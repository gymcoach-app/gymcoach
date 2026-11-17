import { z } from 'zod';
import {
  AVG_HR_MAX,
  AVG_HR_MIN,
  MAX_DISTANCE_M,
  MAX_DURATION_SEC,
  MAX_HR_MAX,
  MAX_HR_MIN,
} from '@/lib/cardio';
import { IMPORT_CSV_MAX_BYTES } from '@/lib/import/csv';
import { cleanTrackPoint, downsampleTrack, type TrackPoint } from '@/lib/import/track';

// ============================================================
// TCX activity file parser (issue #152) - pure, no DB
// ============================================================
// TCX (Training Center XML) text in, ONE normalized cardio activity out.
// The file is UNTRUSTED XML from an arbitrary watch/platform export.
//
// SECURITY - why this is a minimal extractor and not an XML parser:
// a general XML parser is exactly the attack surface (XXE, external DTD
// fetches, entity-expansion bombs) this import must not have, and the repo
// deliberately carries no XML dependency. The TCX shape we need is tiny and
// rigid (Activity > Lap > numeric totals), so this module scans for those
// known tags with single-pass indexOf walks and validates every extracted
// value with Zod. By construction:
//   - NO entity resolution exists: there is no entity table and no decoding
//     of any "&...;" sequence, so internal entities cannot expand (billion
//     laughs) and external entities cannot be fetched (XXE).
//   - XML comments are stripped before any scanning, so content smuggled
//     inside "<!-- -->" (e.g. a fake <Activity>) is never seen - matching
//     what a real XML parser would do. A DTD inside a comment is inert and
//     therefore accepted after stripping.
//   - Any document containing "<!DOCTYPE" or "<!ENTITY" is rejected outright
//     before extraction, so a DTD is never even scanned past. After comments
//     are stripped, any remaining "<!" not followed by a letter (a null-byte-
//     split "<!\0DOCTYPE", "<![CDATA[", a bare "<!>") is rejected as a
//     malformed markup declaration - none of these appear in a real export.
//   - The activity start time is clamped to a sane window (2000-01-01 to
//     now + 1 day), so an extreme or hostile timestamp cannot land a session
//     in year 0 or 9999.
//   - All scans are indexOf-based (no regex over attacker-sized input), so a
//     huge attribute or a truncated tag cannot trigger pathological
//     backtracking; unterminated structures simply stop matching.
//   - The hard byte cap is re-checked here, independent of the route.
// Output bounds are identical to the cardio set schema (lib/schemas/set.ts),
// so an imported set satisfies the same contract as a manually logged one.

// Shared import cap (same 5 MB budget as the CSV importers).
export const TCX_MAX_BYTES = IMPORT_CSV_MAX_BYTES;

// The TCX Sport attribute is an enum of exactly these three values.
export type TcxSport = 'Running' | 'Biking' | 'Other';

export interface TcxActivity {
  startedAt: Date;
  durationSec: number; // whole seconds, summed over laps
  distanceM: number | null; // summed over laps; null when no lap carries one
  avgHr: number | null; // duration-weighted average of lap averages
  maxHr: number | null; // max of the per-lap MaximumHeartRateBpm values
  sport: TcxSport;
  // Downsampled pace/HR track from the per-second <Trackpoint> samples (issue
  // #259), or null when the file carries no usable trackpoints.
  track: TrackPoint[] | null;
}

// Optional extras of a parse. `samples: true` also returns every sanitized
// sample at full resolution (before the downsample to MAX_TRACK_POINTS), for
// a caller that needs the real peak or a per-set split (issue #576). Bounded
// by the raw sample cap of the parser.
export interface TcxParseOptions {
  samples?: boolean;
}

export interface TcxParseResult {
  ok: boolean;
  fatalError: string | null;
  activity: TcxActivity | null;
  // Only when asked for with `samples: true` and the parse succeeded.
  samples?: TrackPoint[];
}

const fatal = (msg: string): TcxParseResult => ({
  ok: false,
  fatalError: msg,
  activity: null,
});

