// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { gzipSync, strToU8, zipSync } from 'fflate';
import type { ImportQueue, ImportQueueResponse } from './import-queue';
import { runStravaConfirm, runStravaPreview } from './strava-import';
import { FIT_MAX_BATCH } from '@/lib/schemas/import';

const CSV_HEADER = 'Activity ID,Activity Date,Activity Name,Activity Type,Filename';

function blobOf(files: Record<string, Uint8Array>): Blob {
  return new Blob([zipSync(files) as BlobPart]);
}

interface Call {
  url: string;
  body: { mode: string; gpx?: string; xml?: string; fits?: string[] };
}

// A stand-in for the three routes: every file's content is a short tag, and
// the tag decides the verdict ("dup" = duplicate, "bad" = unreadable).
function fakeRoutes() {
  const calls: Call[] = [];
  const summary = (tag: string, mode: string) => ({
    mode,
    sport: 'Running',
    exerciseName: tag.startsWith('ride') ? 'Cycling' : 'Running',
    duplicateSessions: tag.includes('dup') ? ['2024-01-01T00:00:00.000Z'] : [],
    ...(mode === 'confirm' ? { createdSessions: 1, createdExercises: 0 } : {}),
  });
  const reply = (status: number, json: unknown): ImportQueueResponse => ({
    status,
    ok: status < 300,
    json,
  });
  const post = vi.fn(async (url: string, raw: unknown) => {
    const body = raw as Call['body'];
    calls.push({ url, body });
    if (body.fits) {
      const tags = body.fits.map((b64) => atob(b64));
      if (body.mode === 'confirm') {
        const skipped = tags.filter((t) => t.includes('conflict')).length;
        return reply(200, {
          mode: 'confirm',
          createdSessions: tags.length - skipped,
          createdExercises: 1,
          skipped,
        });
      }
      return reply(200, {
        mode: 'preview',
        activities: tags.map((tag, index) =>
          tag.includes('bad')
            ? { index, ok: false, error: 'Unreadable file.' }
            : { index, ok: true, ...summary(tag, 'preview') },
        ),
      });
    }
    const tag = body.gpx ?? body.xml ?? '';
    if (tag.includes('bad')) return reply(400, { error: 'Unreadable file.' });
    if (tag.includes('conflict') && body.mode === 'confirm') {
      return reply(409, { error: 'You already have a non-cardio exercise named "Running".' });
    }
    if (tag.includes('boom')) return reply(500, { error: 'Server error.' });
    return reply(200, summary(tag, body.mode));
  });
  const queue: ImportQueue = { post };
  return { queue, calls };
}

