import { describe, it, expect } from 'vitest';
import { parseTcx, tcxExerciseName, TCX_MAX_BYTES, TCX_MIN_STARTED_AT } from './tcx';
import { measureGrowth } from '@/lib/testing/cpu-cost';

// ============================================================
// Happy-path fixtures
// ============================================================

// A realistic two-lap run with per-second Trackpoints whose DistanceMeters
// and HeartRateBpm values MUST NOT leak into the lap totals.
const RUN_TCX = `<?xml version="1.0" encoding="UTF-8"?>
<TrainingCenterDatabase xmlns="http://www.garmin.com/xmlschemas/TrainingCenterDatabase/v2">
  <Activities>
    <Activity Sport="Running">
      <Id>2026-06-10T07:30:00.000Z</Id>
      <Lap StartTime="2026-06-10T07:30:00.000Z">
        <TotalTimeSeconds>900.0</TotalTimeSeconds>
        <DistanceMeters>2500.0</DistanceMeters>
        <Calories>180</Calories>
        <AverageHeartRateBpm xsi:type="HeartRateInBeatsPerMinute_t"><Value>150</Value></AverageHeartRateBpm>
        <MaximumHeartRateBpm><Value>165</Value></MaximumHeartRateBpm>
        <Intensity>Active</Intensity>
        <TriggerMethod>Manual</TriggerMethod>
        <Track>
          <Trackpoint>
            <Time>2026-06-10T07:30:01.000Z</Time>
            <DistanceMeters>3.2</DistanceMeters>
            <HeartRateBpm><Value>120</Value></HeartRateBpm>
          </Trackpoint>
          <Trackpoint>
            <Time>2026-06-10T07:30:02.000Z</Time>
            <DistanceMeters>6.5</DistanceMeters>
            <HeartRateBpm><Value>121</Value></HeartRateBpm>
          </Trackpoint>
        </Track>
      </Lap>
      <Lap StartTime="2026-06-10T07:45:00.000Z">
        <TotalTimeSeconds>300.0</TotalTimeSeconds>
        <DistanceMeters>800.0</DistanceMeters>
        <AverageHeartRateBpm><Value>170</Value></AverageHeartRateBpm>
        <Track>
          <Trackpoint>
            <Time>2026-06-10T07:45:01.000Z</Time>
            <DistanceMeters>2501.0</DistanceMeters>
          </Trackpoint>
        </Track>
      </Lap>
    </Activity>
  </Activities>
</TrainingCenterDatabase>`;

const minimalTcx = (inner: string) =>
  `<?xml version="1.0"?><TrainingCenterDatabase><Activities>${inner}</Activities></TrainingCenterDatabase>`;

