// Cost measurements for tests that guard against a slow path.
//
// A test such as "a crafted input is read in linear time" used to assert a
// wall-clock bound: `expect(performance.now() - started).toBeLessThan(1000)`.
// That bound measures the machine as much as the code. On a busy machine the
// same work takes several times longer on the wall clock (the process waits
// for a core), and its CPU time grows too, in bursts of a few milliseconds
// (a shared core, cold caches, the engine's own compiler and collector
// threads, which the process is charged for when they get to run). So the
// bound was either so generous that a ten times slower path still passed, or
// tight enough to fail at random (issue #593: 1018 ms against 1000, 2535 ms of
// CPU against 2500).
//
// Two measurements here do not depend on how fast the machine is right now:
//
// - `measureGrowth` runs the code at two input sizes and reports how the cost
//   grew: an exponent of 1 is linear, 2 quadratic. Use it when the test guards
//   an order of growth.
// - `referenceCost` reports a cost as a multiple of a fixed piece of work run
//   right before and after it. Use it when the test guards an absolute cost
//   ("the whole property stays cheap") and no smaller size exists to compare
//   with. `repeatedReferenceCost` does the same more tightly for work that
//   can be run several times.
//
// A growth says nothing about code that is ten times slower at every size,
// and a bound in reference units says nothing about the order of growth: a
// test that replaces a bound in milliseconds usually needs one of each.
//
// Both compare two things measured within milliseconds of each other, for
// about as long as each other, and never a time with a constant. The second
// condition matters as much as the first: a short measurement often falls
// between two bursts and a long one never does, so the best of many short
// ones set against one long run makes the long run look slower than it is
// (seen here: 7 times slower, for a whole second).
//
// Vitest runs each test file in its own process (the default `forks` pool),
// so the CPU time read here is the test file's own.
//
// When the code offers something to count as well (lock waits, characters
// read, syntax trees parsed), count it: a count does not depend on the
// machine at all. It only sees the work that goes through what is counted,
// though, so it comes with a measurement, not instead of one. See the
// dispatch-limit tests, the resume tests of the Apple Health scanner and the
// alias chain tests of the eval runner.

// CPU time (user and system, in ms) the process spends in `run`.
export function cpuMs(run: () => void): number {
  const before = process.cpuUsage();
  run();
  const spent = process.cpuUsage(before);
  return (spent.user + spent.system) / 1000;
}

// Time of `calls` calls of `run` in a row, in ms: the CPU time of the process
// or the wall clock, whichever is lower. Each is an upper bound of what the
// calls cost: the wall clock adds the time spent waiting for a core, the CPU
// time adds the engine's helper threads.
function batchMs(run: () => void, calls: number): number {
  const cpu = process.cpuUsage();
  const wall = performance.now();
  for (let call = 0; call < calls; call++) run();
  const wallMs = performance.now() - wall;
  const spent = process.cpuUsage(cpu);
  return Math.max(Math.min(wallMs, (spent.user + spent.system) / 1000), 1e-6);
}

// How many calls of `run` make a batch of `targetMs` or more, and the time of
// that batch. The count doubles until the batch is long enough, so a call of
// a few microseconds ends up in a batch that can be timed.
function sizeBatch(run: () => void, targetMs: number): { calls: number; ms: number } {
  for (let calls = 1; ; calls *= 2) {
    const ms = batchMs(run, calls);
    if (ms >= targetMs || calls >= 1 << 24) return { calls, ms };
  }
}

export interface Growth {
  // Time of one run at each size, in ms (from the fastest batch).
  smallMs: number;
  largeMs: number;
  // largeMs / smallMs.
  ratio: number;
  // log(ratio) / log(large / small): 1 when the cost is proportional to the
  // size, 2 when it grows with its square, 0 when it does not grow.
  exponent: number;
  // Batches timed at each size.
  rounds: number;
}

export interface GrowthOptions {
  // Batches to time at each size. Default 15.
  rounds?: number;
  // Timing stops early, after two batches of each size at least, once the
  // batches have taken this long, in ms. Default 500.
  budgetMs?: number;
  // Shortest batch, in ms. Default 2.
  minBatchMs?: number;
}

// The longest a batch of the small size is made to match the large one.
// Bursts last milliseconds: past this, a batch holds several of them whatever
// its length, and both sizes are slowed alike.
const MATCHED_BATCH_MS = 50;

