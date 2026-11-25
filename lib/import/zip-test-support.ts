import { deflateRawSync } from 'node:zlib';
import type { Unzip } from 'fflate';

// Shared by the tests of the zip readers (zip-stream, strava-archive). Not
// imported by the app.

// Bytes deflate cannot shrink, so an entry's compressed size is its size.
export function noise(length: number, seed = 1): Uint8Array {
  const out = new Uint8Array(length);
  let x = seed * 2654435761;
  for (let i = 0; i < length; i++) {
    x = (Math.imul(x, 1664525) + 1013904223) >>> 0;
    out[i] = x >>> 24;
  }
  return out;
}

// Bytes deflate shrinks to about half: enough for a compressed entry to span
// many slices of the archive.
export function halfNoise(length: number, seed = 7): Uint8Array {
  const out = noise(length, seed);
  for (let i = 0; i < length; i++) out[i] = out[i]! & 0x0f;
  return out;
}

// The compressed bytes fflate's Unzip is holding for entries that were not
// started. `k` is a private field of fflate 0.8 (one array of chunks per
// entry): if an upgrade renames it, the shape check fails loudly instead of
// letting a test pass on nothing.
export function heldBytes(unzip: Unzip): number {
  const k = (unzip as unknown as { k?: Uint8Array[][] }).k;
  if (!Array.isArray(k) || k.length === 0 || !k.every((chunks) => Array.isArray(chunks))) {
    throw new Error('fflate Unzip no longer keeps its pending chunks in `k`: update heldBytes');
  }
  return k.reduce((sum, chunks) => sum + chunks.reduce((n, c) => n + c.length, 0), 0);
}

// A zip of `count` empty stored entries ('m/0', 'm/1', ...) followed by
// `tail` (the bytes of another zip, or nothing). Written by hand: zipSync
// takes seconds for tens of thousands of entries, and a streaming reader only
// looks at the local headers anyway.
export function manyEntriesZip(count: number, tail: Uint8Array = new Uint8Array(0)): Uint8Array {
  const names = Array.from({ length: count }, (_, i) => `m/${i}`);
  const size = names.reduce((n, name) => n + 30 + name.length, 0);
  // Ends with an end-of-central-directory record so the last header is not
  // the last thing in the stream.
  const out = new Uint8Array(size + tail.length + (tail.length === 0 ? 22 : 0));
  const view = new DataView(out.buffer);
  let at = 0;
  for (const name of names) {
    view.setUint32(at, 0x04034b50, true);
    view.setUint16(at + 4, 20, true);
    view.setUint16(at + 26, name.length, true);
    for (let i = 0; i < name.length; i++) out[at + 30 + i] = name.charCodeAt(i);
    at += 30 + name.length;
  }
  if (tail.length > 0) out.set(tail, at);
  else view.setUint32(at, 0x06054b50, true);
  return out;
}

const CRC_TABLE = Uint32Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(data: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < data.length; i++) c = CRC_TABLE[(c ^ data[i]!) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

// A zip of deflated entries laid out as zipSync writes it (sizes and CRC in
// each local header, no data descriptor, then the central directory), with
// the deflate done by Node's zlib instead of fflate. For the fixtures of
// several megabytes: fflate deflates in JavaScript, about 1 s for 6 MiB of
// halfNoise and 2.4 s for 20 MiB on an idle core, which was nearly all the
// time of the tests that only need such an archive to exist (#593). The
// readers under test still inflate it with fflate.
export function deflatedZip(files: Record<string, Uint8Array>): Uint8Array {
  const entries = Object.entries(files).map(([name, data]) => ({
    name: new TextEncoder().encode(name),
    crc: crc32(data),
    size: data.length,
    body: new Uint8Array(deflateRawSync(data, { level: 1 })),
    offset: 0,
  }));
  const local = entries.reduce((n, e) => n + 30 + e.name.length + e.body.length, 0);
  const central = entries.reduce((n, e) => n + 46 + e.name.length, 0);
  const out = new Uint8Array(local + central + 22);
  const view = new DataView(out.buffer);
  // The fields a local header and a central record share, from `at`.
  const common = (at: number, e: (typeof entries)[number]): void => {
    view.setUint16(at, 20, true); // version needed
    view.setUint16(at + 2, 0x0800, true); // UTF-8 names
    view.setUint16(at + 4, 8, true); // deflate
    view.setUint32(at + 10, e.crc, true);
    view.setUint32(at + 14, e.body.length, true);
    view.setUint32(at + 18, e.size, true);
    view.setUint16(at + 22, e.name.length, true);
  };
  let at = 0;
  for (const e of entries) {
    e.offset = at;
    view.setUint32(at, 0x04034b50, true);
    common(at + 4, e);
    out.set(e.name, at + 30);
    out.set(e.body, at + 30 + e.name.length);
    at += 30 + e.name.length + e.body.length;
  }
  for (const e of entries) {
    view.setUint32(at, 0x02014b50, true);
    view.setUint16(at + 4, 20, true); // version made by
    common(at + 6, e);
    view.setUint32(at + 42, e.offset, true);
    out.set(e.name, at + 46);
    at += 46 + e.name.length;
  }
  view.setUint32(at, 0x06054b50, true);
  view.setUint16(at + 8, entries.length, true);
  view.setUint16(at + 10, entries.length, true);
  view.setUint32(at + 12, central, true);
  view.setUint32(at + 16, local, true);
  return out;
}
