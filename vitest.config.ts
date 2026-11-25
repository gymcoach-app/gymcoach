import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import os from 'node:os';
import path from 'node:path';

// Half the cores by default instead of Vitest's cores-minus-one. The unit tier
// often runs while other agents build, lint or run browsers on the same
// machine; with every core already busy, a full worker pool only adds
// contention, and the heavy jsdom UI tests then cross the 5 s per-test
// timeout (lesson L42). Measured on 12 cores at load ~20: the slowest
// EditableSetsTable test went from 5.2 s (timed out) to 2.9 s; at idle the
// whole tier costs about 14% more wall time. VITEST_MAX_WORKERS still wins.
// CI runners are dedicated (4 vCPU), so they keep Vitest's default.
const maxWorkers = process.env.CI
  ? undefined
  : (process.env.VITEST_MAX_WORKERS ?? Math.max(2, Math.floor(os.availableParallelism() / 2)));

export default defineConfig({
  // plugin-react transforms JSX/TSX in test files regardless of the
  // tsconfig `jsx: preserve` setting used by Next.js.
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './'),
    },
  },
  test: {
    // Logic tests live next to lib/ code, component tests under components/.
    // automation/ holds the maintainer's run-record tooling and evals/ its replay
    // harness, both kept apart from the app. Task graders under evals/*/tasks are
    // not test files: they are fetched from the fix commit at grading time.
    include: [
      'lib/**/*.test.ts',
      'components/**/*.test.{ts,tsx}',
      'automation/**/*.test.ts',
      'evals/**/*.test.ts',
    ],
    // Node by default; a test that needs a DOM says so on its first line:
    //   // @vitest-environment jsdom
    // (every test under components/ does, and the lib/ tests of browser
    // storage). Without that line such a test fails at once on `document is
    // not defined`. jsdom used to be the default for every file: Vitest builds
    // a fresh environment per test file, and loading jsdom was most of the
    // unit tier's CPU. Measured on the 143 files of lib/ and automation/, at
    // load 9 to 20 on 12 cores (issue #593): 701 s of summed environment time
    // and 239 s of wall time with jsdom, 0.3 s and 121 s without. That load is
    // what pushed the CPU-bound tests of those folders past their 5 s limit.
    // No `projects` here: the eval harness wraps this file with mergeConfig
    // and overrides `test.include` (evals/maintainer/runner.ts, canaryFiles).
    environment: 'node',
    setupFiles: ['./vitest.setup.ts'],
    globals: true,
    maxWorkers,
  },
});
