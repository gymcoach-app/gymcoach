import type { Unzip } from 'fflate';
import { AppleHealthScanner, type AppleHealthScanResult } from '@/lib/import/apple-health';
import { ZIP_MAX_ENTRIES, ZipEntryLimitError, createSelectiveUnzip } from '@/lib/import/zip-stream';

// ============================================================
// Apple Health export reader (issue #582) - browser side
// ============================================================
// Streams the picked file (export.zip or export.xml) through the scanner of
// lib/import/apple-health.ts. Neither the archive nor the XML is ever held in
// memory whole: the file is read chunk by chunk, a zip is inflated slice by
// slice, and only ONE entry, the export XML, is inflated at all. The routes,
// ECGs and clinical records beside it are dropped as their bytes arrive
// (createSelectiveUnzip: a plain fflate Unzip would keep the compressed bytes
// of every entry it is not asked to read, and export_cda.xml alone can be as
// large as the export).

export type AppleHealthFileErrorCode =
  | 'no-export-xml'
  | 'unreadable'
  | 'too-large'
  | 'too-many-files';

const ERROR_TEXT: Record<AppleHealthFileErrorCode, string> = {
  'no-export-xml': 'No export.xml in this archive.',
  unreadable: 'Unreadable file.',
  'too-large': 'Export too large.',
  'too-many-files': 'Too many files in this archive.',
};

// The entry count past which an archive is refused with 'too-many-files'
// (see ZIP_MAX_ENTRIES). It only counts the entries before the export: the
// read stops once the export has been read.
export const APPLE_HEALTH_MAX_ZIP_ENTRIES = ZIP_MAX_ENTRIES;

export class AppleHealthFileError extends Error {
  constructor(public readonly code: AppleHealthFileErrorCode) {
    super(ERROR_TEXT[code]);
    this.name = 'AppleHealthFileError';
  }
}

// The most the export entry of a zip may inflate to. Past it the read stops
// with 'too-large' and the rest of the entry is not inflated, so a deflate
// bomb (a few MB that expand without end) costs a bounded amount of work
// instead of pinning the tab. 2 GB: the export.xml of several years of
// all-day Apple Watch data is a few hundred MB to about 1.5 GB, and scanning
// 2 GB already takes a phone the better part of a minute. Only what the zip
// claims to hold is capped: a bare export.xml is as large as it is on disk.
export const APPLE_HEALTH_MAX_INFLATED_BYTES = 2 * 1024 * 1024 * 1024;
export const APPLE_HEALTH_MAX_INFLATED_GB = 2;

// The archive is pushed into the unzip in slices of this size. Deflate
// expands at most about 1032 times, so one inflated chunk stays under about
// 17 MB whatever the archive holds, and the size cap is checked at least that
// often. (The scanner then works through each chunk in slices of its own.)
const ZIP_SLICE_BYTES = 16 * 1024;

// True for the zip entry that holds the health data. Normally that is
// apple_health_export/export.xml; a phone set to another language names both
// the folder and the file differently, so besides an export.xml at any path,
// any XML file at the root or one folder deep is accepted. The clinical
// document (export_cda.xml) is not: it can be as large as the export and
// holds no workout.
export function isAppleHealthExportEntry(name: string): boolean {
  const parts = name.split('/').filter((p) => p.length > 0);
  if (parts.length === 0 || name.endsWith('/')) return false;
  const base = parts[parts.length - 1]!.toLowerCase();
  if (base === 'export.xml') return true;
  if (parts.length > 2 || base.startsWith('.')) return false;
  return base.endsWith('.xml') && !base.endsWith('cda.xml');
}

// Bytes per read when the browser has no Blob.stream().
const SLICE_BYTES = 1024 * 1024;

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
  for (let offset = 0; offset < file.size; offset += SLICE_BYTES) {
    yield new Uint8Array(await file.slice(offset, offset + SLICE_BYTES).arrayBuffer());
  }
}

function isZipHeader(chunk: Uint8Array): boolean {
  return chunk.length >= 4 && chunk[0] === 0x50 && chunk[1] === 0x4b && chunk[2] === 3 && chunk[3] === 4;
}

export interface ReadAppleHealthOptions {
  // Called after every chunk with the bytes of the picked file read so far.
  onProgress?: (bytesRead: number, totalBytes: number) => void;
  // Injectable clock for tests.
  now?: Date;
  // Injectable for tests. Default APPLE_HEALTH_MAX_INFLATED_BYTES.
  maxInflatedBytes?: number;
  // Injectable for tests. Default APPLE_HEALTH_MAX_ZIP_ENTRIES.
  maxZipEntries?: number;
}

// Read an Apple Health export and return its cardio workouts and body weight
// entries. Throws AppleHealthFileError when the archive is damaged, holds no
// export XML, holds one that inflates past the size cap, or holds too many
// entries; an XML file with nothing of interest resolves with empty lists.
//
// Exactly one entry of a zip is read: the first one, in archive order, that
// isAppleHealthExportEntry accepts. Once its last byte has arrived the read
// stops: whatever follows it in the archive (a second export, the routes) is
// not even read from the file, so two exports in one archive are never merged
// into one history.
export async function readAppleHealthFile(
  file: Blob,
  options: ReadAppleHealthOptions = {},
): Promise<AppleHealthScanResult> {
  const scanner = new AppleHealthScanner(options.now);
  const maxInflatedBytes = options.maxInflatedBytes ?? APPLE_HEALTH_MAX_INFLATED_BYTES;
  let bytesRead = 0;
  let unzip: Unzip | null = null;
  let foundEntry = false;
  let inflated = 0;
  let tooLarge = false;
  // The export entry has been read to its end.
  let complete = false;
  let first = true;

  try {
    for await (const chunk of readChunks(file)) {
      if (first) {
        first = false;
        if (isZipHeader(chunk)) {
          unzip = createSelectiveUnzip((entry) => {
            if (foundEntry || !isAppleHealthExportEntry(entry.name)) return null;
            foundEntry = true;
            return (data, final) => {
              inflated += data.length;
              if (inflated > maxInflatedBytes) {
                // Returning false drops the rest of the entry uninflated.
                tooLarge = true;
                return false;
              }
              scanner.push(data);
              if (final) complete = true;
            };
          }, options.maxZipEntries);
        }
      }
      if (unzip) {
        for (
          let offset = 0;
          offset < chunk.length && !tooLarge && !complete;
          offset += ZIP_SLICE_BYTES
        ) {
          unzip.push(chunk.subarray(offset, offset + ZIP_SLICE_BYTES), false);
        }
      } else {
        scanner.push(chunk);
      }
      if (tooLarge) break;
      if (complete) {
        // Nothing else of the archive is needed: the read is over.
        options.onProgress?.(file.size, file.size);
        break;
      }
      bytesRead += chunk.length;
      options.onProgress?.(bytesRead, file.size);
    }
    if (unzip && !tooLarge && !complete) unzip.push(new Uint8Array(0), true);
  } catch (err) {
    throw new AppleHealthFileError(
      err instanceof ZipEntryLimitError ? 'too-many-files' : 'unreadable',
    );
  }
  if (tooLarge) throw new AppleHealthFileError('too-large');
  if (unzip && !foundEntry) throw new AppleHealthFileError('no-export-xml');
  return scanner.end();
}
