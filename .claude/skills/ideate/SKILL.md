---
name: ideate
description: When the backlog is empty, manufacture well-scoped PRODUCT feature ideas - bounded feature research plus brainstorming grounded in the product vision and the captured competitor insights - and file them as crisp, single-PR issues so the Issue -> PR loop never starves for ideas. Use only when ship and triage have nothing and there is no open actionable issue. Strictly token-bounded; never launches the heavy multi-agent deep-research workflow.
---

# ideate

triage manufactures code-health work (tests, small bugs, deps); `ideate` manufactures
**product** work when even triage comes up dry, so the loop keeps pushing the product
toward the goal of being the most complete self-hosted AI training/fitness app - not
just keeping it tidy. The output is **issues, not code**: crisp, single-PR feature ideas a
later `implement-issue` run picks up unattended. Read `CLAUDE.md` and
`docs/loops/07-autonomy.md` first.

This is the lightweight, recurring cousin of the one-off deep-research workflow. It is
deliberately cheap: it runs often (whenever the loop would otherwise idle), so it must
cost a tiny fraction of that workflow.

## When to run

Only when the loop is genuinely starved of product work, in this order:
- no ready PR to ship, AND
- `triage` found no trusted code-health issue, AND
- there is no open, actionable, trusted issue to implement.

If there is already an open actionable issue, STOP - implement that first. Never pile new
ideas on top of unstarted ones.

## Hard budget (the whole point is bounded ideation)

- **Never** launch the heavy deep-research workflow (the ~100-agent one) or anything close.
- Default to brainstorming from context you already have (the repo, the research memory,
  the roadmap). A web check is **optional** and capped at **~6 searches**, used only if it
  adds something the captured research does not already cover.
- Spawn at most ONE helper subagent if you need one; prefer doing it inline.
- File **at most 3 issues** per run.
- **Anti-flood:** do not run if there are already **>= 3 open `enhancement`/`idea`
  issues** - the backlog is fed; let `implement-issue` drain it first. One productive run
  per starved cycle; once you file issues, you are done until they drain.

## Where ideas come from (grounded, not random)

1. **The vision.** Aim: the most complete self-hosted AI training/fitness app. The operator
   broadened the scope (2026-06-11) beyond pure hypertrophy: strength, conditioning/cardio,
   endurance, mobility, and general fitness are all in scope. Concretely, the CSV importers
   (`lib/import/strong-csv.ts`, `lib/import/hevy-csv.ts`) currently SKIP cardio rows and
   nothing in the app tracks duration/distance work - that axis is now fair game. Ask "what
   would a serious lifter, a coach, or a leading competitor expect that we do not have yet?"
2. **The captured research** (Memory: `research-product-direction.md`) and its wedge - AI
   that advises *within* the user's program, explains why, and respects data ownership.
   Mine it for not-yet-built items.
3. **The current product.** Skim `app/` routes, `lib/`, `components/` to find concrete gaps
   and the natural next slice of what already shipped (e.g. readiness now exists -> what
   uses it next).
4. **The README roadmap** - unchecked items.
5. **Optional bounded web check** (<= ~6 searches) for what users want / what is missing in
   AI training/fitness apps lately - only if it beats the memory. No heavy fan-out.

## What a good idea-issue looks like

- **Single-PR-sized and additive-friendly** - scoped so `implement-issue` can finish it
  under the green-gate. No epics: split a big idea into the smallest valuable first slice.
- **Encodes a sensible DEFAULT product decision**, so it is concrete work, not "needs a
  product call". Turning ambiguity into a defensible spec is the job.
- Title + **Context** (the user value and where it lives, with file paths) + **Acceptance
  criteria** (a checkable list).
- **Risk-scaled, not additive-only** (operator directive 2026-06-10). Complex ideas - new
  tables, data-safe migrations, LLM-output-contract changes, multi-surface features - are
  in scope when they are a clear product plus; the issue must then name the reinforced
  non-regression controls that apply (full gate, tests at every touched layer, contract
  tests, multi-lens review - see the charter's "Complex features" section). Still
  stop-for-human: destructive data migrations, auth/security changes, major dep bumps.
- Labels: `enhancement` and `idea`.
- **De-dupe** against open AND recently-closed issues and `docs/loops/ideas-backlog.md`.
  Never re-file a shipped or rejected idea.

## Procedure

1. **Confirm starvation and the anti-flood cap.** If not starved, or there are already >= 3
   open `enhancement`/`idea` issues, STOP and report - do not generate.
2. **Ground.** Skim the current features, the research memory, the roadmap. Optionally one
   small web check within the budget.
3. **Brainstorm** a short candidate list; rank by `(user value x fit-with-vision) /
   implementation size`. Prefer high-value single-PR slices; complexity is acceptable when
   the value justifies it and the controls scale with it.
4. **File** the top up-to-3 non-duplicate, single-PR candidates as crisp issues with a
   sensible default spec + acceptance criteria:
   `gh issue create --label enhancement --label idea --title "..." --body "..."`.
5. **Record** one line per idea in `docs/loops/ideas-backlog.md` (proposed / shipped /
   rejected) so future runs do not repeat it. (This is a read/write doc edit; commit it on
   a task branch like any change, never on `main`.)
6. **Report** the new issue numbers + one line each, and what you deliberately did not file.

## Stop conditions

- Not starved, or an open actionable issue exists -> STOP (implement first).
- >= 3 open `enhancement`/`idea` issues -> STOP (anti-flood).
- 20 or more open issues -> STOP (open-issue cap, operator directive 2026-10-19); an idea
  worth keeping goes into the parked backlog #484, not onto the open list.
- No genuinely new, single-PR, non-duplicate idea -> file fewer or none. "Idea backlog
  healthy" is a valid, good outcome; never invent low-value busywork to fill the tracker.
- An idea that genuinely needs the heavy deep-research workflow -> out of scope here; note
  it for a human instead.

## What success looks like

A steady trickle of crisp, vision-aligned, single-PR feature issues that appear only when
the loop would otherwise idle, never faster than implementation drains them, at a tiny
fraction of the one-off deep-research cost. The loop never starves for *product* direction,
and the product keeps moving toward "the most complete AI fitness app" - while staying
token-bounded and inside every guardrail (the filed issues are still subject to the
green-gate, the subagent challenge, and the stop-for-human list when implemented).
