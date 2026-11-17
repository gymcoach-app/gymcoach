import { z } from 'zod';
import {
  AVG_HR_MAX,
  AVG_HR_MIN,
  MAX_DISTANCE_M,
  MAX_DURATION_SEC,
} from '@/lib/cardio';
import { IMPORT_CSV_MAX_BYTES } from '@/lib/import/csv';
import { cleanTrackPoint, downsampleTrack, type TrackPoint } from '@/lib/import/track';

// ============================================================
// GPX track file parser (issue #204) - pure, no DB
// ============================================================
// GPX (GPS Exchange) text in, ONE normalized cardio activity out. The file is
// UNTRUSTED XML from an arbitrary platform export (Strava, Komoot, Apple).
//
// SECURITY - this mirrors lib/import/tcx.ts EXACTLY, deliberately: a general
// XML parser is exactly the attack surface (XXE, external DTD fetches,
// entity-expansion bombs) this import must not have, and the repo carries no
// XML dependency. The GPX shape we need is tiny and rigid (trk > trkseg >
// trkpt[@lat,@lon] with optional <time> and an HR extension), so this module
// scans for those known tags with single-pass indexOf walks and validates
// every extracted value with Zod. By construction:
//   - NO entity resolution exists: there is no entity table and no decoding of
//     any "&...;" sequence, so internal entities cannot expand (billion laughs)
//     and external entities cannot be fetched (XXE).
//   - XML comments are stripped before any scanning, so content smuggled inside
//     "<!-- -->" (e.g. a fake <trk>) is never seen - matching a real XML
//     parser. A DTD inside a comment is inert and accepted after stripping.
//   - Any document containing "<!DOCTYPE" or "<!ENTITY" is rejected outright
//     before extraction, so a DTD is never scanned past. After comments are
//     stripped, any remaining "<!" not followed by a letter (a null-byte-split
//     "<!\0DOCTYPE", "<![CDATA[", a bare "<!>") is rejected as a malformed
//     markup declaration - none of these appear in a real export.
//   - All scans are indexOf-based (no regex over attacker-sized input), so a
//     huge attribute or a truncated tag cannot trigger pathological
//     backtracking; unterminated structures simply stop matching.
//   - The trackpoint count is hard-capped (MAX_TRACKPOINTS) so distance/HR work
//     stays linear and bounded even under the byte cap; a hostile file with
//     millions of <trkpt> simply stops being scanned past the cap.
//   - The hard byte cap is re-checked here, independent of the route.
// Output bounds are identical to the cardio set schema (lib/schemas/set.ts),
// so an imported set satisfies the same contract as a manually logged one.
//
// OUT OF SCOPE (totals only, no track stored): elevation, pace splits, and the
// full polyline. We persist duration / distance / optional avg HR.

// Shared import cap (same 5 MB budget as the CSV/TCX importers).
export const GPX_MAX_BYTES = IMPORT_CSV_MAX_BYTES;

// GPX has no sport attribute; an optional <type> may carry one. We map the
// common Strava/Garmin values and default to Other.
export type GpxSport = 'Running' | 'Biking' | 'Other';

export interface GpxActivity {
  startedAt: Date;
  durationSec: number; // last trkpt time - first trkpt time
  distanceM: number | null; // haversine sum over consecutive trkpts; null if <2 points
  avgHr: number | null; // average of trkpt HR extension values, when present
  sport: GpxSport;
  // Downsampled pace/HR track (issue #259), or null when the points carry no
  // usable time / heart rate to chart.
  track: TrackPoint[] | null;
}

// Optional extras of a parse. `samples: true` also returns every sanitized
// sample at full resolution (before the downsample to MAX_TRACK_POINTS), for
// a caller that needs the real peak or a per-set split (issue #576). Bounded
// by the raw sample cap of the parser.
export interface GpxParseOptions {
  samples?: boolean;
}

export interface GpxParseResult {
  ok: boolean;
  fatalError: string | null;
  activity: GpxActivity | null;
  // Only when asked for with `samples: true` and the parse succeeded.
  samples?: TrackPoint[];
}

const fatal = (msg: string): GpxParseResult => ({
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
  sport: z.enum(['Running', 'Biking', 'Other']),
});

// Longest value we ever need (an ISO timestamp); anything longer is hostile or
// garbage and is treated as absent.
const MAX_VALUE_CHARS = 64;

// Sane window for the activity start (same as TCX): nothing before consumer GPS
// existed, nothing further out than tomorrow (small clock skew is fine).
export const GPX_MIN_STARTED_AT = new Date('2000-01-01T00:00:00.000Z');
const STARTED_AT_FUTURE_SLACK_MS = 24 * 60 * 60 * 1000;

