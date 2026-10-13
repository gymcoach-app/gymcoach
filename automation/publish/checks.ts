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

// Accounts whose PR comments may carry a review record the gate counts
// (automation/review/). Anyone can post a comment that looks like a record;
// only these authors are trusted. The loop posts from JulienAu. Matched on the
// numeric user id, never the login: a renamed or deleted account frees its
// login for someone else, while an id is never reused. The login is kept for
// messages only. Not checked: `performed_via_github_app` (a GitHub App acting
// with a maintainer's own user token posts as that maintainer).
export interface Maintainer {
  login: string;
  id: number;
}
export const MAINTAINERS: readonly Maintainer[] = [
  { login: 'JulienAu', id: 16043912 },
  { login: 'Julien-Au', id: 288004433 },
];
