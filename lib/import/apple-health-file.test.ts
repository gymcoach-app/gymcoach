// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { strToU8, zipSync } from 'fflate';
import {
  AppleHealthFileError,
  isAppleHealthExportEntry,
  readAppleHealthFile,
} from './apple-health-file';

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

describe('readAppleHealthFile', () => {
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
    expect(result.bodyMass).toEqual([{ measuredAt: '2024-01-01T07:00:00.000Z', weightKg: 80 }]);
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
