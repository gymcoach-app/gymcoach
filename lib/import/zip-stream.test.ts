// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Inflate, strFromU8, strToU8, Zip, ZipDeflate, ZipPassThrough, zipSync, type Unzip } from 'fflate';
import { createSelectiveUnzip, type ZipEntryPicker } from './zip-stream';
import { halfNoise, heldBytes, noise } from './zip-test-support';

const SLICE = 64 * 1024;

function feed(unzip: Unzip, zip: Uint8Array, afterSlice?: () => void): void {
  for (let offset = 0; offset < zip.length; offset += SLICE) {
    unzip.push(zip.subarray(offset, offset + SLICE), false);
    afterSlice?.();
  }
  unzip.push(new Uint8Array(0), true);
}

// Read the entries `wanted` names, as text, through a selective unzip.
function collect(wanted: (name: string) => boolean): {
  pick: ZipEntryPicker;
  seen: string[];
  texts: Map<string, string>;
} {
  const seen: string[] = [];
  const texts = new Map<string, string>();
  const pick: ZipEntryPicker = (entry) => {
    seen.push(entry.name);
    if (!wanted(entry.name)) return null;
    const parts: string[] = [];
    return (data, final) => {
      parts.push(strFromU8(data));
      if (final) texts.set(entry.name, parts.join(''));
    };
  };
  return { pick, seen, texts };
}

