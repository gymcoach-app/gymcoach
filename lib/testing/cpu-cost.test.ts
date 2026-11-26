import { describe, expect, it } from 'vitest';
import { cpuMs, measureGrowth, referenceCost, referenceMs } from './cpu-cost';

// Work whose cost is known: `passes` additions per element.
function sumPasses(values: Float64Array, passes: number): number {
  let sum = 0;
  for (let pass = 0; pass < passes; pass++) {
    for (let i = 0; i < values.length; i++) sum += values[i]!;
  }
  return sum;
}

describe('measureGrowth', () => {
  const arrays = new Map([4000, 32_000].map((n) => [n, new Float64Array(n).fill(1)]));

  it('reports an exponent near 1 for work proportional to the size', () => {
    const growth = measureGrowth(
      (n) => {
        sumPasses(arrays.get(n)!, 400);
      },
      4000,
      32_000,
    );
    expect(growth.rounds).toBeGreaterThanOrEqual(2);
    expect(growth.rounds).toBeLessThanOrEqual(15);
    expect(growth.exponent).toBeCloseTo(Math.log(growth.ratio) / Math.log(8), 10);
    expect(growth.exponent).toBeGreaterThan(0.6);
    expect(growth.exponent).toBeLessThan(1.4);
  });

  it('reports an exponent near 2 for work that grows with the square of the size', () => {
    const growth = measureGrowth(
      (n) => {
        // One pass per 20 elements: n * n / 20 additions.
        sumPasses(arrays.get(n)!, n / 20);
      },
      4000,
      32_000,
    );
    expect(growth.exponent).toBeGreaterThan(1.6);
    expect(growth.exponent).toBeLessThan(2.4);
  });

  it('reports no growth for work that does not depend on the size', () => {
    const growth = measureGrowth(
      () => {
        sumPasses(arrays.get(4000)!, 400);
      },
      4000,
      32_000,
    );
    expect(Math.abs(growth.exponent)).toBeLessThan(0.5);
  });

  it('refuses sizes it cannot compare', () => {
    expect(() => measureGrowth(() => {}, 10, 10)).toThrow(/small < large/);
    expect(() => measureGrowth(() => {}, 0, 10)).toThrow(/small < large/);
    expect(() => measureGrowth(() => {}, 20, 10)).toThrow(/small < large/);
  });
});

describe('referenceCost', () => {
  const values = new Float64Array(100_000).fill(1);

  it('counts the CPU time of the work, in ms and in reference units', () => {
    const cost = referenceCost(() => {
      sumPasses(values, 200);
    });
    expect(cost.cpuMs).toBeGreaterThan(0);
    expect(cost.referenceMs).toBeGreaterThan(0);
    expect(cost.units).toBeCloseTo(cost.cpuMs / cost.referenceMs, 10);
  });

  // One measurement is good to a factor of two or so on a busy machine (the
  // reference and the work are slowed by different bursts), which is why the
  // tests that use it put their limit several times above what they measure,
  // sample the reference for longer around long work, or add up many
  // measurements. These two tests allow for that spread.
  it('gives about ten times the units for ten times the work', () => {
    const once = referenceCost(() => {
      sumPasses(values, 200);
    }, 100);
    const tenTimes = referenceCost(() => {
      sumPasses(values, 2000);
    }, 100);
    const ratio = tenTimes.units / once.units;
    expect(ratio).toBeGreaterThan(3);
    expect(ratio).toBeLessThan(30);
  });

  it('measures a reference that repeats within a factor of three', () => {
    const first = referenceMs(100);
    const second = referenceMs(100);
    expect(second / first).toBeGreaterThan(1 / 3);
    expect(second / first).toBeLessThan(3);
  });
});

describe('cpuMs', () => {
  it('counts work and not waiting', () => {
    // A wait costs the process next to nothing however long it lasts, which
    // is what makes these measurements blind to a machine that makes the
    // process wait for a core. Compared with real work of the same wall time,
    // never with a number of milliseconds.
    const waitMs = 50;
    const waited = cpuMs(() => {
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, waitMs);
    });
    const worked = cpuMs(() => {
      const until = performance.now() + waitMs;
      while (performance.now() < until) {
        // busy
      }
    });
    expect(worked).toBeGreaterThan(0);
    expect(waited).toBeLessThan(worked / 2);
  });
});
