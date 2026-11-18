import { Gunzip } from 'fflate';
import { IMPORT_CSV_MAX_BYTES } from '@/lib/import/csv';
import { ImportCancelledError } from '@/lib/import/import-queue';
import { STRAVA_CSV_MAX_BYTES, stravaActivityKey } from '@/lib/import/strava-csv';
import { ZIP_MAX_ENTRIES, ZipEntryLimitError, createSelectiveUnzip } from '@/lib/import/zip-stream';

// ============================================================
// Strava archive reader (issue #582) - browser side
// ============================================================
// Streams the zip of Strava's "Download your data" through fflate's Unzip.
// The archive can weigh gigabytes (photos and videos under media/), so it is
// never held whole: it is read chunk by chunk, and only two kinds of entries
// are inflated at all - activities.csv and the files of the activities/
// folder. Everything else is dropped as it is read, neither decompressed nor
// kept (lib/import/zip-stream.ts: fflate's own Unzip would buffer the
// compressed bytes of every entry it is not asked to read).
//
// Each entry is handed to the caller as soon as it is complete, and the next
// slice of the archive is not read before the caller is done with it: the
// caller sends activities to the server at the pace of the import rate limit,
// so that pause is what keeps memory flat.

export type StravaActivityFormat = 'fit' | 'gpx' | 'tcx';

export type StravaEntryKind =
  | { kind: 'csv' }
  | { kind: 'activity'; format: StravaActivityFormat; gz: boolean }
  // A file of the activities/ folder in a format no import route reads.
  | { kind: 'unsupported' };

// Decide what to do with one zip entry from its path alone. Null means the
// entry is not read. A single wrapping folder is tolerated (an archive that
// was extracted and zipped again); media/ and the other CSV files are not
// read, and neither are hidden files (macOS "._" resource forks).
export function classifyStravaEntry(name: string): StravaEntryKind | null {
  if (name.endsWith('/')) return null;
  const parts = name.replace(/\\/g, '/').split('/').filter((p) => p.length > 0);
  if (parts.length === 0 || parts.length > 3) return null;
  const base = parts[parts.length - 1]!.toLowerCase();
  if (base.startsWith('.') || parts.includes('__MACOSX')) return null;
  if (base === 'activities.csv') return parts.length <= 2 ? { kind: 'csv' } : null;
  if (parts.length < 2 || parts[parts.length - 2]!.toLowerCase() !== 'activities') return null;
  const match = /\.(fit|gpx|tcx)(\.gz)?$/.exec(base);
  if (!match) return { kind: 'unsupported' };
  return { kind: 'activity', format: match[1] as StravaActivityFormat, gz: match[2] !== undefined };
}

// Same cap as the FIT, GPX and TCX routes (5 MB a file, decompressed).
export const STRAVA_MAX_ACTIVITY_BYTES = IMPORT_CSV_MAX_BYTES;

export type StravaArchiveEntry =
  | { kind: 'csv'; text: string }
  | { kind: 'activity'; path: string; format: StravaActivityFormat; data: Uint8Array }
  | { kind: 'skipped'; path: string; reason: 'unsupported' | 'too-large' | 'unreadable' };

export type StravaArchiveErrorCode = 'not-zip' | 'not-strava' | 'unreadable' | 'too-many-files';

// The entry count past which an archive is refused with 'too-many-files'
// (see ZIP_MAX_ENTRIES): photos and videos count, like every entry.
export const STRAVA_MAX_ZIP_ENTRIES = ZIP_MAX_ENTRIES;

export class StravaArchiveError extends Error {
  constructor(public readonly code: StravaArchiveErrorCode) {
    super(
      code === 'not-zip'
        ? 'Not a zip archive.'
        : code === 'not-strava'
          ? 'No Strava activity in this archive.'
          : code === 'too-many-files'
            ? 'Too many files in this archive.'
            : 'Unreadable archive.',
    );
    this.name = 'StravaArchiveError';
  }
}

// The archive is fed to the unzipper in slices of this size, and a gzip
// member in slices of GUNZIP_SLICE_BYTES: deflate expands at most about a
// thousand times, so a slice bounds what one call can allocate before the
// size cap is checked again.
const ZIP_SLICE_BYTES = 64 * 1024;
const GUNZIP_SLICE_BYTES = 16 * 1024;
// Bytes per read when the browser has no Blob.stream().
const READ_BYTES = 1024 * 1024;

function concat(chunks: Uint8Array[], total: number): Uint8Array {
  if (chunks.length === 1) return chunks[0]!;
  const out = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.length;
  }
  return out;
}

// Gunzip with an output cap, checked between slices of the input.
export function gunzipCapped(
  data: Uint8Array,
  maxBytes: number,
): Uint8Array | 'too-large' | 'unreadable' {
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    const gunzip = new Gunzip((chunk) => {
      total += chunk.length;
      if (total <= maxBytes) chunks.push(chunk);
    });
    for (let offset = 0; offset < data.length && total <= maxBytes; offset += GUNZIP_SLICE_BYTES) {
      const end = Math.min(data.length, offset + GUNZIP_SLICE_BYTES);
      gunzip.push(data.subarray(offset, end), end === data.length);
    }
  } catch {
    return 'unreadable';
  }
  if (total > maxBytes) return 'too-large';
  if (total === 0) return 'unreadable';
  return concat(chunks, total);
}

