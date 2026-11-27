import { isDeepStrictEqual } from 'node:util';
import { describe, expect, it, vi } from 'vitest';
import { describeCost, measureGrowth, referenceCost } from '@/lib/testing/cpu-cost';
import { IMPORT_DUPLICATE_WINDOW_MS } from './duplicate-window';
import {
  APPLE_HEALTH_GENERIC_EXERCISE,
  APPLE_HEALTH_SCAN_SLICE,
  AppleHealthScanner,
  type AppleHealthScanResult,
  appleHealthActivityType,
  appleHealthExerciseName,
  appleHealthLocalDayKey,
  appleHealthLocalDayStart,
  decodeXmlEntities,
  dedupeAppleHealthWorkouts,
  isAppleHealthStrengthType,
  normalizeAppleHealthBodyMass,
  normalizeAppleHealthWorkout,
  parseAttributes,
  parseAppleHealthDate,
  scanAppleHealthExport,
} from './apple-health';

const NOW = new Date('2025-01-01T00:00:00.000Z');

// A small export in the shape the Health app writes: a DOCTYPE with an
// internal subset, records of other types, workouts in the old flat form
// (totalDistance attributes) and the newer nested form (WorkoutStatistics),
// a strength workout, and body mass records in two units.
const FIXTURE = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE HealthData [
<!ELEMENT HealthData (ExportDate,Me,(Record|Correlation|Workout|ActivitySummary|ClinicalRecord)*)>
<!ATTLIST Workout
  workoutActivityType   CDATA #REQUIRED
  duration              CDATA #IMPLIED
>
]>
<HealthData locale="en_FR">
 <ExportDate value="2024-06-01 10:00:00 +0200"/>
 <Me HKCharacteristicTypeIdentifierDateOfBirth="1990-01-01"/>
 <!-- <Workout workoutActivityType="HKWorkoutActivityTypeRunning" startDate="2024-01-01 08:00:00 +0100" duration="10" durationUnit="min"/> -->
 <Record type="HKQuantityTypeIdentifierHeartRate" sourceName="Julien&#8217;s Apple&#160;Watch" unit="count/min" startDate="2024-03-05 07:13:00 +0100" endDate="2024-03-05 07:13:00 +0100" value="120">
  <MetadataEntry key="HKMetadataKeyHeartRateMotionContext" value="2"/>
 </Record>
 <Record type="HKQuantityTypeIdentifierBodyMass" sourceName="Scale &amp; Co" unit="kg" creationDate="2024-03-05 07:00:01 +0100" startDate="2024-03-05 07:00:00 +0100" endDate="2024-03-05 07:00:00 +0100" value="81.4"/>
 <Record type="HKQuantityTypeIdentifierBodyMass" sourceName="Scale" unit="kg" startDate="2024-03-05 21:00:00 +0100" endDate="2024-03-05 21:00:00 +0100" value="82.06"/>
 <Record type='HKQuantityTypeIdentifierBodyMass' sourceName='Old "smart" scale' unit='lb' startDate='2023-11-02 08:30:00 -0500' value='180'/>
 <Record type="HKQuantityTypeIdentifierBodyMassIndex" unit="count" startDate="2024-03-05 07:00:00 +0100" value="24.1"/>
 <Record type="HKQuantityTypeIdentifierStepCount" sourceName="a > b" unit="count" startDate="2024-03-05 07:00:00 +0100" value="42"/>
 <Workout workoutActivityType="HKWorkoutActivityTypeRunning" duration="30.5" durationUnit="min" totalDistance="5.2" totalDistanceUnit="km" totalEnergyBurned="400" sourceName="Julien&apos;s &quot;Watch&quot; &lt;S9&gt;" startDate="2024-03-05 07:12:44 +0100" endDate="2024-03-05 07:43:14 +0100">
  <MetadataEntry key="HKIndoorWorkout" value="0"/>
  <WorkoutEvent type="HKWorkoutEventTypePause" date="2024-03-05 07:20:00 +0100"/>
  <WorkoutStatistics type="HKQuantityTypeIdentifierHeartRate" startDate="2024-03-05 07:12:44 +0100" endDate="2024-03-05 07:43:14 +0100" average="151.6" minimum="98" maximum="178" unit="count/min"/>
  <WorkoutRoute sourceName="Watch"><FileReference path="/workout-routes/route.gpx"/></WorkoutRoute>
 </Workout>
 <Workout workoutActivityType="HKWorkoutActivityTypeCycling" duration="3600" durationUnit="s" startDate="2024-03-06 18:00:00 +0100" endDate="2024-03-06 19:00:00 +0100">
  <WorkoutActivity uuid="A" startDate="2024-03-06 18:00:00 +0100" duration="20" durationUnit="min">
   <WorkoutStatistics type="HKQuantityTypeIdentifierDistanceCycling" sum="1" unit="km"/>
   <WorkoutStatistics type="HKQuantityTypeIdentifierHeartRate" average="60" maximum="61" unit="count/min"/>
  </WorkoutActivity>
  <WorkoutStatistics type="HKQuantityTypeIdentifierActiveEnergyBurned" sum="600" unit="kcal"/>
  <WorkoutStatistics type="HKQuantityTypeIdentifierDistanceCycling" sum="15.5" unit="mi"/>
  <WorkoutStatistics type="HKQuantityTypeIdentifierHeartRate" average="140" maximum="300" unit="count/min"/>
 </Workout>
 <Workout workoutActivityType="HKWorkoutActivityTypeTraditionalStrengthTraining" duration="55" durationUnit="min" startDate="2024-03-07 18:00:00 +0100" endDate="2024-03-07 18:55:00 +0100"/>
 <Workout workoutActivityType="HKWorkoutActivityTypeYoga" startDate="2024-03-08 08:00:00 +0100" endDate="2024-03-08 08:45:00 +0100"/>
 <Workout workoutActivityType="HKWorkoutActivityTypeWalking" duration="20" durationUnit="min" startDate="not a date" endDate="2024-03-09 08:45:00 +0100"/>
 <ActivitySummary dateComponents="2024-03-05" activeEnergyBurned="500"/>
