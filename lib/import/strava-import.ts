import type { ImportQueue } from '@/lib/import/import-queue';
import {
  readStravaArchive,
  type StravaActivityFormat,
  type StravaArchiveEntry,
} from '@/lib/import/strava-archive';
import { parseStravaActivitiesCsv, type StravaCsv } from '@/lib/import/strava-csv';
import { FIT_MAX_BATCH } from '@/lib/schemas/import';

// ============================================================
// Strava archive import, the two passes (issue #582) - browser side
// ============================================================
// The archive is read TWICE, on purpose. The preview pass streams it and asks
// the FIT, GPX and TCX routes for a dry run of every activity file, keeping
// only one short line per file (its path and the verdict). The confirm pass
// streams it again and sends, in confirm mode, the files the preview kept.
// Holding every decompressed activity between the two clicks would cost
// hundreds of MB on a long history; reading the picked file again costs
// nothing but time.
//
// The routes are used as they are: FIT files go in batches of FIT_MAX_BATCH
// (one request, one charge of the import rate bucket), GPX and TCX files one
// a request because that is what their routes accept. Parsing, the duplicate
// rule and the writes stay on the server, in one place.
//
// What activities.csv is used for: counting the activities that have no file
// (typed in by hand on Strava; they are skipped, see docs/faq.md) and naming
// the files that could not be imported. The routes take no session name and
// are not changed for it.

export type StravaProblemReason = 'unsupported' | 'too-large' | 'unreadable';

export interface StravaProblem {
  path: string;
  reason: StravaProblemReason;
  // The activity's name in activities.csv, when the file is listed there.
  name: string | null;
}

export interface StravaPreview {
  // Activity files the confirm pass will send.
  importable: number;
  byExercise: Array<{ exerciseName: string; count: number }>;
  // Files whose start is within the duplicate window of an existing session:
  // left out, so a newer archive only adds what is new.
  duplicates: number;
  unreadable: number;
  unsupported: number;
  tooLarge: number;
  // Null when the archive has no readable activities.csv.
  withoutFile: number | null;
  // The first STRAVA_MAX_PROBLEMS files that will not be imported.
  problems: StravaProblem[];
  // Paths (activities/<file>, lowercase) of the importable files.
  keep: Set<string>;
}

export interface StravaImportResult {
  createdSessions: number;
  createdExercises: number;
  // Files the server refused at confirm time (for example a name conflict
  // with a non-cardio exercise).
  skipped: number;
}

export interface StravaProgress {
  bytesRead: number;
  totalBytes: number;
  // Activity files answered by the server so far in this pass.
  activities: number;
}

export interface StravaPassOptions {
  queue: ImportQueue;
  signal?: AbortSignal;
  onProgress?: (progress: StravaProgress) => void;
}

export const STRAVA_MAX_PROBLEMS = 20;

// A FIT batch stays well under the route's 25 MB body cap.
const FIT_BATCH_MAX_CHARS = 16 * 1024 * 1024;

const ENDPOINT: Record<StravaActivityFormat, string> = {
  fit: '/api/import/fit',
  gpx: '/api/import/gpx',
  tcx: '/api/import/tcx',
};

function toBase64(bytes: Uint8Array): string {
  let binary = '';
  const step = 0x8000;
  for (let i = 0; i < bytes.length; i += step) {
    binary += String.fromCharCode(...bytes.subarray(i, i + step));
  }
  return btoa(binary);
}

// GPX and TCX travel as text. Strava's own TCX files start with blank space
// before the XML declaration, which strict readers refuse.
function toXmlText(bytes: Uint8Array): string {
  const text = new TextDecoder().decode(bytes);
  return (text.charCodeAt(0) === 0xfeff ? text.slice(1) : text).trim();
}

type Verdict =
  | { ok: true; exerciseName: string; duplicate: boolean }
  | { ok: false };

interface Summary {
  exerciseName?: unknown;
  duplicateSessions?: unknown;
  createdExercises?: unknown;
  createdSessions?: unknown;
  skipped?: unknown;
  error?: unknown;
  activities?: unknown;
}

function asSummary(json: unknown): Summary {
  return json && typeof json === 'object' ? (json as Summary) : {};
}

function count(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
}

function verdictOf(summary: Summary): Verdict {
  return {
    ok: true,
    exerciseName: typeof summary.exerciseName === 'string' ? summary.exerciseName : '',
    duplicate: Array.isArray(summary.duplicateSessions) && summary.duplicateSessions.length > 0,
  };
}

function fail(status: number, summary: Summary): never {
  throw new Error(typeof summary.error === 'string' ? summary.error : `Error ${status}`);
}

// Sends activity files through the existing routes. In preview mode it
// reports one verdict a file; in confirm mode it adds up what was written. A
// request the server refuses for the file itself (400 unreadable, 409 name
// conflict, 413 too large) only costs that file; anything else (signed out,
// server error, a rate limit that never clears) fails the pass.
class ActivitySender {
  private fits: Array<{ path: string; b64: string }> = [];
  private fitChars = 0;
  readonly written: StravaImportResult = { createdSessions: 0, createdExercises: 0, skipped: 0 };

  constructor(
    private readonly mode: 'preview' | 'confirm',
    private readonly queue: ImportQueue,
    // Called once per file the server answered for.
    private readonly onAnswer: (path: string, verdict: Verdict) => void,
  ) {}

