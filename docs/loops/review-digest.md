# Review digest (read this, so your understanding does not rot)

The loop ships faster than any human reads. That gap is **comprehension debt**: the more the
loop merges that you did not read, the less you actually understand your own product. This
file is the antidote - after each batch, `write-up` appends a short, **prioritized reading
list**: what merged, and which few diffs are worth your eyes *first*, ranked by risk x
impact. The skeptic sub-agents already gate correctness; this keeps the *human* in the loop.

Priority rule: **auth/security, schema/migrations, core behavior (progression/stats), LLM
prompts, and CI/pipeline rank highest** (a wrong call there is expensive and quiet).
Additive UI, tests, and docs rank lowest (a reviewer/skeptic + the gate catch most of it).
Read a diff with `gh pr diff <n>`.

---

## 2026-06-09 - second ideate batch (#84/#85/#86): analytics + UI on lib/stats.ts

Three additive, derived-on-read features shipped (issues #80/#81/#82): personal records on the
post-session summary (#84), MEV/MRV volume landmarks (#85), and stalled-lift detection (#86).
No schema, no migration, no auth/prompt change - so this batch ranks **modest**. The one read
worth your time:

1. **#85 + #86 - the new `lib/stats.ts` helpers (core behavior).** `gh pr diff 86` then
   `gh pr diff 85`. Several features now share this file: `isStalled` (e1RM flat over the last
   `STALL_LOOKBACK_SESSIONS=3` within `STALL_TOLERANCE=0.5%`), `classifyWeeklySets` /
   `WEEKLY_SETS_MEV=10` / `WEEKLY_SETS_MRV=20`, and `weeklySetsByMuscleGroup`. These are pure
   functions that drive what users are told about their training; read the thresholds and the
   "needs >= 3 sessions to flag" / inclusive-band edges. (Note: #81 and #82 both edited this
   file and overlapped - see L7; the merged result is what the gate ran on.)

**Skim (additive UI - lower risk):** #84 personal-records card (`computeSessionPRs` in
`components/session/session-summary.tsx`, reuses `detectPRs` with a "since last session"
baseline) and the two new progress-dashboard cards. Each is display-only, tested, and
skeptic-reviewed; read the helper only if the numbers matter to you, skip the wiring.

---

## 2026-06-09 - the big autonomous session (~27 merges)

A lot shipped today. You do not need to read all of it. Read these **six first** - they
touch auth, the security model, what weights users are told to lift, the AI's behavior, the
database, and the pipeline:

1. **#66 - bcrypt 5 -> 6 (auth).** `gh pr diff 66`. Password hashing for register/login. The
   bcrypt API is unchanged and the auth E2E passed, but this is the one change that can lock
   every user out if wrong. Confirm `bcrypt.hash`/`bcrypt.compare` usage is intact.
2. **#56 - public-repo guardrail (security/trust model).** `gh pr diff 56`. Defines *who the
   loop trusts* (login allowlist `{JulienAu, Julien-Au}`), prompt-injection refusal, and the
   `curl`/`wget` deny. This is the boundary that keeps an open repo from steering the loop.
   Make sure the trust model is the one you want.
3. **#55 - readiness -> deterministic progression.** `gh pr diff 55`. `lib/progression.ts`
   now lets soreness/readiness *hold or reduce* the suggested weight (never raise it),
   backward-compatible. This changes the actual numbers a user is told to lift - read the
   thresholds and the never-raises invariant.
4. **#44 - coach prompt positioning.** `gh pr diff 44`. `lib/prompts/*`: the AI coach is
   instructed to advise *within* the user's program and explain why, never silently rewrite.
   Prompt wording is product behavior; read what the model is now told to do.
5. **#43 - readiness/soreness check-in (schema + API).** `gh pr diff 43`. New
   `ReadinessCheckin` Prisma model + `/api/readiness` (Zod-validated). The only new
   data/table this session - confirm the model and validation.
6. **#67 - CI modernization.** `gh pr diff 67`. `.github/workflows/ci.yml`: actions ->@v5
   (Node 24 runtime), node-version 20->22, Postgres from the ECR Public mirror. Pipeline
   changes affect every future merge's trust gate.

**Skim (additive features - logic + UI + tests, lower risk):** #41 plate calculator, #42 &
#62 program templates, #51 soreness/note UI, #63 readiness explainability badge, #64
readiness opt-out preference, #75 warm-up calculator, #76 personal-record badge, #77
training-consistency card. Each is additive, tested, and skeptic-reviewed; read the `lib/*`
helper if the behavior matters to you, skip the wiring.

**Trust the gate (docs / tests / in-range deps - no close read needed):** the loop-infra
docs #68 (ideation loop) and #74 (memory/learning architecture) are worth reading as
*narrative* if you want to understand how the loop now works; the changelog/log docs
(#46/#50/#52/#58/#65/#73/#78), the readiness route tests #49, and the in-range dep bumps #45
are safe to skip.

> Honest note: the skeptics reviewed all of the above, but "reviewed by another agent" is
> not "understood by you". If you read only six diffs from today, read the six above.

---

## 2026-06-10 - third ideate batch + the complex-features directive (#92-#95, #97)

Merged this batch: #91 (ideate log), #92 (charter widened to complex features), #93
(deload-week banner), #94 (set-logging shorthand), #95 (per-exercise target goals - first
feature under the new directive: additive migration + API + UI), #97 (fix: re-derive goal
achievement when the achieving set is deleted). This batch ranks **high**: it contains a
governance change, a new table + API surface, and a write-path fix.

**Read first, in order:**

1. **#92 - the autonomy charter now allows complex features without human review.**
   `gh pr diff 92`. Governance, not code: the stop-for-human list narrowed to destructive
   migrations / auth-security / major dep bumps, traded for reinforced non-regression
   controls. This changes what the loop is allowed to merge from now on - read it even if
   you read nothing else.
2. **#95 - per-exercise goals (schema + API + write-path hook).** `gh pr diff 95`. New
   `ExerciseGoal` table (additive, unique per user+exercise), Zod-validated ownership-scoped
   routes, and a best-effort achievement stamp inside the set-save path. The post-merge
   independent review verified ownership, migration drift, and e1RM math; still the largest
   new surface this batch.
3. **#97 - the defect that review found.** `gh pr diff 97`. Set DELETE now re-derives
   `achievedAt` from remaining history. Read it as the concrete failure mode of #95's
   lifecycle (and the proof the post-merge backstop works - see lessons.md L8).
4. **#93 - deload recommendation thresholds.** `gh pr diff 93`. `lib/deload.ts` constants
   (2 stalled lifts; readiness average <= 2/5 over <= 5 check-ins, 14-day window) decide
   when the app tells a user to back off - sanity-check the coaching judgment.

**Skim (additive, tested, skeptic-reviewed):** #94 shorthand parser (`lib/set-shorthand.ts`;
note RPE -> RIR mapping = 10 - RPE clamped to 0-5), #91 and the docs in this PR.

> Honest note: #95 merged on the implementing agent's own review pass (no subagent tool in
> its environment); the independent review happened post-merge and found #97. The protocol
> now requires flagging that case explicitly (charter, L8).

---

## 2026-06-10 (later) - fourth ideate batch under the directive (#103-#105) + the review-driven fixes (#108/#109)

Merged: #102 (ideate log), #103 (bodyweight tracking - new table + API + card), #104 (coach
payload gains goals + fatigue), #105 (Strong CSV import - the biggest new surface to date),
#108 (import hardening: streamed body cap, transaction timeout, CSV formula-injection fix),
#109 (bodyweight sync race + bounds). All three features were flagged "needs post-merge
independent review" by the implementing tick (L8) and got it; the reviews produced #108 and
#109. This batch ranks **high**: untrusted file input, a new table, and a write-path fix.