</HealthData>
`;

const EXPECTED = {
  workouts: [
    {
      activityType: 'Running',
      startedAt: '2024-03-05T06:12:44.000Z',
      durationSec: 1830,
      distanceM: 5200,
      avgHr: 152,
      maxHr: 178,
    },
    {
      activityType: 'Cycling',
      startedAt: '2024-03-06T17:00:00.000Z',
      durationSec: 3600,
      // 15.5 mi from the workout's own statistics, not the 1 km of a segment.
      distanceM: 24945,
      avgHr: 140,
      // 300 bpm is outside the bounds: absent, not stored.
      maxHr: null,
    },
    {
      // No duration attribute: end minus start.
      activityType: 'Yoga',
      startedAt: '2024-03-08T07:00:00.000Z',
      durationSec: 2700,
      distanceM: null,
      avgHr: null,
      maxHr: null,
    },
  ],
  skippedStrength: 1,
  skippedInvalid: 1,
  bodyMass: [
    { measuredAt: '2023-11-02T13:30:00.000Z', weightKg: 81.65, utcOffsetMin: -300 },
    // Two measurements on 2024-03-05: the later one is kept.
    { measuredAt: '2024-03-05T20:00:00.000Z', weightKg: 82.06, utcOffsetMin: 60 },
  ],
};

describe('scanAppleHealthExport', () => {
  it('extracts workouts, nested statistics and body mass from a whole file', () => {
    expect(scanAppleHealthExport(FIXTURE, NOW)).toEqual(EXPECTED);
  });

  // Every cut position costs one full scan of the fixture, so the work grows
  // with the square of its length: about 3 700 scans, 1.1 s of wall time on
  // an idle core as one test, and past the 5 s limit of a single test on a busy
  // machine (issue #593). The positions are checked in ranges of SPLIT_RANGE, each its
  // own test with the default 5 s limit.
  //
  // Ranges alone would loosen the limit on the scanner: the same work would
  // get one 5 s limit per range. So the last test sums the cost of all
  // positions and holds it to ONE budget.
  //
  // The budget is not in milliseconds. It was (2500 ms of CPU time, half the
  // old limit), and CPU time proved to depend on the machine too: 0.4 to
  // 0.65 s idle, 1.1 to 1.5 s with 24 busy loops on 12 cores, and 2535 ms in
  // one gate run at load 7 to 19, a red test with nothing wrong in the scanner.
  // Each range is now measured in units of a fixed reference work run right
  // before and after it (lib/testing/cpu-cost.ts), which slows down with the
  // machine the way the scanner does. Measured for the whole property: 285 to
  // 300 units on a calm machine, 230 to 430 with 16 busy loops on top of other
  // jobs. With 1.6 ms of CPU added to every end(), the scanner about ten times
  // slower that the old budget was sized against: 2300 to 4900. The budget is
  // between the two, so that mutant fails it, while each range still passes
  // its own test. These numbers are from one machine (a six-core 2020 laptop,
  // Node 22); the units another one measures are printed on CI and with
  // COST_UNITS_LOG=1 (describeCost).
  const SPLIT_RANGE = 512;
  const SPLIT_STARTS = Array.from(
    { length: Math.ceil((FIXTURE.length + 1) / SPLIT_RANGE) },
    (_, index) => index * SPLIT_RANGE,
  );
  const SPLIT_UNITS_BUDGET = 900;
  // Cost (reference units) and number of positions of each range checked so far.
  const splitCost = new Map<number, { units: number; positions: number }>();

  function checkSplitRange(start: number): void {
    const end = Math.min(start + SPLIT_RANGE, FIXTURE.length + 1);
    const cost = referenceCost(() => {
      for (let cut = start; cut < end; cut++) {
        const scanner = new AppleHealthScanner(NOW);
        scanner.push(FIXTURE.slice(0, cut));
        scanner.push(FIXTURE.slice(cut));
        const result = scanner.end();
        // toEqual, at a fraction of its cost when the result is right: a result
        // that is deeply and strictly equal always passes toEqual, so only a
        // result that is not goes to toEqual, to be judged and reported by it.
        if (!isDeepStrictEqual(result, EXPECTED)) expect(result, `cut at ${cut}`).toEqual(EXPECTED);
      }
    });
    splitCost.set(start, { units: cost.units, positions: end - start });
  }

  it.each(SPLIT_STARTS)(
    'gives the same result when the text is split at every position (from %i)',
    (start) => {
      checkSplitRange(start);
    },
  );

  it('checks every split position within one CPU budget for all of them', () => {
    // A range that did not run (this test picked alone with -t, or a filtered
    // range) is checked here, so the total is never a sum over nothing.
    for (const start of SPLIT_STARTS) {
      if (!splitCost.has(start)) checkSplitRange(start);
    }
    const costs = [...splitCost.values()];
    expect(costs).toHaveLength(SPLIT_STARTS.length);
    // Every position from 0 to the end of the text, once.
    expect(costs.reduce((sum, cost) => sum + cost.positions, 0)).toBe(FIXTURE.length + 1);
    const totalUnits = costs.reduce((sum, cost) => sum + cost.units, 0);
    const measured = describeCost('Apple Health split property', totalUnits, SPLIT_UNITS_BUDGET);
    expect(totalUnits, measured).toBeGreaterThan(0);
    expect(totalUnits, measured).toBeLessThan(SPLIT_UNITS_BUDGET);
  });

  it('gives the same result fed one byte at a time (multi-byte characters split)', () => {
    const bytes = new TextEncoder().encode(FIXTURE.replace('Scale &amp; Co', `Balance ${String.fromCodePoint(0xe9, 0x4f53, 0x1f600)}`));
    const scanner = new AppleHealthScanner(NOW);
    for (let i = 0; i < bytes.length; i++) scanner.push(bytes.subarray(i, i + 1));
    expect(scanner.end()).toEqual(EXPECTED);
  });

  it('gives the same result as bytes split at every position', () => {
    const bytes = new TextEncoder().encode(FIXTURE);
    for (let cut = 0; cut <= bytes.length; cut += 7) {
      const scanner = new AppleHealthScanner(NOW);
      scanner.push(bytes.subarray(0, cut));
      scanner.push(bytes.subarray(cut));
      expect(scanner.end(), `cut at ${cut}`).toEqual(EXPECTED);
    }
  });

  it('ignores a workout written inside a comment or a CDATA section', () => {
    const xml =
      '<HealthData><!-- <Workout workoutActivityType="HKWorkoutActivityTypeRunning" startDate="2024-01-01 08:00:00 +0000" duration="10" durationUnit="min"/> -->' +
      '<![CDATA[ <Workout workoutActivityType="HKWorkoutActivityTypeRunning" startDate="2024-01-02 08:00:00 +0000" duration="10" durationUnit="min"/> ]]>' +
      '<Workout workoutActivityType="HKWorkoutActivityTypeRowing" startDate="2024-01-03 08:00:00 +0000" duration="10" durationUnit="min"/></HealthData>';
    for (let cut = 0; cut <= xml.length; cut++) {
      const scanner = new AppleHealthScanner(NOW);
      scanner.push(xml.slice(0, cut));
      scanner.push(xml.slice(cut));
      const result = scanner.end();
      expect(result.workouts.map((w) => w.activityType), `cut at ${cut}`).toEqual(['Rowing']);
    }
  });

  it('reads a ">" inside a quoted attribute value as text, not as the tag end', () => {
    const xml =
      '<Workout sourceName="a > b" workoutActivityType="HKWorkoutActivityTypeHiking" startDate="2024-01-03 08:00:00 +0000" duration="1" durationUnit="hr" totalDistance="4" totalDistanceUnit="mi"></Workout>';
    expect(scanAppleHealthExport(xml, NOW).workouts).toEqual([
      {
        activityType: 'Hiking',
        startedAt: '2024-01-03T08:00:00.000Z',
        durationSec: 3600,
        distanceM: 6437,
        avgHr: null,
        maxHr: null,
      },
    ]);
  });

  it('returns workouts oldest first whatever the order in the file', () => {
    const w = (day: string) =>
      `<Workout workoutActivityType="HKWorkoutActivityTypeRunning" startDate="2024-01-${day} 08:00:00 +0000" duration="10" durationUnit="min"/>`;
    const result = scanAppleHealthExport(w('09') + w('02') + w('05'), NOW);
    expect(result.workouts.map((x) => x.startedAt.slice(0, 10))).toEqual([
      '2024-01-02',
      '2024-01-05',
      '2024-01-09',
    ]);
  });

  it('does not attach statistics found outside a workout', () => {
    const xml =
      '<WorkoutStatistics type="HKQuantityTypeIdentifierHeartRate" average="150" maximum="170"/>' +
      '<Workout workoutActivityType="HKWorkoutActivityTypeRunning" startDate="2024-01-03 08:00:00 +0000" duration="10" durationUnit="min"/>' +
      '<WorkoutStatistics type="HKQuantityTypeIdentifierHeartRate" average="150" maximum="170"/>';
    expect(scanAppleHealthExport(xml, NOW).workouts[0]).toMatchObject({ avgHr: null, maxHr: null });
  });

  it.each([
    ['empty input', ''],
    ['not XML at all', 'PK\u0003\u0004 binary \u0000\u0001 garbage < < <<< > >'],
    ['a truncated workout tag', '<HealthData><Workout workoutActivityType="HKWorkoutActivityTypeRunning" startDate="2024-01-03 08:0'],
    ['an unterminated attribute value', '<Workout workoutActivityType="HKWorkoutActivityTypeRunning startDate=2024 >'],
    ['an unterminated comment', '<!-- <Workout workoutActivityType="HKWorkoutActivityTypeRunning" startDate="2024-01-03 08:00:00 +0000" duration="10" durationUnit="min"/>'],
    ['only closing tags', '</Workout></WorkoutActivity></Workout>'],
  ])('fails gracefully on %s', (_label, input) => {
    const result = scanAppleHealthExport(input, NOW);
    expect(result.workouts).toEqual([]);
    expect(result.bodyMass).toEqual([]);
  });

  it('keeps a workout whose closing tag is missing (truncated file)', () => {
    const xml =
      '<Workout workoutActivityType="HKWorkoutActivityTypeSwimming" startDate="2024-01-03 08:00:00 +0000" duration="30" durationUnit="min">' +
      '<WorkoutStatistics type="HKQuantityTypeIdentifierDistanceSwimming" sum="1000" unit="yd"/>';
    expect(scanAppleHealthExport(xml, NOW).workouts).toEqual([
      {
        activityType: 'Swimming',
        startedAt: '2024-01-03T08:00:00.000Z',
        durationSec: 1800,
        distanceM: 914,
        avgHr: null,
        maxHr: null,
      },
    ]);
  });

  it('gives up on a tag that never ends instead of buffering it', () => {
    const scanner = new AppleHealthScanner(NOW);
    scanner.push('<Record type="HKQuantityTypeIdentifierBodyMass" value="');
    const filler = 'x'.repeat(16 * 1024);
    for (let i = 0; i < 8; i++) scanner.push(filler);
    scanner.push(
      '<Workout workoutActivityType="HKWorkoutActivityTypeElliptical" startDate="2024-01-03 08:00:00 +0000" duration="10" durationUnit="min"/>',
    );
    const result = scanner.end();
    expect(result.bodyMass).toEqual([]);
    expect(result.workouts.map((w) => w.activityType)).toEqual(['Elliptical']);
  });

  it('does not read a tag that holds a raw <, and reads the one that starts there', () => {
    const run =
      '<Workout workoutActivityType="HKWorkoutActivityTypeRunning" startDate="2024-01-03 08:00:00 +0000" duration="10" durationUnit="min"/>';
    const result = scanAppleHealthExport(
      `<Record type="HKQuantityTypeIdentifierBodyMass" unit="kg" startDate="2024-01-03 08:00:00 +0000" note="a<b" value="80"/>` +
        `<Workout workoutActivityType="HKWorkoutActivityTypeCycling" startDate="2024-01-02 08:00:00 +0000" device="${run}`,
      NOW,
    );
    expect(result.bodyMass).toEqual([]);
    expect(result.workouts.map((w) => w.activityType)).toEqual(['Running']);
  });

  // Each of these made the scanner search the same text again and again (an
  // opener that never ends was searched to the end of the buffer, then the
  // next opener inside it was, and so on): 220 KB of the first pattern took
  // 20 s. The scan is linear now, and this test holds it to that by measuring
  // growth, not milliseconds: the same pattern is scanned at 16 KB and at
  // 128 KB, whole and in small pushes, and the CPU time may grow no faster
  // than the text does, with a margin (an exponent under LINEAR, where 1 is
  // proportional and 2 the square). 128 KB is on purpose more than the 64 KB
  // a tag may hold: the search that started over only did so once an
  // unfinished tag was given up, so a smaller text never showed it. It is also
  // small enough for a scan that is quadratic again to fail this test in
  // seconds instead of running for minutes.
  // It used to allow 1 MB 1500 ms on the wall clock, a bound that depends on
  // how busy the machine is (#593) and that a scan fifty times slower still
  // met on an idle one.
  const LINEAR = 1.5;
  const GOOD_WORKOUT =
    '<Workout workoutActivityType="HKWorkoutActivityTypeRowing" startDate="2024-01-03 08:00:00 +0000" duration="10" durationUnit="min"/>';

  function scanInSteps(text: string, step: number, tail: string): AppleHealthScanResult {
    const scanner = new AppleHealthScanner(NOW);
    for (let offset = 0; offset < text.length; offset += step) {
      scanner.push(text.slice(offset, offset + step));
    }
    scanner.push(tail);
    return scanner.end();
  }

  it.each([
    ['openers inside a quote that never closes', '<Record a="', '<Record '],
    ['openers that never end', '', '<Record '],
    ['openers that each open a quote', '', "<Workout a='"],
    ['openers with alternating quotes', '', `<Record a="<Record b='`],
    ['workout children that never end', '<Workout a="b">', '<WorkoutStatistics '],
  ])('scans %s in linear time', (_label, head, unit) => {
    const tail = `>${GOOD_WORKOUT}`;
    const textOf = (size: number) => head + unit.repeat(Math.ceil(size / unit.length));
    const small = textOf(16 * 1024);
    const large = textOf(128 * 1024);
    // Whole, then in pushes of 4096 and of 256 characters: every push starts
    // a scan, so a scan that starts over from the top of what it kept is
    // quadratic in the number of pushes.
    for (const step of [large.length, 4096, 256]) {
      const growth = measureGrowth(
        (length) => {
          scanInSteps(length === small.length ? small : large, step, tail);
        },
        small.length,
        large.length,
      );
      expect(
        growth.exponent,
        `pushed ${step} at a time: ${growth.smallMs.toFixed(3)} ms for ${small.length} characters, ` +
          `${growth.largeMs.toFixed(3)} ms for ${large.length}`,
      ).toBeLessThan(LINEAR);
    }
    // 1 MB, the size of the old bound: several scan slices, and the scanner
    // is still in step with the input afterwards.
    const megabyte = textOf(1024 * 1024);
    for (const step of [megabyte.length, 64 * 1024, 4096]) {
      const result = scanInSteps(megabyte, step, tail);
      expect(
        result.workouts.map((w) => w.activityType),
        `pushed ${step} at a time`,
      ).toEqual(['Rowing']);
    }
  });

  // The attribute parser used to be a regular expression that retried from
  // every character of a run of name characters with no '=' after it: one
  // 60 000 character run in a Workout tag took 9 to 17 s, and a tag can be
  // 64 KB long. Attributes are parsed in one pass now, and the test measures
  // that the same way as above: a run of 3 000 characters against one of
  // 24 000, three tags each.
  it.each([
    ['a Workout tag', (run: string) => `<Workout ${run}>`],
    [
      'a body mass Record tag',
      (run: string) => `<Record type="HKQuantityTypeIdentifierBodyMass" ${run} unit="kg"/>`,
    ],
    [
      'a WorkoutStatistics tag',
      (run: string) => `<Workout a="b"><WorkoutStatistics ${run}/></Workout>`,
    ],
    [
      'a name followed by spaces',
      (run: string) => `<Workout ${run}${' '.repeat(run.length / 2)}x>`,
    ],
    ['an unclosed value', (run: string) => `<Workout ${run.replace(/a/g, 'a="')}>`],
  ])('parses the attributes of %s holding a long run without = in linear time', (_label, tag) => {
    // Half plain letters, half the other name characters.
    const runOf = (length: number) => 'a'.repeat(length / 2) + ':.-_9'.repeat(length / 10);
    const textOf = (length: number, tags: number) => tag(runOf(length)).repeat(tags) + GOOD_WORKOUT;
    const texts = new Map([3000, 24_000].map((length) => [length, textOf(length, 3)]));
    const growth = measureGrowth(
      (length) => {
        scanAppleHealthExport(texts.get(length)!, NOW);
      },
      3000,
      24_000,
    );
    expect(
      growth.exponent,
      `${growth.smallMs.toFixed(3)} ms for runs of 3000, ${growth.largeMs.toFixed(3)} ms for runs of 24000`,
    ).toBeLessThan(LINEAR);
    // Twenty tags with a run of 60 000, about 1.2 MB: the size of the old bound.
    const result = scanAppleHealthExport(textOf(60_000, 20), NOW);
    expect(result.workouts.map((w) => w.activityType)).toEqual(['Rowing']);
  });

  it('resumes an unfinished tag where it stopped, quote state included', () => {
    // A long but legal tag (under the 64 KB rule) fed a few characters at a
    // time, with a '>' inside a quoted value that only counts as text if the
    // scanner remembers it is inside the quote.
    const tag =
      `<Workout workoutActivityType="HKWorkoutActivityTypeHiking" note='${'a > b " '.repeat(2000)}' ` +
      'startDate="2024-01-03 08:00:00 +0000" duration="10" durationUnit="min"/>';
    expect(tag.length).toBeLessThan(64 * 1024);
    // Counted, not timed: the scanner looks at characters through charCodeAt,
    // so the number of calls says how often the tag was searched. Searched
    // once and its attributes parsed once, that is 1.3 calls per character;
    // searched again from its start on each of the 2 300 pushes, it is over
    // a thousand.
    const charCodeAt = String.prototype.charCodeAt;
    let reads = 0;
    String.prototype.charCodeAt = function (this: string, index: number): number {
      reads += 1;
      return charCodeAt.call(this, index);
    };
    let result: AppleHealthScanResult;
    try {
      const scanner = new AppleHealthScanner(NOW);
      for (let offset = 0; offset < tag.length; offset += 7) {
        scanner.push(tag.slice(offset, offset + 7));
      }
      result = scanner.end();
    } finally {
      String.prototype.charCodeAt = charCodeAt;
    }
    expect(reads / tag.length).toBeLessThan(3);
    expect(result.workouts).toEqual([
      {
        activityType: 'Hiking',
        startedAt: '2024-01-03T08:00:00.000Z',
        durationSec: 600,
        distanceM: null,
        avgHr: null,
        maxHr: null,
      },
    ]);
  });

  // The count above only sees a search made through charCodeAt. The same
  // rule is measured as time too, so that a search made again by other means
  // (indexing, a regular expression) shows as well: a tag eight times longer,
  // fed 64 characters at a time, may take about eight times longer (an
  // exponent of 1), not sixty-four. Measured: 0.9 to 1.15, calm and with 16
  // busy loops; 1.9 with the tag searched again from its start through
  // codePointAt, which the count above does not see.
  it('reads a tag fed in small pushes in a time proportional to its length', () => {
    const tagOf = (length: number) =>
      `<Workout workoutActivityType="HKWorkoutActivityTypeHiking" note='${'a > b " '.repeat(length / 8)}' ` +
      'startDate="2024-01-03 08:00:00 +0000" duration="10" durationUnit="min"/>';
    const tags = new Map([2000, 16_000].map((length) => [length, tagOf(length)]));
    const feedTag = (length: number) => {
      const tag = tags.get(length)!;
      const scanner = new AppleHealthScanner(NOW);
      for (let offset = 0; offset < tag.length; offset += 64) {
        scanner.push(tag.slice(offset, offset + 64));
      }
      return scanner.end();
    };
    for (const length of tags.keys()) {
      expect(feedTag(length).workouts.map((w) => w.activityType)).toEqual(['Hiking']);
    }
    const growth = measureGrowth(feedTag, 2000, 16_000);
    expect(
      growth.exponent,
      `${growth.smallMs.toFixed(3)} ms for a note of 2000 characters, ` +
        `${growth.largeMs.toFixed(3)} ms for 16000`,
    ).toBeLessThan(LINEAR);
  });

  it('works through one huge chunk in bounded slices', () => {
    const record =
      '<Record type="HKQuantityTypeIdentifierStepCount" unit="count" startDate="2024-01-01 07:00:00 +0000" value="12"/>\n';
    const run =
      '<Workout workoutActivityType="HKWorkoutActivityTypeRunning" startDate="2024-01-03 08:00:00 +0000" duration="10" durationUnit="min"/>';
    const text = record.repeat(Math.ceil((3 * APPLE_HEALTH_SCAN_SLICE) / record.length)) + run;
    const bytes = new TextEncoder().encode(text);
    expect(bytes.length).toBeGreaterThan(3 * APPLE_HEALTH_SCAN_SLICE);

    const decode = vi.spyOn(TextDecoder.prototype, 'decode');
    try {
      const fromBytes = scanAppleHealthExport(bytes, NOW);
      const sizes = decode.mock.calls.map(([input]) => (input as Uint8Array | undefined)?.byteLength ?? 0);
      expect(Math.max(...sizes)).toBeLessThanOrEqual(APPLE_HEALTH_SCAN_SLICE);
      expect(sizes.filter((n) => n > 0).length).toBeGreaterThanOrEqual(4);
      expect(fromBytes.workouts.map((w) => w.activityType)).toEqual(['Running']);
    } finally {
      decode.mockRestore();
    }
    // Text goes through the same slices.
    expect(scanAppleHealthExport(text, NOW).workouts.map((w) => w.activityType)).toEqual(['Running']);
  });

  it('keeps one body weight per local day of the export, not per UTC day', () => {
    const record = (at: string, value: string) =>
      `<Record type="HKQuantityTypeIdentifierBodyMass" unit="kg" startDate="${at}" value="${value}"/>`;
    const result = scanAppleHealthExport(
      // Late evening of the 5th in California: already the 6th in UTC.
      record('2024-03-05 23:30:00 -0800', '80') +
        // Morning and evening of the 6th: one day, the evening one is kept,
        // although the evening is the 7th in UTC.
        record('2024-03-06 08:00:00 -0800', '81') +
        record('2024-03-06 20:00:00 -0800', '82'),
      NOW,
    );
    expect(result.bodyMass).toEqual([
      { measuredAt: '2024-03-06T07:30:00.000Z', weightKg: 80, utcOffsetMin: -480 },
      { measuredAt: '2024-03-07T04:00:00.000Z', weightKg: 82, utcOffsetMin: -480 },
    ]);
  });

  it('ignores pushes after end()', () => {
    const scanner = new AppleHealthScanner(NOW);
    scanner.end();
    scanner.push(FIXTURE);
    expect(scanner.end().workouts).toEqual([]);
  });
});

