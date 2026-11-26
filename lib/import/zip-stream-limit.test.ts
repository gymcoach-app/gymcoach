// @vitest-environment node
import { expect, it } from 'vitest';
import type { Unzip } from 'fflate';
import { describeCost, repeatedReferenceCost } from '@/lib/testing/cpu-cost';
import {
  ZIP_MAX_ENTRIES,
  ZipEntryLimitError,
  createSelectiveUnzip,
  type ZipEntryPicker,
} from './zip-stream';
import { manyEntriesZip } from './zip-test-support';

const SLICE = 64 * 1024;

function feed(unzip: Unzip, zip: Uint8Array): void {
  for (let offset = 0; offset < zip.length; offset += SLICE) {
    unzip.push(zip.subarray(offset, offset + SLICE), false);
  }
  unzip.push(new Uint8Array(0), true);
}

// fflate's Unzip is quadratic in the entry count: the default limit is what
// keeps the worst case to a couple of seconds (about ten times that for
// twice the entries).
//
// The cost is measured in units of the reference work of
// lib/testing/cpu-cost.ts, not in seconds: the old bound, 30 s on the wall
// clock, depended on how busy the machine was, and was so far above the
// second the read takes that a read ten times slower still passed (#593).
//
// This test has a file to itself, which gives it a process to itself: next
// to the other tests of zip-stream.test.ts the same read measured 490 to
// 1910 units under load instead of 300 to 670, because of what those tests
// leave on the heap (see below).
//
// Calibration (one machine: a six-core 2020 laptop, Node 22). The read is
// run five times and the fastest of the last four is kept, against the
// fastest of four batches of reference work: 270 to 450 units on a calm
// machine, 280 to 670 with 16 busy loops (300 to 550 over the 50 runs of the
// final version).
//
// The limit is chosen so that the test does not go red on a busy machine
// first: a little over twice the highest value seen for the code as it is.
// It cannot sit closer. The read moves a 50 000 slot array on every entry,
// and how fast the engine does that depends on what its garbage collector is
// doing meanwhile: the same read has two speeds, a factor of 1.6 apart, on a
// calm machine, and no sampling removes that.
//
// What the limit catches, measured by keeping more slot lists per entry the
// way fflate keeps its own (each one adds about the cost of the read):
// - four more lists, a read five to six times slower: 1610 to 2560 units,
//   failed in 5 runs of 5; five lists 2240 to 2880; 0.5 ms added per entry
//   17 900;
// - three more lists: 1350 to 2490, failed in 4 runs of 5;
// - two more lists, three to four times slower: 910 to 1620, not caught
//   reliably.
// So the test holds the read to about five times its cost, where the old
// bound needed fifteen to thirty times. A machine with another processor can
// sit elsewhere: the units it measures are printed on CI and with
// COST_UNITS_LOG=1 (describeCost).
const ZIP_LIMIT_UNITS = 1400;

it('reads an archive right at the default limit at a bounded cost, and no larger one', () => {
  expect(ZIP_MAX_ENTRIES).toBe(50_000);
  const zip = manyEntriesZip(ZIP_MAX_ENTRIES + 1);
  let seen = 0;
  const count: ZipEntryPicker = () => {
    seen += 1;
    return null;
  };
  const cost = repeatedReferenceCost(
    () => {
      seen = 0;
      expect(() => feed(createSelectiveUnzip(count), zip)).toThrow(ZipEntryLimitError);
      expect(seen).toBe(ZIP_MAX_ENTRIES);
    },
    { rounds: 4 },
  );
  const measured = describeCost(
    'zip entry limit',
    cost.units,
    ZIP_LIMIT_UNITS,
    `${cost.cpuMs.toFixed(0)} ms, reference ${cost.referenceMs.toFixed(3)} ms`,
  );
  expect(cost.units, measured).toBeGreaterThan(0);
  expect(cost.units, measured).toBeLessThan(ZIP_LIMIT_UNITS);
}, 120_000);