// Bounds identical to the cardio set contract (lib/schemas/set.ts).
const activitySchema = z.object({
  startedAt: z.date(),
  durationSec: z.number().int().min(1).max(MAX_DURATION_SEC),
  distanceM: z.number().min(0).max(MAX_DISTANCE_M).nullable(),
  avgHr: z.number().int().min(AVG_HR_MIN).max(AVG_HR_MAX).nullable(),
  maxHr: z.number().int().min(MAX_HR_MIN).max(MAX_HR_MAX).nullable(),
  sport: z.enum(['Running', 'Biking', 'Other']),
});

// Longest value we ever need (an ISO timestamp); anything longer is hostile
// or garbage and is treated as absent.
const MAX_VALUE_CHARS = 64;

// Sane window for the activity start: nothing before consumer GPS watches
// existed, nothing further out than tomorrow (small clock skew is fine).
export const TCX_MIN_STARTED_AT = new Date('2000-01-01T00:00:00.000Z');
const STARTED_AT_FUTURE_SLACK_MS = 24 * 60 * 60 * 1000;

// ------------------------------------------------------------
// indexOf-based tag helpers. They handle the narrow, non-nested TCX layout
// (an <Activity> never contains another <Activity>, a <Lap> never another
// <Lap>); namespace prefixes are not used by TCX exports for these elements.
// ------------------------------------------------------------

// Returns the inner text of each <tag ...>...</tag> block, in order.
function extractBlocks(xml: string, tag: string, maxBlocks: number): string[] {
  const blocks: string[] = [];
  const close = `</${tag}>`;
  let from = 0;
  while (blocks.length < maxBlocks) {
    const open = findOpenTag(xml, tag, from);
    if (!open) break;
    const end = xml.indexOf(close, open.contentStart);
    if (end === -1) break; // truncated: ignore the unterminated block
    blocks.push(xml.slice(open.contentStart, end));
    from = end + close.length;
  }
  return blocks;
}

// Locates `<tag` followed by whitespace or `>` and returns where its content
// starts (after the closing `>` of the opening tag). Self-closing tags and
// unterminated opening tags return null.
function findOpenTag(
  xml: string,
  tag: string,
  from: number,
): { tagStart: number; contentStart: number } | null {
  const needle = `<${tag}`;
  let i = from;
  for (;;) {
    const at = xml.indexOf(needle, i);
    if (at === -1) return null;
    const after = xml[at + needle.length];
    if (after === '>' || after === ' ' || after === '\t' || after === '\n' || after === '\r') {
      const gt = xml.indexOf('>', at);
      if (gt === -1) return null; // truncated opening tag
      if (xml[gt - 1] === '/') {
        i = gt + 1; // self-closing: no content, keep looking
        continue;
      }
      return { tagStart: at, contentStart: gt + 1 };
    }
    i = at + needle.length; // e.g. <Track vs <Trackpoint: keep looking
  }
}

// First <tag>value</tag> inner text inside `xml`, trimmed, or null. Values
// longer than MAX_VALUE_CHARS are treated as absent (hostile or garbage).
function firstTagText(xml: string, tag: string): string | null {
  const open = findOpenTag(xml, tag, 0);
  if (!open) return null;
  const end = xml.indexOf(`</${tag}>`, open.contentStart);
  if (end === -1 || end - open.contentStart > MAX_VALUE_CHARS) return null;
  const value = xml.slice(open.contentStart, end).trim();
  return value.length > 0 ? value : null;
}

// Reads attr="value" inside the opening tag that starts at tagStart. The scan
// is capped at the end of the opening tag and the value at MAX_VALUE_CHARS,
// so a huge attribute cannot blow anything up - it just reads as absent.
function attrValue(xml: string, tagStart: number, attr: string): string | null {
  const gt = xml.indexOf('>', tagStart);
  const tagEnd = gt === -1 ? Math.min(xml.length, tagStart + 512) : gt;
  const openTag = xml.slice(tagStart, tagEnd);
  const needle = `${attr}="`;
  const at = openTag.indexOf(needle);
  if (at === -1) return null;
  const start = at + needle.length;
  const end = openTag.indexOf('"', start);
  if (end === -1 || end - start > MAX_VALUE_CHARS) return null;
  return openTag.slice(start, end);
}

