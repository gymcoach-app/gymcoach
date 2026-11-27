import { createRequire } from 'node:module';
import { expect, it } from 'vitest';
import { describeCost, measureGrowth, repeatedReferenceCost } from '@/lib/testing/cpu-cost';

const require = createRequire(import.meta.url);
const guard = require('./guard-git.cjs') as {
  decide: (
    input: { cwd?: string; tool_input?: { command?: string }; agent_id?: string },
    opts?: {
      findTop?: (dir: string) => { top: string; kind: string } | null;
      home?: string;
      pathExists?: (p: string) => boolean;
      checkedOut?: (top: string) => { branch: string; top: string }[];
    },
  ) => { allow?: true; deny?: string };
};

// One primary checkout, as in guard-git.test.ts.
const MAIN = '/repo';
const decideAsAgent = (command: string) =>
  guard.decide(
    { cwd: MAIN, tool_input: { command }, agent_id: 'a1' },
    {
      findTop: (dir) =>
        dir === MAIN || dir.startsWith(`${MAIN}/`) ? { top: MAIN, kind: 'primary' } : null,
      home: '/home/u',
      pathExists: () => false,
      checkedOut: () => [{ branch: 'main', top: MAIN }],
    },
  );

// The growth tests of guard-git.test.ts ("reads ... without reading it again
// and again") say nothing about a guard that reads every command once but
// several times more slowly, which the old bound (1000 ms per input) did
// catch on a calm machine when the slowdown was tenfold. So the heaviest of
// the inputs the guard was first held to also has a bound on what it costs,
// in units of the reference work of lib/testing/cpu-cost.ts measured next to
// it.
//
// This test has a file to itself, which gives it a process to itself: as the
// last of the 76 tests of guard-git.test.ts, with one timed run, it went
// over a limit set 1.3 times above what it measured alone (149.9 units
// against 140, under load). Vitest's default `isolate: true` with the `forks`
// pool (a process per test file) is what this relies on: with one process
// for several files, the limit below would have to be measured again.
//
// The shape is the heaviest of the old test, `"$(` repeated. It is repeated
// 5 000 times here, not 50 000: the command is read five times, and with
// 20 000 repeats the test took up to 4.1 s of its 5 s on a busy machine
// (2.9 s at most with 5 000, 1.3 s typically). The growth tests hold the
// guard to a cost proportional to the length, so the size does not change
// what a constant slowdown looks like, and the 50 000 input is still decided
// in guard-git.test.ts.
const REPEATS = 5_000;

// Calibration (one machine: a six-core 2020 laptop, Node 22). The command is
// read five times and the fastest of the last four is kept, against the
// fastest of four batches of reference work: 6.1 to 7.4 units on a calm
// machine, 6.1 to 11.9 over 100 runs with 16 busy loops (load 9 to 27).
//
// The limit is chosen so that the test does not go red on a busy machine
// first: twice the highest value seen for the code as it is. What it
// catches, measured with every command read several times:
// - five times: 29 to 31 units, failed in 3 runs of 3; ten times: 54;
// - four times: 23 to 25, at the limit, not caught reliably;
// - three times: 17 to 18, not caught.
// So the test holds the guard to about five times its cost. The old bound,
// 1000 ms for a read that takes 100 ms on a calm machine, needed ten times
// there. A machine with another processor can sit elsewhere: the units it
// measures are printed on CI and with COST_UNITS_LOG=1 (describeCost).
const HEAVIEST_INPUT_LIMIT_UNITS = 24;

// Both tests of this file read long commands several times: up to 3.1 s was
// seen under load for the first, against the 5 s a test gets by default.
// The limits they check are on cost, not on this.
const COST_TEST_TIMEOUT_MS = 30_000;

it(
  'reads the heaviest input it was first held to at a bounded cost',
  () => {
    const command = `${'"$('.repeat(REPEATS)} git status`;
    const cost = repeatedReferenceCost(
      () => {
        expect(decideAsAgent(command).deny).toBeFalsy();
      },
      { rounds: 4, referenceBatchMs: 50 },
    );
    const measured = describeCost(
      `git guard, "$(" x ${REPEATS}`,
      cost.units,
      HEAVIEST_INPUT_LIMIT_UNITS,
      `${cost.cpuMs.toFixed(0)} ms, reference ${cost.referenceMs.toFixed(3)} ms`,
    );
    expect(cost.units, measured).toBeGreaterThan(0);
    expect(cost.units, measured).toBeLessThan(HEAVIEST_INPUT_LIMIT_UNITS);
  },
  COST_TEST_TIMEOUT_MS,
);

// The bound above is on 5 000 repeats, and the growth tests of
// guard-git.test.ts stop at 8 000: neither sees a slowdown that only starts
// on a longer command. So the cost is also compared between 5 000 repeats
// and the 50 000 of the old test (15 kB against 150 kB): ten times the
// length may take about ten times longer, under the same limit on the
// exponent as the other growth tests (1 is proportional, 2 the square).
// Measured: 0.98 to 1.00 on a calm machine, 0.94 to 1.04 over 20 runs with
// 16 busy loops. With commands longer than 30 000 characters read several
// times and shorter ones once: five times 1.70 and ten times 2.02, which
// fail; four times 1.62, which fails by little; three times 1.48, which
// passes.
const GROWTH_LIMIT = 1.6;

it(
  'reads ten times the heaviest input in about ten times the time',
  () => {
    const commands = new Map(
      [REPEATS, 50_000].map((repeats) => {
        const command = `${'"$('.repeat(repeats)} git status`;
        return [command.length, command];
      }),
    );
    const [smallLength, largeLength] = [...commands.keys()] as [number, number];
    const growth = measureGrowth(
      (length) => {
        decideAsAgent(commands.get(length)!);
      },
      smallLength,
      largeLength,
    );
    const measured =
      `[cost] git guard, "$(" x ${REPEATS} to x 50000: exponent ${growth.exponent.toFixed(2)}, ` +
      `limit ${GROWTH_LIMIT} (${growth.smallMs.toFixed(2)} ms for ${smallLength} characters, ` +
      `${growth.largeMs.toFixed(2)} ms for ${largeLength})`;
    // Printed from a passing test on CI and on request, like describeCost.
    if (process.env.CI || process.env.COST_UNITS_LOG) console.info(measured);
    expect(growth.exponent, measured).toBeLessThan(GROWTH_LIMIT);
  },
  COST_TEST_TIMEOUT_MS,
);
