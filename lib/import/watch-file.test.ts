import { describe, it, expect } from 'vitest';
import { MAX_TRACK_POINTS } from './track';
import { NO_HEART_RATE_MESSAGE, readWatchFile, readWatchFileDetailed } from './watch-file';

// ============================================================
// Fixtures (same builders as fit.test.ts, tcx.test.ts and gpx.test.ts)
// ============================================================

// Real FIT files produced by the official Garmin FIT SDK.
// Running, 25 min, HR 150 avg / 175 max, start 2026-03-15T09:00:00Z, no records.
const FIT_RUNNING =
  'DgLYUlkAAAAuRklUmYtAAAAAAAUAAQIBAoQCAoQEBIYDBIwABP8AAAAQKRlE0gQAAEEAABIACP0EhgIEhgUBAgcEhggEhgkEhhABAhEBAgHsLhlEECkZRAFg4xYAYOMWACChBwCWr/Jq';
// Cycling, 60 min, no heart rate at all.
const FIT_CYCLING =
  'DgLYUkoAAAAuRklU2JJAAAAAAAUAAQIBAoQCAoQEBIYDBIwABP8AAAD4949DCQAAAEEAABIABf0EhgIEhgUBAggEhgkEhgEIBpBD+PePQwKA7jYAgIQeAIKV';
// Running with six record samples (one per minute): HR 140..165.
const FIT_WITH_RECORDS =
  'DgLYUqwAAAAuRklUVvBAAAAAAAUAAQIBAoQCAoQEBIYDBIwABP8AAADgRTtEBwAAAEEAABQABP0EhgUEhgMBAgYChAHgRTtEAAAAAIzkDAEcRjtEIE4AAJHkDAFYRjtEQJwAAJbkDAGURjtEYOoAAJvkDAHQRjtEgDgBAKDkDAEMRztEoIYBAKXkDEIAABIAB/0EhgIEhgUBAggEhgkEhhABAhEBAgJIRztE4EU7RAFAfgUAoIYBAJalo+o=';

const tcx = (lapInner: string) =>
  `<?xml version="1.0"?><TrainingCenterDatabase><Activities>` +
  `<Activity Sport="Other"><Id>2026-06-10T07:30:00.000Z</Id>` +
  `<Lap StartTime="2026-06-10T07:30:00.000Z"><TotalTimeSeconds>3600</TotalTimeSeconds>` +
  `${lapInner}</Lap></Activity></Activities></TrainingCenterDatabase>`;

const tcxPoint = (time: string, hr?: number, meters?: number) =>
  `<Trackpoint><Time>${time}</Time>` +
  (meters != null ? `<DistanceMeters>${meters}</DistanceMeters>` : '') +
  (hr != null ? `<HeartRateBpm><Value>${hr}</Value></HeartRateBpm>` : '') +
  `</Trackpoint>`;

const gpx = (inner: string) =>
  `<?xml version="1.0" encoding="UTF-8"?>` +
  `<gpx version="1.1" creator="test" xmlns="http://www.topografix.com/GPX/1/1">` +
  `<trk><type>other</type><trkseg>${inner}</trkseg></trk></gpx>`;

const gpxPoint = (time: string, hr?: number) =>
  `<trkpt lat="48.8566" lon="2.3522"><time>${time}</time>` +
  (hr != null ? `<extensions><gpxtpx:hr>${hr}</gpxtpx:hr></extensions>` : '') +
  `</trkpt>`;

function read(format: 'fit' | 'tcx' | 'gpx', content: string) {
  const result = readWatchFile({ format, content });
  if (!result.ok) throw new Error(`expected a readable file, got: ${result.error}`);
  return result.data;
}