// How the cost of `run(size)` grows from `small` to `large`. `run` must do
// everything that scales with the size, input building excluded: build the
// inputs first and look them up by size.
//
// A batch is a fixed number of calls in a row, chosen once: enough calls of
// the large size to last `minBatchMs`, and enough calls of the small size to
// last as long as the large batch. The batches of the two sizes are then
// timed in turn, and the fastest batch of each size is kept. Load only ever
// adds time, so the fastest batch is the closest to what the code costs, and
// because the batches of both sizes are equally long, load has the same
// chances of leaving one of each untouched. The number of calls in a batch is
// fixed beforehand and not "until some time has passed": a batch that ends
// when a clock says so ends early whenever a burst hits it, and holds fewer
// calls the slower the machine is at that moment.
//
// The number of batches does not depend on what they measure, except that
// code slow enough to use up the budget is not timed for long: code that has
// turned quadratic fails its test after two batches instead of fifteen.
export function measureGrowth(
  run: (size: number) => void,
  small: number,
  large: number,
  options: GrowthOptions = {},
): Growth {
  if (!(small > 0) || !(large > small)) throw new Error('measureGrowth: need 0 < small < large');
  const rounds = options.rounds ?? 15;
  const budgetMs = options.budgetMs ?? 500;
  const minBatchMs = options.minBatchMs ?? 2;
  const runLarge = () => run(large);
  const runSmall = () => run(small);
  // Sizing the batches also runs the code before it is timed, so that neither
  // size is the one that pays for its compilation.
  const largeBatch = sizeBatch(runLarge, minBatchMs);
  const smallBatch = sizeBatch(
    runSmall,
    Math.max(minBatchMs, Math.min(largeBatch.ms, MATCHED_BATCH_MS)),
  );
  let largeMs = largeBatch.ms / largeBatch.calls;
  let smallMs = smallBatch.ms / smallBatch.calls;
  let spentMs = largeBatch.ms + smallBatch.ms;
  let timed = 1;
  while (timed < rounds && !(timed >= 2 && spentMs >= budgetMs)) {
    const largeTime = batchMs(runLarge, largeBatch.calls);
    const smallTime = batchMs(runSmall, smallBatch.calls);
    spentMs += largeTime + smallTime;
    largeMs = Math.min(largeMs, largeTime / largeBatch.calls);
    smallMs = Math.min(smallMs, smallTime / smallBatch.calls);
    timed += 1;
  }
  const ratio = largeMs / smallMs;
  const exponent = Math.log(ratio) / Math.log(large / small);
  return { smallMs, largeMs, ratio, exponent, rounds: timed };
}

// The reference work: a fixed mix of what the code measured against it does
// (character loops, substring search, slicing, small allocations, sorting).
// 2 to 5 ms on a 2020 laptop core, depending on what else it is doing.
const REFERENCE_TEXT = '<Record type="reference" value="12.5" unit="kg"/> some text, '.repeat(2048);

function referenceWork(): number {
  const text = REFERENCE_TEXT;
  let sum = 0;
  for (let i = 0; i < text.length; i++) sum = (sum * 31 + text.charCodeAt(i)) | 0;
  const parts: string[] = [];
  for (let at = text.indexOf('<'); at !== -1; at = text.indexOf('<', at + 1)) {
    parts.push(text.slice(at + 1, at + 7));
    sum += at;
  }
  const counts = new Map<string, number>();
  for (const part of parts) counts.set(part, (counts.get(part) ?? 0) + 1);
  const numbers = new Array<number>(4096);
  for (let i = 0; i < numbers.length; i++) numbers[i] = (i * 2654435761) % 4093;
  numbers.sort((a, b) => a - b);
  return sum + counts.size + numbers[17]! + parts.join('').length;
}

// The engine compiles the reference work in steps, the last one after some
// tens of calls: until then a call costs two to three times its final price,
// and a cost divided by it looks that much cheaper. So the first measurement
// in a process runs the work until it is compiled.
let referenceCompiled = false;

// How long the reference work is sampled each time, in ms of CPU, unless the
// caller asks for more.
const REFERENCE_SAMPLE_MS = 20;