  async add(path: string, format: StravaActivityFormat, data: Uint8Array): Promise<void> {
    if (format === 'fit') {
      const b64 = toBase64(data);
      if (this.fits.length > 0 && this.fitChars + b64.length > FIT_BATCH_MAX_CHARS) {
        await this.flush();
      }
      this.fits.push({ path, b64 });
      this.fitChars += b64.length;
      if (this.fits.length >= FIT_MAX_BATCH) await this.flush();
      return;
    }
    const text = toXmlText(data);
    const res = await this.queue.post(
      ENDPOINT[format],
      format === 'gpx' ? { gpx: text, mode: this.mode } : { xml: text, mode: this.mode },
    );
    const summary = asSummary(res.json);
    if (res.ok) {
      const verdict = verdictOf(summary);
      if (this.mode === 'confirm') {
        this.written.createdSessions += 1;
        this.written.createdExercises += count(summary.createdExercises);
      }
      this.onAnswer(path, verdict);
    } else if (res.status === 400 || res.status === 409 || res.status === 413) {
      if (this.mode === 'confirm') this.written.skipped += 1;
      this.onAnswer(path, { ok: false });
    } else fail(res.status, summary);
  }

  async flush(): Promise<void> {
    if (this.fits.length === 0) return;
    const batch = this.fits;
    this.fits = [];
    this.fitChars = 0;
    const res = await this.queue.post(ENDPOINT.fit, {
      fits: batch.map((f) => f.b64),
      mode: this.mode,
    });
    const summary = asSummary(res.json);
    if (!res.ok) fail(res.status, summary);
    if (this.mode === 'confirm') {
      // A confirmed batch answers with counts, not per file.
      this.written.createdSessions += count(summary.createdSessions);
      this.written.createdExercises += count(summary.createdExercises);
      this.written.skipped += count(summary.skipped);
    }
    const answers = new Map<number, Summary & { ok?: unknown }>();
    if (Array.isArray(summary.activities)) {
      for (const a of summary.activities) {
        const row = asSummary(a) as Summary & { ok?: unknown; index?: unknown };
        if (typeof row.index === 'number') answers.set(row.index, row);
      }
    }
    batch.forEach((f, index) => {
      const row = answers.get(index);
      this.onAnswer(f.path, row && row.ok === true ? verdictOf(row) : { ok: false });
    });
  }
}

// Pass 1: dry run. Nothing is written.
export async function runStravaPreview(
  file: Blob,
  options: StravaPassOptions,
): Promise<StravaPreview> {
  const { queue, signal, onProgress } = options;
  const keep = new Set<string>();
  const counts = new Map<string, number>();
  const problems: Array<{ path: string; reason: StravaProblemReason }> = [];
  const totals = { duplicates: 0, unreadable: 0, unsupported: 0, tooLarge: 0 };
  let csv: StravaCsv | null = null;
  let activities = 0;
  let bytesRead = 0;
  const report = () => onProgress?.({ bytesRead, totalBytes: file.size, activities });

  const problem = (path: string, reason: StravaProblemReason) => {
    if (reason === 'unsupported') totals.unsupported += 1;
    else if (reason === 'too-large') totals.tooLarge += 1;
    else totals.unreadable += 1;
    if (problems.length < STRAVA_MAX_PROBLEMS) problems.push({ path, reason });
  };

  const sender = new ActivitySender('preview', queue, (path, verdict) => {
    activities += 1;
    if (!verdict.ok) problem(path, 'unreadable');
    else if (verdict.duplicate) totals.duplicates += 1;
    else if (!keep.has(path)) {
      keep.add(path);
      counts.set(verdict.exerciseName, (counts.get(verdict.exerciseName) ?? 0) + 1);
    }
    report();
  });

  await readStravaArchive(file, {
    signal,
    onProgress: (read) => {
      bytesRead = read;
      report();
    },
    onEntry: async (entry: StravaArchiveEntry) => {
      if (entry.kind === 'csv') csv = parseStravaActivitiesCsv(entry.text);
      else if (entry.kind === 'skipped') problem(entry.path, entry.reason);
      else await sender.add(entry.path, entry.format, entry.data);
    },
  });
  await sender.flush();

  const index = csv as StravaCsv | null;
  const names = new Map<string, string>();
  if (index && problems.length > 0) {
    for (const a of index.activities) {
      if (a.filename && a.name) names.set(a.filename, a.name);
    }
  }
  return {
    importable: keep.size,
    byExercise: [...counts.entries()]
      .map(([exerciseName, n]) => ({ exerciseName, count: n }))
      .sort((a, b) => b.count - a.count || a.exerciseName.localeCompare(b.exerciseName)),
    ...totals,
    withoutFile: index && index.recognized ? index.withoutFile : null,
    problems: problems.map((p) => ({ ...p, name: names.get(p.path) ?? null })),
    keep,
  };
}

// Pass 2: send the kept files in confirm mode. Files already written stay if
// the pass fails or is cancelled halfway; running the import again skips them
// as duplicates.
export async function runStravaConfirm(
  file: Blob,
  keep: ReadonlySet<string>,
  options: StravaPassOptions,
): Promise<StravaImportResult> {
  const { queue, signal, onProgress } = options;
  let activities = 0;
  let bytesRead = 0;
  const report = () => onProgress?.({ bytesRead, totalBytes: file.size, activities });

  const sender = new ActivitySender('confirm', queue, () => {
    activities += 1;
    report();
  });

  await readStravaArchive(file, {
    signal,
    wants: (path) => keep.has(path),
    onProgress: (read) => {
      bytesRead = read;
      report();
    },
    onEntry: async (entry) => {
      if (entry.kind === 'activity' && keep.has(entry.path)) {
        await sender.add(entry.path, entry.format, entry.data);
      }
    },
  });
  await sender.flush();
  return sender.written;
}
