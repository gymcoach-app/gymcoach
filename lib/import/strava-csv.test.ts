// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  matchStravaCsvHeader,
  parseStravaActivitiesCsv,
  stravaActivityKey,
  stravaHeaderKey,
} from './strava-csv';

const e = (cp: number) => String.fromCodePoint(cp);

// The start of a recent English export: about ninety columns, several names
// twice (the second "Elapsed Time" and "Distance" are the precise values).
const RECENT_EN =
  'Activity ID,Activity Date,Activity Name,Activity Type,Activity Description,Elapsed Time,Distance,Max Heart Rate,Relative Effort,Commute,Activity Private Note,Activity Gear,Filename,Athlete Weight,Bike Weight,Elapsed Time,Moving Time,Distance,Max Speed';
// A 2019 export: ten lowercase columns.
const OLD_EN = 'id,date,name,type,description,elapsed_time,distance,commute,gear,filename';
// Headers as an account set to French or German gets them (accents included).
const FRENCH = [
  `ID de l'activit${e(0xe9)}`,
  `Date de l'activit${e(0xe9)}`,
  `Nom de l'activit${e(0xe9)}`,
  `Type d'activit${e(0xe9)}`,
  `Description de l'activit${e(0xe9)}`,
  `Temps ${e(0xe9)}coul${e(0xe9)}`,
  'Distance',
  'Nom du fichier',
];
const GERMAN = [
  `Aktivit${e(0xe4)}ts-ID`,
  `Aktivit${e(0xe4)}tsdatum`,
  `Name der Aktivit${e(0xe4)}t`,
  `Aktivit${e(0xe4)}tsart`,
  'Beschreibung',
  'Verstrichene Zeit',
  'Distanz',
  'Dateiname',
];

describe('stravaHeaderKey', () => {
  it.each([
    ['Activity ID', 'activityid'],
    ['  activity_id ', 'activityid'],
    [`${e(0xfeff)}Activity ID`, 'activityid'],
    [FRENCH[0]!, 'iddelactivite'],
    [GERMAN[0]!, 'aktivitatsid'],
    ['Filename', 'filename'],
  ])('%s -> %s', (cell, key) => {
    expect(stravaHeaderKey(cell)).toBe(key);
  });
});

describe('matchStravaCsvHeader', () => {
  it('finds the columns of a recent English export, first match winning on repeated names', () => {
    expect(matchStravaCsvHeader(RECENT_EN.split(','))).toEqual({
      id: 0,
      date: 1,
      name: 2,
      type: 3,
      filename: 12,
    });
  });

  it('finds the columns of an old lowercase export', () => {
    expect(matchStravaCsvHeader(OLD_EN.split(','))).toEqual({
      id: 0,
      date: 1,
      name: 2,
      type: 3,
      filename: 9,
    });
  });

  it('finds the columns of a French and of a German export', () => {
    const expected = { id: 0, date: 1, name: 2, type: 3, filename: 7 };
    expect(matchStravaCsvHeader(FRENCH)).toEqual(expected);
    expect(matchStravaCsvHeader(GERMAN)).toEqual(expected);
  });

  it('finds columns by name wherever they sit', () => {
    expect(
      matchStravaCsvHeader(['Filename', 'Activity Type', 'Activity Name', 'Activity ID']),
    ).toEqual({ id: 3, date: -1, name: 2, type: 1, filename: 0 });
  });

  it('falls back to content and position for a header in an unknown language', () => {
    const header = ['A', 'B', 'C', 'D', 'E', 'F'];
    const rows = [
      ['9001', 'Jan 2, 2024', 'Morning Run', 'Run', '', ''],
      ['9002', 'Jan 3, 2024', 'Lunch Ride', 'Ride', '', 'activities/9002.fit.gz'],
    ];
    expect(matchStravaCsvHeader(header, rows)).toEqual({
      id: 0,
      date: 1,
      name: 2,
      type: 3,
      filename: 5,
    });
  });

  it('does not guess positions when the first column is not an id', () => {
    const header = ['A', 'B', 'C', 'D'];
    const rows = [['Morning Run', 'x', 'y', 'z']];
    expect(matchStravaCsvHeader(header, rows)).toEqual({
      id: -1,
      date: -1,
      name: -1,
      type: -1,
      filename: -1,
    });
  });
});