// CPU time of one call of the reference work right now, in ms: the mean over
// calls that add up to `sampleMs`. The mean and not the best call, so that a
// machine that is slow in bursts slows the reference as it slows the work
// measured against it.
export function referenceMs(sampleMs = REFERENCE_SAMPLE_MS): number {
  if (!referenceCompiled) {
    for (let call = 0; call < 60; call++) referenceWork();
    referenceCompiled = true;
  }
  const before = process.cpuUsage();
  let calls = 0;
  let totalMs = 0;
  do {
    referenceWork();
    calls += 1;
    const spent = process.cpuUsage(before);
    totalMs = (spent.user + spent.system) / 1000;
  } while (totalMs < sampleMs);
  return totalMs / calls;
}

export interface ReferenceCost {
  // CPU time of `run`, in ms.
  cpuMs: number;
  // CPU time of the reference work, in ms: the mean of a measurement taken
  // right before `run` and one taken right after.
  referenceMs: number;
  // cpuMs / referenceMs: the cost of `run` in reference units.
  units: number;
}

// The CPU cost of one call of `run`, as a multiple of the reference work
// measured around it. A machine that is twice as slow at this moment makes
// both twice as slow, so `units` stays where it was. `sampleMs` is how long
// the reference is sampled before and after: give work that runs for seconds
// a longer sample than the default, which suits work of a tenth of a second.
export function referenceCost(run: () => void, sampleMs = REFERENCE_SAMPLE_MS): ReferenceCost {
  const before = referenceMs(sampleMs);
  const spent = cpuMs(run);
  const after = referenceMs(sampleMs);
  const reference = (before + after) / 2;
  return { cpuMs: spent, referenceMs: reference, units: spent / reference };
}

// The longest batch of reference work set against one run of the work.
const REFERENCE_BATCH_MS = 250;

export interface RepeatedCostOptions {
  // Timed runs of the work, after one run that is not timed. Default 3.
  rounds?: number;
  // The longest batch of reference work set against one run, in ms. Default
  // REFERENCE_BATCH_MS.
  referenceBatchMs?: number;
}

// The same cost in reference units, measured more tightly, for work that can
// be run several times. `run` is called once without being timed (the first
// call pays for compilation and a cold heap), then `run` and a batch of
// reference work about as long as it (REFERENCE_BATCH_MS at most) are timed
// in turn, `rounds` times, and the fastest of each is kept, as in
// `measureGrowth`. One measurement by `referenceCost` is good to a factor of
// two on a busy machine; this one moved by a factor of 1.2 on a calm machine
// and 1.7 with 16 busy loops for the git guard, which lets a limit sit
// between the code as it is and the same code three times slower. `run` must
// do the same work every time it is called.
export function repeatedReferenceCost(
  run: () => void,
  options: RepeatedCostOptions = {},
): ReferenceCost {
  const rounds = options.rounds ?? 3;
  const longestBatchMs = options.referenceBatchMs ?? REFERENCE_BATCH_MS;
  const unit = referenceWork;
  if (!referenceCompiled) {
    for (let call = 0; call < 60; call++) referenceWork();
    referenceCompiled = true;
  }
  const first = batchMs(run, 1);
  const batch = sizeBatch(unit, Math.max(2, Math.min(first, longestBatchMs)));
  const work: number[] = [];
  const reference: number[] = [];
  for (let round = 0; round < rounds; round++) {
    work.push(batchMs(run, 1));
    reference.push(batchMs(unit, batch.calls) / batch.calls);
  }
  const workMs = Math.min(...work);
  const referenceMs = Math.min(...reference);
  return { cpuMs: workMs, referenceMs, units: workMs / referenceMs };
}

// One line saying what a cost test measured, to pass to `expect` as its
// message. The limits in reference units were set from measurements on one
// machine (a 2020 six-core laptop under WSL), and another processor can move
// the ratio between a piece of code and the reference work: so the line is
// also printed when the test passes, on CI and wherever COST_UNITS_LOG is
// set, and the units of that machine can be read from the test's output
// before a limit is trusted there.
export function describeCost(label: string, units: number, limit: number, detail = ''): string {
  const line =
    `[cost] ${label}: ${units.toFixed(1)} reference units, limit ${limit}` +
    (detail ? ` (${detail})` : '');
  if (process.env.CI || process.env.COST_UNITS_LOG) console.info(line);
  return line;
}
