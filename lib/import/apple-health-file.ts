import { Unzip, UnzipInflate } from 'fflate';
import { AppleHealthScanner, type AppleHealthScanResult } from '@/lib/import/apple-health';

// ============================================================
// Apple Health export reader (issue #582) - browser side
// ============================================================
// Streams the picked file (export.zip or export.xml) through the scanner of
// lib/import/apple-health.ts. Neither the archive nor the XML is ever held in
// memory whole: the file is read chunk by chunk, a zip is inflated chunk by
// chunk (fflate's streaming Unzip), and only the export XML entry is inflated
// at all - the routes, ECGs and clinical records beside it are skipped.

export type AppleHealthFileErrorCode = 'no-export-xml' | 'unreadable';

export class AppleHealthFileError extends Error {
  constructor(public readonly code: AppleHealthFileErrorCode) {
    super(code === 'no-export-xml' ? 'No export.xml in this archive.' : 'Unreadable file.');
    this.name = 'AppleHealthFileError';
  }
}

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
}

// Read an Apple Health export and return its cardio workouts and body weight
// entries. Throws AppleHealthFileError when the archive is damaged or holds no
// export XML; an XML file with nothing of interest resolves with empty lists.
export async function readAppleHealthFile(
  file: Blob,
  options: ReadAppleHealthOptions = {},
): Promise<AppleHealthScanResult> {
  const scanner = new AppleHealthScanner(options.now);
  let bytesRead = 0;
  let unzip: Unzip | null = null;
  let foundEntry = false;
  let failure: unknown = null;
  let first = true;

  try {
    for await (const chunk of readChunks(file)) {
      if (first) {
        first = false;
        if (isZipHeader(chunk)) {
          unzip = new Unzip((entry) => {
            if (!isAppleHealthExportEntry(entry.name)) return;
            foundEntry = true;
            entry.ondata = (err, data) => {
              if (err) failure = err;
              else scanner.push(data);
            };
            entry.start();
          });
          unzip.register(UnzipInflate);
        }
      }
      if (unzip) unzip.push(chunk, false);
      else scanner.push(chunk);
      if (failure) break;
      bytesRead += chunk.length;
      options.onProgress?.(bytesRead, file.size);
    }
    if (unzip && !failure) unzip.push(new Uint8Array(0), true);
  } catch {
    throw new AppleHealthFileError('unreadable');
  }
  if (failure) throw new AppleHealthFileError('unreadable');
  if (unzip && !foundEntry) throw new AppleHealthFileError('no-export-xml');
  return scanner.end();
}
