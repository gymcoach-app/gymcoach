# Contributing to GymCoach

Thanks for your interest in improving GymCoach. External issues and pull
requests are welcome and encouraged. This guide covers the local setup, the
checks your changes should pass, and - because this repo is largely maintained
by an autonomous AI loop - an honest description of how your contribution is
handled.

## How your contribution is handled

This project is maintained day to day by an AI agent under a public charter
(`docs/loops/`). So that you know exactly what to expect:

- **An AI reviews your PR, and may merge it.** New external PRs get a triage
  response within about a day and a full structured review verdict within 72
  hours: a mechanical surface check, an adversarial multi-lens code review,
  and a read of CI. When all three are clean, the PR touches none of the
  human-only paths below and it adds value, the agent may merge it on its
  own; otherwise the verdict says what a human maintainer still has to decide. Contributors with
  an established track record can be granted vetted status (by a human), after
  which the agent may also push small fixups to their branch.
- **Your code is executed by CI** (GitHub Actions, ephemeral, no secrets) when
  you open a PR. Outside CI, external code is only ever executed in an
  isolated, credential-free container - never directly on a maintainer
  machine.
- **Some paths are never merged by the agent** and always need a human
  decision: CI/workflows, `scripts/`, `.claude/`, the maintenance runtime
  `automation/` (it holds the merge gate), build and container files,
  ignore and env files, dependency manifests and lockfiles, executable configs
  (`next.config.js`, test configs, `middleware.ts`, lint and TypeScript
  configs), the review-bot config, and the maintenance charter (`CLAUDE.md`,
  `docs/loops/`). PRs there are welcome - just expect a human in the loop and
  a slower cycle.
- **Some paths get a stricter review before the agent may merge**: Prisma
  schema and migrations, auth/session/rate-limit code, the MCP surface and its
  tokens, bulk data export routes, the LLM provider and prompt layer, and
  locale modules (`messages/`, `i18n/`). The agent merges these only when every
  check is clean, including two dedicated security reviews, and after tagging
  a rollback point. The authoritative lists live in
  `docs/loops/10-external-contributions.md`.
- **Feature ideas are welcome as issues.** Clear, in-scope issues may be
  implemented by the agent itself, with credit to you in the PR and CHANGELOG.
- **License and sign-off**: by submitting a contribution you agree it is
  provided under the repository's license. Please add a
  `Signed-off-by: Your Name <email>` line to your commits
  (`git commit -s`, the Developer Certificate of Origin,
  https://developercertificate.org/). This is requested, not yet enforced by
  CI.

None of this is a security guarantee - review reduces risk, it does not
certify code. It is simply the honest description of the pipeline your PR
goes through.

## Development setup

See the README for the full quick start. In short:

```bash
cp .env.example .env
npm install
docker compose up -d db
npm run db:migrate
npm run db:seed
npm run dev
```

## Project conventions

- TypeScript strict, no `any` where it can be avoided.
- Validate every API input with Zod.
- Prefer the existing Shadcn UI primitives in `components/ui`.
- The codebase is English-only (UI, comments, prompts, docs).
- Do not use em-dashes or en-dashes; use a regular hyphen.
- Conventional Commits for messages (`feat:`, `fix:`, `chore:`, ...).

## Tests

The project uses a three-tier test setup. Please add or update tests with your
change.

```bash
npm run test              # unit + component (Vitest, jsdom)
npm run test:coverage     # with coverage

# Integration + E2E need the test database. `bash scripts/verify.sh --full`
# starts and migrates it for you (scripts/test-db.sh); by hand:
docker compose -f docker-compose.test.yml up -d
npx prisma migrate deploy   # DATABASE_URL pointing at the test DB (port 5434)
npm run test:integration    # Vitest against real Postgres
npm run build && npm run test:e2e   # Playwright (builds, then drives the app)
docker compose -f docker-compose.test.yml down
```

CI runs lint, typecheck, unit, integration, build and E2E on every pull
request (see `.github/workflows/ci.yml`).

## Before opening a pull request

```bash
npm run lint
npm run typecheck
npm run test
npm run build
```

Keep pull requests focused and describe the change and how you tested it.
