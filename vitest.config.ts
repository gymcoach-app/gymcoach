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
    // automation/ holds the maintainer's run-record tooling, kept apart from the app.
    include: ['lib/**/*.test.ts', 'components/**/*.test.{ts,tsx}', 'automation/**/*.test.ts'],
    // jsdom covers both: pure logic tests run fine in it too.
    environment: 'jsdom',
    setupFiles: ['./vitest.setup.ts'],
    globals: true,
    maxWorkers,
  },
});