describe('normalizeAppleHealthWorkout', () => {
  const base = {
    workoutActivityType: 'HKWorkoutActivityTypeRunning',
    startDate: '2024-03-05 07:12:44 +0100',
    duration: '30',
    durationUnit: 'min',
  };

  it('skips the strength types and imports interval training as cardio', () => {
    for (const type of ['TraditionalStrengthTraining', 'FunctionalStrengthTraining', 'CoreTraining']) {
      expect(
        normalizeAppleHealthWorkout({ ...base, workoutActivityType: `HKWorkoutActivityType${type}` }, NOW),
      ).toEqual({ kind: 'strength' });
      expect(isAppleHealthStrengthType(type)).toBe(true);
    }
    expect(
      normalizeAppleHealthWorkout(
        { ...base, workoutActivityType: 'HKWorkoutActivityTypeHighIntensityIntervalTraining' },
        NOW,
      ),
    ).toMatchObject({ kind: 'cardio', workout: { activityType: 'HighIntensityIntervalTraining' } });
  });

  it.each([
    ['a missing type', { workoutActivityType: undefined }],
    ['a type with markup in it', { workoutActivityType: 'HKWorkoutActivityType<b>' }],
    ['a start before 2000', { startDate: '1999-12-31 23:00:00 +0000' }],
    ['a start more than a day ahead', { startDate: '2025-01-03 00:00:00 +0000' }],
    ['a start without a time zone', { startDate: '2024-03-05 07:12:44' }],
    ['a zero duration and no end', { duration: '0' }],
    ['a duration over 24 hours', { duration: '1441' }],
    ['a negative duration from the dates', { duration: undefined, endDate: '2024-03-05 07:00:00 +0100' }],
    ['an unknown duration unit and no end', { durationUnit: 'fortnight' }],
    ['a non-numeric duration and no end', { duration: '0x10' }],
  ])('rejects %s', (_label, patch) => {
    expect(normalizeAppleHealthWorkout({ ...base, ...patch }, NOW)).toEqual({ kind: 'invalid' });
  });

  it('drops an out-of-range distance or heart rate instead of the workout', () => {
    expect(
      normalizeAppleHealthWorkout(
        {
          ...base,
          totalDistance: '1000.1',
          totalDistanceUnit: 'km',
          hrAverage: '39',
          hrMaximum: '251',
        },
        NOW,
      ),
    ).toEqual({
      kind: 'cardio',
      workout: {
        activityType: 'Running',
        startedAt: '2024-03-05T06:12:44.000Z',
        durationSec: 1800,
        distanceM: null,
        avgHr: null,
        maxHr: null,
      },
    });
  });

  it('converts every duration and distance unit to seconds and meters', () => {
    const run = (patch: Record<string, string>) => {
      const r = normalizeAppleHealthWorkout({ ...base, ...patch }, NOW);
      return r.kind === 'cardio' ? r.workout : null;
    };
    expect(run({ duration: '90', durationUnit: 's' })?.durationSec).toBe(90);
    expect(run({ duration: '1.5', durationUnit: 'hr' })?.durationSec).toBe(5400);
    expect(run({ duration: '12.345', durationUnit: 'min' })?.durationSec).toBe(741);
    expect(run({ totalDistance: '3', totalDistanceUnit: 'mi' })?.distanceM).toBe(4828);
    expect(run({ totalDistance: '800', totalDistanceUnit: 'm' })?.distanceM).toBe(800);
    expect(run({ totalDistance: '1760', totalDistanceUnit: 'yd' })?.distanceM).toBe(1609);
    expect(run({ totalDistance: '1', totalDistanceUnit: 'furlong' })?.distanceM).toBeNull();
    // A zero total falls back to the statistics sum.
    expect(
      run({ totalDistance: '0', totalDistanceUnit: 'km', statDistanceSum: '2', statDistanceUnit: 'km' })
        ?.distanceM,
    ).toBe(2000);
  });
});

