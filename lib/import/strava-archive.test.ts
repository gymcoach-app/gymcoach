// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import { gzipSync, Inflate, strToU8, strFromU8, Unzip, zipSync } from 'fflate';
import { ImportCancelledError } from './import-queue';
import {
  classifyStravaEntry,
  gunzipCapped,
  readStravaArchive,
  STRAVA_MAX_ACTIVITY_BYTES,
  StravaArchiveError,
  type StravaArchiveEntry,
} from './strava-archive';
import { halfNoise, heldBytes, noise } from './zip-test-support';

const CSV = 'Activity ID,Activity Date,Activity Name,Activity Type,Filename\n1,d,Run,Run,activities/1.gpx\n';
const GPX = '<gpx><trk><name>Morning Run</name></trk></gpx>';
const TCX = '<TrainingCenterDatabase/>';
const FIT = new Uint8Array([14, 16, 1, 2, 0, 0, 0, 0, 0x2e, 0x46, 0x49, 0x54, 0, 0]);

function blobOf(bytes: Uint8Array): Blob {
  return new Blob([bytes as BlobPart]);
}

async function entriesOf(
  zip: Uint8Array,
  options: Partial<Parameters<typeof readStravaArchive>[1]> = {},
): Promise<StravaArchiveEntry[]> {
  const entries: StravaArchiveEntry[] = [];
  await readStravaArchive(blobOf(zip), { onEntry: (e) => void entries.push(e), ...options });
  return entries;
}

describe('classifyStravaEntry', () => {
  it.each([
    ['activities.csv', { kind: 'csv' }],
    ['export_12345/activities.csv', { kind: 'csv' }],
    ['activities/1.fit', { kind: 'activity', format: 'fit', gz: false }],
    ['activities/1.fit.gz', { kind: 'activity', format: 'fit', gz: true }],
    ['activities/1.gpx', { kind: 'activity', format: 'gpx', gz: false }],
    ['activities/1.gpx.gz', { kind: 'activity', format: 'gpx', gz: true }],
    ['activities/1.tcx', { kind: 'activity', format: 'tcx', gz: false }],
    ['activities/1.TCX.GZ', { kind: 'activity', format: 'tcx', gz: true }],
    ['export_12345/activities/9.fit.gz', { kind: 'activity', format: 'fit', gz: true }],
    ['activities/1.json', { kind: 'unsupported' }],
    ['activities/1.kml.gz', { kind: 'unsupported' }],
    ['activities/', null],
    ['activities/sub/1.gpx', null],
    ['a/b/activities/1.gpx', null],
    ['a/b/activities.csv', null],
    ['media/1.jpg', null],
    ['media/activities.gpx', null],
    ['routes/1.gpx', null],
    ['profile.csv', null],
    ['activities/._1.gpx', null],
    ['__MACOSX/activities/1.gpx', null],
    ['', null],
  ])('%s', (name, expected) => {
    expect(classifyStravaEntry(name)).toEqual(expected);
  });
});

