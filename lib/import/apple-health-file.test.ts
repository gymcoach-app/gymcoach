// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Inflate, Unzip, strToU8, zipSync } from 'fflate';
import { AppleHealthScanner } from './apple-health';
import {
  APPLE_HEALTH_MAX_INFLATED_BYTES,
  APPLE_HEALTH_MAX_INFLATED_GB,
  APPLE_HEALTH_MAX_ZIP_ENTRIES,
  AppleHealthFileError,
  isAppleHealthExportEntry,
  readAppleHealthFile,
} from './apple-health-file';
import { heldBytes, manyEntriesZip, noise } from './zip-test-support';

const NOW = new Date('2025-01-01T00:00:00.000Z');

const workout = (type: string, day: string) =>
  `<Workout workoutActivityType="HKWorkoutActivityType${type}" startDate="2024-01-${day} 08:00:00 +0000" duration="10" durationUnit="min"/>\n`;

const EXPORT_XML =
  '<?xml version="1.0" encoding="UTF-8"?>\n<HealthData locale="en_US">\n' +
  '<Record type="HKQuantityTypeIdentifierBodyMass" unit="kg" startDate="2024-01-01 07:00:00 +0000" value="80"/>\n' +
  // Enough filler records to span several read and inflate chunks.
  '<Record type="HKQuantityTypeIdentifierStepCount" unit="count" startDate="2024-01-01 07:00:00 +0000" value="12"/>\n'.repeat(
    4000,
  ) +
  workout('Running', '02') +
  workout('TraditionalStrengthTraining', '03') +
  workout('Walking', '04') +
  '</HealthData>\n';

// A route file and the clinical document sit next to the export in a real
// archive: both must be left alone.
const DECOY = strToU8(workout('Cycling', '09'));