describe('parseTcx (happy paths)', () => {
  it('takes totals from lap fields (not trackpoint sums) and captures the track', () => {
    const res = parseTcx(RUN_TCX);
    expect(res.ok).toBe(true);
    // Totals come from the lap fields - trackpoint DistanceMeters/HeartRateBpm
    // are never summed into them.
    expect(res.activity).toMatchObject({
      startedAt: new Date('2026-06-10T07:30:00.000Z'),
      durationSec: 1200,
      distanceM: 3300,
      // Duration-weighted: (150*900 + 170*300) / 1200 = 155.
      avgHr: 155,
      // Max-of-laps: lap 1 carries MaximumHeartRateBpm 165, lap 2 carries none.
      maxHr: 165,
      sport: 'Running',
    });
    // The per-second <Trackpoint> samples are now captured as a track (#259).
    expect(Array.isArray(res.activity?.track)).toBe(true);
    expect(res.activity!.track!.length).toBeGreaterThan(0);
  });

  it('handles a duration-only activity without distance or heart rate', () => {
    const res = parseTcx(
      minimalTcx(
        `<Activity Sport="Biking"><Id>2026-06-09T18:00:00Z</Id>` +
          `<Lap StartTime="2026-06-09T18:00:00Z"><TotalTimeSeconds>600</TotalTimeSeconds></Lap></Activity>`,
      ),
    );
    expect(res.ok).toBe(true);
    expect(res.activity).toMatchObject({
      durationSec: 600,
      distanceM: null,
      avgHr: null,
      sport: 'Biking',
    });
  });

  it('falls back to the first Lap StartTime when Id is missing', () => {
    const res = parseTcx(
      minimalTcx(
        `<Activity Sport="Other"><Lap StartTime="2026-06-08T06:00:00Z">` +
          `<TotalTimeSeconds>120</TotalTimeSeconds></Lap></Activity>`,
      ),
    );
    expect(res.ok).toBe(true);
    expect(res.activity?.startedAt).toEqual(new Date('2026-06-08T06:00:00Z'));
    expect(res.activity?.sport).toBe('Other');
  });

  it('treats an unknown Sport attribute as Other', () => {
    const res = parseTcx(
      minimalTcx(
        `<Activity Sport="Swimming"><Id>2026-06-08T06:00:00Z</Id>` +
          `<Lap><TotalTimeSeconds>60</TotalTimeSeconds></Lap></Activity>`,
      ),
    );
    expect(res.ok).toBe(true);
    expect(res.activity?.sport).toBe('Other');
  });

  it('sums a multi-activity file into one session anchored on the earliest start', () => {
    const res = parseTcx(
      minimalTcx(
        `<Activity Sport="Running"><Id>2026-06-08T07:00:00Z</Id>` +
          `<Lap><TotalTimeSeconds>300</TotalTimeSeconds><DistanceMeters>1000</DistanceMeters></Lap></Activity>` +
          `<Activity Sport="Biking"><Id>2026-06-08T06:00:00Z</Id>` +
          `<Lap><TotalTimeSeconds>300</TotalTimeSeconds></Lap></Activity>`,
      ),
    );
    expect(res.ok).toBe(true);
    expect(res.activity).toMatchObject({
      startedAt: new Date('2026-06-08T06:00:00Z'),
      durationSec: 600,
      distanceM: 1000,
      sport: 'Running',
    });
  });

  it('skips empty or garbage laps but keeps the valid ones', () => {
    const res = parseTcx(
      minimalTcx(
        `<Activity Sport="Running"><Id>2026-06-08T07:00:00Z</Id>` +
          `<Lap><TotalTimeSeconds>0</TotalTimeSeconds></Lap>` +
          `<Lap><TotalTimeSeconds>not-a-number</TotalTimeSeconds></Lap>` +
          `<Lap><TotalTimeSeconds>240</TotalTimeSeconds></Lap></Activity>`,
      ),
    );
    expect(res.ok).toBe(true);
    expect(res.activity?.durationSec).toBe(240);
  });
});

// ============================================================
// Hostile fixtures (issue #152 security bar)
// ============================================================

