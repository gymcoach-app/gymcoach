// The CI checks a merge requires, one per job in .github/workflows/ci.yml. The
// merge gate cross-checks this list against the repository's required status
// checks and refuses when the two disagree, so neither can drift silently.
export const REQUIRED_CHECKS = [
  'Lint, typecheck, unit tests',
  'Integration tests (Postgres)',
  'Production build',
  'Docker smoke test (production image)',
  'End to end (Playwright)',
] as const;

// The GitHub App that runs ci.yml (GitHub Actions). Pinned so the gate fails
// closed when the repository rules cannot be read or leave the app open: a
// same-named check from any other app never counts.
export const CI_APP_ID = 15368;

export const REPO = 'gymcoach-app/gymcoach';
export const BASE_BRANCH = 'main';
