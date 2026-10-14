# Autonomous development in GymCoach

GymCoach is a self-hosted workout tracker and an experiment in autonomous software
maintenance. Claude Code agents develop the application through a pipeline of
reusable skills, software checks, independent reviews, and bounded shipping work.
Agents also propose most of what gets built: triage, agent research on competing apps
and their users' requests, and the [ideation loop](08-ideation-loop.md) file the work,
alongside adopted external issues. A human sets the product direction, goals and
authority boundaries, and steers ideation with directives.

The experiment asks two questions: can agents maintain a useful application over
time, and can changes to their working methods make that maintenance more reliable?
The repository records the first in its code and run history. Measuring the second
is the next stage of development.

[Back to GymCoach](../../README.md) ·
[Implementation roadmap](11-autonomous-development-roadmap.md) ·
[Autonomy charter](07-autonomy.md)

## How the current pipeline works

```mermaid
flowchart LR
    A[Issues and product needs] --> B[Triage]
    B --> C[Implement one task]
    C --> D[Local verification and PR]
    D --> E[Independent review and CI]
    E -->|Changes needed| C
    E -->|Eligible and green| F[Merge]
    F --> G[Write up results and lessons]
    G --> B
```

1. **Choose useful work.** Triage examines issues and code health. When there is
   no actionable backlog, bounded ideation files product improvements (at most three
   per run, none while three idea issues are open), grounded in the captured
   competitor research and an optional small web check.
   External requests follow the contribution trust policy before adoption.
2. **Implement one task.** The implementation skill creates a task branch, makes
   a focused change, adds appropriate tests, and runs the local verification gate.
   Concurrent tasks use separate worktrees; tasks touching the same files are
   serialized. The implementation stage stops at the PR.
3. **Challenge the result.** An independent reviewer looks for defects. Complex
   changes require multiple review lenses and verification in the running app.
   CI runs lint, type checking, unit tests, integration tests, a production build,
   Playwright E2E tests, and a Docker image smoke test.
4. **Ship within the charter.** The shipping stage checks eligibility, review
   findings, and CI. It can merge eligible changes autonomously. Security-sensitive
   changes and other reserved decisions follow the charter's human review path.
5. **Record what happened.** The journal links decisions and shipped work. Lessons
   are promoted into skills or conventions, or recorded as accepted risks.

These are the operating procedures the agents are instructed to follow. Three
transitions now have code behind them. The shipping skill routes every merge
through [`automation/publish/merge.ts`](../../automation/publish/merge.ts), which
merges only at the reviewed head SHA, with all required CI checks green on it and
a structured review record for that head and base; it constrains an agent that
follows the skill, since it runs with the caller's own GitHub token. And
`verify.sh --full` prepares its own test database. A Claude Code PreToolUse hook
([`automation/hooks/guard-git.cjs`](../../automation/hooks/guard-git.cjs)) refuses
subagents' HEAD-moving git commands in checkouts they do not own. The repository does not yet
contain a standalone controller that mechanically enforces every transition.
The journal also records occasions when the procedure failed.

## What exists and what is planned

| Capability             | Current implementation                                                                                                                                                                                                                                                                              | Next step                                                                                 |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| Task pipeline          | Claude Code loops invoking repository skills                                                                                                                                                                                                                                                        | Versioned controller with durable task state                                              |
| Verification           | Local gate, CI, independent reviews; a merge gate that needs green CI and a structured review record for the exact head and base                                                                                                                                                                    | Revalidate the combined result when `main` moves under a reviewed PR                      |
| Isolation              | Worktree procedures, a git guard hook for subagents, container verification scripts, a test database that `verify.sh --full` starts and migrates itself                                                                                                                                             | Enforced worker isolation and separate publishing authority                               |
| Limits                 | Documented attempt, merge, and turn-budget limits                                                                                                                                                                                                                                                   | Runtime accounting and enforced aggregate limits                                          |
| Memory                 | Git, issues, run journal, lessons, skills                                                                                                                                                                                                                                                           | Indexed retrieval and executable fixes for recurring mistakes                             |
| Agent evaluation       | A versioned PR-outcome baseline, with agent usage recovered from transcripts where attributable; a 3-task replay smoke suite (`evals/maintainer/`) graded in containers, with the agent's network limited to the model API (#453); tamper detection is a tripwire with two known bypasses (#468); the paid agent stays hard-disabled until #468 is closed or accepted | 20-30 tasks, then a budgeted agent baseline once the operator accepts the credential risk |
| Improvement of methods | Lessons promoted into procedures                                                                                                                                                                                                                                                                    | Candidate procedures compared with the current version                                    |
| Laya                   | Not integrated                                                                                                                                                                                                                                                                                      | Optional classification experiment after baseline evaluation                              |

The [implementation roadmap](11-autonomous-development-roadmap.md) defines the
proposed architecture, ordered milestones, acceptance criteria, and a handoff
prompt for a coding agent. Its unchecked milestones are not shipped features.

## Boundaries and human involvement

The [autonomy charter](07-autonomy.md) defines the mandate, stopping conditions,
review requirements, and changes reserved for a human. The
[external contribution policy](10-external-contributions.md) defines trust tiers,
hard-block paths, and the treatment of outside code and requests. Those documents
remain authoritative; this overview does not grant additional permissions.

Issues, comments, diffs, and tool output can carry untrusted instructions. Agents
must treat them as data. External code has explicit execution restrictions, and a
worktree alone is not a security boundary. Green CI is necessary for a merge; it
does not prove that a request is appropriate or that every defect was detected.