**Read first, in order:**

1. **#105 + #108 together - the import pipeline.** `gh pr diff 105`, then `gh pr diff 108`.
   Untrusted CSV -> parser caps/Zod -> dry-run plan -> one transaction. #108 is what the
   security lens changed: a chunked body could bypass the 5 MB header check (now a streamed
   cap in parseJsonBody), Prisma's 5 s default would abort big legit imports (now 60 s),
   and imported names could plant spreadsheet formulas in the CSV export (now neutralized
   in lib/csv.ts).
2. **#103 + #109 - the bodyweight sync invariant.** `gh pr diff 103`, then `gh pr diff 109`.
   User.bodyweight is now a mirror of the newest entry, kept in sync under a user-row lock;
   #109 is the race the reviewer caught (POST trusted "stamped now = newest").
3. **#104 - what the coach now knows.** `gh pr diff 104`. Input-side only: goals with
   progress, stalled lifts, the deload recommendation. The adjustments output contract is
   untouched (verdict CLEAN) - but the coach's advice will now reference goals, so read the
   prompt addition.

**Skim:** the README/media refresh in the write-up PR (new screenshots + re-recorded GIFs
showing the current product; demo seed extended with bodyweight/goal/readiness data).

> The L8 backstop is now proven twice: independent post-merge review found one REAL defect
> in #95 and four across #103/#105. Author self-review keeps missing what independent eyes
> catch in one pass.

---

## 2026-06-11 - fifth batch (#115/#116/#117): three CLEAN verdicts, first zero-defect batch

Merged: #114 (ideate log), #115 (one-tap deload week - migration + progression + API),
#116 (ask the coach mid-session - live session context in the chat payload), #117 (Hevy
CSV import on the hardened pipeline). All three were flagged for post-merge independent
review (L8) and all three came back CLEAN - the first batch with zero REAL defects. Also
the first batch under the model-routing directive (Fable implements, Opus reviews).

**Read first, in order:**

1. **#115 - the deload precedence rule.** `gh pr diff 115`. suggestNextWeight now has a
   planned-deload branch that pre-empts progression AND readiness adjustments (one 10%
   step-down, never stacked). This changes what weight the app tells you to lift - the
   reviewer verified every branch, but it is core training behavior, worth your eyes.
2. **#116 - what the chat can see now.** `gh pr diff 116`. A sessionId query param attaches
   your live workout to the chat payload; two independent ownership gates (page + API),
   foreign ids degrade to null. The structured contracts are byte-identical.
3. **#117 - the import surface doubled.** `gh pr diff 117`. New Hevy parser + shared
   executor refactor; the Strong path is pinned byte-identical by a regression test and
   the rate-limit bucket is genuinely shared across both routes.

**Skim:** #114 and this write-up. **Follow-up filed:** #118 (latent doc-vs-validation
contradiction on negative assisted loads - unreachable today, option-A doc fix specced).

> Screenshots note: none of the four captured pages (home/progress/generator/catalog)
> visibly changed in this batch (the new surfaces live in the session runner, the chat,
> and settings), and the GIFs were re-recorded yesterday - so per the media rule (refresh
> on visible change; clips max ~3 batches lag) the media stands as-is at 1 batch of lag.

---

## 2026-06-12 - the conditioning batch (#137-#139, fix #141): cardio becomes first-class

Merged: #137 (cardio sets: additive migration, Zod cross-field rule, logging UI, offline
path), #138 (importers map cardio rows), #139 (conditioning card), #141 (the one REAL
review finding: coach payload no longer counts cardio as strength signals), plus #132
earlier (docker-smoke CI job, reviewed CLEAN). This is the first batch on the broadened
training/fitness vision. All three feature reviews ran on Opus per the model-routing
directive; the #137 reviewer ran the flow live (logged 30:00 / 5 km on a production
build and read it back) and threw adversarial Zod probes; the #138 reviewer wrote 8
extra adversarial import probes - all passed.

**Read first, in order:**

1. **#137 - the schema and the exclusion contract.** `gh pr diff 137`. Two nullable
   columns + a CARDIO enum value, and the promise that cardio NEVER pollutes lifting
   math - verified exclusion-by-exclusion (stats, records, goals, MEV/MRV, stalls).
   This contract is what every future conditioning feature builds on.
2. **#141 - the one place the contract leaked.** `gh pr diff 141`. weekSummary fed
   cardio to the LLM as phantom 0-volume lifts; now excluded, pinned by an
   integration test. Proof the L8 review lane still earns its cost (4 batches, 6 REAL
   findings, all caught before users).
3. **#138 - untrusted cardio numbers.** `gh pr diff 138`. Duration/distance bounds
   shared with the API schema, applied after unit conversion; strength dup-keys pinned
   byte-identical.

**Skim:** #139 (display-only card; review CLEAN with two cosmetic NITs: the pre-existing
local-vs-UTC ISO-week doc mismatch repo-wide, and the warmup-only-cardio empty card),
this write-up (incl. demo seed gaining 23 deterministic cardio sessions + fresh
screenshots).

---

## 2026-06-12 (later) - sixth batch (#148/#149/#150): export round-trip, coach conditioning, supersets

Merged: #148 (cardio columns in the CSV export), #149 (dedicated conditioning section in
the coach payload), #150 (supersets slice 1: builder pairing + A1/A2 session flow). All
three independent Opus reviews: CLEAN - the first zero-finding batch. The #150 reviewer
proved the flow live on a production build (pair -> A1 badge -> log -> auto-advance to A2
-> Next cycles back) and exhaustively checked the no-trap navigation property; the #149
reviewer additionally scanned for injected code after a zombie-writer episode (clean).

**Read first, in order:**

1. **#150 - the superset structure.** `gh pr diff 150`. One nullable column; ALL
   semantics derive on read in lib/supersets.ts. This is the foundation later slices
   (shared rest, circuits) build on - worth understanding the renumber-on-read model.
2. **#149 - what the coach knows now.** `gh pr diff 149`. Conditioning aggregates join
   goals and fatigue in the payload; output contract byte-identical.
3. **#148 - the export contract.** `gh pr diff 148`. Two trailing columns; existing
   column positions pinned by test.

**Process note:** lesson L11 (zombie writer after a crashed tick - stop the dead task
before relaunching; see lessons.md) and the L3 reminder that background ticks must poll
CI in-process landed this cycle.

---

## 2026-06-12 (evening) - seventh batch (#156/#157/#158 + fixes #162/#163): the research-grounded cycle

This cycle started with an operator-funded research refresh (~26 searches; see Memory
research-product-direction) that found the hybrid-athlete white space, the Garmin API
lockout, and "explainable memory beats autonomy" - and the batch implements exactly that:
#158 TCX file import (the wedge feature vendors cannot copy), #157 per-day conditioning +
interference guidance, #156 the coach-context transparency card. Post-merge: #158 CLEAN
under a genuinely hostile security review (the reviewer bypassed the DOCTYPE check and
proved it inert - no entity decoding exists; 5MB adversarial inputs parse linearly);
#157 CLEAN; #156 had ONE REAL finding - the footer claimed the AI never receives raw
rows, which is false (week summaries carry per-set data) - reworded to the truth in #162.
The thrice-flagged local-vs-UTC week-helper skew was fixed for all consumers in #163.

**Read first, in order:**

1. **#158 - the hand-rolled TCX extractor.** `gh pr diff 158`. Read lib/import/tcx.ts
   with the security review's findings in hand: security-by-construction (no entity
   table) rather than by filtering. Remaining advisory nits are #161.
2. **#162 - the one-line trust fix.** `gh pr diff 162`. What the AI actually receives,
   stated truthfully. If you read one diff, read this one - it is the product's promise.