describe('readWatchFile - FIT (issue #562)', () => {
  it('reads the session summary of a base64 FIT file without records', () => {
    expect(read('fit', FIT_RUNNING)).toEqual({
      startedAt: new Date('2026-03-15T09:00:00.000Z'),
      durationSec: 1500,
      avgHr: 150,
      maxHr: 175,
      hrTrack: null,
    });
  });

  it('keeps only the heart rate of the record track (distance dropped)', () => {
    const data = read('fit', FIT_WITH_RECORDS);
    expect(data.hrTrack).toEqual([
      { t: 0, hr: 140 },
      { t: 60, hr: 145 },
      { t: 120, hr: 150 },
      { t: 180, hr: 155 },
      { t: 240, hr: 160 },
      { t: 300, hr: 165 },
    ]);
    expect(data.avgHr).toBeGreaterThanOrEqual(140);
    expect(data.maxHr).toBeGreaterThanOrEqual(data.avgHr!);
    expect(data.maxHr).toBeLessThanOrEqual(250);
  });

  it('refuses a FIT file without any heart rate', () => {
    expect(readWatchFile({ format: 'fit', content: FIT_CYCLING })).toEqual({
      ok: false,
      code: 'no_heart_rate',
      error: NO_HEART_RATE_MESSAGE,
    });
  });

  it('reports an unreadable FIT file with the parser message', () => {
    const result = readWatchFile({ format: 'fit', content: 'not base64 fit' });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('unreadable');
      expect(result.error.length).toBeGreaterThan(0);
    }
  });
});