describe('parseTcx (hostile input)', () => {
  it('rejects a file with an internal DTD outright', () => {
    const res = parseTcx(
      `<?xml version="1.0"?><!DOCTYPE TrainingCenterDatabase [<!ELEMENT TrainingCenterDatabase ANY>]>` +
        minimalTcx(
          `<Activity Sport="Running"><Id>2026-06-08T07:00:00Z</Id>` +
            `<Lap><TotalTimeSeconds>60</TotalTimeSeconds></Lap></Activity>`,
        ),
    );
    expect(res.ok).toBe(false);
    expect(res.fatalError).toMatch(/DTD and entity declarations are not allowed/);
  });

  it('rejects an external entity (XXE) attempt outright', () => {
    const res = parseTcx(
      `<?xml version="1.0"?><!DOCTYPE foo [<!ENTITY xxe SYSTEM "file:///etc/passwd">]>` +
        `<TrainingCenterDatabase><Activities><Activity Sport="Running">` +
        `<Id>&xxe;</Id><Lap><TotalTimeSeconds>60</TotalTimeSeconds></Lap>` +
        `</Activity></Activities></TrainingCenterDatabase>`,
    );
    expect(res.ok).toBe(false);
    expect(res.fatalError).toMatch(/not allowed/);
  });

  // A billion-laughs document: every entity is ten of the one before, so
  // `levels` of them stand for 3 x 10^levels characters once expanded.
  function entityBomb(levels: number): string {
    let declarations = '<!ENTITY lol1 "lol">';
    for (let level = 2; level <= levels; level++) {
      declarations += `<!ENTITY lol${level} "${`&lol${level - 1};`.repeat(10)}">`;
    }
    return (
      `<?xml version="1.0"?><!DOCTYPE lolz [${declarations}]>` +
      `<TrainingCenterDatabase>&lol${levels};</TrainingCenterDatabase>`
    );
  }

  // "Fast" is measured as growth, not as milliseconds on the wall clock (the
  // old bound, 1000 ms, depended on the machine and was a hundred thousand
  // times what the rejection takes, #593). Three more levels make the document
  // about twice as long and what it expands to a thousand times as long: a
  // parser that rejects it outright takes about twice as long (measured 1 to 3
  // times: a rejection is a few microseconds, which is hard to time), one that
  // expands anything first hundreds of times as long (measured 560 to 1050).
  it('rejects a billion-laughs entity bomb outright (and fast)', () => {
    for (const levels of [3, 6, 9]) {
      const res = parseTcx(entityBomb(levels));
      expect(res.ok).toBe(false);
      expect(res.fatalError).toMatch(/not allowed/);
    }
    const bombs = new Map([3, 6].map((levels) => [entityBomb(levels).length, entityBomb(levels)]));
    const [small, large] = [...bombs.keys()] as [number, number];
    const growth = measureGrowth(
      (length) => {
        parseTcx(bombs.get(length)!);
      },
      small,
      large,
    );
    expect(
      growth.ratio,
      `${growth.smallMs.toFixed(4)} ms for 3 levels, ${growth.largeMs.toFixed(4)} ms for 6`,
    ).toBeLessThan(25);
  });

  it('never expands entity references even without a DTD (no entity table exists)', () => {
    // An undeclared entity in a numeric field: it simply fails Number(), so
    // the lap is skipped - nothing is ever resolved or substituted.
    const res = parseTcx(
      minimalTcx(
        `<Activity Sport="Running"><Id>2026-06-08T07:00:00Z</Id>` +
          `<Lap><TotalTimeSeconds>&evil;</TotalTimeSeconds></Lap></Activity>`,
      ),
    );
    expect(res.ok).toBe(false);
    expect(res.fatalError).toMatch(/No usable lap/);
  });

  it('handles a truncated file gracefully', () => {
    const res = parseTcx(RUN_TCX.slice(0, Math.floor(RUN_TCX.length / 2)));
    expect(res.ok).toBe(false);
    expect(res.fatalError).toBeTruthy();
  });

  it('handles a truncated opening tag without hanging', () => {
    const res = parseTcx(`<TrainingCenterDatabase><Activities><Activity Sport="Run`);
    expect(res.ok).toBe(false);
  });

  it('treats a huge attribute value as absent instead of processing it', () => {
    const huge = 'A'.repeat(100_000);
    const res = parseTcx(
      minimalTcx(
        `<Activity Sport="${huge}"><Id>2026-06-08T07:00:00Z</Id>` +
          `<Lap StartTime="${huge}"><TotalTimeSeconds>60</TotalTimeSeconds></Lap></Activity>`,
      ),
    );
    // The Sport scan is capped: the value reads as absent -> Other.
    expect(res.ok).toBe(true);
    expect(res.activity?.sport).toBe('Other');
  });

  it('treats huge element text as absent instead of buffering it', () => {
    const huge = '9'.repeat(100_000);
    const res = parseTcx(
      minimalTcx(
        `<Activity Sport="Running"><Id>2026-06-08T07:00:00Z</Id>` +
          `<Lap><TotalTimeSeconds>${huge}</TotalTimeSeconds></Lap>` +
          `<Lap><TotalTimeSeconds>60</TotalTimeSeconds></Lap></Activity>`,
      ),
    );
    expect(res.ok).toBe(true);
    expect(res.activity?.durationSec).toBe(60);
  });

  it('rejects a file over the shared byte cap', () => {
    const res = parseTcx('a'.repeat(TCX_MAX_BYTES + 1));
    expect(res.ok).toBe(false);
    expect(res.fatalError).toMatch(/too large/i);
  });

  it('rejects non-TCX XML and empty input', () => {
    expect(parseTcx('<html><body>hi</body></html>').ok).toBe(false);
    expect(parseTcx('').ok).toBe(false);
    expect(parseTcx('not xml at all').ok).toBe(false);
  });

  it('ignores an <Activity> smuggled inside an XML comment', () => {
    // A real XML parser never sees commented-out markup; neither do we.
    const res = parseTcx(
      minimalTcx(
        `<!-- <Activity Sport="Biking"><Id>2026-06-01T05:00:00Z</Id>` +
          `<Lap><TotalTimeSeconds>9999</TotalTimeSeconds>` +
          `<DistanceMeters>999999</DistanceMeters></Lap></Activity> -->` +
          `<Activity Sport="Running"><Id>2026-06-08T07:00:00Z</Id>` +
          `<Lap><TotalTimeSeconds>60</TotalTimeSeconds></Lap></Activity>`,
      ),
    );
    expect(res.ok).toBe(true);
    expect(res.activity).toMatchObject({
      startedAt: new Date('2026-06-08T07:00:00Z'),
      durationSec: 60,
      distanceM: null,
      sport: 'Running',
    });
  });

  it('accepts a file whose DTD is commented out (inert by construction)', () => {
    // Comments are stripped first, so a commented DOCTYPE is simply absent -
    // exactly what a real XML parser would conclude.
    const res = parseTcx(
      `<?xml version="1.0"?><!-- <!DOCTYPE TrainingCenterDatabase SYSTEM "http://evil.example/x.dtd"> -->` +
        minimalTcx(
          `<Activity Sport="Running"><Id>2026-06-08T07:00:00Z</Id>` +
            `<Lap><TotalTimeSeconds>60</TotalTimeSeconds></Lap></Activity>`,
        ),
    );
    expect(res.ok).toBe(true);
    expect(res.activity?.durationSec).toBe(60);
  });

  it('drops everything after an unterminated comment instead of scanning it', () => {
    const res = parseTcx(
      minimalTcx(
        `<!-- never closed <Activity Sport="Running"><Id>2026-06-08T07:00:00Z</Id>` +
          `<Lap><TotalTimeSeconds>60</TotalTimeSeconds></Lap></Activity>`,
      ),
    );
    expect(res.ok).toBe(false);
    expect(res.fatalError).toMatch(/No activity found/);
  });

  it('rejects a null-byte-split <!DOCTYPE as a malformed markup declaration', () => {
    // "<!" + NUL + "DOCTYPE" dodges the plain substring check but is not
    // well-formed XML; the tightened "<!" scan rejects it outright, proving
    // it can never smuggle a DTD past the gate.
    const res = parseTcx(
      `<?xml version="1.0"?><!\u0000DOCTYPE foo [<!\u0000ENTITY xxe SYSTEM "file:///etc/passwd">]>` +
        minimalTcx(
          `<Activity Sport="Running"><Id>2026-06-08T07:00:00Z</Id>` +
            `<Lap><TotalTimeSeconds>60</TotalTimeSeconds></Lap></Activity>`,
        ),
    );
    expect(res.ok).toBe(false);
    expect(res.fatalError).toMatch(/malformed markup declaration/);
  });

  it('rejects CDATA sections (no real TCX export emits them)', () => {
    const res = parseTcx(
      minimalTcx(
        `<Activity Sport="Running"><Id>2026-06-08T07:00:00Z</Id>` +
          `<Lap><TotalTimeSeconds><![CDATA[60]]></TotalTimeSeconds></Lap></Activity>`,
      ),
    );
    expect(res.ok).toBe(false);
    expect(res.fatalError).toMatch(/malformed markup declaration/);
  });

  it('rejects an activity with no usable start time', () => {
    const res = parseTcx(
      minimalTcx(
        `<Activity Sport="Running"><Id>not-a-date</Id>` +
          `<Lap><TotalTimeSeconds>60</TotalTimeSeconds></Lap></Activity>`,
      ),
    );
    expect(res.ok).toBe(false);
    expect(res.fatalError).toMatch(/start time/i);
  });
});