async function* readChunks(file: Blob): AsyncGenerator<Uint8Array> {
  if (typeof file.stream === 'function') {
    const reader = file.stream().getReader();
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) return;
        if (value && value.length > 0) yield value;
      }
    } finally {
      reader.releaseLock();
    }
  }
  for (let offset = 0; offset < file.size; offset += READ_BYTES) {
    yield new Uint8Array(await file.slice(offset, offset + READ_BYTES).arrayBuffer());
  }
}

function isZipHeader(chunk: Uint8Array): boolean {
  return chunk.length >= 4 && chunk[0] === 0x50 && chunk[1] === 0x4b && chunk[2] === 3 && chunk[3] === 4;
}

export interface ReadStravaArchiveOptions {
  // Called for every entry of interest, in archive order. The reader waits
  // for the returned promise before it reads further.
  onEntry: (entry: StravaArchiveEntry) => void | Promise<void>;
  // Called after every chunk with the bytes of the archive read so far.
  onProgress?: (bytesRead: number, totalBytes: number) => void;
  // Aborting stops the read; the promise then rejects with ImportCancelledError.
  signal?: AbortSignal;
  // Activity paths to leave compressed (the confirm pass only needs the
  // files the preview kept). Return false to skip the entry.
  wants?: (path: string) => boolean;
  // Injectable for tests. Default STRAVA_MAX_ZIP_ENTRIES.
  maxZipEntries?: number;
}

// Read a Strava archive entry by entry. Resolves with the number of entries
// handed over. Throws StravaArchiveError when the file is not a zip, is
// damaged, holds too many entries, or holds neither an activities.csv nor an
// activities/ file.
export async function readStravaArchive(
  file: Blob,
  options: ReadStravaArchiveOptions,
): Promise<number> {
  const { onEntry, onProgress, signal, wants } = options;
  const ready: StravaArchiveEntry[] = [];
  let seen = 0;
  let handed = 0;

  const unzip = createSelectiveUnzip((entry) => {
    const kind = classifyStravaEntry(entry.name);
    if (!kind) return null;
    seen += 1;
    const path = stravaActivityKey(entry.name) ?? entry.name;
    if (kind.kind === 'unsupported') {
      ready.push({ kind: 'skipped', path, reason: 'unsupported' });
      return null;
    }
    if (kind.kind === 'activity' && wants && !wants(path)) return null;
    const cap = kind.kind === 'csv' ? STRAVA_CSV_MAX_BYTES : STRAVA_MAX_ACTIVITY_BYTES;
    // The declared size is advisory (absent with a data descriptor); the
    // count below is the real control.
    if ((entry.originalSize ?? 0) > cap) {
      ready.push({ kind: 'skipped', path, reason: 'too-large' });
      return null;
    }
    const chunks: Uint8Array[] = [];
    let total = 0;
    return (data, final) => {
      total += data.length;
      if (total > cap) {
        // Past the cap the entry is given up: what was kept is released and
        // the rest of it is neither kept nor inflated.
        chunks.length = 0;
        ready.push({ kind: 'skipped', path, reason: 'too-large' });
        return false;
      }
      if (data.length > 0) chunks.push(data);
      if (!final) return;
      const bytes = concat(chunks, total);
      chunks.length = 0;
      if (kind.kind === 'csv') {
        ready.push({ kind: 'csv', text: new TextDecoder().decode(bytes) });
        return;
      }
      const inflated = kind.gz ? gunzipCapped(bytes, cap) : bytes;
      if (typeof inflated === 'string') ready.push({ kind: 'skipped', path, reason: inflated });
      else if (inflated.length === 0) ready.push({ kind: 'skipped', path, reason: 'unreadable' });
      else ready.push({ kind: 'activity', path, format: kind.format, data: inflated });
    };
  }, options.maxZipEntries);

  const drain = async () => {
    while (ready.length > 0) {
      if (signal?.aborted) throw new ImportCancelledError();
      handed += 1;
      await onEntry(ready.shift()!);
    }
  };

  let bytesRead = 0;
  let first = true;
  for await (const chunk of readChunks(file)) {
    if (signal?.aborted) throw new ImportCancelledError();
    if (first) {
      first = false;
      if (!isZipHeader(chunk)) throw new StravaArchiveError('not-zip');
    }
    for (let offset = 0; offset < chunk.length; offset += ZIP_SLICE_BYTES) {
      try {
        unzip.push(chunk.subarray(offset, offset + ZIP_SLICE_BYTES), false);
      } catch (err) {
        throw new StravaArchiveError(
          err instanceof ZipEntryLimitError ? 'too-many-files' : 'unreadable',
        );
      }
      await drain();
    }
    bytesRead += chunk.length;
    onProgress?.(bytesRead, file.size);
  }
  if (first) throw new StravaArchiveError('not-zip');
  try {
    unzip.push(new Uint8Array(0), true);
  } catch {
    throw new StravaArchiveError('unreadable');
  }
  await drain();
  if (seen === 0) throw new StravaArchiveError('not-strava');
  return handed;
}