describe('activity type mapping', () => {
  it('strips the HealthKit prefix and refuses anything that is not a plain name', () => {
    expect(appleHealthActivityType('HKWorkoutActivityTypeRunning')).toBe('Running');
    expect(appleHealthActivityType('Running')).toBe('Running');
    expect(appleHealthActivityType('')).toBeNull();
    expect(appleHealthActivityType('HKWorkoutActivityType')).toBeNull();
    expect(appleHealthActivityType('Run ning')).toBeNull();
    expect(appleHealthActivityType('x'.repeat(61))).toBeNull();
  });

  it.each([
    ['Running', 'Running'],
    ['Walking', 'Walking'],
    ['Hiking', 'Hiking'],
    ['Cycling', 'Cycling'],
    ['Swimming', 'Swimming'],
    ['Rowing', 'Rowing machine'],
    ['Elliptical', 'Elliptical'],
    ['StairClimbing', 'Stair climbing'],
    ['JumpRope', 'Jump rope'],
    ['HighIntensityIntervalTraining', APPLE_HEALTH_GENERIC_EXERCISE],
    ['Yoga', APPLE_HEALTH_GENERIC_EXERCISE],
    ['constructor', APPLE_HEALTH_GENERIC_EXERCISE],
    ['toString', APPLE_HEALTH_GENERIC_EXERCISE],
  ])('logs %s as %s', (type, name) => {
    expect(appleHealthExerciseName(type)).toBe(name);
  });

  it('uses the same names as the watch-file imports for running, cycling and the rest', async () => {
    const { fitExerciseName } = await import('./fit');
    expect(appleHealthExerciseName('Running')).toBe(fitExerciseName('Running'));
    expect(appleHealthExerciseName('Cycling')).toBe(fitExerciseName('Biking'));
    expect(APPLE_HEALTH_GENERIC_EXERCISE).toBe(fitExerciseName('Other'));
  });
});

