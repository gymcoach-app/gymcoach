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