describe('runStravaPreview', () => {
  it('routes every file to its import route and adds up one preview', async () => {
    const archive = blobOf({
      'activities.csv': strToU8(
        [
          CSV_HEADER,
          '1,d,Morning Run,Run,activities/1.gpx',
          '2,d,Evening Ride,Ride,activities/2.tcx.gz',
          '3,d,Old Run,Run,activities/3.fit.gz',
          '4,d,Broken Watch Run,Run,activities/4.fit',
          '5,d,Seen Before,Run,activities/5.gpx.gz',
          '6,d,Yoga,Yoga,',
          '7,d,Weights,Weight Training,',
          '8,d,Corrupt,Run,activities/8.gpx',
        ].join('\n'),
      ),
      'activities/1.gpx': strToU8('run-1'),
      'activities/2.tcx.gz': gzipSync(strToU8('  \n ride-2 ')),
      'activities/3.fit.gz': gzipSync(strToU8('run-3')),
      'activities/4.fit': strToU8('bad-4'),
      'activities/5.gpx.gz': gzipSync(strToU8('run-dup-5')),
      'activities/8.gpx': strToU8('bad-8'),
      'activities/9.json': strToU8('{}'),
      'media/1.jpg': strToU8('jpg'),
    });
    const { queue, calls } = fakeRoutes();
    const progress: number[] = [];
    const preview = await runStravaPreview(archive, {
      queue,
      onProgress: (p) => progress.push(p.activities),
    });

    expect(calls.every((c) => c.body.mode === 'preview')).toBe(true);
    expect(calls.map((c) => c.url).sort()).toEqual([
      '/api/import/fit',
      '/api/import/gpx',
      '/api/import/gpx',
      '/api/import/gpx',
      '/api/import/tcx',
    ]);
    // GPX rides in `gpx`, TCX in `xml` (trimmed), both FIT files in one batch.
    expect(calls.find((c) => c.url === '/api/import/tcx')!.body.xml).toBe('ride-2');
    expect(calls.find((c) => c.url === '/api/import/fit')!.body.fits).toEqual([
      btoa('run-3'),
      btoa('bad-4'),
    ]);

    expect(preview.importable).toBe(3);
    expect([...preview.keep].sort()).toEqual([
      'activities/1.gpx',
      'activities/2.tcx.gz',
      'activities/3.fit.gz',
    ]);
    expect(preview.byExercise).toEqual([
      { exerciseName: 'Running', count: 2 },
      { exerciseName: 'Cycling', count: 1 },
    ]);
    expect(preview.duplicates).toBe(1);
    expect(preview.unreadable).toBe(2);
    expect(preview.unsupported).toBe(1);
    expect(preview.tooLarge).toBe(0);
    expect(preview.withoutFile).toBe(2);
    // The files left out are named after their row of activities.csv.
    expect(preview.problems).toEqual(
      expect.arrayContaining([
        { path: 'activities/4.fit', reason: 'unreadable', name: 'Broken Watch Run' },
        { path: 'activities/8.gpx', reason: 'unreadable', name: 'Corrupt' },
        { path: 'activities/9.json', reason: 'unsupported', name: null },
      ]),
    );
    expect(progress[progress.length - 1]).toBe(6);
  });

  it('splits FIT files into batches of the route limit', async () => {
    const files: Record<string, Uint8Array> = {};
    for (let i = 0; i < FIT_MAX_BATCH * 2 + 5; i++) files[`activities/${i}.fit`] = strToU8(`run-${i}`);
    const { queue, calls } = fakeRoutes();
    const preview = await runStravaPreview(blobOf(files), { queue });

    expect(calls.map((c) => c.body.fits!.length)).toEqual([FIT_MAX_BATCH, FIT_MAX_BATCH, 5]);
    expect(preview.importable).toBe(FIT_MAX_BATCH * 2 + 5);
    // No activities.csv: the manual entry count is unknown, not zero.
    expect(preview.withoutFile).toBeNull();
  });

  it('leaves the manual entry count unknown when activities.csv has no filename column', async () => {
    const { queue } = fakeRoutes();
    const preview = await runStravaPreview(
      blobOf({
        // Recognized by its id column only: no row can be told to be manual.
        'activities.csv': strToU8('A,B,C,D\n55,d,Run,Run\n56,d,Yoga,Yoga\n'),
        'activities/55.gpx': strToU8('run-55'),
      }),
      { queue },
    );
    expect(preview.importable).toBe(1);
    expect(preview.withoutFile).toBeNull();
  });

  it('fails the pass on an error that is not about one file', async () => {
    const { queue } = fakeRoutes();
    await expect(
      runStravaPreview(blobOf({ 'activities/1.gpx': strToU8('boom') }), { queue }),
    ).rejects.toThrow('Server error.');
  });
});

describe('runStravaConfirm', () => {
  it('sends only the kept files, in confirm mode, and adds up what was written', async () => {
    const archive = blobOf({
      'activities.csv': strToU8(`${CSV_HEADER}\n1,d,Run,Run,activities/1.gpx\n`),
      'activities/1.gpx': strToU8('run-1'),
      'activities/2.gpx': strToU8('run-dup-2'),
      'activities/3.fit': strToU8('run-3'),
      'activities/4.fit.gz': gzipSync(strToU8('run-conflict-4')),
      'activities/5.tcx': strToU8('run-conflict-5'),
      'activities/6.fit': strToU8('run-dup-6'),
    });
    const { queue, calls } = fakeRoutes();
    const keep = new Set([
      'activities/1.gpx',
      'activities/3.fit',
      'activities/4.fit.gz',
      'activities/5.tcx',
    ]);
    const result = await runStravaConfirm(archive, keep, { queue });

    expect(calls.every((c) => c.body.mode === 'confirm')).toBe(true);
    expect(calls.map((c) => c.url).sort()).toEqual([
      '/api/import/fit',
      '/api/import/gpx',
      '/api/import/tcx',
    ]);
    expect(calls.find((c) => c.url === '/api/import/gpx')!.body.gpx).toBe('run-1');
    expect(calls.find((c) => c.url === '/api/import/fit')!.body.fits).toEqual([
      btoa('run-3'),
      btoa('run-conflict-4'),
    ]);
    // 1.gpx and 3.fit are written; the two name conflicts are skipped.
    expect(result).toEqual({ createdSessions: 2, createdExercises: 1, skipped: 2 });
  });
});