3. **#157 - what the coach can now reason about.** `gh pr diff 157`. Daily cardio next
   to dated strength sessions; prose-only interference advice.

**Skim:** #156 (display-only card), #163 (UTC getters, 2-line change, suite verified
under TZ=America/New_York for the first time), this write-up (demo seed gains a superset
pairing; all four clips re-recorded at the staleness cap).

---

## 2026-07-15 - batch #278/#279: aerobic decoupling + GymCoach-native CSV import

Merged: #278 (aerobic-decoupling readout on imported cardio, display-only), #279
(GymCoach-native CSV history import through the shared hardened import pipeline). One
hard-guardrail-1 breach this batch (an intermediate commit hit `main` directly from a
shared working tree; reverted forward and re-shipped as #279 - see the autonomy-log entry
and lesson L15).

**Read first, in order:**

1. **#279 - the new import path and the shared-planner change.** `gh pr diff 279`. Highest
   risk x impact: an untrusted-input parser (`lib/import/gymcoach-csv.ts`) plus a new
   ownership-scoped API route (`app/api/import/gymcoach/route.ts`) plus an ADDITIVE change
   to the shared planner/executor that also feeds the Strong and Hevy imports
   (`lib/import/strong-import.ts`). Read for two properties: (a) the Strong/Hevy paths stay
   byte-identical (pinned by the new `strong-import.test.ts` cases), and (b) the parser
   un-escapes the export's formula-injection guard only for the round-trip and does not
   re-introduce an injection sink. Security lens already READY; this is the diff to
   understand fully.
2. **#278 - the decoupling math.** `gh pr diff 278`. `trackDecoupling()` in `lib/cardio.ts`:
   midpoint split, per-half efficiency = speed / mean HR, null-guards for degenerate tracks.
   Display-only (a server component on the history detail page), no schema/API change, so
   lower risk - but worth a skim to confirm the null-when-unsupportable behavior and that no
   lifting metric is touched.

**Skim:** this write-up (CHANGELOG + README decoupling bullet, lesson L15, the
06-orchestration "one worktree each" rule). The #272-#276 fork stack is untrusted and NOT
merged - do not review it as loop work; it awaits human vetting.

**Media note:** the history detail page gained the decoupling readout, but it is not in the
captured screenshot set (home/progress/generator/catalog + the 4 flow GIFs), so no shot is
due for it. The recorded GIFs (dated 2026-06-12) now lag several feature batches; none of
the new cardio/import work is a clip scenario, so this is noted as lag, not a blocker for a
docs tick - a periodic re-record is due soon.

---

## 2026-07-22 - progress photos (#281) + a human-directed fork adoption (#272)

Merged since the last digest: **#281** (progress photos, loop-authored) and **#272**
(localization + a security hardening, a concurrent session's fork adoption confirmed by the
operator). Read these first, highest risk x impact:

1. **#272 - the security-relevant slice of the fork adoption.** `gh pr diff 272`. This is
   EXTERNAL code (author `SHAREN`, a fork) merged by a concurrent session and kept by operator
   decision - so it deserves your eyes more than loop-authored work, not less. Focus on the two
   files that are not translation strings: `lib/auth.ts` (session cookies now `Secure` by
   default in production, with a `SESSION_COOKIE_SECURE=false` opt-out - confirm the opt-out is
   the only escape hatch and that HTTP self-hosters get a clear default) and
   `app/api/programs/from-template/route.ts` (rerouted through `buildProgramFromGenerated` so
   instantiating a template can no longer overwrite user-authored exercise metadata - confirm
   that reuse is faithful). The `messages/en|ru/*` catalogs are low-risk string data.
2. **#281 - the file-upload surface.** `gh pr diff 281`. Highest intrinsic risk of the two by
   design (a new upload endpoint + local file storage + an additive migration). Two independent
   skeptics (correctness + security) already returned READY, but if you read one loop diff this
   batch, read this: the sniffer (`lib/progress-photo.ts`, magic-byte allowlist as sole type
   authority + `resolveInsideStorageDir` containment), the capped streamed read and 404-no-oracle
   ownership routes (`app/api/progress-photos/**`), and the additive migration. Non-blocking
   hardening is tracked in #282.

**Skim:** this write-up (CHANGELOG Added: progress photos + localization, Security: cookie
default; README features/roadmap; lesson L16; autonomy-log). The remaining SHAREN PRs
#273-#276 are untrusted and NOT merged - do not review them as loop work; they await human
vetting.

**Media note:** the Progress page gained a photos card, but it renders an empty state until
demo photos are seeded (`scripts/seed-demo-history.ts` has none yet), so no screenshot re-shoot
is worthwhile until the demo seed carries a couple of photos - noted as a small demo-media
follow-up, within the staleness cap.

## 2026-07-27 - backup gym import (#290) + progress-photo storage hardening (#291)

Merged since the last digest: **#290** and **#291** (both loop-authored, from follow-up issues
the previous batch's reviews filed), plus **#288** (docs thanking the fork contributor) and
**#289** (CI: more headroom for the Docker smoke job on a cold cache). Read these first:

1. **#291 - the file-storage security surface.** `gh pr diff 291`. It changes the containment
   check that every photo read, write and delete goes through (`lib/progress-photo.ts`): the
   textual `startsWith` check now has a `realpath` companion resolved against the deepest
   existing component of the target. Read it for the case where the storage dir itself does not
   exist yet (containment then compares two identical ancestors - intended, nothing to escape)
   and for the delete-ordering swap in `app/api/progress-photos/[id]/route.ts`, which trades
   "row gone, file orphaned" for "file gone, row retryable".
2. **#290 - the restore path.** `gh pr diff 290`. Backup restore runs in one transaction over a
   user's whole dataset, so a change to what it accepts is worth a look: gym weight arrays are
   now parsed with the same schema the gym API uses (which also means `z.coerce.number()`, so a
   numeric string in a hand-edited file is now accepted rather than rejected), and duplicate gym
   names are skipped instead of aborting the restore. Both are covered by an integration test
   that was confirmed to fail without the fix.

**Skim:** this write-up (CHANGELOG Fixed + Security, README uploads paragraph, lesson L17, the
new `CLAUDE.md` note on re-running the E2E tier), #288 and #289.

**Media note:** still no re-shoot. The captured pages HAVE drifted since 2026-06-18 (the catalog
and logger now show exercise technique media, the Progress page has a photos card), so the
screenshots are the oldest debt in this repo - but the Progress card renders empty until the demo
seed carries photos, so the shoot is worth doing once, after `scripts/seed-demo-history.ts` seeds
a couple of demo photos. That is the next media tick, not this one; it is now at the edge of the
~3-batch staleness cap.

## 2026-08-20 - E2E signup IPs (#294), the pipeline fix that closes lesson L17

One PR merged since the last digest: **#294** (closes #292, filed by the previous batch's own
lesson L17). It is test infrastructure only - no product code, no schema, no prompts - but it
touches the **pipeline**, which is the high-priority tier of the rule above, so it is worth one
read:

1. **#294 - who the E2E suite looks like to the rate limiter.** `gh pr diff 294`. The five specs
   that sign up through the UI (auth, bodyweight, deload, goals, import) now each set a dedicated
   `x-forwarded-for` through `test.use({ extraHTTPHeaders })`, and three IPs that had been reused
   across API-signup specs were deduped. Read it for one thing: the fix moves the *tests* off the
   shared bucket and leaves `register:<ip>` (5 per 60s) exactly as users experience it - the gate
   was fixed at the test's assumption, not by loosening the product's limit. Worth knowing that
   the suite now depends on the app trusting `x-forwarded-for` in the E2E environment.

**Skim:** this write-up (CHANGELOG Fixed, the rewritten `CLAUDE.md` green-gate paragraph, the
resolution note on lesson L17, autonomy-log entry).