function blobOf(bytes: Uint8Array): Blob {
  return new Blob([bytes as BlobPart]);
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('readAppleHealthFile', () => {
  it('holds none of the bytes of the entries it does not read', async () => {
    // What a real export.zip carries beside the export: the clinical document
    // (as large as the export), GPS routes and ECGs. Stored and deflated,
    // before and after the export.
    const zip = zipSync({
      'apple_health_export/export_cda.xml': [noise(400_000, 1), { level: 0 }],
      'apple_health_export/workout-routes/route_2024-01-02.gpx': [noise(300_000, 2), { level: 6 }],
      'apple_health_export/export.xml': strToU8(EXPORT_XML),
      'apple_health_export/electrocardiograms/ecg_2024-01-02.csv': [noise(300_000, 3), { level: 0 }],
      'apple_health_export/workout-routes/route_2024-01-04.gpx': [noise(200_000, 4), { level: 6 }],
    });
    expect(zip.length).toBeGreaterThan(1_200_000);

    // The reader's Unzip, caught on its first push.
    const push = vi.spyOn(Unzip.prototype, 'push');
    const unzipOf = () => push.mock.contexts[0] as Unzip;
    let worst = 0;
    let samples = 0;
    const result = await readAppleHealthFile(blobOf(zip), {
      now: NOW,
      onProgress: () => {
        samples += 1;
        worst = Math.max(worst, heldBytes(unzipOf()));
      },
    });

    expect(result.workouts.map((w) => w.activityType)).toEqual(['Running', 'Walking']);
    expect(samples).toBeGreaterThan(0);
    expect(worst).toBe(0);
    expect(heldBytes(unzipOf())).toBe(0);
  });

  it('reads one export entry, the first match, and inflates no later one', async () => {
    const second =
      '<HealthData>' + workout('Cycling', '10') + workout('Hiking', '11') + '</HealthData>';
    const zip = zipSync({
      'apple_health_export/export.xml': strToU8(EXPORT_XML),
      'apple_health_export/export 2.xml': strToU8(second),
      'backup/export.xml': strToU8(second),
    });
    const inflate = vi.spyOn(Inflate.prototype, 'push');
    const result = await readAppleHealthFile(blobOf(zip), { now: NOW });
    const inflatedIn = inflate.mock.calls.reduce((sum, [data]) => sum + data.length, 0);

    expect(result.workouts.map((w) => w.activityType)).toEqual(['Running', 'Walking']);
    expect(result.skippedStrength).toBe(1);
    // Only the compressed bytes of the first entry went through an inflater.
    expect(inflatedIn).toBeGreaterThan(0);
    expect(inflatedIn).toBeLessThan(zip.length - 2 * 100);

    // The first match wins whatever its name: here the localized one.
    const other = zipSync({
      'apple_health_export/Exportieren.xml': strToU8(second),
      'apple_health_export/export.xml': strToU8(EXPORT_XML),
    });
    const fromOther = await readAppleHealthFile(blobOf(other), { now: NOW });
    expect(fromOther.workouts.map((w) => w.activityType)).toEqual(['Cycling', 'Hiking']);
  });

  it('stops reading the archive once the export entry has arrived', async () => {
    const tail = noise(1_500_000, 9);
    const zip = zipSync({
      'apple_health_export/export.xml': strToU8(EXPORT_XML),
      'apple_health_export/export_cda.xml': [tail, { level: 0 }],
    });
    // Count what the reader pulls out of the file.
    const blob = blobOf(zip);
    let pulled = 0;
    Object.defineProperty(blob, 'stream', { value: undefined });
    const slice = blob.slice.bind(blob);
    blob.slice = (start?: number, end?: number) => {
      pulled += Math.min(end ?? zip.length, zip.length) - (start ?? 0);
      return slice(start, end);
    };
    const pushed = vi.spyOn(Unzip.prototype, 'push');
    const progress: Array<[number, number]> = [];

    const result = await readAppleHealthFile(blob, {
      now: NOW,
      onProgress: (read, total) => progress.push([read, total]),
    });

    expect(result.workouts.map((w) => w.activityType)).toEqual(['Running', 'Walking']);
    // One 1 MB read holds the whole export entry: the 1.5 MB after it are
    // neither read from the file nor pushed into the unzip.
    expect(pulled).toBe(1024 * 1024);
    const unzipped = pushed.mock.calls.reduce((sum, [chunk]) => sum + chunk.length, 0);
    expect(unzipped).toBeLessThan(200_000);
    // Progress still ends on the full size.
    expect(progress).toEqual([[zip.length, zip.length]]);
  });

  it('refuses an archive with too many entries before the export', async () => {
    const zip = manyEntriesZip(30, zipSync({ 'apple_health_export/export.xml': strToU8(EXPORT_XML) }));
    await expect(
      readAppleHealthFile(blobOf(zip), { now: NOW, maxZipEntries: 30 }),
    ).rejects.toMatchObject({ name: 'AppleHealthFileError', code: 'too-many-files' });
    // The export is entry 31: readable with one more.
    const result = await readAppleHealthFile(blobOf(zip), { now: NOW, maxZipEntries: 31 });
    expect(result.workouts).toHaveLength(2);
    expect(APPLE_HEALTH_MAX_ZIP_ENTRIES).toBe(50_000);
  });

  it('stops with too-large once the export inflates past the cap', async () => {
    // 2 GB, the documented limit.
    expect(APPLE_HEALTH_MAX_INFLATED_BYTES).toBe(APPLE_HEALTH_MAX_INFLATED_GB * 1024 ** 3);

    // A deflate bomb: 32 MB of spaces in a few tens of KB of archive (more
    // than one slice of it). Building it is the slow part of this test.
    const bomb = zipSync(
      { 'apple_health_export/export.xml': new Uint8Array(32 * 1024 * 1024).fill(32) },
      { level: 1 },
    );
    expect(bomb.length).toBeGreaterThan(16 * 1024);
    expect(bomb.length).toBeLessThan(400_000);
    const cap = 1024 * 1024;
    const scanned = vi.spyOn(AppleHealthScanner.prototype, 'push');
    const inflate = vi.spyOn(Inflate.prototype, 'push');
    const progress: number[] = [];

    await expect(
      readAppleHealthFile(blobOf(bomb), {
        now: NOW,
        maxInflatedBytes: cap,
        onProgress: (read) => progress.push(read),
      }),
    ).rejects.toMatchObject({ name: 'AppleHealthFileError', code: 'too-large' });

    // Nothing past the cap reached the scanner, and the inflater was not fed
    // the rest of the entry: the read stopped within one slice of the archive.
    const scannedBytes = scanned.mock.calls.reduce((sum, [chunk]) => sum + chunk.length, 0);
    expect(scannedBytes).toBeLessThanOrEqual(cap);
    const inflatedIn = inflate.mock.calls.reduce((sum, [data]) => sum + data.length, 0);
    expect(inflatedIn).toBeLessThanOrEqual(16 * 1024);
    expect(progress).toEqual([]);
  }, 30_000);

  it('caps a stored entry too, and accepts an export exactly at the cap', async () => {
    const xml = strToU8(EXPORT_XML);
    const stored = zipSync({ 'apple_health_export/export.xml': xml }, { level: 0 });
    await expect(
      readAppleHealthFile(blobOf(stored), { now: NOW, maxInflatedBytes: xml.length - 1 }),
    ).rejects.toMatchObject({ code: 'too-large' });
    const result = await readAppleHealthFile(blobOf(stored), { now: NOW, maxInflatedBytes: xml.length });
    expect(result.workouts).toHaveLength(2);
  });

  it('hands the scanner bounded chunks even when the archive inflates a lot per slice', async () => {
    // 8 MB of spaces: one 16 KB slice of archive holds all of it.
    const zip = zipSync({
      'apple_health_export/export.xml': strToU8(' '.repeat(8 * 1024 * 1024) + workout('Running', '02')),
    });
    const decode = vi.spyOn(TextDecoder.prototype, 'decode');
    const result = await readAppleHealthFile(blobOf(zip), { now: NOW });
    const largest = Math.max(
      ...decode.mock.calls.map(([input]) => (input as Uint8Array | undefined)?.byteLength ?? 0),
    );
    expect(result.workouts.map((w) => w.activityType)).toEqual(['Running']);
    expect(largest).toBeLessThanOrEqual(256 * 1024);
  });

  it('reads export.xml out of an export.zip, and only that entry', async () => {
    const zip = zipSync({
      'apple_health_export/export_cda.xml': DECOY,
      'apple_health_export/workout-routes/route_2024-01-02.gpx': DECOY,
      'apple_health_export/export.xml': strToU8(EXPORT_XML),
      'apple_health_export/electrocardiograms/deep/notes.xml': DECOY,
    });
    const progress: Array<[number, number]> = [];
    const result = await readAppleHealthFile(blobOf(zip), {
      now: NOW,
      onProgress: (read, total) => progress.push([read, total]),
    });

    expect(result.workouts.map((w) => w.activityType)).toEqual(['Running', 'Walking']);
    expect(result.skippedStrength).toBe(1);
    expect(result.bodyMass).toEqual([
      { measuredAt: '2024-01-01T07:00:00.000Z', weightKg: 80, utcOffsetMin: 0 },
    ]);
    // Progress counts the bytes of the picked file and ends at its size.
    expect(progress.length).toBeGreaterThan(0);
    expect(progress[progress.length - 1]).toEqual([zip.length, zip.length]);
  });

  it('reads a stored (uncompressed) entry and a localized file name', async () => {
    const zip = zipSync(
      { [`apple_health_export/Exportaci${String.fromCodePoint(0xf3)}n.xml`]: strToU8(EXPORT_XML) },
      { level: 0 },
    );
    const result = await readAppleHealthFile(blobOf(zip), { now: NOW });
    expect(result.workouts).toHaveLength(2);
  });

  it('reads a bare export.xml as a stream', async () => {
    const result = await readAppleHealthFile(blobOf(strToU8(EXPORT_XML)), { now: NOW });
    expect(result.workouts.map((w) => w.activityType)).toEqual(['Running', 'Walking']);
    expect(result.bodyMass).toHaveLength(1);
  });

  it('falls back to sliced reads when the browser has no Blob.stream()', async () => {
    const blob = blobOf(strToU8(EXPORT_XML));
    Object.defineProperty(blob, 'stream', { value: undefined });
    const result = await readAppleHealthFile(blob, { now: NOW });
    expect(result.workouts).toHaveLength(2);
  });

  it('refuses an archive without an export XML', async () => {
    const zip = zipSync({ 'photos/readme.txt': strToU8('hello') });
    await expect(readAppleHealthFile(blobOf(zip), { now: NOW })).rejects.toMatchObject({
      name: 'AppleHealthFileError',
      code: 'no-export-xml',
    });
  });

  it('refuses a damaged archive', async () => {
    const zip = zipSync({ 'apple_health_export/export.xml': strToU8(EXPORT_XML) });
    // Corrupt the deflate stream right after the local file header.
    const broken = zip.slice();
    broken.fill(0xff, 80, 200);
    await expect(readAppleHealthFile(blobOf(broken), { now: NOW })).rejects.toBeInstanceOf(
      AppleHealthFileError,
    );
  });

  it('resolves with nothing for a file that is not an export', async () => {
    const result = await readAppleHealthFile(blobOf(strToU8('just some text')), { now: NOW });
    expect(result).toEqual({ workouts: [], skippedStrength: 0, skippedInvalid: 0, bodyMass: [] });
  });
});

describe('isAppleHealthExportEntry', () => {
  it.each([
    ['apple_health_export/export.xml', true],
    ['export.xml', true],
    ['apple_health_export/Export.XML', true],
    ['apple_health_export/Exportieren.xml', true],
    ['apple_health_export/export_cda.xml', false],
    ['apple_health_export/workout-routes/route.gpx', false],
    ['apple_health_export/electrocardiograms/ecg.csv', false],
    ['a/b/export.xml', true],
    ['a/b/other.xml', false],
    ['apple_health_export/', false],
    ['__MACOSX/._export.xml', false],
    ['', false],
  ])('%s -> %s', (name, expected) => {
    expect(isAppleHealthExportEntry(name)).toBe(expected);
  });
});
