import { defineConfig, devices } from '@playwright/test';

// End to end tests. The web server runs a production build against the test
// database (docker-compose.test.yml). Build the app and apply migrations
// first; in CI the e2e job does both before invoking Playwright.
const PORT = 3031;
const KEEP_ALIVE_MS = 60 * 60 * 1000;
const TEST_DB =
  process.env.E2E_DATABASE_URL ??
  'postgresql://gymcoach_test:gymcoach_test@localhost:5434/gymcoach_test';

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
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