**Caveat to carry:** back-to-back E2E is green now, but bounded - on CI (`retries: 2`) a single
flaky spec can spend three of its bucket's five registers. And #283 (two concurrent `verify.sh`
runs contending on :5434/:3031, lesson L16) is untouched and still open; do not read #294 as
having fixed that one.

**Media note:** nothing user-visible shipped this batch, so no screenshot or clip work is owed by
it. The pre-existing debt stands unchanged: the captured pages have drifted since 2026-06-18 and
the re-shoot is still waiting on `scripts/seed-demo-history.ts` seeding a couple of progress
photos. It is now past the edge of the ~3-batch staleness cap and should be the next media tick.

## 2026-08-20 - five-PR batch: MCP hardening (#296), plate fallback (#297), infra lock (#298), ideation (#305), muscle heat map (#306)

Merged since the last digest: **#296** (closes #287), **#297** (closes #285), **#298** (closes
#283), **#305** (the ideate batch record for #299-#304) and **#306** (closes #299). All five are
loop-authored, all five passed CI 5/5 and an independent pre-merge review, and two of those
reviews found a real defect that was fixed on the branch before merge. Read these first:

1. **#296 - the externally reachable surface.** `gh pr diff 296`. This is the only diff in the
   batch that changes what a remote party can do: `lib/mcp/cors.ts` decides which `Origin` the
   MCP endpoint echoes and whether the transport's DNS-rebinding protection is armed. Read it for
   the opt-in semantics (unset envs preserve today's open behavior, so an existing deployment is
   not silently hardened *or* silently broken), for CORS keying off `MCP_ALLOWED_ORIGINS` alone
   while `MCP_ALLOWED_HOSTS` only arms rebinding protection, and for `Vary: Origin` being sent on
   the deny branch too (without it a shared cache can serve a deny to a later allowlisted
   origin). The `get_training_context` email drop is one line and needs no review time.
2. **#298 - the gate protecting every other gate.** `gh pr diff 298`. A bug here silently
   weakens or hangs the green-gate itself. Read the lock lifecycle: `exec 9>`, non-blocking
   attempt, wait notice, `flock --wait 3600`, and `9>&-` on both `npm` invocations so the lock fd
   does not survive into a test child. The `9>&-` is the review finding - without it a zombie
   next-server holds the lock for its whole lifetime while the waiter blocks forever.
3. **#297 - the settings write race.** `gh pr diff 297`. The restored card is plain UI, but the
   review finding is worth reading as a pattern: two components that each hydrate a copy of one
   `localStorage` blob and write `{...ownState, key: value}` back will clobber each other's edits
   as soon as the second one exists. Both writers now re-read before writing. The symmetric
   regression test is the part to check.
4. **#306 - the money shot.** `gh pr diff 306`. Additive display-only UI on the progress page, so
   it ranks last by risk, but it is the batch's visible feature: `lib/muscle-map.ts` maps weekly
   working sets per muscle group to heat levels through the SAME `classifyWeeklySets` /
   `resolveVolumeBand` path as the volume-landmarks card (so the two cards can never disagree),
   and nothing feeds back into progression. Skim the mapping table for muscle-group coverage;
   `OTHER` is deliberately unpainted.

**Skim:** #305 (the ideation record) and this write-up (CHANGELOG Added/Fixed/Security, the README
feature bullet and roadmap line, the L8 reinforcement and L16 resolution note, the `CLAUDE.md`
concurrency paragraph, autonomy-log).

**Carry forward:** #300-#304 (recap poster, strength level badges, GPX route drawing, year-long
training heatmap, PR celebration) remain in the backlog, unimplemented.

**Media note:** the progress page changed visibly this batch and the muscle heat map is the money
shot for both a screenshot and a clip - neither was captured here (this tick does not launch the
app). The re-shoot is now the highest-value media debt: `progress.png` predates the photos card
AND the heat map, and no committed clip shows either. Next media tick should seed a couple of
demo progress photos in `scripts/seed-demo-history.ts`, re-shoot the progress page, and re-record
the progress scenario in one pass.

## 2026-09-04 - three parallel dev ticks: FK index (#334), dropped-equipment notice (#335), catalog card (#336)

