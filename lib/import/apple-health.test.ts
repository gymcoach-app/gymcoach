import { describe, expect, it } from 'vitest';
import {
  APPLE_HEALTH_GENERIC_EXERCISE,
  AppleHealthScanner,
  appleHealthActivityType,
  appleHealthExerciseName,
  decodeXmlEntities,
  isAppleHealthStrengthType,
  normalizeAppleHealthBodyMass,
  normalizeAppleHealthWorkout,
  parseAppleHealthDate,
  scanAppleHealthExport,
  utcDayKey,
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
    { measuredAt: '2023-11-02T13:30:00.000Z', weightKg: 81.65 },
    // Two measurements on 2024-03-05: the later one is kept.
    { measuredAt: '2024-03-05T20:00:00.000Z', weightKg: 82.06 },
  ],
};

describe('scanAppleHealthExport', () => {
  it('extracts workouts, nested statistics and body mass from a whole file', () => {
    expect(scanAppleHealthExport(FIXTURE, NOW)).toEqual(EXPECTED);
  });

  it('gives the same result when the text is split at every position', () => {
    for (let cut = 0; cut <= FIXTURE.length; cut++) {
      const scanner = new AppleHealthScanner(NOW);
      scanner.push(FIXTURE.slice(0, cut));
      scanner.push(FIXTURE.slice(cut));
      expect(scanner.end(), `cut at ${cut}`).toEqual(EXPECTED);
    }
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

  it('keys a measurement by its UTC day', () => {
    expect(utcDayKey('2024-03-05T23:30:00.000Z')).toBe('2024-03-05');
    expect(utcDayKey(new Date('2024-03-06T00:10:00+02:00'))).toBe('2024-03-05');
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
