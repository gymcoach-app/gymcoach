# Maintainer automation

Tooling for the autonomous maintainer, kept apart from the GymCoach application:
the app never imports this directory and the Docker image does not ship it
(`.dockerignore`). See the
[implementation roadmap](../docs/loops/11-autonomous-development-roadmap.md).

## Merge gate (milestone 2)

- `publish/gate.ts` - pure decision: a PR may be merged at an approved SHA only when
  it is open, not a draft, targets `main`, is `clean`, its head is still the approved
  SHA, and every allowlisted CI check, from the expected CI app, succeeded on that
  exact SHA (latest rerun decides). Empty, missing, pending, skipped, neutral,
  foreign-app and other-SHA checks refuse the merge.
- `publish/checks.ts` - the allowlist: the five jobs of `.github/workflows/ci.yml`.
  The gate refuses when it disagrees with the repository's required status checks.
- `publish/merge.ts` - the only way the maintainer merges (see the `ship-pr` skill).
  Dry run by default; `--merge` calls the merge endpoint with `sha=<approved>`.

  ```bash
  npx tsx automation/publish/merge.ts 123 --sha <reviewed-40-hex-sha>
  npx tsx automation/publish/merge.ts 123 --sha <sha> --merge --method squash \
    --title "feat: ... (#123)" --message "Closes #120"
  ```

Limits: the gate checks CI, not review evidence; the review binding is still a
procedure. It runs with the caller's gh credentials, so it constrains the agent that
follows the skill, not a determined one with the same token.

## Run records (milestone 1)

- `records/schema.ts` - versioned Zod schemas (schema version 1) for task, run,
  review and outcome records. A measurement is either known, with a unit, or
  unknown, with a reason. A value the workflow does not record is unknown, never 0.
- `baseline/build.ts` - pure builder: raw GitHub and git data in, records out.
- `baseline/report.ts` - the Markdown report; every rate states its denominator.
- `baseline/collect.ts` - read-only collector (`gh api` GET calls and `git log`).
  Run `git fetch` first: revert detection reads the local `origin/main`.

  ```bash
  git fetch origin
  npx tsx automation/baseline/collect.ts --since 2026-08-14 --window-days 14 \
    --out docs/loops/baseline/2026-10-13
  ```

- `baseline/render.ts` - re-renders `report.md` from a collected `runs.jsonl` and
  `meta.json` without calling GitHub (`npx tsx automation/baseline/render.ts <dir>`).
  Both scripts format the report with the repo's Prettier config, so a re-render
  reproduces the committed `report.md` byte for byte.

Outputs are public metadata only: PR numbers, logins, SHAs, timestamps, check
names and conclusions. PR and issue bodies, comment text and commit messages are
read in memory to find references and trailers, and are never written.

Author classes: `loop` is the maintainer account with a Claude Co-Authored-By
trailer on the PR commits; `maintainer-unattributed` is the maintainer account
without one; `external-vetted` uses the grant date in
`docs/loops/10-external-contributions.md`; everyone else is `external`. The
trailer shows Claude wrote the commits, not that the run was unattended.

Reviews: a reviewer is a `bot` (login ending in `[bot]`), a `maintainer`, or
`other-human`; bot reviews are reported apart from the human review line. A
posted verdict counts only when a maintainer comment names a verdict and the head
it reviewed (`head \`<sha>\``); the short SHA is resolved against the PR's commits.

Follow-ups: a bug-labelled issue or an issue or PR titled `fix`/`bug` that cites
the PR within the window; a fix PR closed unmerged does not count. Revert and
follow-up rates are reported over runs whose window has closed, with observing
runs apart. CI: skipped and neutral checks are not decisive, and a running check
leaves the head's CI outcome unknown.