Merged since the last digest: **#332** (French locale, the operator's own branch), **#334**
(closes #325), **#335** (closes #326) and **#336** (closes #330). The last three are
loop-authored, ran as three parallel worktree ticks, and each passed CI on its first run plus
an independent skeptic review. Read these first:

1. **#334 - the only schema change in the batch.** `gh pr diff 334`. A migration ranks top by
   rule, and this one has a wrinkle worth your eyes: it restores an index that a previous
   review told a contributor to delete (lesson L20), and it does so with `CREATE INDEX IF NOT
   EXISTS` because the original index was removed by editing an already-applied migration in
   place - so a database that applied the pre-review version still has the index while a fresh
   one does not. Check that you agree the guard is warranted here rather than a habit worth
   spreading: the general rule in this repo is still that an applied migration is immutable.
   The index itself is `[gymEquipmentId, completedAt]` on `Set`, and its reader is Postgres
   executing `ON DELETE SET NULL`, not any application query.
2. **#335 - core behavior on the offline path, plus one ownership test.** `gh pr diff 335`.
   Read `lib/sync.ts` first: the set POST is fire-and-forget through IndexedDB, so the
   server's "your equipment reference was dropped" answer can only be observed inside the
   background flush, and the fix is a subscriber (`onEquipmentDropped`) rather than a return
   value. Two things to check: that the local record is nulled on that path (otherwise the
   next set re-sends a stale id), and that the session-runner subscription filters by session
   id so a flush belonging to an older session cannot toast into the current one. The
   integration case added to `tests/integration/route-ownership.test.ts` is the security-
   relevant line - it pins the `gym: { userId }` scope on the equipment lookup, and the
   reviewer verified it fails when the scope is removed. Known gap, filed as **#337**, not a
   regression: with no `SessionRunner` mounted at flush time the record is still nulled but
   the user is never told.
3. **#336 - additive UI, ranks last, but read the screenshot-script change.** `gh pr diff
   336`. The card layout itself is presentation only (a 64x64 leading media slot,
   `line-clamp-2` on the name, a compact `equipmentTypesShort` label in en/ru/fr, actions on
   their own row below `sm`). The one line with reach beyond this PR is in
   `scripts/screenshots.mjs`: the pointer is now parked before each capture, because the
   "large grey box" the issue reported in the README was a ghost button's hover state under
   the resting mouse. That is a fix to the committed-media pipeline, so it affects every
   future shot.

**Skim:** #332 (a third message catalog, mechanically parallel to the existing two) and this
write-up (CHANGELOG Added/Fixed, the README feature/roadmap/credits lines, lessons L5 and L15
updated plus new L21, the `ship-pr` and `implement-issue` skill edits, the confirmed
parallel-dev pattern in `06-orchestration.md`, autonomy-log).

**Also worth ten minutes, and it is not a diff:** the answer posted on **#331** (SHAREN's
proposal to make MCP a first-class external-coach interface). It commits the project to an
ordering - token scopes before any write expansion, because `McpAccessToken.canWrite` is a
single boolean and widening what it authorizes would retroactively escalate every token
already issued. That is a design call with a security consequence, the issue is labeled
`needs-maintainer`, and it is yours to confirm or overrule before anyone writes PR 2.

**Carry forward:** #337, #338 (every seeded exercise is `equipmentType: OTHER`, so the new
label reads "Any equipment" everywhere) and #339 (a French comment in `tailwind.config.ts`)
came out of this batch's reviews and are unimplemented. #333 (printable A4 sheet, adopted
from #331), #324, #320 and #300-#304 still stand.

**Media note:** `catalog.png` was re-shot in #336 and inspected, and #329 refreshed the rest,
so the static screenshots are current. The recorded clips are not: none of them shows the
equipment picker or the muscle heat map, which makes the scenario re-record the oldest media
debt in the repo.

---

## 2026-09-11 - return-to-training follow-ups (#347) and the printable A4 sheet (#346)

Two merges: one change to the numbers the app tells you to lift, one new authenticated
route. Read them in that order - the second is additive UI, the first is core behavior.

1. **#347 - the return-to-training history read and load snapping (core behavior).**
   `gh pr diff 347`. Three things worth your eyes, in `lib/return-to-training-history.ts`
   and `lib/gym-loads.ts`. (a) The session read now takes
   `RETURN_LONG_TERM_ANCHOR_SESSION_LIMIT + RETURN_RECENT_SESSION_LIMIT` (8 + 14) rows and
   splits them by the recent-window predicate instead of taking 8 and hoping none of them
   are recent. The reviewer's derivation is the part to check, because it shrinks the claim:
   in any non-normal return mode at most one recent session exists, so the real gain is
   7 -> 8 long-term anchors, not a rescue from below the robust minimum of 3 - the case the
   issue feared was unreachable. What IS reachable, and is now pinned by a red-first
   integration test, is the comeback session displacing the oldest anchor. (b)
   `constrainGymWeight` is rebuilt on `gymWeightOptions`, so an `OTHER`-typed exercise with
   saved weight options now snaps to them in the ordinary progression path (the
   return-session ceiling already did) and the barbell ceiling is shared. Check that you
   agree with the blast radius: `OTHER` is the DEFAULT equipment type in this repo, which is
   why the same review filed **#348**. (c) The removed `nonComparableExerciseSessions` field
   was never populated by any caller, and the test that asserted on it hand-fed the value -
   worth one look to confirm it really was dead rather than a wiring bug.
2. **#346 - a new authenticated route (additive, but it is a route).** `gh pr diff 346`.
   The sheet builder (`lib/print-sheet.ts`) and the component are pure presentation, so the
   lines that matter are in `app/(print)/programs/[id]/print/page.tsx`: the program query is
   scoped `where: { id, userId: session.userId }` behind `requireSession()`, the `?workout=`
   parameter is Zod-parsed and anything that is not a non-empty id (including an empty
   value) is a 404, and the workout filter runs on the already-owner-scoped program rather
   than on a second lookup. The new `app/(print)` route group has its own layout, which is
   why `SyncBootstrap` is mounted there: the invariant is that it is live on every protected
   route, and a new route group silently opts out of it otherwise.

**Skim:** the i18n additions (`programs.print` in en/fr/ru, structurally pinned by the
existing catalog test), the `@media print` block in `globals.css` - noting that it is
app-wide, not scoped to the print route group, which is accepted for now - and this
write-up.

**Carry forward:** **#348** (OTHER-typed exercises inherit a linked item's stack through
`useItemWeights`, so a short inherited list can make the session stepper's `+` a dead
button) is the one issue this batch created. Still standing: #320, #300-#304, and the MCP
half of #331 (`needs-maintainer`). The rest of the previous wave's carry-forward (#337,
#338, #339) closed with #341-#343.

**Media note:** `docs/screenshots/print-sheet.png` was added this batch (a real print
capture of the seeded "Lower A" workout, looked at before committing). The recorded clips
are unchanged and now lag three shipped features - the equipment picker, the muscle heat
map and the print sheet - which is the oldest debt in the repo.

---

## 2026-09-13 - the second SHAREN wave: two merged (#350, #354), five open and waiting on you

Seven fork PRs from @SHAREN landed overnight. Two were small enough and clean enough to
auto-merge at the vetted tier (**#350** progress-photo paths, **#354** MCP date formatting);
both are one-line-shaped fixes, four review lenses each came back CLEAN, and neither needs
your eyes. The other five are **OPEN and yours to decide** - every one of them either sits on
a hard-block path or carries findings the review would not merge past. This digest is
therefore not a "what shipped" list; it is a **decision queue**, ranked.

**Read and decide, in this order:**

1. **#353 - locale switching (auth-adjacent, and it adds a public route).** `gh pr diff 353`.
   Two majors. (a) The new `POST /api/locale` sets the locale cookie's `Secure` flag from
   `x-forwarded-proto`, a client-controllable header - the value is a client input on any
   deployment where nothing strips or rewrites it. That directly contradicts the rule
   `lib/auth.ts:71-84` documents for the session cookie (env-driven, `SESSION_COOKIE_SECURE`,
   specifically so the flag cannot be derived from something unreliable). The locale cookie is
   not a credential, so the immediate impact is small; the **precedent** is the thing to rule
   on, because the next cookie written this way may not be a locale. (b) The route is public
   (`middleware.ts` is edited to let it through) and the body is not Zod-validated - it is
   `await request.json()` cast to a shape, so a literal `null` body reaches `body.locale` and
   throws, which is a 500 on an unauthenticated route rather than the 400 the repo's own
   convention (every API input validated with Zod) would give. Also worth a thought: this
   converts a Server Action into a plain public POST, which changes the CSRF story, and the
   spoofed-header case has no test.
2. **#356 - inline set editing (API validation gap + data integrity).** `gh pr diff 356`.
   The new `PATCH /api/sets/[id]` is correctly owner-scoped, but it drops two guards the POST
   path enforces (`app/api/sessions/[id]/sets/route.ts`): no finished-session check, and no
   `validateSetForCategory`. Through the raw API that means a finished session can still be
   edited and a CARDIO set can be given a 500x100 working-set shape. Three more: the
   pounds weight picker round-trips 100 -> 100.017 kg (untested, because every existing test
   runs in KG); the table's submit payload omits `gymEquipmentId`, which quietly bypasses the
   equipment snapshot #313/#325/#326 built; and the optimistic rollback can restore a queued
   row to status `syncing`, stranding it. Ownership, the schema `pick`, and the sync replay
   path were checked and are sound.
3. **#352 - PWA update refresh (a reload that can interrupt a workout).** `gh pr diff 352`.
   The update manager reloads a *visible* tab unconditionally when a replacement service
   worker takes over. Mid-session that drops the lifter back to exercise 1. The loop guard is
   per page lifetime, so it does not survive the reload it just caused. Separately, this PR
   adds `clientsClaim: true` to `next.config.js`, which widens a pre-existing hole: the
   `api-get` runtime cache is never purged on logout. That one is filed as **#357**
   (`needs-maintainer`, auth-adjacent) and is independent of whether you merge this PR.
4. **#351 - calendar history view (behavior regressions in an otherwise nice feature).**
   `gh pr diff 351`. `buildCsvHref` now takes a required `month`, so the CSV export is
   permanently month-scoped - the "export everything" affordance is gone. Day bucketing uses
   the **server process** timezone rather than the lifter's, the French week start is wrong,
   and some message keys are dead. Six E2E import specs are re-pointed at deep links; net
   coverage was checked and is equal, not reduced.
5. **#355 - live-session exercise strip (composition risk).** `gh pr diff 355`. Tapping the
   *current* tile during rest remounts the runner and loses the rest timer and auto-advance.
   Selection is keyed by `exerciseId` instead of `ProgramExercise.id`, so a program that uses
   the same exercise twice will confuse the two. It also overlaps #356 in
   `components/session/session-runner.tsx` and `messages/*/session.ts` - neither review saw
   the composition. **If you take both, take #356 first**, then rebase #355 on it.

**Trust the gate:** #350 (`path.join` -> `path.posix.join`, one line) and #354
(`toLocaleDateString` -> `useFormatter`, plus a regression test whose throwing-spy mechanism
was verified sound). Both merged, both low risk.

**Carry forward:** #357 (new, this batch), #348, #320, #300-#304, and the MCP half of #331.
The recorded clips still lag the equipment picker, the muscle heat map and the print sheet.

---

## 2026-09-14 - the SHAREN wave closed: the five hard-block PRs merged on your authorization

You said in session: *"Tu peux avancer et valider sans moi suivant tes recommandations, je te
fais confiance"* - so the five PRs this file handed you yesterday as a decision queue were
merged today with the verdicts' recommendations applied. That is a **delegated human
decision**, not a policy change: hard-block paths are still human-merge-only, and every merge
was a merge commit pinned to a reviewed SHA. Each PR got a maintainer fixup (except #356,
where the contributor had already closed every finding himself), each fixup got its own
independent delta re-review, and no contributor code ran on this machine - the gate ran in an
isolated container, integration and E2E in CI only.

Merged: **#352** (`d1875e4`), **#353** (`ad6431b`), **#351** (`7b408b6`), **#356** (`c8ec6ef`),
**#355** (`ffb16b1`), in that order. Yesterday's #350 and #354 close out the wave at 7/7.

**Read first, in this order:**

1. **#356 - inline set editing (new write route, transactions, goal re-derivation).**
   `gh pr diff 356`. The largest new surface of the wave and the only new API write path:
   `PATCH /api/sets/[id]`. Read it for three things. (a) The guards now mirror the POST path -
   owner scope, 404 on a foreign set, 400 on a finished session, 400 on strength fields against
   a CARDIO exercise - because a raw-API caller was the hole the review found. (b) The set
   update and the goal re-derivation run in **one serializable transaction**, with
   parameterized `FOR UPDATE` locks on the set row and on the `ExerciseGoal` row and a bounded
   three-attempt retry on `P2034`, so a corrected set can no longer leave a stale `achievedAt`.
   (c) The value math: the weight picker is canonical in kg, and `gymEquipmentId` is back in
   the submit payload so the equipment snapshot from #313/#325/#326 is not silently bypassed.
   Worth your eyes because it is a write path to your own logged data and because the
   correctness argument is a concurrency argument.
2. **#353 - locale switching (a new public route, and a cookie-flag precedent).**
   `gh pr diff 353`. This is the one the digest flagged as a precedent question yesterday, and
   the answer landed the conservative way: `cookieSecureFlag()` is now a named export of
   `lib/auth.ts` used by **both** the session cookie and the locale cookie, so the flag comes
   from `SESSION_COOKIE_SECURE` / `NODE_ENV` and never from a client-supplied
   `x-forwarded-proto`. The route is still public (login and signup pages must be able to
   switch language), so read the compensating controls: a Zod `z.enum(locales)` body, and a
   same-origin check replacing the origin check the Server Action got for free. The delta
   re-review is what caught that the same-origin check must take the **first** entry of a
   chained `X-Forwarded-Host` - the host the browser actually addressed - rather than the
   header whole.
3. **#355 - live-session navigation (state machine + a new page).** `gh pr diff 355`. Two
   things to check. The strip is **inert** unless the runner is in input mode: during rest or
   the summary it neither switches nor opens details, because opening navigates away and a
   remount would lose the rest timer and its pending auto-advance. And selection travels as
   `?programExerciseId=` - the `ProgramExercise` row id, not the exercise id - so a workout
   that programs the same movement twice keeps the two rows apart. The new
   `/exercises/[id]` detail page takes a `returnTo` that is regex-restricted to a session path
   (`safeSessionReturnPath`), which is the open-redirect question answered.
4. **#351 - calendar history (behavior regressions, now reversed).** `gh pr diff 351`. Read
   `lib/history-calendar.ts`: `buildHistoryCsvHref` takes only the program filter again, so the
   full-history CSV export is back and the displayed month is a view rather than an export
   scope; day bucketing goes through `dateKeyInTimeZone` with a `?tz=` param validated against
   an IANA-shaped pattern and a real `Intl.DateTimeFormat` probe, falling back to the server
   zone; the month query pads 36 h on each side so a zone shift cannot clip a day. The zone is
   carried on links and on the session detail page too - the second delta re-review caught
   that the detail page was still formatting in the server zone.
5. **#352 - PWA update refresh (can interrupt a workout).** `gh pr diff 352`. Small, but it
   reloads your tab. The fix defers on `/session/` routes and on a hidden tab, setting a
   pending flag instead, and guards against a reload cycle with a 30 s `sessionStorage` stamp
   that survives the reload it caused (the original in-page flag did not). Note what this PR
   does **not** fix: `clientsClaim: true` widens the pre-existing `api-get` cache-on-logout
   hole, still open as **#357** (`needs-maintainer`).

**Trust the gate (loop-authored, this PR):** the container-gate scripts, the policy paragraph
that documents them, lessons L28-L30, the CHANGELOG and README updates.

**Carry forward:** #357, #348, #320, #300-#304, and the MCP half of #331. **Media:** the
history calendar is now a captured page (`docs/screenshots/history.png`, and
`scripts/screenshots.mjs` opens the latest day with sessions so the frame is not an empty
rest day); home and progress were re-shot and reverted, because neither page changed this
wave and the fresh home capture happened to lose the coach-insight card, which only appears
when the demo seed's run date produces one. **Still in debt:** the recorded clips now lag four
shipped capabilities (equipment picker, muscle heat map, print sheet, and this wave's calendar
/ inline editing / exercise strip) - well past the ~3-batch cap, and the honest number to fix
next content tick.

## 2026-09-30 - the third SHAREN wave: eight PRs merged on your authorization, three decisions the loop took for you

You wrote in session that you left the new SHAREN PRs to the loop end to end. That was taken
as the in-session authorization for **this wave only**, hard-block PRs included - the same
kind of delegated human decision as 2026-09-14, not a policy change. Six of the eight touch a
hard-block path (`lib/mcp/**`, `prisma/schema.prisma` plus a migration, `messages/**`). Every
merge was pinned to a reviewed SHA; #366 was the one vetted-tier squash, the other seven are
merge commits. No contributor code ran on this machine (unit gate, one-off commands and the
integration tier all ran in isolated containers). Rollback tag:
`autonomy-baseline-2026-09-30`.

Merged, in order: **#366** (`ed6a333`), **#367** (`91b5293`), **#362** (`2bddb4b`), **#364**
(`5c5a784`), **#363** (`b0394aa`), **#365** (`8d74479`), **#368** (`0eb377c`), **#369**
(`3ac4203`). Open, maintainer-authored: **#383** (closes #382, the minor follow-ups).

**Decide first - three product decisions the loop took under your delegation.** Each is
reversible; each is the loop's call, not yours, until you confirm it.

1. **#363 keeps the contributor's semantics: the in-session actions edit the saved
   program.** `gh pr diff 363`. Replace / add / remove change the program, not only today's
   session; the copy now says so and a replace always confirms. A session-scoped override
   (change today only) was not built. If you wanted "today only", that is a new feature, not
   a fix.
2. **MCP write consent stays one toggle, relabelled "Allow changes to saved data".**
   `gh pr diff 362` and `gh pr diff 368` (settings copy and `docs/chatgpt-mcp.md`). Both PRs
   widened what a write-enabled token can do - gym inventory and workout history, on top of
   programs - and neither said so; the loop made the widening explicit in the label, the
   description and the docs rather than split the scope. **#375** (`needs-maintainer`) is the
   real fix: separate write scopes need a migration and a default for existing tokens, and
   that default is your call.
3. **#368: the external image URL mode was removed from the MCP tool.** A prompt-injected
   client could otherwise plant a URL that later clients are handed. Over MCP an image is now
   uploaded bytes or cleared; the REST route keeps its URL mode (and #383 adds a test for it).

**Read next:**

4. **#362 - MCP equipment backfill (migration + a new write path to history).**
   `gh pr diff 362`. The new audit table and migration, the ownership guards (now tested - no
   test would have failed if they were removed before the fixup), the never-overwrite rule on
   apply, and the undo's "every affected set still matches" check.
5. **#381 - the CI image mirror.** Not a diff yet, an issue: 10 of 18 CI attempts this wave
   were reruns for `toomanyrequests: Data limit exceeded` on the ECR public mirror of
   `postgres:16-alpine`. The mirror was L2's fix for Docker Hub limits; it now fails about
   half the runs. Choosing the replacement registry is a CI change, so it is yours.

**Trust the gate (lower risk):** #366, #367, #364, #365 (UI, each fixed up and delta-reviewed),
#369 (read-only index); in this PR, `scripts/container-integration.sh`, lessons L31-L36, the
policy and `ship-pr` edits that graduate them, the CHANGELOG and README.

**Carry forward:** #375-#381 (filed this wave), #383 open, #357, #348, #320, #300-#304, the
MCP half of #331. **Media:** no captured page changed, no re-shoot; the recorded session clip
is now stale against the picker, actions menu, metric columns and barbell diagram.

---

## 2026-10-07 - rest timer controls, copy as text, and the first unvetted PR the loop merged on its own

Merged: **#420** (@Retsumdk, unvetted, gym-loads fix), **#421** (rest timer pause, -15/+15 s,
end-of-rest flash), **#422** (copy a finished workout as text). In this PR: your 2026-10-07
standing delegation, written into the trust policy.

**Read first:**

1. **This PR's policy edit.** `docs/loops/10-external-contributions.md` (the top, the trust
   tiers and "Outcomes by tier"), plus the aligned lines in `CLAUDE.md`, `07-autonomy.md`,
   `CONTRIBUTING.md` and `.claude/skills/ship-pr/SKILL.md`. Check that it says what you meant:
   the loop now merges an unvetted PR only when all three passes are clean and it adds value;
   hard-block paths and any blocking, major or security finding still stop at a verdict. It is
   the widest change to the loop's authority since 2026-08-27.
2. **#420 - the first merge you did not click.** `gh pr diff 420`. Small and core
   (`itemStackStopsApplying` in `lib/gym-loads.ts`, its call in `upsertOwnedGymEquipment`).
   Read it as a spot check of the new path, not because it looks wrong. No backfill: configs
   already cleared by the old rule stay cleared, because nothing records whether an option list
   was inherited.

**Decide:** whether to add `Retsumdk` to the vetted list (proposed in `autonomy-log.md`; two
clean merged PRs, #385 and #420).

**Trust the gate (lower risk):** #421 and #422 (additive UI, a device-local setting, a pure text
formatter, each fixed up after one skeptic review), the CHANGELOG and README lines.

## 2026-10-09 - the first vetted-tier merge, the duplicate-exercise rule, and a bodyweight goal

Merged: **#425** (@Retsumdk, first PR under the vetted tier, POST refuses a duplicate exercise),
**#427** (the same rule on PUT replace, MCP add and the program editor), **#428** (bodyweight
goal line, with a migration). #424 (Retsumdk added to the vetted list) is covered in the
2026-10-07 digest.

**Read first:**

1. **#428 - schema and backup format.** `gh pr diff 428`. An additive migration
   (`User.bodyweightGoalKg`, nullable) and backup v6 in `app/api/backup/route.ts`: check that a
   v5 backup still imports and that the profile route only writes the goal when it is sent.
   Rollback tag `autonomy-baseline-2026-10-09`.
2. **#427 - a write rule on four paths, and what it deliberately does not cover.**
   `gh pr diff 427`. Read the PUT check in `app/api/program-exercises/[id]/route.ts` (it fires
   only when the exercise changes, so legacy duplicates stay editable) and note that program
   generation keeps repeats on purpose (5/3/1 BBB). The real bug, one set pool per exercise in
   the live runner, is still open as #429. Small nit for whoever touches it next: the header
   comment of `tests/integration/program-exercise-duplicate-paths.test.ts` still says
   generation "keeps the first occurrence", which the reverted dedupe no longer does.
3. **#425 - the first vetted-tier merge.** `gh pr diff 425`. Fifteen lines; read it as a spot
   check that the 409 sits after both ownership checks.

**Process:** L38 - two review subagents ran `git checkout` in shared trees this run. The rule is
now in `ship-pr` and `06-orchestration.md`; worth a glance that it reads the way you want.

**Trust the gate (lower risk):** the bodyweight card UI and its i18n strings, the editor's
exercise filter, the CHANGELOG and README lines.

## 2026-10-13 - MCP error mapping, favourite exercises, duplicate and save as workout, and the hard-block split

Merged: **#432** (@Retsumdk, vetted, `lib/mcp/**`: one guard maps Prisma errors for every MCP
tool; merged by the loop on your in-session instruction), **#434** (the remaining Prisma
error classes), **#435** (favourite exercises, with a migration), **#436** (duplicate a
program or a workout, save a finished session as a workout). In this PR: your 2026-10-13
extension of the delegation, written into the trust policy, and `"root": true` in
`.eslintrc.json`.

**Read first:**

1. **This PR's policy edit.** `docs/loops/10-external-contributions.md` ("Extension
   2026-10-13" at the top, then "Hard-block paths" split into group A and group B, pass 1 and
   "Outcomes by tier"), plus the aligned lines in `CLAUDE.md`, `07-autonomy.md`,
   `CONTRIBUTING.md` and `.claude/skills/ship-pr/SKILL.md`. Check the group boundaries are the
   ones you meant: group A (auth, MCP, `lib/api.ts`, rate limit, MCP tokens, bulk-data
   routes, LLM and prompts, Prisma schema and migrations, locale modules) is loop-mergeable
   with both security lenses clean and a rollback tag first; group B (CI, scripts,
   `.claude/`, the charter, container, ignore and env files, `middleware.ts`, manifests,
   executable configs, `.coderabbit.yaml`) stays yours to merge. Two choices the loop made
   that you may want to reverse: external code touching either group is never run locally,
   container included; and an adopted external issue whose implementation touches a
   hard-block path is still a human task.
2. **#432 + #434 - the MCP error surface.** `gh pr diff 432`, then `gh pr diff 434`. Read
   `lib/mcp/errors.ts` whole (about 55 lines): every tool goes through `guardToolHandler`,
   Prisma errors become fixed wording or "Server error.", anything else passes through
   unchanged so the server's deliberate messages still reach the client. Worth a glance:
   that no handler in `lib/mcp/server.ts` is registered without the guard.
3. **#435 - schema and backup format.** `gh pr diff 435`. One additive column
   (`Exercise.isFavorite`), `PATCH /api/exercises/[id]` scoped by `userId` in the `where`,
   backup v7 in `app/api/backup/route.ts` (check a v6 backup still imports). Rollback tag
   `autonomy-baseline-2026-10-13b`.
4. **#436 - three new write routes.** `gh pr diff 436`. Read `lib/programs/duplicate.ts`:
   every read is scoped to the owner inside one transaction, and save-as-workout checks the
   target `programId` too. The copy-by-omission in `lib/programs/copy.ts` copies any future
   `ProgramExercise` column automatically, which is the intent but worth knowing.

**Process:** L39 (merge `main` into a sibling after a shared-type merge, now in `ship-pr`), L40
(new `[param]` routes join the ownership ratchet, now in `implement-issue`), L41 (nested
worktrees need `"root": true`, fixed in `.eslintrc.json`).

**Trust the gate (lower risk):** the catalog star UI and its focus handling, the duplicate
and save-as-workout buttons, the i18n strings, the CHANGELOG and README lines.

## 2026-10-13 (afternoon) - roadmap slices: baseline, merge gate with review records, test database bootstrap

Merged: **#438** (your roadmap and overview), **#439** (run records and the baseline),
**#443** (usage and estimated cost from local transcripts), **#442** (SHA-pinned merge gate),
**#449** (structured review records required by the gate), **#441** (`verify.sh --full`
starts and migrates the test DB), **#447** (unit tier under load, L42), **#445** (CI Postgres
from a digest-pinned cached image, closes #381), **#448** (git guard hook, merged on your
confirmation), and your launch videos **#440** and **#444**. In this PR: L43, L44, roadmap
status line.

**Read first:**

1. **#442 + #449 - the merge path itself.** `gh pr diff 442`, then `gh pr diff 449`. Read
   `automation/publish/gate.ts` whole: it is now the only route to a merge in `ship-pr`, so
   a bug there either blocks every merge or lets one through. Check `evaluateReviews` (latest
   record per reviewer, all ready; edited or broken records refuse) and `MAINTAINERS` in
   `automation/publish/checks.ts` (numeric user ids). Know the two stated limits: the gate
   runs with the caller's own token, and it proves a review record exists for the commits,
   not that the reviewer was independent (the loop posts records from the account that
   authors its PRs).
2. **#445 - CI pipeline.** `gh pr diff 445`. `.github/actions/start-postgres/action.yml`
   replaces the service containers in three required jobs. Check the digest pin and the
   image-ID check before `docker run`; a cache entry written on `main` is read by every PR,
   forks included.
3. **#441 - a script that runs `prisma migrate deploy`.** `gh pr diff 441`. Read the URL
   guard in `scripts/test-db.sh` and its cases in `scripts/test-db.test.sh`: it is what
   stops the step from migrating anything but `localhost:5434/gymcoach_test`. Note the
   pinned compose project `gymcoach-test`, shared by every checkout on the machine.
4. **#448 - merged on your "Merge it".** `gh pr diff 448`. It adds a PreToolUse hook to
   `.claude/settings.json` that runs before every Bash call of every agent session in this
   project. Subagents are refused HEAD-moving git in checkouts they do not own; the main
   session is refused only in another session's worktree; untagged stash commands are
   refused for everyone; `GYMCOACH_GIT_GUARD=off` at launch disables it. Run
   `node automation/hooks/guard-git.cjs --self-test` if a Claude Code upgrade seems to
   change hook inputs.

**Process:** L43 (prove a shared-state change from a second checkout, now in
`implement-issue` and `ship-pr`), L44 (review a control through the control and ask whether
one actor can clear another's stop, now in `ship-pr`).

**Trust the gate (lower risk):** #439 and #443 (maintainer tooling, never imported by the
app, outputs checked for private strings), #447 (a formatter cache with a cache-key test),
the CHANGELOG, README and roadmap lines.

## 2026-10-14 - usage ledger, local limits, evidence page, eval containment (#468 left open)

Merged: **#451** (run-time usage ledger hook), **#452** (eval harness, paid agent
disabled), **#454** and **#456** (heavy-work slots, subagent dispatch limit, 60 min idle
window), **#457** (`docs/loops/evidence.md`) and **#455** (eval containment, closes #453).
Filed: **#468** (the two known canary bypasses). In this PR: L46 and its `ship-pr` rule,
roadmap status, evidence page update, two README minors from #456's review.

**Read first:**

1. **#455 - what the paid agent would run inside.** `gh pr diff 455`. You decide when
   `PAID_AGENT_ENABLED` flips, so read `evals/maintainer/README.md` "Residual risks" and
   the comment above `PAID_AGENT_ENABLED` in `evals/maintainer/runner.ts` first: the
   credential copy is readable by the agent and the model API is reachable, and grading
   validity rests on a tripwire with two known bypasses (#468). Then `egress-proxy.cjs`
   (the only network exit) and `isAgentWritable` in `runner.ts` (what is copied from the
   agent). Precondition before any paid run: #468 closed or its risks accepted by you, the
   credential risk accepted, a budget set, and a diff review of the agent's patch.
2. **#451, #454, #456 - hooks in every session.** `gh pr diff 454`, then `gh pr diff 451`.
   Both add hooks to `.claude/settings.json` that run in every Claude Code session in this
   project. `dispatch-limit.cjs` can refuse Agent calls (it fails open on errors; a crashed
   subagent can hold one of the three places for up to 60 minutes, see
   `automation/README.md`); `record-usage.cjs` writes outside the repo and records no text.
   Switches: `GYMCOACH_MAX_SUBAGENTS=off`, `GYMCOACH_USAGE_LEDGER=off`,
   `GYMCOACH_HEAVY_SLOTS=off`.
3. **#452 - the Docker Desktop finding.** No diff to read for it, but a setting to check:
   the review showed `host.docker.internal:2375` answering as the unauthenticated engine
   API from inside a container. If "Expose daemon on tcp://localhost:2375 without TLS" is
   still ticked in Docker Desktop, any container on this machine can control Docker.

**Process:** L46 (a hardening race has a budget: after three consecutive reviews with a
new bypass, state the remaining rounds, then narrow claims, file the rest, keep the
capability off), now in `ship-pr` step 4.

**Trust the gate (lower risk):** #457 (a docs page, every number copied from the baseline
report), the `heavy-slot.sh` self-test, the CHANGELOG, roadmap and evidence lines.

## 2026-10-19 - base-stale gate, changelog fragments, MCP bodyweight and limits, repeated-exercise blocks

Merged: **#470**, **#472** (weights-only equipment save), **#474** (repeated-exercise
blocks, migration), **#473** (gate runs in the ledger), **#477**, **#485** (MCP bodyweight),
**#476**, **#486** (last-done line), **#481**, **#483** (base-stale gate, record
carry-over), **#488** (coach context per block), **#487** (logout cache purge), **#489**
(`/mcp` body cap, write rate limit), **#491**, **#492** (changelog fragments), **#446**
(docs). Triage: open issues cut to 20 or fewer, parked ideas in #484. In this PR: changelog
fold, playbook (03, 04, 05, evidence), the cap in the `triage` and `ideate` skills, README,
#473's wording minors.

**Read first:**

1. **#481, #483 - what lets a review survive a merge of `main`.** `gh pr diff 481`, then
   `gh pr diff 483`. Read `automation/publish/base-update.ts`: it decides when a ready
   record still counts after the head changed. A false "pure update" lets unreviewed code
   merge on an old record, so check the `.gitattributes` rule and the absent-base case.
2. **#477, #485 - an unvetted contributor in `lib/mcp/**`.** `gh pr diff 477`, then
   `gh pr diff 485`. A write tool on user data, merged by the loop on clean security lenses
   with a rollback tag (`autonomy-baseline-2026-10-19`). Check the confirmation gate and
   the bodyweight lock and re-sync in `lib/bodyweight-record.ts`.
3. **#489 - `/mcp` request handling.** `gh pr diff 489`. The body is now read by the app
   before the SDK sees it (`lib/mcp/limits.ts`); a mistake there is a denial of service or
   a parse bypass on the external entry point.
4. **#474 - a migration and the progression input.** `gh pr diff 474`. `Set.block`
   (nullable, additive), backup format v8, and `getLastPerformances` keyed per block: the
   numbers the next suggested load comes from.
5. **#487 - logout on a shared device.** `gh pr diff 487`. Which caches are deleted and
   which offline sets are kept (`lib/pwa-cache.ts`, `lib/sync.ts`).

**Trust the gate (lower risk):** #476, #486 (one text line, day counting with DST tests),
#470, #472 (narrow route with integration tests), #488 (additive payload field, negative
control in the PR), #473 (local ledger, fail-open), #491, #492 (tooling, unit tests), the
docs here.
