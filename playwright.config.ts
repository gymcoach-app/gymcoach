import os from 'node:os';
import { defineConfig, devices } from '@playwright/test';

// End to end tests. The web server runs a production build against the test
// database (docker-compose.test.yml). Build the app and apply migrations
// first; in CI the e2e job does both before invoking Playwright.
const PORT = 3031;
const KEEP_ALIVE_MS = 60 * 60 * 1000;
const TEST_DB =
  process.env.E2E_DATABASE_URL ??
  'postgresql://gymcoach_test:gymcoach_test@localhost:5434/gymcoach_test';

// At most three spec files at a time, instead of Playwright's default of half
// the cores (six on a 12-core machine). Every worker drives its own browser,
// but they all talk to ONE server, and `next start` renders on one thread: a
// spec such as distance-unit.spec.ts, which lasts 8 to 10 s alone, costs that
// server 6 to 8 s of CPU time (read from /proc while it ran, issue #593). Six
// of them side by side ask for several times what the thread can give, so
// each one waits for the others and runs into the 30 s limit of a test.
// Six copies of that spec, same machine, other jobs at load 6 to 13:
//   6 workers: all six timed out at 30 s
//   4 workers: 15 to 21 s each, 43 s for the six
//   3 workers: 15 to 16 s each, 38 s for the six
//   2 workers: 10 to 14 s each, 41 s for the six
// The six take about as long with two workers as with four, because the
// server thread is the limit either way: fewer workers do not make the tier
// slower, they make each test wait less for the others. CI runners have 4
// cores, where the default is already two workers; it is left alone.
// `--workers` on the command line still wins.
const WORKERS = process.env.CI
  ? undefined
  : Math.max(1, Math.min(3, Math.floor(os.availableParallelism() / 2)));

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  workers: WORKERS,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: 'list',
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: 'on-first-retry',
  },
  webServer: {
    // LLM_PROVIDER=demo serves canned coach responses, so the AI flows (chat,
    // in-session chat) are E2E-testable without any API key (issue #111).
    //
    // --keepAliveTimeout: Node closes an idle keep-alive connection about 6 s
    // after its last response (5 s default plus 1 s). Playwright's API client
    // (page.request) keeps connections in a per-worker pool with no idle limit
    // and does not resend a POST, so a request written at the instant the
    // server closes its socket fails with "read ECONNRESET" (#593; measured
    // with two POSTs 5.99 to 6.03 s apart under load: 43 resets in 96 pairs,
    // 0 in 96 with this flag). One hour outlasts any run, so the server never
    // closes a pooled connection mid-suite. Browsers resend on a stale
    // connection by themselves; this only concerns the API client.
    command: `DATABASE_URL='${TEST_DB}' JWT_SECRET='e2e-test-secret-at-least-32-characters' LLM_PROVIDER='demo' next start -p ${PORT} --keepAliveTimeout ${KEEP_ALIVE_MS}`,
    url: `http://localhost:${PORT}/login`,
    timeout: 120_000,
    reuseExistingServer: !process.env.CI,
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