// Caps so a hostile file cannot make us accumulate unbounded work even under
// the byte cap. A real ride/run is at most a few tens of thousands of points;
// 200000 is generous while still bounding the haversine loop.
const MAX_TRACKPOINTS = 200_000;
const MAX_TRACKS = 50;

// ------------------------------------------------------------
// indexOf-based tag helpers, copied from the TCX parser's hardened layout. GPX
// here is non-nested for the tags we read (a <trkpt> never contains another
// <trkpt>); namespace prefixes on the HR extension are handled explicitly.
// ------------------------------------------------------------

// Locates `<tag` followed by whitespace, `>` or `/` and returns where its
// content starts (after the closing `>` of the opening tag) plus the opening
// tag's start. Self-closing tags return contentStart === the position after
// "/>", with selfClosing flagged. Unterminated opening tags return null.
function findOpenTag(
  xml: string,
  tag: string,
  from: number,
): { tagStart: number; contentStart: number; selfClosing: boolean } | null {
  const needle = `<${tag}`;
  let i = from;
  for (;;) {
    const at = xml.indexOf(needle, i);
    if (at === -1) return null;
    const after = xml[at + needle.length];
    if (
      after === '>' ||
      after === ' ' ||
      after === '\t' ||
      after === '\n' ||
      after === '\r' ||
      after === '/'
    ) {
      const gt = xml.indexOf('>', at);
      if (gt === -1) return null; // truncated opening tag
      const selfClosing = xml[gt - 1] === '/';
      return { tagStart: at, contentStart: gt + 1, selfClosing };
    }
    i = at + needle.length; // e.g. <trkseg vs <trkpt: keep looking
  }
}

// Returns the inner text of each <tag ...>...</tag> block, in order, capped at
// maxBlocks. Self-closing instances contribute an empty block.
function extractBlocks(xml: string, tag: string, maxBlocks: number): string[] {
  const blocks: string[] = [];
  const close = `</${tag}>`;
  let from = 0;
  while (blocks.length < maxBlocks) {
    const open = findOpenTag(xml, tag, from);
    if (!open) break;
    if (open.selfClosing) {
      blocks.push('');
      from = open.contentStart;
      continue;
    }
    const end = xml.indexOf(close, open.contentStart);
    if (end === -1) break; // truncated: ignore the unterminated block
    blocks.push(xml.slice(open.contentStart, end));
    from = end + close.length;
  }
  return blocks;
}

// First <tag>value</tag> inner text inside `xml`, trimmed, or null. Values
// longer than MAX_VALUE_CHARS are treated as absent (hostile or garbage). A
// self-closing tag has no text -> null.
function firstTagText(xml: string, tag: string): string | null {
  const open = findOpenTag(xml, tag, 0);
  if (!open || open.selfClosing) return null;
  const end = xml.indexOf(`</${tag}>`, open.contentStart);
  if (end === -1 || end - open.contentStart > MAX_VALUE_CHARS) return null;
  const value = xml.slice(open.contentStart, end).trim();
  return value.length > 0 ? value : null;
}

// Reads attr="value" inside the opening tag that starts at tagStart. The scan
// is capped at the end of the opening tag and the value at MAX_VALUE_CHARS, so
// a huge attribute cannot blow anything up - it just reads as absent. Handles
// both double and single quotes (GPX exporters use either).
function attrValue(xml: string, tagStart: number, attr: string): string | null {
  const gt = xml.indexOf('>', tagStart);
  const tagEnd = gt === -1 ? Math.min(xml.length, tagStart + 512) : gt;
  const openTag = xml.slice(tagStart, tagEnd);
  for (const quote of ['"', "'"]) {
    const needle = `${attr}=${quote}`;
    const at = openTag.indexOf(needle);
    if (at === -1) continue;
    const start = at + needle.length;
    const end = openTag.indexOf(quote, start);
    if (end === -1 || end - start > MAX_VALUE_CHARS) return null;
    return openTag.slice(start, end);
  }
  return null;
}

// Removes every "<!-- ... -->" comment, single pass, indexOf-based. An
// unterminated comment drops the rest of the document, exactly like a real XML
// parser refusing to see past it.
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
// Haversine distance between two lat/lon points, in meters. Pure arithmetic,
// no dependency. Mean Earth radius 6371000 m.
// ------------------------------------------------------------
const EARTH_RADIUS_M = 6_371_000;

export function haversineMeters(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return EARTH_RADIUS_M * c;
}

// A trackpoint with valid coordinates (latitude in [-90,90], longitude in
// [-180,180]) and optional time / heart rate.
interface Trkpt {
  lat: number;
  lon: number;
  time: Date | null;
  hr: number | null;
}