// Removes every <tag ...>...</tag> subtree (used to drop the per-second
// <Track> samples so lap totals are read from the Lap level only).
function stripBlocks(xml: string, tag: string): string {
  const close = `</${tag}>`;
  let out = '';
  let from = 0;
  for (;;) {
    const open = findOpenTag(xml, tag, from);
    if (!open) {
      out += xml.slice(from);
      return out;
    }
    const end = xml.indexOf(close, open.contentStart);
    if (end === -1) {
      // Truncated subtree: drop everything from the opening tag on.
      out += xml.slice(from, open.tagStart);
      return out;
    }
    out += xml.slice(from, open.tagStart);
    from = end + close.length;
  }
}

// Removes every "<!-- ... -->" comment, single pass, indexOf-based. An
// unterminated comment drops the rest of the document, exactly like a real
// XML parser refusing to see past it.
function stripComments(xml: string): string {
  const open = '<!--';
  const close = '-->';
  if (!xml.includes(open)) return xml;
  let out = '';
  let from = 0;
  for (;;) {
    const at = xml.indexOf(open, from);
    if (at === -1) return out + xml.slice(from);
    out += xml.slice(from, at);
    const end = xml.indexOf(close, at + open.length);
    if (end === -1) return out; // unterminated comment: drop the rest
    from = end + close.length;
  }
}

function asFiniteNumber(text: string | null): number | null {
  if (text === null) return null;
  const n = Number(text);
  return Number.isFinite(n) ? n : null;
}

// ------------------------------------------------------------
// The parser
// ------------------------------------------------------------

// Caps so a hostile file cannot make us accumulate unbounded work even under
// the byte cap: a real export has one activity and at most a few hundred laps.
const MAX_ACTIVITIES = 20;
const MAX_LAPS = 1000;
// Hard cap on per-second samples collected for the track, so a hostile file
// cannot blow up memory (the shared downsampleTrack then caps stored points).
const MAX_TRACKPOINTS = 200_000;