describe('gunzipCapped', () => {
  it('inflates a gzip member', () => {
    const out = gunzipCapped(gzipSync(strToU8(GPX)), 1000);
    expect(typeof out).not.toBe('string');
    expect(strFromU8(out as Uint8Array)).toBe(GPX);
  });

  it('stops at the cap instead of inflating a bomb', () => {
    // 4 MB of zeros gzip down to a few KB.
    const bomb = gzipSync(new Uint8Array(4 * 1024 * 1024));
    expect(bomb.length).toBeLessThan(16 * 1024);
    expect(gunzipCapped(bomb, 100_000)).toBe('too-large');
  });

  it('reports bytes that are not gzip', () => {
    expect(gunzipCapped(strToU8('definitely not gzip data'), 1000)).toBe('unreadable');
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('readStravaArchive', () => {
  it('reads activities.csv and the activity files, and nothing else', async () => {
    const zip = zipSync({
      'activities/1.gpx': strToU8(GPX),
      'activities/2.fit.gz': gzipSync(FIT),
      'activities/3.tcx.gz': gzipSync(strToU8(TCX)),
      'activities/4.fit': FIT,
      'activities/5.json': strToU8('{}'),
      'activities.csv': strToU8(CSV),
      'media/photo.jpg': strToU8('not a picture'),
      'routes/route.gpx': strToU8(GPX),
      'profile.csv': strToU8('a,b\n1,2\n'),
    });
    const progress: Array<[number, number]> = [];
    const entries = await entriesOf(zip, {
      onProgress: (read, total) => progress.push([read, total]),
    });

    expect(entries.map((e) => (e.kind === 'csv' ? 'csv' : `${e.kind}:${e.path}`))).toEqual([
      'activity:activities/1.gpx',
      'activity:activities/2.fit.gz',
      'activity:activities/3.tcx.gz',
      'activity:activities/4.fit',
      'skipped:activities/5.json',
      'csv',
    ]);
    const byPath = new Map(
      entries.flatMap((e) => (e.kind === 'activity' ? [[e.path, e] as const] : [])),
    );
    expect(strFromU8(byPath.get('activities/1.gpx')!.data)).toBe(GPX);
    // The .gz files arrive already inflated, with the format of the inner file.
    expect(byPath.get('activities/2.fit.gz')!.format).toBe('fit');
    expect([...byPath.get('activities/2.fit.gz')!.data]).toEqual([...FIT]);
    expect(strFromU8(byPath.get('activities/3.tcx.gz')!.data)).toBe(TCX);
    expect(entries.find((e) => e.kind === 'csv')).toEqual({ kind: 'csv', text: CSV });
    expect(entries.find((e) => e.kind === 'skipped')).toMatchObject({ reason: 'unsupported' });
    expect(progress[progress.length - 1]).toEqual([zip.length, zip.length]);
  });

  it('reads stored (uncompressed) entries and an archive wrapped in one folder', async () => {
    const zip = zipSync(
      {
        'export_1/activities.csv': strToU8(CSV),
        'export_1/activities/7.GPX.GZ': gzipSync(strToU8(GPX)),
      },
      { level: 0 },
    );
    const entries = await entriesOf(zip);
    expect(entries).toHaveLength(2);
    expect(entries[1]).toMatchObject({ kind: 'activity', path: 'activities/7.gpx.gz', format: 'gpx' });
  });

  it('waits for the caller before it reads further', async () => {
    const files: Record<string, Uint8Array> = {};
    // Incompressible payloads, so the archive spans many slices.
    for (let i = 0; i < 6; i++) {
      const bytes = new Uint8Array(90_000);
      for (let j = 0; j < bytes.length; j++) bytes[j] = (j * 31 + i * 7 + (j >> 8)) & 0xff;
      files[`activities/${i}.fit`] = bytes;
    }
    const zip = zipSync(files, { level: 0 });
    let inFlight = 0;
    let maxInFlight = 0;
    const order: string[] = [];
    await readStravaArchive(blobOf(zip), {
      onEntry: async (e) => {
        inFlight += 1;
        maxInFlight = Math.max(maxInFlight, inFlight);
        await new Promise((resolve) => setTimeout(resolve, 2));
        if (e.kind === 'activity') order.push(e.path);
        inFlight -= 1;
      },
    });
    expect(maxInFlight).toBe(1);
    expect(order).toEqual([0, 1, 2, 3, 4, 5].map((i) => `activities/${i}.fit`));
  });

  it('skips a file over the size cap, whether the size is declared or only found out', async () => {
    const big = new Uint8Array(STRAVA_MAX_ACTIVITY_BYTES + 1);
    const zip = zipSync({
      'activities/big.gpx': big,
      // Small on disk, over the cap once gunzipped.
      'activities/bomb.gpx.gz': gzipSync(big),
      'activities/ok.gpx': strToU8(GPX),
    });
    const entries = await entriesOf(zip);
    expect(entries).toEqual([
      { kind: 'skipped', path: 'activities/big.gpx', reason: 'too-large' },
      { kind: 'skipped', path: 'activities/bomb.gpx.gz', reason: 'too-large' },
      expect.objectContaining({ kind: 'activity', path: 'activities/ok.gpx' }),
    ]);
  });

  it('holds none of the bytes of the entries it does not read', async () => {
    // What a real archive is mostly made of: media, files over the size cap
    // and, on the confirm pass, activities the preview did not keep. None of
    // their bytes may stay in memory, during the read or after it.
    const zip = zipSync({
      'media/video.mp4': [noise(400_000, 1), { level: 0 }],
      'media/photo.jpg': [noise(300_000, 2), { level: 6 }],
      'activities/1.gpx': strToU8(GPX),
      'activities/unwanted.fit': [noise(300_000, 3), { level: 0 }],
      'activities/huge.fit': [new Uint8Array(STRAVA_MAX_ACTIVITY_BYTES + 1), { level: 0 }],
      'activities/9.kml': [noise(200_000, 4), { level: 0 }],
      'routes/route.gpx': [noise(200_000, 5), { level: 6 }],
      'activities/2.gpx': strToU8(GPX),
      'media/last.jpg': [noise(300_000, 6), { level: 0 }],
    });
    expect(zip.length).toBeGreaterThan(STRAVA_MAX_ACTIVITY_BYTES + 1_700_000);

    // The reader's Unzip, caught on its first push.
    const push = vi.spyOn(Unzip.prototype, 'push');
    const unzipOf = () => push.mock.contexts[0] as Unzip;
    const heldAtEntry: number[] = [];
    const entries: StravaArchiveEntry[] = [];
    let worst = 0;
    await readStravaArchive(blobOf(zip), {
      wants: (path) => path !== 'activities/unwanted.fit',
      onProgress: () => {
        worst = Math.max(worst, heldBytes(unzipOf()));
      },
      onEntry: (e) => {
        entries.push(e);
        heldAtEntry.push(heldBytes(unzipOf()));
      },
    });

    expect(entries.map((e) => (e.kind === 'csv' ? 'csv' : `${e.kind}:${e.path}`))).toEqual([
      'activity:activities/1.gpx',
      'skipped:activities/huge.fit',
      'skipped:activities/9.kml',
      'activity:activities/2.gpx',
    ]);
    expect(heldAtEntry).toEqual([0, 0, 0, 0]);
    expect(worst).toBe(0);
    expect(heldBytes(unzipOf())).toBe(0);
  });

  it('stops inflating an activity file once it is over the size cap', async () => {
    // Twice the cap once inflated, and a header that declares 1 KB: only the
    // count of inflated bytes can tell.
    const payload = halfNoise(2 * STRAVA_MAX_ACTIVITY_BYTES);
    const zip = zipSync({ 'activities/bomb.gpx': payload, 'activities/ok.gpx': strToU8(GPX) });
    const lying = zip.slice();
    new DataView(lying.buffer).setUint32(22, 1024, true);
    const compressed = new DataView(zip.buffer).getUint32(18, true);
    expect(compressed).toBeGreaterThan(STRAVA_MAX_ACTIVITY_BYTES * 0.8);

    let inflateInput = 0;
    const realPush = Inflate.prototype.push;
    vi.spyOn(Inflate.prototype, 'push').mockImplementation(function (this: Inflate, chunk, final) {
      inflateInput += chunk.length;
      realPush.call(this, chunk, final);
    });

    const entries = await entriesOf(lying);
    expect(entries).toEqual([
      { kind: 'skipped', path: 'activities/bomb.gpx', reason: 'too-large' },
      expect.objectContaining({ kind: 'activity', path: 'activities/ok.gpx' }),
    ]);
    // Half the entry inflates to the cap; the other half is never inflated.
    expect(inflateInput).toBeLessThan(compressed * 0.6);
  });

  it('reports a .gz file that is not gzip as unreadable, without failing the archive', async () => {
    const zip = zipSync({
      'activities/bad.fit.gz': strToU8('this is not gzip at all'),
      'activities/empty.gpx': new Uint8Array(0),
      'activities/ok.gpx': strToU8(GPX),
    });
    const entries = await entriesOf(zip);
    expect(entries.map((e) => (e.kind === 'skipped' ? e.reason : e.kind))).toEqual([
      'unreadable',
      'unreadable',
      'activity',
    ]);
  });

  it('leaves the files the caller does not want compressed', async () => {
    const zip = zipSync({
      'activities/1.gpx': strToU8(GPX),
      'activities/2.gpx': strToU8(GPX),
      'activities.csv': strToU8(CSV),
    });
    const entries = await entriesOf(zip, { wants: (path) => path === 'activities/2.gpx' });
    expect(entries.map((e) => (e.kind === 'csv' ? 'csv' : e.path))).toEqual([
      'activities/2.gpx',
      'csv',
    ]);
  });

  it('falls back to sliced reads when the browser has no Blob.stream()', async () => {
    const blob = blobOf(zipSync({ 'activities/1.gpx': strToU8(GPX) }));
    Object.defineProperty(blob, 'stream', { value: undefined });
    const entries: StravaArchiveEntry[] = [];
    await readStravaArchive(blob, { onEntry: (e) => void entries.push(e) });
    expect(entries).toHaveLength(1);
  });

  it('refuses a file that is not a zip, and an empty one', async () => {
    await expect(entriesOf(strToU8('Activity ID,Filename\n'))).rejects.toMatchObject({
      name: 'StravaArchiveError',
      code: 'not-zip',
    });
    await expect(entriesOf(new Uint8Array(0))).rejects.toMatchObject({ code: 'not-zip' });
  });

  it('refuses a zip that is not a Strava archive', async () => {
    const zip = zipSync({ 'apple_health_export/export.xml': strToU8('<HealthData/>') });
    await expect(entriesOf(zip)).rejects.toMatchObject({ code: 'not-strava' });
  });

  it('refuses a damaged archive', async () => {
    const zip = zipSync({ 'activities/1.gpx': strToU8(GPX.repeat(200)) });
    const broken = zip.slice();
    broken.fill(0xff, 50, 120);
    await expect(entriesOf(broken)).rejects.toBeInstanceOf(StravaArchiveError);
  });

  it('stops when the signal is aborted', async () => {
    const zip = zipSync({
      'activities/1.gpx': strToU8(GPX),
      'activities/2.gpx': strToU8(GPX),
    });
    const controller = new AbortController();
    const seen: string[] = [];
    await expect(
      readStravaArchive(blobOf(zip), {
        signal: controller.signal,
        onEntry: (e) => {
          if (e.kind === 'activity') seen.push(e.path);
          controller.abort();
        },
      }),
    ).rejects.toBeInstanceOf(ImportCancelledError);
    expect(seen).toEqual(['activities/1.gpx']);
  });
});