describe('parseStravaActivitiesCsv', () => {
  it('reads the activities and counts the ones without a file', () => {
    const csv = [
      RECENT_EN,
      '101,"Jan 2, 2024, 7:01:02 AM",Morning Run,Run,,1800,5.01,,,false,,,activities/101.fit.gz',
      '102,"Jan 3, 2024, 6:00:00 PM","Ride, with a comma",Ride,,3600,30,,,false,,,activities/102.gpx',
      '103,"Jan 4, 2024, 6:00:00 PM",Yoga at home,Yoga,,1800,0,,,false,,,',
      '104,"Jan 5, 2024, 6:00:00 PM",Weights,Weight Training,,1800,0,,,false,,,',
    ].join('\n');
    const parsed = parseStravaActivitiesCsv(`${e(0xfeff)}${csv}\n`);
    expect(parsed.recognized).toBe(true);
    expect(parsed.withoutFile).toBe(2);
    expect(parsed.activities).toHaveLength(4);
    expect(parsed.activities[0]).toEqual({
      id: '101',
      date: 'Jan 2, 2024, 7:01:02 AM',
      name: 'Morning Run',
      type: 'Run',
      filename: 'activities/101.fit.gz',
    });
    expect(parsed.activities[1]!.name).toBe('Ride, with a comma');
    expect(parsed.activities[2]!.filename).toBeNull();
  });

  it('reads an old export with CRLF line ends', () => {
    const csv = `${OLD_EN}\r\n7,2019-05-01 06:00:00,Run,Run,,1500,4000.0,false,,activities/7.gpx.gz\r\n`;
    const parsed = parseStravaActivitiesCsv(csv);
    expect(parsed.activities).toEqual([
      {
        id: '7',
        date: '2019-05-01 06:00:00',
        name: 'Run',
        type: 'Run',
        filename: 'activities/7.gpx.gz',
      },
    ]);
    expect(parsed.withoutFile).toBe(0);
  });

  it('normalizes the filename to the key archive entries use', () => {
    const csv = `${OLD_EN}\n8,d,Tempo,Run,,1,1,false,,/Activities/8.FIT.GZ\n`;
    expect(parseStravaActivitiesCsv(csv).activities[0]!.filename).toBe('activities/8.fit.gz');
  });

  it('says nothing about manual entries when no filename column can be found', () => {
    const parsed = parseStravaActivitiesCsv('A,B,C,D\n55,d,Run,Run\n56,d,Run,Run\n');
    expect(parsed.recognized).toBe(true);
    // Unknown, not zero: every row has a null filename here, and none of them
    // is known to be a manual entry.
    expect(parsed.withoutFile).toBeNull();
    expect(parsed.activities.map((a) => a.filename)).toEqual([null, null]);
  });

  it('reports an unrelated CSV as not recognized', () => {
    expect(parseStravaActivitiesCsv('Date,Exercise,Weight\n2024-01-01,Squat,100\n')).toEqual({
      recognized: false,
      activities: [],
      withoutFile: null,
    });
    expect(parseStravaActivitiesCsv('').recognized).toBe(false);
  });

  it('bounds the length of a cell', () => {
    const csv = `${OLD_EN}\n9,d,${'x'.repeat(5000)},Run,,1,1,false,,activities/9.gpx\n`;
    expect(parseStravaActivitiesCsv(csv).activities[0]!.name).toHaveLength(200);
  });
});

describe('stravaActivityKey', () => {
  it.each([
    ['activities/123.fit.gz', 'activities/123.fit.gz'],
    ['export_42/activities/123.GPX', 'activities/123.gpx'],
    ['./activities/1.tcx', 'activities/1.tcx'],
    ['activities.csv', null],
    ['media/1.jpg', null],
    ['123.fit', null],
  ])('%s -> %s', (path, key) => {
    expect(stravaActivityKey(path)).toBe(key);
  });
});