export function parseTcx(input: string, options: TcxParseOptions = {}): TcxParseResult {
  if (input.length > TCX_MAX_BYTES) {
    return fatal('File too large: the limit is 5 MB.');
  }

  // Strip comments BEFORE any scanning so commented-out markup (a smuggled
  // <Activity>, an inert commented DTD) is never seen, matching a real XML
  // parser's view of the document.
  const xml = stripComments(input);

  // Reject any DTD or entity declaration outright (XXE / billion-laughs by
  // construction cannot happen: we also never decode entities anywhere).
  const upper = xml.toUpperCase();
  if (upper.includes('<!DOCTYPE') || upper.includes('<!ENTITY')) {
    return fatal('Invalid TCX file: DTD and entity declarations are not allowed.');
  }

  // With comments already stripped, every remaining "<!" must open a normal
  // markup declaration (a letter follows). Anything else - "<!\0DOCTYPE",
  // "<![CDATA[", "<!>" - is malformed or evasive and no real export emits it.
  {
    let bang = xml.indexOf('<!');
    while (bang !== -1) {
      const next = xml[bang + 2];
      const isLetter =
        next !== undefined && ((next >= 'a' && next <= 'z') || (next >= 'A' && next <= 'Z'));
      if (!isLetter) {
        return fatal('Invalid TCX file: malformed markup declaration.');
      }
      bang = xml.indexOf('<!', bang + 2);
    }
  }

  if (!xml.includes('<TrainingCenterDatabase')) {
    return fatal('Not a TCX file: missing TrainingCenterDatabase root.');
  }

  const activityBlocks: Array<{ tagStart: number; content: string }> = [];
  {
    let from = 0;
    while (activityBlocks.length < MAX_ACTIVITIES) {
      const open = findOpenTag(xml, 'Activity', from);
      if (!open) break;
      const end = xml.indexOf('</Activity>', open.contentStart);
      if (end === -1) break; // truncated activity: ignore it
      activityBlocks.push({
        tagStart: open.tagStart,
        content: xml.slice(open.contentStart, end),
      });
      from = end + '</Activity>'.length;
    }
  }
  if (activityBlocks.length === 0) {
    return fatal('No activity found in the file (it may be truncated or empty).');
  }

  // One TCX file = one cardio session: when a file carries several activities
  // (a multisport export), their lap totals are summed into a single session
  // anchored on the earliest start; the first activity picks the sport.
  let totalSeconds = 0;
  let totalMeters = 0;
  let sawDistance = false;
  let hrWeightedSum = 0;
  let hrSeconds = 0;
  // Max HR is a peak, so it is the max over the per-lap MaximumHeartRateBpm
  // values (not a sum or an average), matching issue #203's documented choice.
  let maxHrSeen: number | null = null;
  let earliestStart: Date | null = null;
  let sport: TcxSport = 'Other';
  let sportSet = false;
  // Per-second samples for the track (issue #259): absolute time + cumulative
  // distance (TCX Trackpoint DistanceMeters is cumulative from the start) + HR.
  // Bounded by MAX_TRACKPOINTS so a hostile file cannot exhaust memory.
  const rawPoints: { time: Date; cumMeters: number | null; hr: number | null }[] = [];

  for (const activity of activityBlocks) {
    const sportAttr = attrValue(xml, activity.tagStart, 'Sport');
    if (!sportSet) {
      sport = sportAttr === 'Running' || sportAttr === 'Biking' ? sportAttr : 'Other';
      sportSet = true;
    }

    // <Id> is the activity start timestamp in TCX.
    const idText = firstTagText(stripBlocks(activity.content, 'Lap'), 'Id');
    const idDate = idText ? new Date(idText) : null;
    if (idDate && !Number.isNaN(idDate.getTime())) {
      if (!earliestStart || idDate < earliestStart) earliestStart = idDate;
    }

    for (const lap of extractBlocks(activity.content, 'Lap', MAX_LAPS)) {
      // Drop the per-second samples: <Trackpoint> elements also contain
      // DistanceMeters and HeartRateBpm, which must not be summed as totals.
      const lapTotals = stripBlocks(lap, 'Track');

      const seconds = asFiniteNumber(firstTagText(lapTotals, 'TotalTimeSeconds'));
      if (seconds === null || seconds <= 0) continue; // empty/garbage lap
      totalSeconds += seconds;

      const meters = asFiniteNumber(firstTagText(lapTotals, 'DistanceMeters'));
      if (meters !== null && meters > 0) {
        totalMeters += meters;
        sawDistance = true;
      }

      const hrBlock = extractBlocks(lapTotals, 'AverageHeartRateBpm', 1)[0];
      const hr = hrBlock === undefined ? null : asFiniteNumber(firstTagText(hrBlock, 'Value'));
      if (hr !== null && hr > 0) {
        hrWeightedSum += hr * seconds;
        hrSeconds += seconds;
      }

      const maxHrBlock = extractBlocks(lapTotals, 'MaximumHeartRateBpm', 1)[0];
      const lapMaxHr =
        maxHrBlock === undefined ? null : asFiniteNumber(firstTagText(maxHrBlock, 'Value'));
      if (lapMaxHr !== null && lapMaxHr > 0) {
        maxHrSeen = maxHrSeen === null ? lapMaxHr : Math.max(maxHrSeen, lapMaxHr);
      }

      // Collect the per-second <Trackpoint> samples for the track (issue #259):
      // each carries a <Time>, a cumulative <DistanceMeters>, and an optional
      // <HeartRateBpm><Value>. Bounded by the remaining trackpoint budget.
      if (rawPoints.length < MAX_TRACKPOINTS) {
        for (const tp of extractBlocks(lap, 'Trackpoint', MAX_TRACKPOINTS - rawPoints.length)) {
          const timeText = firstTagText(tp, 'Time');
          const time = timeText ? new Date(timeText) : null;
          if (!time || Number.isNaN(time.getTime())) continue; // need a time to place it
          const hrBlk = extractBlocks(tp, 'HeartRateBpm', 1)[0];
          rawPoints.push({
            time,
            cumMeters: asFiniteNumber(firstTagText(tp, 'DistanceMeters')),
            hr: hrBlk === undefined ? null : asFiniteNumber(firstTagText(hrBlk, 'Value')),
          });
        }
      }
    }

    // Fall back to the first lap's StartTime when <Id> is missing/invalid.
    if (!earliestStart) {
      const firstLap = findOpenTag(activity.content, 'Lap', 0);
      if (firstLap) {
        const startText = attrValue(activity.content, firstLap.tagStart, 'StartTime');
        const startDate = startText ? new Date(startText) : null;
        if (startDate && !Number.isNaN(startDate.getTime())) earliestStart = startDate;
      }
    }
  }

  if (totalSeconds <= 0) {
    return fatal('No usable lap found: the file carries no positive TotalTimeSeconds.');
  }
  if (!earliestStart) {
    return fatal('No activity start time found (missing or invalid Id / Lap StartTime).');
  }
  if (
    earliestStart < TCX_MIN_STARTED_AT ||
    earliestStart.getTime() > Date.now() + STARTED_AT_FUTURE_SLACK_MS
  ) {
    return fatal('Activity start time out of range: it must be between 2000-01-01 and tomorrow.');
  }

  const durationSec = Math.round(totalSeconds);
  const rawAvgHr = hrSeconds > 0 ? Math.round(hrWeightedSum / hrSeconds) : null;
  const rawMaxHr = maxHrSeen !== null ? Math.round(maxHrSeen) : null;
  // Summary fields only; the track is built and attached after validation.
  const candidate = {
    startedAt: earliestStart,
    durationSec,
    distanceM: sawDistance ? Math.round(totalMeters * 100) / 100 : null,
    // Out-of-bounds heart rate (sensor glitch or hostile value) degrades to
    // "no heart rate" instead of failing the import: it is optional data.
    avgHr: rawAvgHr !== null && rawAvgHr >= AVG_HR_MIN && rawAvgHr <= AVG_HR_MAX ? rawAvgHr : null,
    // Same degrade-to-null on an out-of-bounds peak (issue #203).
    maxHr: rawMaxHr !== null && rawMaxHr >= MAX_HR_MIN && rawMaxHr <= MAX_HR_MAX ? rawMaxHr : null,
    sport,
  };

  const checked = activitySchema.safeParse(candidate);
  if (!checked.success) {
    return fatal(
      'Activity totals out of bounds: duration must be 1 second to 24 hours and distance at most 1000 km.',
    );
  }
  // Build the downsampled track from the per-second samples, relative to the
  // start, sanitized/bounded by cleanTrackPoint and attached to the validated
  // summary - matching the FIT and GPX importers.
  const start = earliestStart.getTime();
  const points = rawPoints
    .map((pt) => cleanTrackPoint((pt.time.getTime() - start) / 1000, pt.cumMeters, pt.hr))
    .filter((pt): pt is TrackPoint => pt !== null);
  const track = downsampleTrack(points);
  return {
    ok: true,
    fatalError: null,
    activity: { ...checked.data, track },
    ...(options.samples ? { samples: points } : {}),
  };
}

// Default exercise name per TCX sport, matching the seeded catalog names
// where one exists ('Running', 'Cycling'); 'Other' creates/reuses a generic
// cardio exercise. Ownership-scoped lookup/creation happens in the route.
export function tcxExerciseName(sport: TcxSport): string {
  switch (sport) {
    case 'Running':
      return 'Running';
    case 'Biking':
      return 'Cycling';
    default:
      return 'Cardio (imported)';
  }
}