// ============================================================
// Bounds (identical to the cardio set contract)
// ============================================================

describe('parseTcx (bounds)', () => {
  it('rejects a duration over 24 hours', () => {
    const res = parseTcx(
      minimalTcx(
        `<Activity Sport="Running"><Id>2026-06-08T07:00:00Z</Id>` +
          `<Lap><TotalTimeSeconds>90000</TotalTimeSeconds></Lap></Activity>`,
      ),
    );
    expect(res.ok).toBe(false);
    expect(res.fatalError).toMatch(/out of bounds/);
  });

  it('rejects a distance over 1000 km', () => {
    const res = parseTcx(
      minimalTcx(
        `<Activity Sport="Biking"><Id>2026-06-08T07:00:00Z</Id>` +
          `<Lap><TotalTimeSeconds>3600</TotalTimeSeconds>` +
          `<DistanceMeters>2000000</DistanceMeters></Lap></Activity>`,
      ),
    );
    expect(res.ok).toBe(false);
    expect(res.fatalError).toMatch(/out of bounds/);
  });

  it('drops an out-of-bounds heart rate instead of failing the import', () => {
    const res = parseTcx(
      minimalTcx(
        `<Activity Sport="Running"><Id>2026-06-08T07:00:00Z</Id>` +
          `<Lap><TotalTimeSeconds>600</TotalTimeSeconds>` +
          `<AverageHeartRateBpm><Value>999</Value></AverageHeartRateBpm></Lap></Activity>`,
      ),
    );
    expect(res.ok).toBe(true);
    expect(res.activity?.avgHr).toBeNull();
  });

  it('reads MaximumHeartRateBpm as the max over laps (issue #203)', () => {
    const res = parseTcx(
      minimalTcx(
        `<Activity Sport="Running"><Id>2026-06-08T07:00:00Z</Id>` +
          `<Lap><TotalTimeSeconds>600</TotalTimeSeconds>` +
          `<MaximumHeartRateBpm><Value>160</Value></MaximumHeartRateBpm></Lap>` +
          `<Lap><TotalTimeSeconds>600</TotalTimeSeconds>` +
          `<MaximumHeartRateBpm><Value>178</Value></MaximumHeartRateBpm></Lap></Activity>`,
      ),
    );
    expect(res.ok).toBe(true);
    expect(res.activity?.maxHr).toBe(178);
  });

  it('does not let a Trackpoint MaximumHeartRateBpm leak into the lap max', () => {
    // Lap total carries no MaximumHeartRateBpm; only a per-second Track sample
    // does. The Track is stripped before extraction, so maxHr stays null.
    const res = parseTcx(
      minimalTcx(
        `<Activity Sport="Running"><Id>2026-06-08T07:00:00Z</Id>` +
          `<Lap><TotalTimeSeconds>600</TotalTimeSeconds><Track><Trackpoint>` +
          `<MaximumHeartRateBpm><Value>200</Value></MaximumHeartRateBpm>` +
          `</Trackpoint></Track></Lap></Activity>`,
      ),
    );
    expect(res.ok).toBe(true);
    expect(res.activity?.maxHr).toBeNull();
  });

  it('drops an out-of-bounds max heart rate instead of failing the import', () => {
    const res = parseTcx(
      minimalTcx(
        `<Activity Sport="Running"><Id>2026-06-08T07:00:00Z</Id>` +
          `<Lap><TotalTimeSeconds>600</TotalTimeSeconds>` +
          `<MaximumHeartRateBpm><Value>999</Value></MaximumHeartRateBpm></Lap></Activity>`,
      ),
    );
    expect(res.ok).toBe(true);
    expect(res.activity?.maxHr).toBeNull();
  });

  // Number() accepts exponent and hex notation; lock in that both stay
  // inside the same bounds as plain decimals (no notation slips past them).
  it('accepts exponent notation but still enforces the bounds', () => {
    const ok = parseTcx(
      minimalTcx(
        `<Activity Sport="Running"><Id>2026-06-08T07:00:00Z</Id>` +
          `<Lap><TotalTimeSeconds>1.8e3</TotalTimeSeconds></Lap></Activity>`,
      ),
    );
    expect(ok.ok).toBe(true);
    expect(ok.activity?.durationSec).toBe(1800);

    const overflow = parseTcx(
      minimalTcx(
        `<Activity Sport="Running"><Id>2026-06-08T07:00:00Z</Id>` +
          `<Lap><TotalTimeSeconds>9e99</TotalTimeSeconds></Lap></Activity>`,
      ),
    );
    expect(overflow.ok).toBe(false);
    expect(overflow.fatalError).toMatch(/out of bounds/);
  });

  it('accepts hex notation as its numeric value, bounds still applied', () => {
    // Number('0x3C') is 60; an absurd hex duration still hits the 24 h cap.
    const ok = parseTcx(
      minimalTcx(
        `<Activity Sport="Running"><Id>2026-06-08T07:00:00Z</Id>` +
          `<Lap><TotalTimeSeconds>0x3C</TotalTimeSeconds></Lap></Activity>`,
      ),
    );
    expect(ok.ok).toBe(true);
    expect(ok.activity?.durationSec).toBe(60);

    const overflow = parseTcx(
      minimalTcx(
        `<Activity Sport="Running"><Id>2026-06-08T07:00:00Z</Id>` +
          `<Lap><TotalTimeSeconds>0xFFFFFFFF</TotalTimeSeconds></Lap></Activity>`,
      ),
    );
    expect(overflow.ok).toBe(false);
    expect(overflow.fatalError).toMatch(/out of bounds/);
  });

  it('treats Infinity and NaN text as garbage laps', () => {
    const res = parseTcx(
      minimalTcx(
        `<Activity Sport="Running"><Id>2026-06-08T07:00:00Z</Id>` +
          `<Lap><TotalTimeSeconds>Infinity</TotalTimeSeconds></Lap>` +
          `<Lap><TotalTimeSeconds>NaN</TotalTimeSeconds></Lap>` +
          `<Lap><TotalTimeSeconds>60</TotalTimeSeconds></Lap></Activity>`,
      ),
    );
    expect(res.ok).toBe(true);
    expect(res.activity?.durationSec).toBe(60);
  });
});