// A zip written by fflate's streaming Zip: every entry carries a data
// descriptor, so its sizes are not in the local header.
function streamedZip(files: Record<string, { data: Uint8Array; deflate: boolean }>): Uint8Array {
  const parts: Uint8Array[] = [];
  const zip = new Zip((err, chunk) => {
    if (err) throw err;
    parts.push(chunk);
  });
  for (const [name, { data, deflate }] of Object.entries(files)) {
    const file = deflate ? new ZipDeflate(name, { level: 6 }) : new ZipPassThrough(name);
    zip.add(file);
    file.push(data, true);
  }
  zip.end();
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let offset = 0;
  for (const p of parts) {
    out.set(p, offset);
    offset += p.length;
  }
  return out;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('createSelectiveUnzip', () => {
  it('hands over the picked entries, deflated, stored or empty, and only those', () => {
    const text = 'a line of text\n'.repeat(20_000);
    const zip = zipSync({
      'keep/deflated.txt': strToU8(text),
      'skip/one.bin': noise(10_000),
      'keep/stored.txt': [strToU8('stored as is'), { level: 0 }],
      'keep/empty.txt': new Uint8Array(0),
      'skip/two.txt': strToU8(text),
    });
    const { pick, seen, texts } = collect((name) => name.startsWith('keep/'));
    feed(createSelectiveUnzip(pick), zip);

    expect(seen).toEqual([
      'keep/deflated.txt',
      'skip/one.bin',
      'keep/stored.txt',
      'keep/empty.txt',
      'skip/two.txt',
    ]);
    expect([...texts.keys()]).toEqual(['keep/deflated.txt', 'keep/stored.txt', 'keep/empty.txt']);
    expect(texts.get('keep/deflated.txt')).toBe(text);
    expect(texts.get('keep/stored.txt')).toBe('stored as is');
    expect(texts.get('keep/empty.txt')).toBe('');
  });

  it('holds none of the bytes of the entries it skips', () => {
    const zip = zipSync({
      'media/stored.mp4': [noise(300_000, 1), { level: 0 }],
      'media/deflated.jpg': [noise(300_000, 2), { level: 6 }],
      'keep.txt': strToU8('kept'),
      'media/last.jpg': [noise(200_000, 3), { level: 0 }],
    });
    expect(zip.length).toBeGreaterThan(800_000);
    const { pick, texts } = collect((name) => name === 'keep.txt');
    const unzip = createSelectiveUnzip(pick);
    let worst = 0;
    feed(unzip, zip, () => {
      worst = Math.max(worst, heldBytes(unzip));
    });

    expect(texts.get('keep.txt')).toBe('kept');
    expect(worst).toBe(0);
    expect(heldBytes(unzip)).toBe(0);
  });

  it('holds none of them either when the sizes come in a data descriptor', () => {
    const zip = streamedZip({
      'media/stored.mp4': { data: noise(300_000, 4), deflate: false },
      'media/deflated.jpg': { data: noise(300_000, 5), deflate: true },
      'keep.txt': { data: strToU8('kept all the same'), deflate: true },
    });
    const { pick, seen, texts } = collect((name) => name === 'keep.txt');
    const unzip = createSelectiveUnzip(pick);
    let worst = 0;
    feed(unzip, zip, () => {
      worst = Math.max(worst, heldBytes(unzip));
    });

    expect(seen).toEqual(['media/stored.mp4', 'media/deflated.jpg', 'keep.txt']);
    expect(texts.get('keep.txt')).toBe('kept all the same');
    expect(worst).toBe(0);
  });

  it('inflates nothing of a skipped entry', () => {
    const push = vi.spyOn(Inflate.prototype, 'push');
    const zip = zipSync({ 'skip.txt': strToU8('never read\n'.repeat(50_000)) });
    feed(createSelectiveUnzip(() => null), zip);
    expect(push).not.toHaveBeenCalled();
  });

  it('stops inflating an entry once its sink returns false', () => {
    const payload = halfNoise(6 * 1024 * 1024);
    const zip = zipSync({ 'bomb.bin': payload, 'after.txt': strToU8('still read') });
    // Compressed, the first entry spans dozens of slices.
    expect(zip.length).toBeGreaterThan(30 * SLICE);

    let inflateInput = 0;
    const realPush = Inflate.prototype.push;
    vi.spyOn(Inflate.prototype, 'push').mockImplementation(function (this: Inflate, chunk, final) {
      inflateInput += chunk.length;
      realPush.call(this, chunk, final);
    });

    const limit = 500_000;
    let received = 0;
    let callsAfterStop = 0;
    let stopped = false;
    let after = '';
    const unzip = createSelectiveUnzip((entry) => {
      if (entry.name === 'after.txt') {
        return (data) => {
          after += strFromU8(data);
        };
      }
      return (data) => {
        if (stopped) callsAfterStop += 1;
        received += data.length;
        if (received <= limit) return;
        stopped = true;
        return false;
      };
    });
    feed(unzip, zip);

    expect(stopped).toBe(true);
    expect(callsAfterStop).toBe(0);
    // About a quarter of a MB of input yields the first half MB of output;
    // the other megabytes of the entry never reach the inflater.
    expect(inflateInput).toBeLessThan(zip.length / 4);
    // The entry after it is still found and read.
    expect(after).toBe('still read');
    expect(heldBytes(unzip)).toBe(0);
  });

  it('skips an entry in an unknown compression method, and refuses to read one', () => {
    const zip = zipSync({ 'odd.bin': noise(5000), 'keep.txt': strToU8('kept') }, { level: 0 });
    // Compression method of the first local header: 14 (LZMA) instead of 0.
    const odd = zip.slice();
    odd[8] = 14;

    const { pick, texts } = collect((name) => name === 'keep.txt');
    const unzip = createSelectiveUnzip(pick);
    feed(unzip, odd);
    expect(texts.get('keep.txt')).toBe('kept');
    expect(heldBytes(unzip)).toBe(0);

    expect(() => feed(createSelectiveUnzip(collect(() => true).pick), odd)).toThrow(
      /compression method 14/,
    );
  });

  it('throws on a damaged deflate stream', () => {
    const zip = zipSync({ 'keep.txt': strToU8('some text to deflate\n'.repeat(2000)) });
    const broken = zip.slice();
    broken.fill(0xff, 60, 140);
    expect(() => feed(createSelectiveUnzip(collect(() => true).pick), broken)).toThrow();
  });
});