The application's AI coach uses the user's configured LLM provider for training
features. The development agents use a separate maintenance environment. Running
the application with Docker does not grant an agent access to your repository,
GitHub account, or server.

## Evidence from real runs

- [Evidence page](evidence.md): the measured baseline, the controls now in code,
  reviews that caught real problems, what is not shown yet, and how to reproduce it.
- [Run journal](autonomy-log.md): decisions, merged work, findings, and deferrals.
- [Lessons](lessons.md): failures and the procedure changes they prompted.
- [Review digest](review-digest.md): changes and risks worth a maintainer's attention.
- [Product changelog](../../CHANGELOG.md): user-visible results.

For example, lessons L15 and L38 describe agents interfering with shared Git state;
L29 describes why a fixup needs a fresh review; L36 records checking that a new
test actually fails without the fix. These incidents guide the move from written
rules to executable controls: L29 is now checked by the merge gate (a fixup
changes the head, so the old review record no longer counts), and L4, L23 and L42
became script and code changes, L15 and L38 a git guard hook.

A first [baseline report](baseline/2026-10-13/report.md) counts PR outcomes, CI
evidence, human and bot reviews, reverts and fix follow-ups from public GitHub data, using the versioned
records in [`automation/`](../../automation/README.md). Agent tokens, an
API-list-price cost estimate and session time are recovered from local Claude Code
transcripts where a subagent session can be attributed to a PR (32 of 79 runs, a
lower bound per run);
the rest, and human interventions, stay unknown. We do not yet publish an autonomy
rate, cost per successful task, or
benchmark improvement score. A merged PR and a green test suite alone do not establish that a new
agent configuration is better than the previous one.

## Try the workflow in another repository

Start with a reliable verification command, a short working agreement, and one
bounded implementation task. Adapt the skills to your stack and inspect their
permissions before running them. Start with a PR for human review; adopt more
autonomy only after testing the relevant controls in your own environment.

This directory is currently a playbook, not a one-command maintainer installer.
Reproducing the hosted schedule, credentials, and protection rules requires setup
outside these Markdown files. A portable replay command and controller are roadmap
deliverables.

Contributors can help with the app, report agent failures, or propose evaluation
tasks. See [CONTRIBUTING.md](../../CONTRIBUTING.md) for how AI review works and
which changes need maintainer involvement.

## Detailed playbook

The numbered documents include the system's development history. For current
authority boundaries, consult the charter and contribution policy; for current
implementation steps, consult the relevant skill. Earlier examples may describe
an earlier operating phase.

- [`00-concept.md`](00-concept.md) - what a loop actually is, the five-stage lineage,
  and the six ingredients mapped to real Claude Code tools.
- [`01-foundations.md`](01-foundations.md) - the four things a loop needs first:
  `CLAUDE.md`, the green-gate (`scripts/verify.sh`), permissions
  (`.claude/settings.json`), and a reusable skill.
- [`02-issue-to-pr-loop.md`](02-issue-to-pr-loop.md) - the flagship loop that turns
  open issues into pull requests, its guardrails, and how it graduates to the cloud.
- [`03-triage-loop.md`](03-triage-loop.md) - the head of the pipeline: manufacture
  well-scoped issues so the Issue -> PR loop never starves.
- [`04-ship-loop.md`](04-ship-loop.md) - the shipping half: watch CI, fix a red gate,
  self-review, and auto-merge on green. Where the full gate actually gates a merge.
- [`05-content-loop.md`](05-content-loop.md) - the tail: keep the CHANGELOG and this
  playbook true to what shipped. The growth engine.
- [`06-orchestration.md`](06-orchestration.md) - the maintainer loop that runs all the
  stages end to end, and how it graduates to a nightly cron.
- [`07-autonomy.md`](07-autonomy.md) - the charter for running unsupervised: mandate,
  hard guardrails, the stop-for-human list, the subagent challenge protocol, and the
  rollback baseline. Paired with the append-only [`autonomy-log.md`](autonomy-log.md).
- [`08-ideation-loop.md`](08-ideation-loop.md) - the head above triage: when even triage
  comes up dry, manufacture bounded **product** feature ideas (the cheap, recurring cousin
  of the one-off deep-research workflow) so the product keeps growing, not just the test
  suite. Logs to [`ideas-backlog.md`](ideas-backlog.md).
- [`09-memory-and-learning.md`](09-memory-and-learning.md) - the loop as a control system:
  how it manages/compresses context (state in git, not the session), learns (layered
  filesystem memory + lessons that **graduate** into skills - no vector RAG), and regrounds
  on its purpose. Staging area in [`lessons.md`](lessons.md); the per-batch human reading
  list (comprehension-debt antidote) in [`review-digest.md`](review-digest.md).
- [`10-external-contributions.md`](10-external-contributions.md) - the trust and vetting
  policy for external issues and PRs: trust tiers, the execution gate (CI is the only
  executor of unvetted code), the hard-block path list, the three vetting passes, the
  issue-adoption pipeline, and the human-granted vetted-contributor ladder.
- [`11-autonomous-development-roadmap.md`](11-autonomous-development-roadmap.md) -
  the proposed next architecture, implementation milestones, acceptance criteria,
  Laya experiment, and handoff prompt.

The executable verification entry point is
[`scripts/verify.sh`](../../scripts/verify.sh). The agent procedures live in
[`.claude/skills/`](../../.claude/skills/).