// ============================================================
// Start-time clamp (issue #161): 2000-01-01 .. now + 1 day
// ============================================================

describe('parseTcx (startedAt clamp)', () => {
  const lapWith = (id: string) =>
    minimalTcx(
      `<Activity Sport="Running"><Id>${id}</Id>` +
        `<Lap><TotalTimeSeconds>60</TotalTimeSeconds></Lap></Activity>`,
    );

  it('rejects a start before 2000-01-01', () => {
    const res = parseTcx(lapWith('1999-12-31T23:59:59Z'));
    expect(res.ok).toBe(false);
    expect(res.fatalError).toMatch(/start time out of range/);
  });

  it('rejects an extreme past and an extreme future start', () => {
    expect(parseTcx(lapWith('1970-01-01T00:00:00Z')).ok).toBe(false);
    expect(parseTcx(lapWith('9999-01-01T00:00:00Z')).ok).toBe(false);
  });

  it('accepts the 2000-01-01 boundary and a slightly future start (clock skew)', () => {
    expect(parseTcx(lapWith(TCX_MIN_STARTED_AT.toISOString())).ok).toBe(true);
    const soon = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    expect(parseTcx(lapWith(soon)).ok).toBe(true);
  });

  it('rejects a start more than a day in the future', () => {
    const farFuture = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString();
    const res = parseTcx(lapWith(farFuture));
    expect(res.ok).toBe(false);
    expect(res.fatalError).toMatch(/start time out of range/);
  });
});