// Reads one trkpt's lat/lon attributes and its optional <time> / HR extension.
// Returns null when lat or lon is missing or out of range (a hostile or broken
// point is dropped, not fatal). The HR extension appears as <gpxtpx:hr>,
// <ns3:hr> or a bare <hr>; we read whichever is present first.
function parseTrkpt(xml: string, tagStart: number, content: string): Trkpt | null {
  const latText = attrValue(xml, tagStart, 'lat');
  const lonText = attrValue(xml, tagStart, 'lon');
  const lat = asFiniteNumber(latText);
  const lon = asFiniteNumber(lonText);
  if (lat === null || lon === null) return null;
  if (lat < -90 || lat > 90 || lon < -180 || lon > 180) return null;

  const timeText = firstTagText(content, 'time');
  const time = timeText ? new Date(timeText) : null;
  const validTime = time && !Number.isNaN(time.getTime()) ? time : null;

  // HR extension: try the namespaced forms first, then a bare <hr>.
  let hr: number | null = null;
  for (const tag of ['gpxtpx:hr', 'ns3:hr', 'hr']) {
    const text = firstTagText(content, tag);
    const n = asFiniteNumber(text);
    if (n !== null) {
      hr = n;
      break;
    }
  }

  return { lat, lon, time: validTime, hr };
}

// Maps an optional GPX <type> to our sport enum (case-insensitive). Strava
// emits values like "running"/"cycling"/"9"; we map the obvious word forms and
// default to Other.
function sportForType(type: string | null): GpxSport {
  if (!type) return 'Other';
  const t = type.trim().toLowerCase();
  if (t.includes('run')) return 'Running';
  if (t.includes('bik') || t.includes('cycl') || t.includes('ride')) return 'Biking';
  return 'Other';
}

// ------------------------------------------------------------
// The parser
// ------------------------------------------------------------