describe('readWatchFile - TCX (issue #562)', () => {
  it('takes the lap summary and the heart rate curve', () => {
    const data = read(
      'tcx',
      tcx(
        `<AverageHeartRateBpm><Value>118</Value></AverageHeartRateBpm>` +
          `<MaximumHeartRateBpm><Value>165</Value></MaximumHeartRateBpm><Track>` +
          tcxPoint('2026-06-10T07:30:00.000Z', 95, 0) +
          tcxPoint('2026-06-10T07:31:00.000Z', 130, 12) +
          tcxPoint('2026-06-10T07:32:00.000Z', undefined, 20) +
          tcxPoint('2026-06-10T07:33:00.000Z', 160, 31) +
          `</Track>`,
      ),
    );
    expect(data.startedAt).toEqual(new Date('2026-06-10T07:30:00.000Z'));
    expect(data.durationSec).toBe(3600);
    // The file's own summary wins over the track.
    expect(data.avgHr).toBe(118);
    expect(data.maxHr).toBe(165);
    // The point without heart rate is dropped, and no distance is kept.
    expect(data.hrTrack).toEqual([
      { t: 0, hr: 95 },
      { t: 60, hr: 130 },
      { t: 180, hr: 160 },
    ]);
  });

  it('derives the average and the peak from the track when the laps state none', () => {
    const data = read(
      'tcx',
      tcx(
        `<Track>` +
          tcxPoint('2026-06-10T07:30:00.000Z', 100) +
          tcxPoint('2026-06-10T07:31:00.000Z', 121) +
          tcxPoint('2026-06-10T07:32:00.000Z', 140) +
          `</Track>`,
      ),
    );
    // (100 + 121 + 140) / 3 = 120.33 -> 120.
    expect(data.avgHr).toBe(120);
    expect(data.maxHr).toBe(140);
  });

  it('keeps a summary-only file (no track)', () => {
    const data = read('tcx', tcx(`<AverageHeartRateBpm><Value>118</Value></AverageHeartRateBpm>`));
    expect(data).toMatchObject({ avgHr: 118, maxHr: null, hrTrack: null });
  });

  it('refuses a TCX file without any heart rate', () => {
    const result = readWatchFile({
      format: 'tcx',
      content: tcx(`<Track>${tcxPoint('2026-06-10T07:30:00.000Z', undefined, 5)}</Track>`),
    });
    expect(result).toEqual({ ok: false, code: 'no_heart_rate', error: NO_HEART_RATE_MESSAGE });
  });

  it('treats out-of-bounds heart rate as absent', () => {
    const result = readWatchFile({
      format: 'tcx',
      content: tcx(
        `<AverageHeartRateBpm><Value>900</Value></AverageHeartRateBpm>` +
          `<MaximumHeartRateBpm><Value>12</Value></MaximumHeartRateBpm><Track>` +
          tcxPoint('2026-06-10T07:30:00.000Z', 20) +
          tcxPoint('2026-06-10T07:31:00.000Z', 400) +
          `</Track>`,
      ),
    });
    expect(result).toEqual({ ok: false, code: 'no_heart_rate', error: NO_HEART_RATE_MESSAGE });
  });

  it('reports a hostile file as unreadable', () => {
    const result = readWatchFile({
      format: 'tcx',
      content: `<?xml version="1.0"?><!DOCTYPE x [<!ENTITY a "b">]><TrainingCenterDatabase/>`,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('unreadable');
  });
});

describe('readWatchFile - GPX (issue #562)', () => {
  it('takes the peak from the track, since GPX states none', () => {
    const data = read(
      'gpx',
      gpx(
        gpxPoint('2026-06-10T07:30:00.000Z', 150) +
          gpxPoint('2026-06-10T07:31:00.000Z', 152) +
          gpxPoint('2026-06-10T07:32:00.000Z', 171) +
          gpxPoint('2026-06-10T07:33:00.000Z', 160),
      ),
    );
    expect(data.startedAt).toEqual(new Date('2026-06-10T07:30:00.000Z'));
    expect(data.durationSec).toBe(180);
    // (150 + 152 + 171 + 160) / 4 = 158.25 -> 158.
    expect(data.avgHr).toBe(158);
    expect(data.maxHr).toBe(171);
    expect(data.hrTrack).toEqual([
      { t: 0, hr: 150 },
      { t: 60, hr: 152 },
      { t: 120, hr: 171 },
      { t: 180, hr: 160 },
    ]);
  });

  it('refuses a GPX track without heart rate', () => {
    const result = readWatchFile({
      format: 'gpx',
      content: gpx(gpxPoint('2026-06-10T07:30:00.000Z') + gpxPoint('2026-06-10T07:31:00.000Z')),
    });
    expect(result).toEqual({ ok: false, code: 'no_heart_rate', error: NO_HEART_RATE_MESSAGE });
  });

  it('keeps every stored value inside the bounds and the track inside the point cap', () => {
    const start = Date.parse('2026-06-10T07:30:00.000Z');
    let points = '';
    for (let i = 0; i < 1800; i++) {
      // A glitchy sensor: every tenth sample is out of the 40..250 window.
      const hr = i % 10 === 0 ? 300 : 100 + (i % 80);
      points += gpxPoint(new Date(start + i * 1000).toISOString(), hr);
    }
    const data = read('gpx', gpx(points));
    const track = data.hrTrack!;
    expect(track.length).toBeGreaterThan(1);
    expect(track.length).toBeLessThanOrEqual(MAX_TRACK_POINTS);
    for (let i = 0; i < track.length; i++) {
      expect(Object.keys(track[i]!).sort()).toEqual(['hr', 't']);
      expect(track[i]!.hr).toBeGreaterThanOrEqual(40);
      expect(track[i]!.hr).toBeLessThanOrEqual(250);
      if (i > 0) expect(track[i]!.t).toBeGreaterThan(track[i - 1]!.t);
    }
    expect(data.avgHr).toBeGreaterThanOrEqual(40);
    expect(data.avgHr).toBeLessThanOrEqual(250);
    // The peak is read from every sample of the file (issue #576): the valid
    // values run 100..179, and 179 only occurs on samples the stored curve
    // (one point out of four here) does not keep.
    expect(data.maxHr).toBe(179);
    expect(Math.max(...track.map((p) => p.hr))).toBeLessThan(179);
  });
});

// Issue #576: a peak the file does not state is read from the full-resolution
// samples, not from the downsampled curve that is stored.
describe('readWatchFile - peak and average from the full-resolution samples (issue #576)', () => {
  const start = Date.parse('2026-06-10T07:30:00.000Z');
  // 1500 one-second samples at a flat 110 bpm, with one spike to 188 at a
  // second the stored curve (one point out of three) skips.
  const SPIKE_AT = 700;
  const flatWithSpike = (point: (time: string, hr: number) => string) => {
    let points = '';
    for (let i = 0; i < 1500; i++) {
      points += point(new Date(start + i * 1000).toISOString(), i === SPIKE_AT ? 188 : 110);
    }
    return points;
  };

  it('finds a TCX peak that falls between two stored points', () => {
    const data = read('tcx', tcx(`<Track>${flatWithSpike(tcxPoint)}</Track>`));
    const track = data.hrTrack!;
    expect(track.length).toBe(MAX_TRACK_POINTS);
    // The stored curve does not hold the spike...
    expect(track.some((p) => p.t === SPIKE_AT)).toBe(false);
    expect(Math.max(...track.map((p) => p.hr))).toBe(110);
    // ...the session peak does.
    expect(data.maxHr).toBe(188);
    // (1499 * 110 + 188) / 1500 = 110.05 -> 110.
    expect(data.avgHr).toBe(110);
  });

  it('finds a GPX peak that falls between two stored points', () => {
    const data = read('gpx', gpx(flatWithSpike(gpxPoint)));
    expect(Math.max(...data.hrTrack!.map((p) => p.hr))).toBe(110);
    expect(data.maxHr).toBe(188);
  });

  it('still lets the peak stated by the file win over the samples', () => {
    const data = read(
      'tcx',
      tcx(
        `<MaximumHeartRateBpm><Value>171</Value></MaximumHeartRateBpm>` +
          `<Track>${flatWithSpike(tcxPoint)}</Track>`,
      ),
    );
    expect(data.maxHr).toBe(171);
  });

  it('returns every heart rate sample next to the reading, heart rate only', () => {
    const result = readWatchFileDetailed({
      format: 'tcx',
      content: tcx(`<Track>${flatWithSpike(tcxPoint)}</Track>`),
    });
    if (!result.ok) throw new Error(result.error);
    expect(result.hrSamples.length).toBe(1500);
    expect(result.hrSamples[SPIKE_AT]).toEqual({ t: SPIKE_AT, hr: 188 });
    // The stored reading is the same as the one readWatchFile gives.
    expect(result.data).toEqual(read('tcx', tcx(`<Track>${flatWithSpike(tcxPoint)}</Track>`)));
  });

  it('drops out-of-bounds samples and those without heart rate', () => {
    const result = readWatchFileDetailed({
      format: 'tcx',
      content: tcx(
        `<Track>` +
          tcxPoint('2026-06-10T07:30:00.000Z', 100, 0) +
          tcxPoint('2026-06-10T07:30:01.000Z', 300, 3) +
          tcxPoint('2026-06-10T07:30:02.000Z', undefined, 6) +
          tcxPoint('2026-06-10T07:30:03.000Z', 120, 9) +
          `</Track>`,
      ),
    });
    if (!result.ok) throw new Error(result.error);
    expect(result.hrSamples).toEqual([
      { t: 0, hr: 100 },
      { t: 3, hr: 120 },
    ]);
  });

  it('gives no samples for a summary-only file', () => {
    const result = readWatchFileDetailed({ format: 'fit', content: FIT_RUNNING });
    if (!result.ok) throw new Error(result.error);
    expect(result.hrSamples).toEqual([]);
    expect(result.data.maxHr).toBe(175);
  });

  it('reports the same errors as readWatchFile', () => {
    expect(readWatchFileDetailed({ format: 'fit', content: FIT_CYCLING })).toEqual({
      ok: false,
      code: 'no_heart_rate',
      error: NO_HEART_RATE_MESSAGE,
    });
  });
});