describe('tcxExerciseName', () => {
  it('maps sports onto the catalog cardio names', () => {
    expect(tcxExerciseName('Running')).toBe('Running');
    expect(tcxExerciseName('Biking')).toBe('Cycling');
    expect(tcxExerciseName('Other')).toBe('Cardio (imported)');
  });
});

describe('parseTcx track (issue #259)', () => {
  it('builds a pace/HR track from the per-second Trackpoints', () => {
    // RUN_TCX has 3 trackpoints: two in lap 1 (t=1s,2s with HR) and one in
    // lap 2 (t=901s, no HR). Each is relative to the activity start.
    const r = parseTcx(RUN_TCX);
    expect(r.ok).toBe(true);
    expect(r.activity?.track).toEqual([
      { t: 1, d: 3.2, hr: 120 },
      { t: 2, d: 6.5, hr: 121 },
      { t: 901, d: 2501 },
    ]);
  });

  it('keeps the track null when the file carries no trackpoints', () => {
    const r = parseTcx(
      minimalTcx(
        `<Activity Sport="Running"><Id>2026-06-10T07:30:00.000Z</Id>` +
          `<Lap StartTime="2026-06-10T07:30:00.000Z"><TotalTimeSeconds>600</TotalTimeSeconds>` +
          `<DistanceMeters>2000</DistanceMeters></Lap></Activity>`,
      ),
    );
    expect(r.ok).toBe(true);
    expect(r.activity?.track).toBeNull();
  });

  it('downsamples a long track to at most 500 points, ordered from the start', () => {
    let tps = '';
    const base = new Date('2026-06-10T07:30:00.000Z').getTime();
    for (let i = 0; i < 600; i++) {
      const time = new Date(base + i * 1000).toISOString();
      tps += `<Trackpoint><Time>${time}</Time><DistanceMeters>${i * 3}</DistanceMeters><HeartRateBpm><Value>150</Value></HeartRateBpm></Trackpoint>`;
    }
    const r = parseTcx(
      minimalTcx(
        `<Activity Sport="Running"><Id>2026-06-10T07:30:00.000Z</Id>` +
          `<Lap StartTime="2026-06-10T07:30:00.000Z"><TotalTimeSeconds>600</TotalTimeSeconds>` +
          `<DistanceMeters>1800</DistanceMeters><Track>${tps}</Track></Lap></Activity>`,
      ),
    );
    expect(r.ok).toBe(true);
    const track = r.activity!.track!;
    expect(track.length).toBeGreaterThan(1);
    expect(track.length).toBeLessThanOrEqual(500);
    expect(track.length).toBeLessThan(600);
    expect(track[0]!.t).toBe(0);
  });
});