export function parseGpx(input: string, options: GpxParseOptions = {}): GpxParseResult {
  if (input.length > GPX_MAX_BYTES) {
    return fatal('File too large: the limit is 5 MB.');
  }

  // Strip comments BEFORE any scanning so commented-out markup (a smuggled
  // <trk>, an inert commented DTD) is never seen, matching a real XML parser.
  const xml = stripComments(input);

  // Reject any DTD or entity declaration outright (XXE / billion-laughs cannot
  // happen by construction: we also never decode entities anywhere).
  const upper = xml.toUpperCase();
  if (upper.includes('<!DOCTYPE') || upper.includes('<!ENTITY')) {
    return fatal('Invalid GPX file: DTD and entity declarations are not allowed.');
  }

  // With comments stripped, every remaining "<!" must open a normal markup
  // declaration (a letter follows). Anything else - "<!\0DOCTYPE", "<![CDATA[",
  // "<!>" - is malformed or evasive and no real export emits it.
  {
    let bang = xml.indexOf('<!');
    while (bang !== -1) {
      const next = xml[bang + 2];
      const isLetter =
        next !== undefined && ((next >= 'a' && next <= 'z') || (next >= 'A' && next <= 'Z'));
      if (!isLetter) {
        return fatal('Invalid GPX file: malformed markup declaration.');
      }
      bang = xml.indexOf('<!', bang + 2);
    }
  }

  if (!xml.includes('<gpx')) {
    return fatal('Not a GPX file: missing <gpx> root.');
  }

  // Collect <trk> blocks (capped). Each track is one segment-set; we read its
  // optional <type> for the sport and all its trackpoints across <trkseg>.
  const trackBlocks: Array<{ tagStart: number; content: string }> = [];
  {
    let from = 0;
    while (trackBlocks.length < MAX_TRACKS) {
      const open = findOpenTag(xml, 'trk', from);
      if (!open) break;
      if (open.selfClosing) {
        from = open.contentStart;
        continue;
      }
      const end = xml.indexOf('</trk>', open.contentStart);
      if (end === -1) break; // truncated track: ignore it
      trackBlocks.push({ tagStart: open.tagStart, content: xml.slice(open.contentStart, end) });
      from = end + '</trk>'.length;
    }
  }
  if (trackBlocks.length === 0) {
    return fatal('No track found in the file (it may be a route/waypoint-only GPX or truncated).');
  }

  // Walk every trackpoint in document order, across all tracks and segments,
  // up to the hard cap. Distance is the haversine sum between consecutive
  // points; duration is last-time minus first-time; HR is averaged over points
  // that carry it. The first track's <type> sets the sport.
  let sport: GpxSport = 'Other';
  let sportSet = false;
  let pointCount = 0;
  let prev: Trkpt | null = null;
  let totalMeters = 0;
  let firstTime: Date | null = null;
  let lastTime: Date | null = null;
  let hrSum = 0;
  let hrCount = 0;
  let capped = false;
  // Per-point samples for the track (issue #259): only points that carry a time
  // can be placed on the timeline; cumulative distance is the haversine sum so
  // far. Bounded by MAX_TRACKPOINTS, like the totals above.
  const rawPoints: Array<{ time: Date; cumMeters: number; hr: number | null }> = [];

  for (const track of trackBlocks) {
    if (!sportSet) {
      // <type> is a direct child of <trk>; reading it from the track content
      // (segments do not carry a <type>) is sufficient.
      sport = sportForType(firstTagText(track.content, 'type'));
      sportSet = true;
    }

    // Iterate <trkpt> within this track (segments are flat here: a trkpt is the
    // same whether or not it sits inside a <trkseg>).
    let from = 0;
    while (pointCount < MAX_TRACKPOINTS) {
      const open = findOpenTag(track.content, 'trkpt', from);
      if (!open) break;
      let content = '';
      let nextFrom: number;
      if (open.selfClosing) {
        nextFrom = open.contentStart;
      } else {
        const end = track.content.indexOf('</trkpt>', open.contentStart);
        if (end === -1) break; // truncated point: stop this track
        content = track.content.slice(open.contentStart, end);
        nextFrom = end + '</trkpt>'.length;
      }
      from = nextFrom;

      const pt = parseTrkpt(track.content, open.tagStart, content);
      if (pt) {
        pointCount += 1;
        if (prev) {
          totalMeters += haversineMeters(prev.lat, prev.lon, pt.lat, pt.lon);
        }
        prev = pt;
        if (pt.time) {
          if (!firstTime || pt.time < firstTime) firstTime = pt.time;
          if (!lastTime || pt.time > lastTime) lastTime = pt.time;
          rawPoints.push({ time: pt.time, cumMeters: totalMeters, hr: pt.hr });
        }
        if (pt.hr !== null && pt.hr > 0) {
          hrSum += pt.hr;
          hrCount += 1;
        }
      }
    }
    if (pointCount >= MAX_TRACKPOINTS) {
      capped = true;
      break;
    }
  }

  if (pointCount === 0) {
    return fatal('No usable trackpoints found (missing or invalid lat/lon coordinates).');
  }
  if (capped) {
    // A file at the cap is almost certainly hostile or corrupt; refuse rather
    // than import a partial, misleading total.
    return fatal('Too many trackpoints: the file exceeds the supported size.');
  }
  if (!firstTime || !lastTime) {
    return fatal('No usable timestamps found: GPX trackpoints must carry <time> to derive duration.');
  }

  const durationMs = lastTime.getTime() - firstTime.getTime();
  if (durationMs <= 0) {
    return fatal('Track duration is zero: the trackpoint timestamps do not advance.');
  }

  if (
    firstTime < GPX_MIN_STARTED_AT ||
    firstTime.getTime() > Date.now() + STARTED_AT_FUTURE_SLACK_MS
  ) {
    return fatal('Activity start time out of range: it must be between 2000-01-01 and tomorrow.');
  }

  const durationSec = Math.round(durationMs / 1000);
  const rawAvgHr = hrCount > 0 ? Math.round(hrSum / hrCount) : null;
  // The summary fields only; the track is built and attached after validation.
  const candidate = {
    startedAt: firstTime,
    durationSec,
    // A single valid point yields no distance; round to cm like TCX.
    distanceM: pointCount >= 2 ? Math.round(totalMeters * 100) / 100 : null,
    // Out-of-bounds heart rate (sensor glitch or hostile value) degrades to
    // "no heart rate" instead of failing the import: it is optional data.
    avgHr: rawAvgHr !== null && rawAvgHr >= AVG_HR_MIN && rawAvgHr <= AVG_HR_MAX ? rawAvgHr : null,
    sport,
  };

  const checked = activitySchema.safeParse(candidate);
  if (!checked.success) {
    return fatal(
      'Activity totals out of bounds: duration must be 1 second to 24 hours and distance at most 1000 km.',
    );
  }
  // Build the downsampled track from the per-point samples, relative to the
  // start. Sanitized/bounded by cleanTrackPoint (not the summary schema) and
  // attached to the validated summary, matching the FIT importer.
  const start = firstTime.getTime();
  const points = rawPoints
    .map((p) => cleanTrackPoint((p.time.getTime() - start) / 1000, p.cumMeters, p.hr))
    .filter((p): p is TrackPoint => p !== null);
  const track = downsampleTrack(points);
  return {
    ok: true,
    fatalError: null,
    activity: { ...checked.data, track },
    ...(options.samples ? { samples: points } : {}),
  };
}

// Default exercise name per GPX sport, matching the TCX importer's mapping so a
// GPX run and a TCX run land on the same exercise. Ownership-scoped
// lookup/creation happens in the route.
export function gpxExerciseName(sport: GpxSport): string {
  switch (sport) {
    case 'Running':
      return 'Running';
    case 'Biking':
      return 'Cycling';
    default:
      return 'Cardio (imported)';
  }
}
