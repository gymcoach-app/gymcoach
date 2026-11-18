import {
  Inflate,
  Unzip,
  type AsyncFlateStreamHandler,
  type UnzipDecoderConstructor,
  type UnzipFile,
} from 'fflate';

// ============================================================
// Streaming unzip that keeps nothing it was not asked for (issue #582)
// ============================================================
// fflate's streaming Unzip buffers the compressed bytes of every entry until
// that entry is started: an entry the caller ignores is therefore held in
// memory whole, for as long as the Unzip lives. On a Strava archive that is
// the media/ folder, gigabytes of it.
//
// So every entry is started here, with a decoder of our own. For an entry
// the caller does not pick, the decoder drops the compressed bytes as they
// arrive: nothing is kept and nothing is inflated. For a picked entry it
// inflates (or passes a stored entry through) into the caller's sink, and the
// sink can return false to stop: the rest of that entry is then dropped
// without being inflated either, which is what bounds the CPU cost of a
// deflate bomb once its size cap is passed.

// Receives the decompressed bytes of one entry, in order. `final` is true on
// the last call. Return false to drop the rest of the entry; the sink is not
// called again.
export type ZipEntrySink = (data: Uint8Array, final: boolean) => void | false;

// Called once per entry, in archive order, when its header is read. Return a
// sink to read the entry, or null to skip it.
export type ZipEntryPicker = (entry: UnzipFile) => ZipEntrySink | null;

const STORED = 0;
const DEFLATED = 8;

interface Slot {
  sink: ZipEntrySink | null;
}

// An Unzip to push the archive into, slice by slice. A damaged deflate stream,
// or a picked entry in a compression method other than stored and deflate,
// throws out of push().
export function createSelectiveUnzip(pick: ZipEntryPicker): Unzip {
  // The slot of the entry being started: fflate builds the decoder inside
  // start(), synchronously, and gives it nothing but the entry's name.
  let starting: Slot | null = null;
  const registered = new Set<number>();

  const decoderFor = (compression: number): UnzipDecoderConstructor =>
    class {
      static compression = compression;
      // Replaced by fflate with a relay to the entry's ondata.
      ondata: AsyncFlateStreamHandler = () => {};
      private readonly slot = starting;
      private inflate: Inflate | null = null;

      push(data: Uint8Array, final: boolean): void {
        if (!this.slot || !this.slot.sink) {
          // Skipped or stopped: the bytes go nowhere.
          this.inflate = null;
          return;
        }
        if (compression === STORED) {
          this.ondata(null, data, final);
        } else if (compression === DEFLATED) {
          this.inflate ??= new Inflate((chunk, last) => this.ondata(null, chunk, last));
          this.inflate.push(data, final);
        } else {
          throw new Error(`Unsupported zip compression method ${compression}.`);
        }
      }
    };

  const unzip = new Unzip((entry) => {
    const slot: Slot = { sink: pick(entry) };
    if (!registered.has(entry.compression)) {
      registered.add(entry.compression);
      unzip.register(decoderFor(entry.compression));
    }
    // Also called directly by fflate, without a decoder, for an empty entry.
    entry.ondata = (err, data, final) => {
      if (err) throw err;
      if (slot.sink && slot.sink(data, final) === false) slot.sink = null;
    };
    starting = slot;
    try {
      entry.start();
    } finally {
      starting = null;
    }
  });
  return unzip;
}