describe('parseAttributes', () => {
  it('reads every name="value" and name=\'value\' of a tag', () => {
    expect(
      parseAttributes(
        `<Record type="HK" unit='lb'\n\tvalue = "1 > 0"  source:name.x-1="a 'b' c" empty="" amp="R&amp;D"`,
      ),
    ).toEqual({
      type: 'HK',
      unit: 'lb',
      value: '1 > 0',
      'source:name.x-1': `a 'b' c`,
      empty: '',
      amp: 'R&D',
    });
  });

  it('gives what the regular expression it replaces gave on odd input', () => {
    const regex = (tag: string) => {
      const out = Object.create(null) as Record<string, string>;
      for (const m of tag.matchAll(/([A-Za-z_:][\w:.-]*)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) {
        out[m[1]!] = decodeXmlEntities(m[2] ?? m[3] ?? '');
      }
      return out;
    };
    for (const tag of [
      '<Workout',
      '<Workout a b c>',
      '<Workout a=b c="d">',
      '<Workout 1abc="x" -y="z" 9="n">',
      '<Workout a="1" a="2">',
      `<Workout a="unclosed b='c' d='e'`,
      `<Workout a='unclosed b="c" d="e"`,
      '<Workout a = = "x" b="y">',
      '<Workout a="x"b="y"c=\'z\'>',
      '<Workout a.b:c-d_e="x" =\'lonely\' f="g"',
      '<Workout a="x" b=',
      '<Workout a="x" b="',
      '<Workout constructor="c" __proto__="p" toString="t">',
    ]) {
      expect(parseAttributes(tag), tag).toEqual(regex(tag));
    }
    // Not on the prototype chain: an attribute named like a method is data.
    expect(Object.getPrototypeOf(parseAttributes('<Workout a="b">'))).toBeNull();
  });
});

describe('body mass', () => {
  it('converts to kg, rounds to 10 g and bounds the value', () => {
    const at = '2024-03-05 07:00:00 +0100';
    const kg = (value: string, unit: string) =>
      normalizeAppleHealthBodyMass({ startDate: at, value, unit }, NOW)?.weightKg ?? null;
    expect(kg('81.456', 'kg')).toBe(81.46);
    expect(kg('180', 'lb')).toBe(81.65);
    expect(kg('12.5', 'st')).toBe(79.38);
    expect(kg('81400', 'g')).toBe(81.4);
    expect(kg('19.99', 'kg')).toBeNull();
    expect(kg('300.01', 'kg')).toBeNull();
    expect(kg('80', 'oz')).toBeNull();
    expect(kg('abc', 'kg')).toBeNull();
    expect(normalizeAppleHealthBodyMass({ value: '80', unit: 'kg' }, NOW)).toBeNull();
    expect(
      normalizeAppleHealthBodyMass({ startDate: '2031-01-01 00:00:00 +0000', value: '80', unit: 'kg' }, NOW),
    ).toBeNull();
  });

  it('carries the UTC offset of the timestamp', () => {
    const offset = (startDate: string) =>
      normalizeAppleHealthBodyMass({ startDate, value: '80', unit: 'kg' }, NOW)?.utcOffsetMin;
    expect(offset('2024-03-05 07:00:00 +0100')).toBe(60);
    expect(offset('2024-03-05 07:00:00 -0530')).toBe(-330);
    expect(offset('2024-03-05T07:00:00+14:00')).toBe(840);
    expect(offset('2024-03-05T07:00:00Z')).toBe(0);
    expect(offset('2024-03-05 07:00:00 +0000')).toBe(0);
    expect(Object.is(offset('2024-03-05 07:00:00 -0000'), 0)).toBe(true);
    // No time zone is 15 hours from UTC: read as UTC.
    expect(offset('2024-03-05 07:00:00 +1500')).toBe(0);
  });

  it('keys a measurement by the local day of its own offset', () => {
    const key = (measuredAt: string, utcOffsetMin: number) =>
      appleHealthLocalDayKey({ measuredAt, utcOffsetMin });
    expect(key('2024-03-06T07:30:00.000Z', -480)).toBe('2024-03-05');
    expect(key('2024-03-05T22:30:00.000Z', 120)).toBe('2024-03-06');
    expect(key('2024-03-05T23:30:00.000Z', 0)).toBe('2024-03-05');
    expect(appleHealthLocalDayKey({ measuredAt: new Date('2024-03-06T07:30:00.000Z'), utcOffsetMin: -480 })).toBe(
      '2024-03-05',
    );

    // The day starts at local midnight and lasts 24 hours from there.
    const at = Date.parse('2024-03-06T07:30:00.000Z');
    expect(new Date(appleHealthLocalDayStart(at, -480)).toISOString()).toBe('2024-03-05T08:00:00.000Z');
    expect(new Date(appleHealthLocalDayStart(at, 0)).toISOString()).toBe('2024-03-06T00:00:00.000Z');
    expect(new Date(appleHealthLocalDayStart(at, 840)).toISOString()).toBe('2024-03-05T10:00:00.000Z');
  });
});

describe('dedupeAppleHealthWorkouts', () => {
  const at = (iso: string, activityType = 'Running') => ({
    activityType,
    startedAt: iso,
    durationSec: 600,
    distanceM: null,
    avgHr: null,
    maxHr: null,
  });

  it('applies the 2 minute window of the server, the earliest of a pair winning', () => {
    expect(IMPORT_DUPLICATE_WINDOW_MS).toBe(120_000);
    const result = dedupeAppleHealthWorkouts([
      at('2024-01-01T08:10:00.000Z', 'Walking'),
      at('2024-01-01T08:00:00.000Z'),
      // Exactly on the edge of the window: still a duplicate.
      at('2024-01-01T08:02:00.000Z', 'Cycling'),
      // Within 2 minutes of the dropped one but not of the kept one: kept,
      // as on the server, where only kept starts are compared against.
      at('2024-01-01T08:03:30.000Z', 'Hiking'),
      // And this one is then a duplicate of that one.
      at('2024-01-01T08:05:00.000Z', 'Rowing'),
    ]);
    expect(result.duplicates).toBe(2);
    expect(result.workouts.map((w) => w.activityType)).toEqual(['Running', 'Hiking', 'Walking']);
  });

  it('keeps everything when nothing is close, and handles an empty list', () => {
    const list = [at('2024-01-01T08:00:00.000Z'), at('2024-01-01T08:02:00.001Z')];
    expect(dedupeAppleHealthWorkouts(list)).toEqual({ workouts: list, duplicates: 0 });
    expect(dedupeAppleHealthWorkouts([])).toEqual({ workouts: [], duplicates: 0 });
  });
});

describe('parseAppleHealthDate', () => {
  it.each([
    ['2024-03-05 07:12:44 +0100', '2024-03-05T06:12:44.000Z'],
    ['2024-03-05 07:12:44 -0530', '2024-03-05T12:42:44.000Z'],
    ['2024-03-05T07:12:44+01:00', '2024-03-05T06:12:44.000Z'],
    ['2024-03-05T07:12:44.250Z', '2024-03-05T07:12:44.000Z'],
    ['  2024-03-05 07:12:44 +0000 ', '2024-03-05T07:12:44.000Z'],
  ])('reads %s', (raw, iso) => {
    expect(parseAppleHealthDate(raw)?.toISOString()).toBe(iso);
  });

  it.each([undefined, '', '2024-03-05', '2024-13-45 07:12:44 +0100', '05/03/2024 07:12', 'yesterday'])(
    'refuses %s',
    (raw) => {
      expect(parseAppleHealthDate(raw)).toBeNull();
    },
  );
});

describe('decodeXmlEntities', () => {
  it('decodes the predefined and numeric entities, and nothing else', () => {
    expect(decodeXmlEntities('a &amp; b &lt;c&gt; &quot;d&quot; &apos;e&apos;')).toBe(
      'a & b <c> "d" \'e\'',
    );
    expect(decodeXmlEntities('&#65;&#x42;&#x1F600;')).toBe('AB\u{1F600}');
    expect(decodeXmlEntities('&amp;lt;')).toBe('&lt;');
    expect(decodeXmlEntities('&xxe; &#0; &#xD800; &#99999999; & plain')).toBe(
      '&xxe; &#0; &#xD800; &#99999999; & plain',
    );
  });
});
