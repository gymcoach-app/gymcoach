# Autonomy log

Append-only journal of autonomous runs. Newest first. Each entry: what was decided and
why, what shipped, what was challenged by subagents, what was deferred to a human. Governed
by the charter in [`07-autonomy.md`](07-autonomy.md).

---

## 2026-10-01 - First PR from @Retsumdk (#385, closes #348): unvetted tier, merged under operator authorization

**Context.** A new external contributor opened #385 against the `good first issue` #348
(OTHER-typed exercises silently inherited a linked item's weight stack). Unvetted tier, so
the execution gate applied in full: nothing from the branch ran on the host, CI was the only
executor. CI sat in `action_required` (GitHub's first-contributor approval); the loop
approved the run, which is the designated sandbox.

**Passes.** Pass 1: 3 files (`lib/gym-equipment.ts`, `lib/gym-loads.ts`, its test), no
hard-block path, head pinned at `6983952`. Pass 2: four independent lenses (backdoor /
egress, test-weakening, correctness and conventions, threat model), each handed the concrete
questions the diff raised (does the `exercises` select carry `equipmentType`, which
integration fixtures omit a type and therefore default to OTHER, what does the
`equipmentTypeChanged ? []` branch do per transition). Unanimous: no blocker. Lens (b)
verified the contributor's claim that every integration fixture through the sync path pairs
matching types. Lens (c) found the one real MINOR: the type-change wipe now fires for
exercises the stack never applied to. Pass 3: all five CI jobs green on the pinned SHA.

**Merge.** The operator authorized the merge in session ("if it helps, merge it"), as for
#341-#343; squash pinned with `gh api -X PUT .../merge -f sha=` so authorship is kept.
Verdict posted as a PR comment; the four MINORs went to maintainer follow-up #386 per the
bounded-rounds rule (**L34**), not to a fixup round on the fork. README thanks and
CHANGELOG credit in this PR.

**Challenged.** Nothing non-unanimous. The contributor's "no backfill of existing rows"
decision was accepted as stated and parked in #386 rather than asked of them.

**One metric.** 1 external PR, 1 merged, 0 host executions of contributor code, 4 lenses,
1 follow-up issue.

---

## 2026-06-16 - Three display-only slices: exercise cue in the logger, weekly frequency, e1RM loading table (#224/#225/#226)

**Context.** Maintainer tick, three additive DISPLAY-ONLY product slices, serialized by ascending
size (each PR merged before the next branch was cut). All three authored by JulienAu, trust-gated
(login allowlist + collaborator check HTTP 204). Inherited model this cycle (Fable unavailable). None
touched schema, API, or the LLM contract; each shipped colocated tests and passed `bash scripts/verify.sh`.

**Decided / shipped.**
- **#224 (PR #228, merged on green).** Surface `Exercise.notes` as an always-visible muted "cue" line
  under the exercise header in the session set logger (`components/session/exercise-card.tsx`), so the
  form reminder is there exactly while logging. Read the source first: the full exercise row (with
  `notes`) was ALREADY threaded through the session-runner serialized shape via
  `ProgramExercise & { exercise: Exercise }`, so NO serialization change was needed (the issue allowed
  for it but it was unnecessary). The card already rendered `exo.notes` behind a collapsed "Notes /
  mind-muscle cue" toggle; this adds the always-visible line on top, leaving the per-set quick-note
  field and the collapsible block unchanged. Component tests cover with-notes / without-notes / cardio.
- **#225 (PR #229, merged on green).** New pure `weeklyFrequencyByMuscleGroup` in `lib/stats.ts`:
  distinct training days (UTC calendar days with >= 1 working set hitting the group) per muscle group
  per ISO week. Deliberately mirrors `weeklySetsByMuscleGroup`'s ISO-week bucketing and warmup + cardio
  exclusion so frequency reads consistently with the volume card. Surfaced as "Nx/week" on each Volume
  landmarks row, for the EXACT week the card already displays (page picks the frequency point matching
  `latestCompletedWeek.weekKey`), so volume and frequency describe the same week. Reuses the
  `weeklySetsRaw` query already on the page. Unit tests: two sets same day = 1, two days = 2, warmup +
  cardio excluded, empty week = 0.
- **#226 (PR #N, this entry rides here, merged on green).** New pure `computeLoadingTable` in
  `lib/loading-table.ts`: default percentages (95..60%) of an exercise's best e1RM, each rounded to the
  NEAREST loadable increment (2.5 kg / 5 lb) in the display unit (round-to-nearest, distinct from the
  warm-up ramp's round-DOWN, since a planned working load reads best on the closest plate jump). The
  e1RM is stored in kg and is bodyweight-adjusted for bodyweight movements (consistent with the rest of
  the page); the dashboard converts to the display unit before deriving so rounding lands on real plate
  jumps. Rendered as a collapsible native `<details>` "Training loads" table on the selected exercise's
  progress view, hidden entirely when the exercise has no e1RM (empty list). Unit tests pin the
  percentage->load math in kg and lb, the round-to-nearest behavior, the no-e1RM empty case, and a
  custom percentage set.

**Challenged.** No review subagent was spawned this run (nested run). Per the charter's backstop these
are flagged for an OPTIONAL light post-merge correctness review by the orchestrator; all three are
pure additive display-only derivations with no production-contract surface, so the risk is low. Self-checked
that each new test is non-vacuous (e.g. the frequency test distinguishes distinct-day counting from a
raw set count; the loading-table test distinguishes round-to-nearest from round-down).

**Production bugs surfaced.** None. No unexpected schema/contract need arose; scope held to display-only.

**Deferred.** Nothing.

---

## 2026-06-15 - Test-only hardening: de-flake readiness check-in + pin last-performance derivation (#219/#220)

**Context.** Maintainer tick, two test-only issues, serialized (PR #222 MERGED before the #220 branch
was cut). Both authored by JulienAu, trust-gated (login allowlist + collaborator check HTTP 204).
Inherited model this cycle (Fable unavailable). Pure test changes with no production diff, so the
post-merge independent-review backstop does NOT apply; the discipline that did apply was "never weaken
a test to make it pass" - both PRs assert the REAL contract, read from source first.

**Decided / shipped.**
- **#219 (PR #222, merged on green).** The readiness check-in unit test "submits a partial soreness map
  and a note" intermittently timed out (default 5s) when the full unit suite runs in parallel under CPU
  contention (WSL2); green in isolation and in CI where tiers run separately. Fix is test-only:
  `userEvent.setup({ delay: null })` in the shared `openForm` helper (drops user-event's artificial
  per-keystroke/per-click timer, the actual stall) plus a 15s timeout on the single heaviest case as
  belt-and-suspenders. The component is untouched and every assertion is byte-for-byte unchanged.
  Verified by running the file x3 in isolation and a full `verify.sh` - no timeout.
- **#220 (PR #N, this entry rides here, merged on green).** Added colocated `lib/last-performance.test.ts`
  pinning the pure derivation that `tests/integration/last-performance.test.ts` only covered through a
  real DB. `getLastPerformances` reads `@/lib/db` directly (no pure-function seam), so the unit test
  mocks `@/lib/db` with a small in-memory fake that HONORS the `where`/`orderBy` the function builds -
  warmup exclusion, exclude-session, and most-recent selection are exercised through the real query
  construction, not re-implemented in the assertions. Covers: strength max-load + reps-at-max-load +
  raw set list; warmup exclusion; exclude-session vs latest; cardio totals (duration/distance SUMMED,
  HR AVERAGED+rounded over ONLY the rows that recorded one - the (150+170)/2=160 case rules out a sum
  or an over-all-rows average), null-HR and missing-distance edge cases, multi-exercise resolution, and
  no-history (absent from map, no crash). Bodyweight: documented + asserted that the derivation returns
  the raw stored `Set.weight` (effective-load is a consumer concern in `lib/stats`, not applied here).

**Challenged.** No review subagent was spawned, but these are pure test additions with no production
surface, so the charter's post-merge backstop is not triggered. Self-checked that the assertions are
non-vacuous (the HR-average pin would fail against a sum or a /N-over-all-rows implementation).

**Production bugs surfaced.** None. The derivation behaves exactly as the new tests assert.

**Deferred.** Nothing.

---

## 2026-06-15 - Coach records, custom volume targets, AI-parsed set logging (#212/#211/#210)

**Context.** Maintainer tick, three feature issues, strictly serialized by ascending size (each PR
MERGED before the next branch was cut). All three authored by JulienAu, trust-gated (login allowlist
+ collaborator check HTTP 204). Inherited model this cycle (Fable unavailable) - fine. Two of the
three are complex (an LLM-payload change, a schema+migration+API+UI change, and an untrusted-LLM-
output feature), so the reinforced complex-feature controls applied: full local gate + tests at every
touched layer + fresh rollback baseline before the migration. **Could not spawn review subagents this
run**, so per the charter's "no independent reviewer" backstop these PRs merged on a green FULL gate
and are FLAGGED here for post-merge independent review.

**Decided / shipped.**
- **#212 (PR #214, merged on green).** Feed the AI coach the all-time records. New
  `CoachPayload.records` via the SAME shared `lib/records.ts` `exerciseRecords` derivation the
  progress board uses (full history, effective load, cardio excluded at the query, warm-ups excluded);
  capped to the most-recently-trained exercises (`COACH_RECORDS_CAP = 20`), per-record dates dropped
  to stay compact. Input-side only: a short prompt addition tells the coach to reference and celebrate
  a PR and NEVER invent a record, and records never go in `<adjustments>`. The `<adjustments>` contract
  tests pass UNMODIFIED. Demo provider's canned debrief now references a record. Integration tests pin
  the bests (heaviest-set vs best-e1RM on different sets), cardio exclusion, cross-user isolation, and
  empty-for-a-fresh-user.
- **#211 (PR #215, merged on green).** User-settable weekly volume targets (personal MEV/MRV per
  muscle). Additive `VolumeTarget` table (unique per user+muscle, cascade delete) - absent rows fall
  back to the 10/20 defaults, so existing users are unaffected. Zod-bounded (`mev >= 1`, `mrv > mev`,
  max 40), ownership-scoped GET/POST/DELETE `/api/volume-targets` (every handler scoped to the auth'd
  user by construction). `classifyWeeklySets` stayed PURE - new `resolveVolumeBand` merges the user's
  targets with the defaults (and ignores an internally inconsistent stored band) and the page passes
  the resolved band in. Card shows each group's active band and custom-vs-default; inline
  `VolumeTargetEditor` dialog edits mev/mrv with reset-to-default.
  - *Migration discipline:* additive migration validated on the test DB the way CI does -
    `prisma migrate reset` (all migrations from scratch) + `prisma migrate diff` -> "No difference
    detected". Fresh rollback baseline `autonomy-baseline-2026-06-15` tagged + pushed on main BEFORE
    the first migration merge. docker-smoke (which runs `migrate deploy` on a fresh DB) stayed green.
- **#210 (PR #<this>, merged on green) - THE LAST ROADMAP ITEM.** Free-text (AI-parsed) set logging.
  Opt-in "Parse with AI" button next to a free-text field in the set logger fills the form for the
  user to confirm - it NEVER auto-logs, and the deterministic shorthand path is untouched (normal
  logging never waits on the network). New `lib/prompts/set-parse-prompt.ts` (stable, cacheable) +
  `lib/schemas/set-parse.ts`: a NEW, SEPARATE parse contract (discriminated union strength|cardio)
  pinned by contract tests; the `<adjustments>` contract was NOT touched or reused. The model output
  is UNTRUSTED: `parseSetDescription` extracts JSON and Zod-validates against the set bounds, failing
  CLOSED (`{ ok: false }`) on no-JSON / invalid-JSON / out-of-range / refusal / wrong-kind, so the UI
  fills nothing and shows a "could not parse, try the shorthand" hint - never throws, never logs
  garbage. `aiParseSet` also swallows provider errors to null. Route `/api/sets/parse` is ownership-
  checked + rate-limited and returns `{ parsed: null }` (a 200, not an error) on a junk parse. Demo
  provider returns a canned strength/cardio parse (and the refusal sentinel for an UNPARSEABLE marker)
  so the no-key flow works. README roadmap box checked. Coverage: schema contract tests (valid shapes
  accepted, every junk/out-of-range path rejected, wrong-kind rejected), demo-provider tests, route
  integration (owner parse, cardio parse, `parsed: null` on refusal, NO set logged as a side effect,
  404 on another user's exercise, 400 empty, 401 unauth), component tests (fill-then-confirm, unit
  conversion, null-parse fills nothing, cardio-on-strength ignored), and an E2E (type free text ->
  Parse with AI -> field fills -> Log).

**Challenged.** Subagent review tool was unavailable this run, so per the charter the author's own
pass does NOT satisfy the challenge protocol. These merged on a green FULL gate (`scripts/verify.sh`
tiers run locally: lint/type/unit/build + integration on :5434 + E2E; full CI green incl. integration,
docker-smoke, and E2E). **FLAGGED for post-merge independent review:** multi-lens for #214 and #215;
multi-lens INCLUDING untrusted-model-output handling for #210 (the parse fail-closed paths, the
ownership/rate-limit on the route, and that no set is ever logged from a parse).

**Deferred.** Nothing blocked. Roadmap's last unchecked item (free-text AI set logging) is now done.

---

## 2026-06-14 - Direct test coverage: CSV reader + profile schema (#198/#199)

**Context.** Maintainer tick, two test-only coverage issues, strictly serialized (each PR MERGED
before the next branch was cut). Both authored by JulienAu, trust-gated (login allowlist +
collaborator check HTTP 204). Inherited model this cycle (Fable unavailable) - fine. Pure test
additions, no production code touched, so a post-merge independent review was not required; the
discipline instead was "read the source first, assert the REAL contract, never weaken a test, and
STOP + file if a test surfaces a genuine bug". No bug surfaced - both modules behaved exactly as
documented.

**Decided / shipped.**
- **#198 (PR #200, merged on green).** New `lib/import/csv.test.ts`: direct, adversarial coverage
  for the shared quote-aware CSV reader (the untrusted-upload parsing core, previously exercised
  only through the Strong/Hevy parser tests). 29 tests over `readCsvRecords` (quoted commas, quoted
  newlines spanning lines, doubled-quote `""` escapes, trailing/empty fields, CRLF vs LF vs lone-CR,
  blank trailing + mid-file lines, final record with no newline, 1-based `line` numbers), `asNumber`
  (ints/decimals/whitespace/empty->0/garbage->NaN, exponent passes, and the `Number.isFinite` guard
  so Infinity/NaN never leak a non-finite value), and `headerKey` normalization.
  - *Contract clarified:* the caps `IMPORT_CSV_MAX_BYTES`/`IMPORT_CSV_MAX_ROWS` are exported
    constants that `readCsvRecords` itself does NOT enforce - the format parsers do, against the
    reader's output. The test asserts the constant values and documents that the reader reads a
    row-cap-exceeding file in full (rejection is upstream), rather than asserting a cap the reader
    does not own. Verified empirically against the source before writing.
- **#199 (PR #<this>, merged on green).** New `lib/schemas/profile.test.ts` mirroring the existing
  `lib/schemas/*.test.ts` style: 34 tests for `profileUpdateSchema` - bodyweight 20-300 (19.9/20/
  300/300.1, decimals allowed), heightCm 100-250 (int-only), weeklyFrequency 1-14 (int-only), each
  edge accepted / just-outside rejected; all native-enum values accepted + junk rejected (Sex/
  TrainingGoal/WeightUnit), nullable-vs-optional split (unit is optional-not-nullable); coachNote at
  vs over `COACH_NOTE_MAX_LEN` with length measured after trim; displayName trim + min-1 + max-80;
  unknown keys stripped (default Zod object).
  - *Contract clarified:* an all-whitespace `coachNote` trims to `""` at the schema level; the
    null-coercion is the route's job (per the schema comment), so the test asserts `""` here, not
    null. Verified empirically before asserting.

**Challenged.** Test-only PRs with no production behavior change -> no subagent review per the run
directive. The substitute discipline (read source, assert real contract empirically, never weaken)
was applied; both green-gates passed (`bash scripts/verify.sh`: prisma generate + lint + typecheck
+ unit + build) and full CI was green (lint/type/unit, integration, build, E2E, docker-smoke).

**Deferred.** Nothing. No production bug surfaced.

---

## 2026-06-13 - Records board, superset rest timer, coach note (#190/#189/#188)

**Context.** Maintainer tick, strictly serialized by ascending size (each PR MERGED before the
next branch was cut). All three issues authored by JulienAu, trust-gated (login allowlist +
collaborator check HTTP 204). Inherited model this cycle (Fable unavailable) - fine, proceeded.
Repo is on Next.js 15 / React 19; followed the existing async-request-API patterns.

**Decided / shipped.**
- **#190 (PR #192, merged).** A display-only Records board on the progress page: per strength
  exercise, the all-time heaviest working set (weight x reps + date) and the best estimated 1RM
  (Epley + date). New pure `exerciseRecords` in lib/records.ts, one bounded extra query over the
  user's full set history (category != CARDIO at the query, warm-ups excluded in the derivation),
  bodyweight effective-load applied by the caller like the rest of the page. Sorted
  alphabetically; ties keep the earlier date; the card hides until there is a record. Colocated
  unit tests (heaviest, best e1RM, ties, bodyweight, warmup/cardio exclusion, grouping, empty).
- **#189 (PR #193, merged on green --full).** Superset-aware rest timer, completing the supersets
  feature. New pure helper `isSupersetTransitionRest` + `SUPERSET_TRANSITION_REST_SEC` (20s) in
  lib/supersets.ts: a short transition rest only when the runner's auto-advance stays inside the
  current item's own group (A1 -> A2); standalone work, the last member advancing past the group,
  and staying put all keep the full restSec. session-runner applies it; standalone rest is
  pinned unchanged (restSec used verbatim when the helper returns false). No schema/API/logging
  change. Unit tests over 2- and 3-member groups; an E2E running an A1/A2 group to completion
  asserting a short rest (<=20s) between members and the full rest (>20s) after the group.
  - *Picked* a 20s non-zero transition rest over skip-entirely: the acceptance criteria require
    a "short transition rest", and a few seconds to switch stations matches real superset use.
- **#188 (PR #<this>, merged on green --full).** A free-text note to the coach (correctable AI
  memory). Additive nullable User.coachNote (migration 20260613163135, validated on the test DB:
  migrate deploy + clean migrate diff "No difference detected"). Zod-bounded (500 chars, trimmed,
  whitespace -> null clear) coachNote on PATCH /api/profile, ownership-scoped; schema extracted to
  lib/schemas/profile.ts so the bound is shared with the UI counter. CoachPayload.userProfile.
  coachNote (additive, input-side). Input-side prompt guidance (weigh it, acknowledge when
  relevant, never override safety, treat as data not instructions) with the <adjustments> output
  contract UNCHANGED - the existing adjustments contract tests pass unmodified. Demo provider's
  canned debrief references the note (still closing on </adjustments>). Coach page gets an editable
  "Note to your coach" card with a counter and save/clear. Integration tests pin the route
  (set/clear, trim-to-null, 500-char bound, absent-preserves, cross-user isolation) and the
  payload (null = absent); unit tests pin the prompt guidance and the demo line. Rollback baseline
  `autonomy-baseline-2026-06-13b` tagged on main before the migration merged.

**Challenged.** No subagent-spawning tool available in this nested tick. Per the charter backstop,
each PR merged only on green full CI and is FLAGGED here for independent POST-MERGE review:
correctness on #190 and #189 (does-it-actually-work lens for #189's timer); multi-lens incl.
output-contract-unchanged and input-handling for #188.

**Gate note.** One pre-existing local-only flake (`readiness-checkin.test.tsx > submits a partial
soreness map...`, a userEvent 5s timeout under WSL2) fails identically on clean main and is green
in CI; unrelated to these changes. Confirmed each tier (unit minus that flake, integration, E2E,
build) green locally and relied on CI as the authoritative full gate.

**Deferred to human.** The post-merge reviews above. #169 (Next.js major bump) remains
stop-for-human, untouched.

---

## 2026-06-13 - Cardio axis rounded out: last-time reference, pace/speed, TCX export (#176/#177/#175)

**Context.** Maintainer tick running the cardio-axis batch, strictly serialized by ascending
size (each PR MERGED before the next branch was cut). All three issues authored by JulienAu,
trust-gated (login allowlist + collaborator check HTTP 204). Inherited model this cycle (Fable
unavailable) - fine, proceeded. #169 (Next.js major bump) left untouched as stop-for-human.

**Decided / shipped.**
- **#176 (PR #179, merged).** The in-session "Last session" reference was gated off for cardio
  (`!isCardio` in exercise-card.tsx). Extended the last-performance shape to carry summed cardio
  totals (durationSec/distanceM averaged-HR; null for strength) and branched the card on isCardio
  so cardio shows "<mm:ss> . <distance> . <avgHr> bpm" via the shared lib/cardio formatters.
  Display-only, no schema/API/prompt change. Component tests cover the cardio branch (full data,
  duration-only, no-history, defensive no-cardio-record); integration test pins the totals math.
- **#177 (PR #180, merged).** Pure, unit-aware pace/speed derivations in lib/cardio.ts
  (paceSecPerKm, speedKmh, formatPace, formatSpeed) returning null on zero/absent distance - no
  divide-by-zero, no NaN/Infinity. Surfaced on the post-session summary recap and the history
  detail (totals + a per-set Pace column), in the user's unit (min/km+km/h metric, min/mi+mph
  imperial). Display-only. Colocated unit tests (metric/imperial/zero) + summary component tests.
- **#175 (PR #181, merged on green --full).** The outbound half of data ownership: GET
  /api/cardio/tcx?sessionId=... emits a minimal valid TCX 1.0 Activity (one Lap per cardio set),
  ownership-scoped exactly like the CSV export (foreign session -> 404; 400 on a non-cardio
  session or missing sessionId). Pure serializer lib/import/tcx-export.ts emits a FIXED minimal
  structure (no DTD/entities) and xmlEscapes the five XML metacharacters on every interpolated
  value; sport mapping is the inverse of the import's name<->sport. A "Download .tcx" action
  sits on the finished-session detail page, shown only when the session has cardio.
  - *Deviation noted:* the issue named app/(app)/session/[id] for the button, but that route
    redirects finished sessions to home; the session-detail surface that actually renders a
    completed session is app/(app)/history/[id], so the action landed there (the issue's clear
    intent - download a completed cardio session from its detail view).
  - Round-trip test (serializeTcx -> parseTcx) pins identical duration/distance/avgHr; xmlEscape
    unit tests cover all five metacharacters and a markup-injection attempt; integration tests
    pin ownership (404), cardio-only (400), missing-sessionId (400), and the round trip through
    the route. Complex change (new route + new surface), so ran verify.sh --full before the PR.

**Challenged.** No subagent-spawning tool available in this nested tick. Per the charter
backstop, each PR merged only on green full CI and is FLAGGED here for independent POST-MERGE
review: correctness lens on #176/#177; correctness + an XML-escaping/ownership lens on #175.

**Deferred to human.** The post-merge review above. #169 (Next.js major bump) remains
stop-for-human, untouched.

---

## 2026-06-12 (day) - Backup export/restore made complete (#168)

**Context.** Maintainer tick on issue #168 (author JulienAu, trust-gated: login allowlist
plus collaborator check HTTP 204): the backup route - the data-ownership wedge - silently
dropped everything added since it shipped. Data-integrity work, so the reinforced
controls applied: full local gate, tests at every touched layer, no migration needed
(purely additive).

**Decided / shipped.**
- app/api/backup/route.ts rewritten against a systematic schema inventory (now documented
  in the route header): export gains Set.durationSec/distanceM/avgHr,
  ProgramExercise.supersetGroup, Exercise.usesBodyweight (a fourth silent drop the issue
  had not listed), the profile incl deloadUntil, and the ExerciseGoal / BodyweightEntry /
  ReadinessCheckin / Conversation+Message models. VERSION bumped to 2; version 1 files
  keep importing (every v2 field/model is optional, defaulting to null/absent).
- Restore hardened as untrusted input: 50 MiB streaming byte cap (readBodyWithCap),
  bounds on every value reusing the writer schemas' limits (cardio caps, superset group
  range, profile ranges, soreness map), array caps, dates must parse (400 instead of a
  Prisma 500), enum fields validated with nativeEnum instead of the old `as any` casts.
  The transaction (still all-or-nothing) now also purges/recreates the new models.
- tests/integration/backup-route.test.ts: lossless round trip into a SECOND user
  (field-for-field, order-insensitive re-export comparison) with ownership assertions;
  a version-1-file restore; and adversarial cases - out-of-bounds value, non-JSON,
  missing confirmReplace, mid-transaction unique-violation rollback leaving prior data
  byte-identical, 50 MiB+ body (413), 20k+ array (400).
- Full local gate (verify.sh --full) before the PR.

**Challenged.** No subagent-spawning tool in this tick: per the charter backstop the PR
merged on green full CI and is flagged for independent POST-MERGE review - correctness
lens on the round trip and a security lens on the untrusted restore path.

**Deferred to human.** Post-merge review above. #169 (major-version dep bumps) remains
stop-for-human from the previous tick.

---

## 2026-06-12 (night) - TCX hardening nits land (#161); triage follows

**Context.** Maintainer tick. One implementation item: issue #161 (the advisory nits the
hostile security review of #158 suggested for the TCX importer). Author JulienAu,
trust-gated (login allowlist + collaborator check HTTP 204). Additive, no migration.

**Decided / shipped.**
- PR closing #161: lib/import/tcx.ts now strips XML comments before any scanning (indexOf
  single pass; an unterminated comment drops the rest, like a real parser), so a
  comment-smuggled <Activity> is never seen and a commented-out DTD is correctly treated
  as inert and accepted. The advisory DTD reject is tightened: after comment stripping,
  any "<!" not followed by a letter (null-byte-split <!DOCTYPE, <![CDATA[, bare <!>) is
  rejected as a malformed markup declaration. startedAt is clamped to 2000-01-01 .. now +
  1 day (small clock skew tolerated). New fixtures lock every verified behavior in:
  comment smuggling, commented DTD, unterminated comment, null-byte-split DOCTYPE,
  CDATA, exponent/hex/Infinity/NaN numerics (notation cannot bypass the bounds), the
  clamp boundaries, and a route-level re-confirm inside the duplicate window creating a
  deliberate second session while reusing the exercise.
- Full local gate (verify.sh --full) before the PR; PR #167 merged on green 5-check CI.

**Challenged.** No subagent-spawning tool available in this tick: per the charter's
no-self-certification backstop, the PR merged on green full CI and is flagged for an
independent POST-MERGE review (security lens - it touches the untrusted-XML parser).

**Deferred to human.** Triage ran after the merge (this amendment rides in a docs PR):
- Filed #168: the backup export/restore route silently drops everything added since it
  shipped (Set.durationSec/distanceM/avgHr, ProgramExercise.supersetGroup, and the
  ExerciseGoal / BodyweightEntry / ReadinessCheckin models) and has zero integration
  coverage - the L8 silent-data-loss class on the one route meant to prevent it.
- Filed #169 (STOP-FOR-HUMAN): npm audit reports 6 high / 1 moderate advisories, all
  fixable only by major bumps - next 14.2.35 needs >=15.5.16 for its runtime advisories;
  the eslint-config-next/glob and next-pwa/workbox chains are dev/build-time. Per the
  charter the loop must not auto-implement this; the issue records the decision needed.
- Not due / nothing to file: gate spot-check (last run 2026-06-11); permissions re-audit
  (hardened 2026-06-09; deny list re-read this run and intact - rm -rf, force-push
  variants, reset --hard, curl, wget all still denied; no allow-list scope creep found).

---

## 2026-06-12 (evening) - Seventh batch: research-grounded; one trust fix; UTC helpers settled

**Context.** The operator funded a deeper research pass this cycle (~26 searches, Opus).
It produced the hybrid-athlete/file-import direction and five recorded
anti-recommendations; ideate filed #152/#153/#154 from it; a Fable tick shipped them as
#156/#157/#158 (3/3 budget, baseline 2026-06-12b tagged, one E2E strict-mode fix).

**Decided / shipped.**
- Reviews (Opus): #158 CLEAN under hostile attack (DOCTYPE bypass proven inert, 5MB
  adversarial inputs linear, bounds airtight); #157 CLEAN; #156 one REAL - the
  transparency footer overclaimed privacy. Fixed same-day (#162). The thrice-flagged
  ISO-week local-time skew fixed for every consumer (#163, verified under a non-UTC TZ).
  TCX advisory nits filed as #161 (good first issue).
- Write-up: CHANGELOG/README (TCX import is the headline), backlog verdicts, demo seed
  superset pairing, all four clips re-recorded (staleness cap reached), demo redeploy.

**Challenged.** Three independent reviews, model-split. Accepted-change rate: 5 merged /
0 abandoned this batch (plus docs).

**Deferred to human.** Nothing. #161 awaits a normal pick-up; FIT/GPX import, maxHr, and
coach-context annotation are future slices.

---

---

## 2026-06-12 (third run) - Seventh batch ships: coach transparency (#154), interference awareness (#153), TCX import (#152)

**Context.** Maintainer tick executing the seventh ideate batch, strictly serialized by
ascending size, each PR merged on green full CI before the next branch was cut. All three
issues authored by JulienAu (trust-gated). No subagent-spawning tool available in this
tick, so per the charter's no-self-certification rule every PR merged on green full CI and
is flagged for an independent POST-MERGE review by the orchestrator.

**Decided / shipped.**
- PR #156 (Closes #154): "What your coach sees" transparency card on the coach page,
  collapsed by default. Display-only: the page calls the SHARED buildCoachPayload and a
  pure mapper (lib/coach-context.ts) reshapes it - no duplicated derivations, no prompt or
  payload change (payload tests untouched). Unit + component tests incl. fresh-user empty
  states. Fast gate green locally; CI green; merged. Post-merge review lens: correctness.
- PR #157 (Closes #153): per-day conditioning for hybrid interference awareness.
  `conditioning.days` (current ISO week, `{ date, minutes, km }`, zero days omitted -
  documented as the compact choice) via a new shared dailyConditioning derivation in
  lib/stats.ts over the already-fetched sets. Input-side prompt guidance only (flag hard
  cardio adjacent to heavy lower-body days, explain why, prose only); demo provider gained
  one interference line. Purely additive diff; the adjustments contract tests passed
  UNMODIFIED. Full gate green locally; CI green; merged. Post-merge review: multi-lens.
- PR #158 (Closes #152): TCX file import as one cardio session - the riskiest item
  (untrusted XML). Security bar implemented as specified: lib/import/tcx.ts is a minimal
  indexOf-based extractor over the narrow TCX shape, NOT an XML parser - no entity table,
  no entity decoding, so XXE and billion-laughs are impossible by construction; any
  `<!DOCTYPE`/`<!ENTITY` rejected outright; value/attribute scans capped; hostile fixtures
  in tests (internal DTD, external entity, entity bomb, truncated file, huge attributes,
  oversize). Decision documented in-module: no XML dependency added - a general parser IS
  the attack surface and the TCX subset needed is tiny. Additive Set.avgHr migration
  (bounds 40..250 enforced in the set schema, the sets route and the importer) validated
  on the test DB (migrate deploy + clean migrate diff); fresh rollback baseline
  `autonomy-baseline-2026-06-12b` tagged on main before merge. Route mirrors the hardened
  CSV imports: shared `import:userId` rate bucket, streamed body cap, dry-run preview with
  a +/-2 min near-duplicate warning, transactional confirm, ownership-scoped exercise
  reuse (409 on a non-cardio name conflict, nothing written). avgHr renders in the session
  detail; the conditioning card and coach payload pick imported sessions up automatically.
  Tests at every layer (parser unit incl. hostile, route integration, E2E
  upload -> preview -> confirm -> history detail). Post-merge review: SECURITY (mandatory).

**Challenged.** No in-tick independent reviewer could be spawned; the charter's backstop
applies - all three PRs are explicitly queued for post-merge independent review
(correctness #156, multi-lens #157, security #158).

**Deferred to human / next run.** The three post-merge reviews. FIT and GPX import are
later slices; maxHr deferred; TCX exercise picker (user-chosen target exercise) deferred -
the Sport-based default shipped.

---

## 2026-06-12 (later) - Sixth batch: zero-finding reviews; supersets land; two process lessons

**Context.** Sixth ideate batch (#144 export columns, #145 coach conditioning, #146
supersets slice 1) implemented across two ticks (the first died waiting on CI - lesson L3
relearned - and later re-woke as a concurrent writer during #145 - new lesson L11).

**Decided / shipped.**
- #148/#149/#150 all merged on green full CI; all three independent Opus reviews CLEAN -
  the first zero-REAL-finding batch. The #150 reviewer proved the A1/A2 flow live on a
  production build and exhaustively verified the no-trap navigation property; the #149
  reviewer ran an injected-code scan after the zombie episode (nothing foreign).
- Lessons graduated: L11 (stop a crashed tick before relaunching into the same checkout;
  06-orchestration.md gains the relaunch-after-crash rule) and the L3 reminder is now
  injected into tick prompts (poll CI in-process, never end a run "waiting").
- Write-up: CHANGELOG, README (supersets, coach conditioning, export round-trip),
  backlog verdicts, this entry. Captured pages unchanged (builder/session-runner are not
  screenshot subjects); clips within the staleness cap. Demo redeploy follows the merge.

**Challenged.** Two independent reviews, model-split. Accepted-change rate: 3 merged /
0 abandoned (plus 2 docs PRs).

**Deferred to human.** Nothing. Superset slices 2+ (shared rest, circuit timer), pace
analytics, and cardio drill-down stay un-filed for the next starved cycle.

---

---

## 2026-06-12 - Coach conditioning payload (#145) + supersets slice 1 (#146) shipped

**Context.** Maintainer tick executing the remaining two issues of the sixth ideate
batch, strictly serialized (PR merged before the next branch). Both issues authored by
JulienAu (trust-gated, collaborator-verified 204). PR #148 (#144, cardio CSV export) had
already merged.

**Decided / shipped.**
- PR #149 (Closes #145): dedicated `CoachPayload.conditioning` section -
  weekCurrent/weekPrevious `{ minutes, km, sessions }` plus the 150 min/week guideline -
  computed via the SHARED lib/stats.ts weeklyConditioning derivation over the
  already-fetched recent sets (no duplication). Input-side prompt guidance only; the
  `<adjustments>` output contract untouched and its tests passed unmodified. Demo
  provider's canned debrief exercises the section. Tests: prompt positioning, demo
  contract-closure pin, integration suite (aggregation, zero-cardio user -> zeros + null
  weekPrevious, isolation). Full local gate green before the PR; CI green; squash-merged.
- PR #150 (Closes #146): supersets slice 1, program-level only. Additive nullable
  `ProgramExercise.supersetGroup` migration validated on the test DB (migrate deploy +
  clean migrate diff); rollback baseline `autonomy-baseline-2026-06-12` tagged on main
  before merge. All user-facing semantics derive on read in the new pure lib
  (`lib/supersets.ts`): A1/A2/B1 labels, presentation order (group members consecutive),
  auto-advance alternation, Next-button cycling that never traps the user in an
  unfinished group. Builder gains pair-with-previous / unpair menu actions riding the
  existing PUT route (absent field preserves pairing, null unpairs - pinned). Logging
  semantics, rest timer, generation/templates/imports/coach payload untouched. Tests at
  every layer: 14 unit (derivations), schema bounds, route integration (persistence,
  absent-vs-null, ownership), new E2E pairing two exercises and running the A1/A2 flow;
  standalone flows pinned by the existing suite plus explicit pinned-behavior unit cases.
- One local typecheck red on the way (stale `.next` types; cleared) and one expected
  fixture fallout (ProgramExercise test fixtures gained `supersetGroup: null`) - no
  assertion weakened.

**Challenged.** No subagent spawning available in this nested run, so per the charter's
no-self-certify rule both PRs merged on green FULL CI (integration + E2E) and are flagged
for independent post-merge review: multi-lens for both, does-it-actually-work for #146.

**Deferred to human.** Nothing blocked. Later superset slices (shared-rest enforcement,
circuit timer, logging semantics, generation/template awareness) stay un-filed until a
starved cycle.

---

## 2026-06-12 - Conditioning batch reviewed (3x CLEAN + 1 fix); write-up + demo refresh

**Context.** The cardio foundation batch (#137/#138/#139) merged yesterday with the
no-reviewer flag; the three independent Opus reviews ran as the orchestrator's next
action.

**Decided / shipped.**
- Verdicts: #138 CLEAN (security; reviewer added 8 adversarial probes), #139 CLEAN
  (correctness; 2 cosmetic NITs noted), #137 CLEAN with ONE minor REAL finding - the
  coach payload counted cardio sets as working sets and emitted phantom 0-volume CARDIO
  "lifts". Fixed same-day as #140 -> PR #141 (merged on green incl. the new docker-smoke
  job), exclusion pinned by an integration test.
- The #137 reviewer satisfied charter control 6 by running the flow live (production
  build, logged 30:00 / 5 km, read it back, E2E spec green).
- Write-up: CHANGELOG, README features (cardio + conditioning card + importers),
  backlog verdicts, this entry. Demo seed extended with 23 deterministic cardio
  sessions; all four screenshots re-shot (progress now shows the conditioning card);
  demo redeploy via the deploy-demo workflow follows the merge.

**Challenged.** Three independent reviews, model-split (Fable implemented, Opus
reviewed). Accepted-change rate this batch: 5 merged / 0 abandoned.

**Deferred to human.** Nothing. Future slices stay un-filed until the next starved
cycle (pace analytics, conditioning in the coach payload, cardio drill-down).

---

## 2026-06-11 - Conditioning/cardio foundation batch shipped (#133, #134, #135)

**Context.** Maintainer tick executing the conditioning batch ideated on 2026-06-11, in
strict dependency order (each PR merged before the next branch was cut). All three issues
authored by JulienAu (trust-gated, collaborator-verified 204).

**Decided / shipped.**
- PR #137 (Closes #133): first-class cardio sets. Additive migration
  (`Set.durationSec`, `Set.distanceM`, `ExerciseCategory.CARDIO`) validated on the test
  DB (migrate deploy + clean migrate diff); rollback baseline
  `autonomy-baseline-2026-06-11b` tagged on main before merge. Cardio sets store
  reps = 1 / weight = 0 (normalized server-side), Zod bounds 1..86400 s / 0..1000 km,
  cross-field rule (duration/distance only on CARDIO exercises, duration required) in
  the API route. Session logger swaps weight/reps for mm:ss + km inputs; sets list,
  summary and history render `12:30 · 2.5 km`. Offline queue/sync/hydration carry the
  fields. Tonnage/e1RM/PR/progress/MEV-MRV math skips cardio sets explicitly; CARDIO
  excluded from the lifting selector. Catalog gains 4 cardio movements. Tests at every
  layer (unit, integration incl. pinned strength path, new E2E). One local full-gate red
  on the way: the new E2E spec's UI signup pushed the suite over the register limiter's
  5/min budget - fixed with the established per-spec X-Forwarded-For bucket pattern, not
  by touching the limiter.
- PR #138 (Closes #134): the Strong/Hevy importers map cardio rows onto the new fields.
  Qualifying condition is exactly the old skip branch; usable-duration rows import
  (meters/miles conversion per export unit), the rest keep the counted skip notice.
  Cardio-only new exercises are created CARDIO/OTHER. Dup keys byte-identical for
  strength, extended for cardio so distinct runs do not collapse. #105/#106/#108
  hardening untouched and re-pinned (strength-row shapes, dup-key format, caps).
- PR #139 (Closes #135): conditioning card on the progress page - pure
  `weeklyConditioning` derivation (8 zero-filled ISO weeks: minutes, km, sessions),
  Recharts bar chart with the WHO 150 min/week reference line, hidden until the first
  cardio set ever; strength charts untouched.

**Challenged.** Nested run, no independent subagent spawnable: per the charter's
backstop, all three PRs merged on green full CI (local `verify.sh --full` plus the
5-check CI including docker-smoke) and are flagged for post-merge independent review as
the orchestrator's next action - multi-lens (correctness + does-it-work) for #133,
security lens for #134 (untrusted file input), correctness for #135.

**Deferred.** Pace/speed analytics, conditioning in the AI coach payload, per-exercise
cardio drill-down, CSV history export of duration/distance - future slices, not filed
yet to respect anti-flood.

## 2026-06-11 - Docker smoke test in CI (#129) + first conditioning-axis ideate batch

**Context.** Maintainer tick after the vision broadening (#130/#131). One trusted open
issue (#129, author JulienAu, collaborator-verified) requesting a CI smoke test of the
production Docker image, because #127 (bcrypt prebuilds missing from the standalone
output) reached the live demo with all-green CI.

**Decided / shipped.**
- PR #132 (Closes #129): new required `docker-smoke` CI job - buildx build of the
  production image (GHA layer cache), Postgres on a dedicated network, the image started
  with the exact prod compose command (`migrate deploy` + `node server.js`), then three
  probes from the job: GET /login, POST /api/auth/register, POST /api/auth/login all 200.
  Default-decision substitution, documented in the PR: the probe account is created via
  the image's own register route instead of a host-side seed (covers bcrypt hash AND
  compare, Prisma writes, JWT, catalog seeding; no host npm ci, keeps the job lean).
- Birth-proof (L9 gate spot-check) run locally before the PR: with the #128 COPY lines
  reverted the probe fails (register 500, "No native build was found" from bcrypt); with
  the fix restored all probes pass. The net provably catches the #127 class at birth.
- First CI run hit the known ECR mirror transient ("toomanyrequests: Rate exceeded") on
  the smoke job's own pull; hardened with a bounded 5-attempt pull retry instead of a
  manual rerun. Second run all green, smoke job 2m39s warm (budget ~5 min). Merged on
  green full CI; main synced.
- Ideate batch (conditioning/cardio axis, per the broadened vision): filed #133
  (first-class cardio sets - additive Set.durationSec/distanceM + CARDIO category +
  logging UI, the foundation slice), #134 (importers map cardio rows onto the new fields
  instead of skipping; depends on #133), #135 (conditioning card on the progress page
  with a 150 min/week reference line; depends on #133). Recorded in ideas-backlog.md.
  Deliberately not filed: supersets (stays deferred), free-text AI set logging (not on
  the cardio axis; future batch), pace/speed analytics and coach-payload conditioning
  (later slices of #133-#135).

**Challenged.** Nested run, no independent reviewer spawnable: the #132 diff was
self-reviewed plus proven by the two-leg birth-proof and green full CI, and is flagged
in the run report for an independent post-merge review per the charter's no-reviewer
backstop (lesson L8).

**Deferred to human.** Nothing.

**Next.** Implement #133 first (it unblocks #134/#135), under the complex-features
controls (additive migration, full local gate, tests at every layer, multi-lens review).

---

## 2026-06-11 - Operator decision: product vision broadened beyond hypertrophy

**Context.** The operator decided (2026-06-11) that the product opens beyond pure
hypertrophy. The aim becomes: **the most complete self-hosted AI training/fitness app** -
strength, conditioning/cardio, endurance, mobility, and general fitness are all in scope.

**Decided / shipped.** Updated the two spots that carried the old wording:
`.claude/skills/ideate/SKILL.md` (three occurrences; the "The vision" item now records the
broadening and the concrete opening: the Strong/Hevy CSV importers currently SKIP cardio
rows and nothing tracks duration/distance work - that axis is now fair game) and
`docs/loops/08-ideation-loop.md` (one occurrence). Docs-only PR, no code change.

**Challenged.** Docs-only; merged on green CI per the charter (no independent review
needed for wording-only changes).

**Deferred to human.** Nothing.

---

## 2026-06-11 - Fifth batch: roadmap's last AI item shipped; first zero-defect reviews; model routing live

**Context.** Fifth ideate batch (#111 ask-the-coach mid-session, #112 one-tap deload,
#113 Hevy import) filed and logged (#114), implemented by a Fable background tick (PRs
#115/#116/#117, all merged on green full CI, budget 3/3, rollback baseline tagged before
the migration). First cycle under the operator's model-routing directive: Fable for the
implementing tick, Opus 4.8 for the three independent post-merge reviews.

**Decided / shipped.**
- All three post-merge reviews came back CLEAN - the first batch with zero REAL defects
  since the L8 backstop exists. Notable verifications: deload precedence on every branch
  incl. no-stacking; double ownership gate on the chat sessionId; shared import rate
  bucket and a byte-identical Strong path.
- The tick's flagged product concern (deload step-down on negative assisted loads) was
  requalified by the reviewer as a pre-existing, currently unreachable doc-vs-validation
  contradiction; filed as #118 with a default option-A (docs) resolution.
- Write-up: CHANGELOG, README features + roadmap (in-session AI suggestions checked;
  free-text AI set logging is the remaining open item), backlog, this entry. Media
  unchanged per the rule (no captured page changed; clips at 1 batch of lag).

**Challenged.** Three independent Opus reviews in parallel; all CLEAN. The quality
signal survived the model split - the cheaper review lane still verified empirically
(ran tests, checked diffs byte-level) rather than rubber-stamping.

**Deferred to human.** Nothing. #118 awaits a normal loop pick-up (option A specced).

---

## 2026-06-11 - Maintainer run: shipped #112, #111, #113 (fifth ideate batch)

**Context.** Maintainer tick over the fifth ideate batch, strictly serialized (lesson L7:
the next issue's branch is cut only after the prior PR is MERGED). All three issues
trust-gated (author `JulienAu`). All three are complex features under the 2026-06-10
directive: each ran `verify.sh --full` locally before its PR and shipped tests at every
touched layer (unit + integration + E2E). Merge budget 3; used 3.

**Shipped.**
- **#112 -> PR #115 (merged): one-tap deload week.** Additive nullable `User.deloadUntil`
  migration (validated on :5434: `migrate deploy` + clean `migrate diff`; rollback baseline
  `autonomy-baseline-2026-06-11` tagged on main before the merge). POST/DELETE
  `/api/deload` (strict-empty-object Zod body so no client-chosen duration; operates only
  on the caller's own row). New `'planned-deload'` suggestion reason: 10% step-down using
  the existing `READINESS_DELOAD_FRACTION`, precedence over a programmed increment and a
  readiness hold, never stacking with a readiness deload (one reduction, pinned by unit
  tests). Banner start/end buttons, session-runner badge + explainer, coach payload
  `fatigue.deloadActive` (additive; output contract untouched). One local gate red: an
  existing exact-shape payload test needed the additive field - acknowledged and updated
  with an extra active/expired case.
- **#111 -> PR #116 (merged): ask the coach mid-session.** "Ask the coach" button in the
  session runner -> `/chat?sessionId=...`. Chat payload gains the additive, compact,
  ownership-checked `currentSession` section (`buildCurrentSessionContext` returns null
  for a foreign/unknown id - the chat silently degrades). Prompt addition is input-side
  ONLY; every structured output contract is unchanged and the existing contract tests
  passed unmodified. Demo provider serves a canned in-session answer keyed on the quoted
  `"currentSession"` payload marker, and the Playwright web server now runs
  `LLM_PROVIDER=demo`, so the no-key flow is E2E-covered end to end (the canned answer
  streaming back proves the live context reached the provider). One local gate red: the
  suite's 6th parallel UI signup tripped the 5/min register rate limit - the new spec now
  registers via the API in its own X-Forwarded-For bucket (test-side fix; the limit itself
  is untouched).
- **#113 -> PR #117 (this PR): Hevy CSV import.** Second import format behind the same
  untrusted-input bar as #105: shared caps + RFC4180 reader extracted verbatim to
  `lib/import/csv.ts` (Strong parser tests pass unmodified), new `hevy-csv.ts` parser
  (set_type warmup/dropset mapping, both documented timestamp formats, lbs header variant,
  0-based set_index hardened against silent defaults), planner/executor generalized with
  optional flags/times that keep the Strong path byte-identical (pinned by a regression
  test), mirrored `/api/import/hevy` route (streamed body cap, shared rate-limit budget,
  dry-run preview, transactional confirm, duplicate skip), settings source-app selector
  (unit toggle stays Strong-only).

**Challenged.** No subagent-spawning tool exists in this environment, so the charter's
independence requirement could not be met in-run: each PR got an inline multi-lens review
pass by the author (correctness + does-it-actually-work; + security for #113) on top of the
green full gate, and per the charter all three merges are flagged for an independent
POST-MERGE review by the orchestrator as the next action. Findings worth recording from the
inline passes: the deload step-down on negative (assisted) loads reduces assistance (a
pre-existing semantic of the readiness deload, not a regression - candidate for a future
issue), and an active deload cannot be ended early from the progress page when the user has
no recent training data (bounded: it self-expires).

**Deferred to a human / next run.**
- Independent post-merge review of #115, #116, #117 (charter "Subagent challenge protocol"
  backstop, lesson L8).
- Possible product issue: deload semantics for assisted (negative-load) exercises.

**Context.** Maintainer tick over the fourth ideate batch, strictly serialized (lesson L7:
next issue only after the prior PR is MERGED). All three issues trust-gated (author
`JulienAu`, collaborator check HTTP 204). All three are complex features under the
2026-06-10 directive, so each ran `verify.sh --full` locally before its PR, shipped tests at
every touched layer, and validated its migration against the test Postgres. Merge budget 3;
used 3.

**Shipped.**
- **#99 -> PR #103 (merged): bodyweight tracking.** Additive `BodyweightEntry` migration
  (fresh `migrate deploy` + clean `migrate diff` on :5434), POST/GET/DELETE routes that keep
  `User.bodyweight` (the "current value" the app reads) in sync with the newest entry in one
  transaction, and a progress-page card (12-week trend chart, quick add in the display unit,
  deletable entries). Rollback baseline `autonomy-baseline-2026-06-10b` tagged on main
  before the merge. One local gate red (Playwright strict-mode: "Log" matched "Log out"),
  fixed with an exact-match selector.
- **#101 -> PR #104 (merged): goals + fatigue signals into the AI coach payload.** Additive
  `CoachPayload.goals` (per-exercise target, e1RM progressPct, achieved - same semantics as
  the progress page incl. effective load) and `CoachPayload.fatigue` (stalled lifts over the
  12-week window, deload recommendation with the same human-readable reason lines the
  banner shows, via the new shared `deloadReasonLine`). System prompt gained usage guidance;
  the `<adjustments>` OUTPUT contract is untouched and its existing tests passed unmodified.
  Demo provider debrief now exercises the new fields. Full gate green on the first run.
- **#100 -> PR #105 (this PR): Strong CSV import.** Pure quote-aware parser
  `lib/import/strong-csv.ts` treating the file as untrusted input (5 MB / 50000-row caps,
  no eval, Zod on every row with the set schema's bounds, per-line error collection, cardio
  rows skipped with a count, kg/lb toggle with header-suffix override), pure planner +
  transactional executor (case-insensitive exercise matching, missing exercises created as
  OTHER/ISOLATION via an additive enum migration, sessions grouped per (date, workout) at
  noon UTC, exact-duplicate skip for idempotence), rate-limited Zod-validated route with
  dry-run preview and confirm modes, settings UI (pick -> preview -> confirm with the error
  list), and tests at every layer incl. a transaction-rollback integration test and an E2E
  upload -> preview -> confirm -> history flow. Two local gate reds fixed: jsdom `File.text`
  (FileReader fallback) and the catalog-coverage test (OTHER intentionally has no catalog
  exercise).

**Challenged.** This tick ran in an environment without a subagent tool, so per the charter
(lesson L8 rule) the multi-lens reviews could NOT be executed independently pre-merge. Each
PR merged only on green full CI after an author self-review pass; all three are flagged in
the run report for an independent POST-MERGE review by the orchestrator as its next action
(correctness + does-it-actually-work for all three, plus a security lens on #100's untrusted
file input and route).

**Deferred to human / orchestrator.** The post-merge independent reviews above. Note for the
reviewer: imported sessions render as "Free session" in the history list (the Strong workout
name lives in the session notes) - a possible polish slice, not a defect.

---

## 2026-06-10 (evening) - Fourth batch shipped, reviewed, hardened; README + demo media catch-up

**Context.** The fourth ideate batch (#99/#100/#101, two of them deliberate re-evaluations
of pre-directive rejections) was implemented by a background tick (PRs #103/#104/#105, all
merged on green full CI, migrations validated, rollback baselines tagged). The tick again
had no subagent tool and flagged all three for post-merge independent review per L8.

**Decided / shipped.**
- Three independent post-merge reviews ran in parallel: #104 CLEAN; #103 one REAL (sync
  race window) + nits; #105 three REAL under the security lens (chunked-body bypass of the
  5 MB cap, 5 s transaction timeout vs multi-year imports, CSV formula-injection chain
  into the export).
- Fixes shipped same-day: #108 (import hardening + lib/csv.ts extraction) and #109
  (user-row lock + re-derivation, deterministic tie-break, 20-300 kg bounds), both with
  tests pinning the failure modes and merged on green full CI.
- Operator directive captured and graduated: README features/roadmap refresh EVERY
  user-facing batch; screenshots when a captured page visibly changed; clips periodically
  with a ~3-batch staleness cap. Codified in the write-up skill + 05-content-loop; this PR
  does the catch-up (features list rewritten, roadmap split, all 4 screenshots re-shot,
  all 4 GIFs re-recorded against a seeded demo with the new features visible - the demo
  seed now also creates bodyweight entries, a goal, and readiness check-ins).

**Challenged.** The L8 backstop is now proven twice (5 REAL defects caught post-merge
across #95/#103/#105 that author self-review missed). The directive's trade - complexity
allowed, controls scaled up - is holding: every defect was caught by the loop's own
controls before any user impact.

**Deferred to human.** Nothing. NITs not fixed are recorded in the review digest entries.

---

## 2026-06-10 (later) - Post-merge backstop review of #95; fix #97; batch write-up

**Context.** The background tick that shipped #94/#95 reported it could not spawn an
independent reviewer (no subagent tool in its environment) and had self-executed the
"multi-lens" pass for #95 - which the charter does not accept as the challenge. The
orchestrator ran the missing independent review post-merge as its next action.

**Decided / shipped.**
- Independent post-merge skeptic on #95 (commit cc33953): ownership, migration drift
  (clean `migrate diff` against a shadow DB), e1RM math, and the set-save best-effort path
  all verified sound; ONE real defect found - deleting the achieving set left a goal
  permanently "Achieved".
- Filed #96, fixed via PR #97 (merged on green; the integration job's first red was the
  known transient ECR `toomanyrequests` pull failure - re-run, then green): set DELETE now
  re-derives `achievedAt` from the remaining sets, same best-effort pattern as stamping.
- Write-up: CHANGELOG (deload banner, shorthand logging, exercise goals, the charter
  widening), ideas-backlog #88/#89/#90 -> shipped, review digest for the batch, lesson L8
  graduated into the charter (no-independent-reviewer case now has an explicit rule).

**Challenged.** The review WAS the challenge - and it proved the point: an honest
self-review by the author missed a lifecycle defect an independent reviewer caught in one
pass.

**Deferred to human.** Nothing. Three NITs from the review (capped progress display vs
achieved badge, stamping race, missing fetch error toast in the goal card) noted as
accepted risks; none is data-incorrect.

---

## 2026-06-10 - Maintainer run: shipped #89 (set shorthand) and #90 (exercise goals)

**Context.** Maintainer tick over the third ideate batch. Both issues trust-gated (author
`JulienAu`), implemented in order, each behind its own PR and CI run. Merge budget 3; used 2.

**Shipped.**
- **#89 -> PR #94 (merged): quick set logging via shorthand.** Pure parser
  `lib/set-shorthand.ts` (`100x8`, `100 8`, `100x8@9`, decimals, RPE 1-10) + a quick-entry
  field in `set-input.tsx` that fills the classic weight/reps/RIR fields. The app tracks RIR,
  not RPE, so `rpeToRir` maps RIR = 10 - RPE rounded, clamped to the API's 0-5. Weight read in
  the display unit via `fromDisplayWeight`. No API/schema change. 28 new unit/component tests.
- **#90 -> PR #95 (this PR): per-exercise target goals.** First feature shipped under the
  charter's "complex features" directive, so it carries the reinforced controls: additive
  `ExerciseGoal` migration (validated with `prisma migrate deploy` + `migrate diff` drift
  check against the seeded test DB), Zod-validated upsert/list/delete routes with ownership
  tests, pure `lib/goals.ts` (progress = best e1RM / target e1RM; achievement = working set
  meeting both axes, stamped deterministically with the achieving set's `completedAt`),
  effectiveWeight semantics for bodyweight exercises at every layer, goal card + dialog on the
  progress page, and tests at all touched layers including a full E2E flow
  (`tests/e2e/goals.spec.ts`: set -> track -> achieve -> remove). `verify.sh --full` run
  locally before the PR; rollback baseline `autonomy-baseline-2026-06-10` tagged before merge.

**Challenged.**
- #89: independent skeptic on the staged diff. Caught early in self-review: a regex
  backtracking trap (`100 89.5` would have parsed as reps 8 @ RPE 9.5) - fixed by requiring a
  separator before the RPE; the skeptic pass then surfaced two cosmetic findings (a misleading
  test name, fixed; keep-RIR-when-RPE-deleted judged the correct default).
- #90: multi-lens review (correctness + does-it-actually-work), findings recorded in the PR.

**Deferred to human.** Nothing blocking. Note for ops: the local Docker daemon was down at
run start; the loop started Docker Desktop itself to run the full gate.

---

## 2026-06-10 - Operator directive: complex features with reinforced controls; third ideate batch

**Context.** The operator widened the feature mandate in-session: complex features (data-safe
migrations, LLM output-contract changes, multi-surface work) may now ship without human
review when they are a clear product plus - compensated by MORE non-regression control, not
more approval. Codified in the charter's new "Complex features" section; the ideate skill
and `08-ideation-loop.md` updated to match. Unchanged: hard guardrails, untrusted-input
rules, and stop-for-human for destructive data migrations, auth/security, major dep bumps.

**Decided / shipped.**
- Closed external test issue #57 (already triaged "not planned" in-thread, left open by
  mistake).
- Third ideate batch filed: #88 deload-week recommendation (display-only derivation), #89
  set-logging shorthand parser (roadmap's natural-language logging, deterministic slice),
  #90 per-exercise target goals (additive ExerciseGoal table + Zod API + progress UI).
  Backlog logged via PR #91 (merged on green).
- Charter amendment shipped via PR (this entry rides along).

**Challenged.** Docs-only changes; the gate + a re-read of the security sections stood in
for a code skeptic. The trust-model sections were verified unchanged.

**Deferred to human.** Nothing; the directive explicitly removes the human from complex
feature review while keeping the security stop-list.

---

## 2026-06-09 - Second ideate batch (#80/#81/#82 via #84/#85/#86)

**Context.** The second batch of ideate-produced product features shipped autonomously; this
docs run is the content-loop tail that records it.

**Shipped this batch.** Three additive, derived-on-read features, no schema/migration:
- **#84 / #80 - personal records on the post-session summary.** Confirmed against
  `components/session/session-summary.tsx`: `computeSessionPRs` reuses `lib/records` `detectPRs`
  against a "since last session" baseline (prior-session sets + earlier sets this session), so a
  set is never compared with itself; warm-ups excluded; renders a "Personal records this session"
  card with heaviest-load / best-e1RM badges.
- **#85 / #81 - MEV/MRV volume landmarks.** Confirmed against `lib/stats.ts`:
  `WEEKLY_SETS_MEV=10`, `WEEKLY_SETS_MRV=20`, `weeklySetsByMuscleGroup` (working-set counts per
  ISO week, warm-ups excluded), and `classifyWeeklySets` (inclusive band -> BELOW_MEV / WITHIN /
  ABOVE_MRV). A "Volume landmarks" card on the progress dashboard; display-only.
- **#86 / #82 - stalled-lift detection.** Confirmed against `lib/stats.ts`: `isStalled` over a
  per-session best-e1RM series with `STALL_LOOKBACK_SESSIONS=3` and `STALL_TOLERANCE=0.005`
  (0.5%), never flagging with fewer than `lookback` sessions; a "Stalled lifts" card on the
  progress dashboard.

**Challenged / verified.** Docs-only, verification-first: every CHANGELOG/log claim was read out
of `components/session/session-summary.tsx` and `lib/stats.ts` (the constants, the band edges,
the lookback/tolerance) before writing it, not trusted from the PR summaries.

**Lesson harvested.** L7 - #81 and #82 both edited `lib/stats.ts` and the progress dashboard; the
two implement agents overlapped, so the second branch cut from a stale `main` and hit a merge
conflict (resolved by merging `main` in and keeping both additions). Graduated into the
orchestration decision order (`06`): serialize same-file queued issues, gated on the prior PR
actually merging - sharpening the existing "one writer per task" / "green separately, red
together" notes.

**Comprehension digest exercised.** The per-batch reading-list mechanism (#79) was used: the
digest ranks this batch modest and points the human first at the shared `lib/stats.ts` helpers
(`isStalled` / `classifyWeeklySets` / `weeklySetsByMuscleGroup`), with the additive cards to skim.

**Trust gate.** All three documented PRs (#84/#85/#86) and the issues they closed (#80/#81/#82)
were authored by `JulienAu`, on the maintainer allowlist - in-scope for the loop.

**Deferred to human / operator.** Unchanged: dep majors + `bcrypt` 6 remain parked; the
non-additive product ideas the ideate run rejected stay for a human.

---

## 2026-06-09 - The loop starts growing the product: ideation + the first ideate batch

**Context.** A multi-tick session that closed the gap between "the loop maintains the repo"
and "the loop grows the product", then proved the public-repo guardrail under a real attack.
This docs run is the content-loop tail that records it.

**Shipped this arc.**
- **Ideation loop (#68) + first ideate run (#73).** Added the `ideate` skill and
  `docs/loops/08-ideation-loop.md`: when ship and triage have nothing, manufacture
  well-scoped, single-PR product feature ideas grounded in the product vision and the
  captured competitor research, and file them as crisp issues. The first run proposed three
  (issues #69/#70/#71) and rejected the gaps that did not fit one tight PR (bodyweight history,
  supersets, CSV import), logged in `ideas-backlog.md`.
- **Memory / learning / regrounding architecture (#74).** Added
  `docs/loops/09-memory-and-learning.md`: the loop framed as a cybernetic feedback control
  system - setpoint (the product vision + charter), externalized durable memory (git + GitHub +
  files, not the session), lessons that graduate into skills, and regrounding each tick. It
  also states what we deliberately do not build (vector RAG, parallel writers, unbounded
  memory) and why.
- **First ideate batch shipped (issues #69/#70/#71 via PRs #75/#76/#77).** The first product
  features the ideation loop produced, each additive, derived-on-read, no migration:
  - **#75 / #69 - warm-up set calculator.** Confirmed against `lib/warmup.ts`: a pure
    `computeWarmupRamp` producing 40/60/80 percent stages with descending reps in the display
    unit, rounded down to a loadable increment (2.5 kg / 5 lb), clamped below the working
    weight, de-duplicated, with an empty-bar lead-off; display-only, never mutates a set.
  - **#76 / #70 - personal-record badge.** Confirmed against `lib/records.ts`: `detectPRs`
    returns `'weight'` (heaviest non-warmup load) and/or `'e1rm'` (Epley estimate beats the
    best prior) by comparing a candidate against prior history; warm-ups excluded, strict
    comparisons so ties never flag, no records table.
  - **#77 / #71 - training consistency card.** Confirmed against `lib/stats.ts`
    `trainingConsistency`: distinct trained days per ISO week over a 12-week window plus the
    current streak of consecutive on-streak weeks, with an optional weekly-frequency target and
    a partial current week that does not break the streak; rendered by
    `components/progress/consistency-card.tsx` on the progress page.
- **Public-repo guardrail proven by the #57 red-team + CI hardening (#67).** The trust gate
  closed external issue #57 as not-planned (untrusted authorship; never promoted to
  auto-implementable), validating the #56 hardening under a real probe. CI was modernized for
  Node 24 runners and the Postgres image pull hardened (#67).

**Challenged / verified.** Docs-only, so verification-first rather than a code subagent: every
CHANGELOG and log claim was read out of `lib/warmup.ts`, `lib/records.ts`, and `lib/stats.ts`
before writing it, not trusted from the PR summaries. One correction caught this way: #71 ships
a consistency *card*, and the `globalThis.Set` shadow workaround lives in `lib/stats.ts` (not
`lib/records.ts`); recorded as lesson L6.

**Lesson harvested.** L6 (Prisma's generated `Set` model shadows the global `Set`; use
`globalThis.Set` in lib that touches both) - accepted risk. The mid-batch "job was not acquired
by Runner" GitHub Actions outage reconfirmed L2 (read the failing step; infra, re-run) - noted
under L2 rather than as a new lesson.

**Trust gate.** All documented PRs (#75/#76/#77) and the issues they closed (#69/#70/#71) were
authored by `JulienAu`, on the maintainer allowlist. External issue #57 was correctly refused.

**Deferred to human / operator.** The non-additive product ideas the ideate run rejected
(bodyweight/measurement history, supersets/circuits, CSV import) stay parked for a human; dep
majors and `bcrypt` 6 remain deferred.

---

## 2026-06-09 - Chain everything: templates, readiness explainability + opt-out

**Context.** Operator said "chain everything": run the full pipeline unsupervised under the
charter. Three product bets (issues #59/#60/#61) were scoped, implemented, and merged
autonomously this session; this docs run is the content-loop tail that records them. Three
PRs had merged since the last write-up (PR #58) and were undocumented.

**Decided / shipped (this PR, docs only).** Documented the three merged PRs, each verified
against the merged code, not just the PR description:
- **PR #62 / issue #59 (expanded template catalog).** Confirmed against
  `lib/programs/templates.ts`: six new `ProgramTemplate` entries (slugs
  `starting-strength-3day`, `stronglifts-5x5-3day`, `madcow-5x5-3day`, `phul-4day`,
  `phat-5day`, `full-body-3day`) added additively next to the original five, each
  schema-validated at module load and asserted to materialize into a runnable program by
  `templates.test.ts`. CHANGELOG: extended the existing `Added` templates line.
- **PR #63 / issue #60 (readiness explainability).** Confirmed against
  `components/session/exercise-card.tsx`: the `readiness-hold` / `readiness-deload` reason
  from `suggestNextWeight` is plumbed to the set UI and rendered as a badge composed from a
  verb ("Held" / "Lighter") and a cause ("reported soreness" / "low readiness today"), with
  no UI when there is no readiness signal. CHANGELOG: a new `Added` line.
- **PR #64 / issue #61 (readiness auto-regulation opt-out).** Confirmed against
  `lib/preferences.ts` (`readinessAutoRegulation: true` in `DEFAULT_PREFERENCES`, additive,
  no Prisma migration) and `lib/progression.ts` (`readinessForSuggestion` gate, applied in
  `SessionRunner`): default on; off reproduces pre-readiness pure programmed progression.
  CHANGELOG: folded into the existing `Changed` readiness-progression line.

**Challenged.** Verification-first (docs-only, no product code): each CHANGELOG/log claim was
checked against `lib/programs/templates.ts`, `components/session/exercise-card.tsx`,
`lib/preferences.ts`, and `lib/progression.ts` before writing it. The badge wording in the
PR summary matched the code (verb + cause composition).

**Trust gate.** All three documented PRs (#62/#63/#64) and the product issues they closed
(#59/#60/#61) were authored by `JulienAu`, on the maintainer allowlist - in-scope for the
loop. External issue #57 was closed as not-planned by the trust gate (untrusted external
authorship; never promoted into auto-implementable work).

**Deferred to human / operator.** Dependency major bumps and `bcrypt` 6 remain parked as a
separate human-reviewed draft, not actioned here. Further product calls (still more
templates, progression-threshold tuning) noted for the operator rather than filed as
auto-implementable issues.

**Idle.** After this docs PR the product backlog is empty; a triage sweep follows to decide
whether a crisp, single-PR code-health item is worth manufacturing, else a clean idle.

---

## 2026-06-09 - Write up the readiness-progression loop and the public-repo hardening

**Context.** Maintainer tick. Decision order per `06-orchestration.md`: drain ready PRs,
refill if starved, implement one issue, then write up. Verified state with `gh` before
acting: zero open PRs, zero open issues, `main` clean. Two PRs had merged since the last
write-up (PR #52) and were undocumented, so step 1 (ship) and step 3 (implement) had
nothing to do; the actionable work this tick was the content loop.

**Decided / shipped (this PR, docs only).** Documented the two merged, undocumented PRs,
each verified against the merged code, not just the PR description:
- **PR #55 / issue #53 (readiness now influences deterministic progression).** Confirmed
  against `lib/progression.ts`: an optional third `readiness?: ReadinessSignal | null`
  param on `suggestNextWeight`, named threshold constants, a recency gate
  (`ageHours <= 36`), `readiness-hold` / `readiness-deload` reasons, soreness keyed on the
  exercise's `muscleGroup`, and the never-raises invariant. CHANGELOG: a `Changed` line
  under the coach/progression behavior (the suggestion's contract is the same; its inputs
  grew).
- **PR #56 / issue #54 (harden the loop against untrusted public input).** Confirmed
  against the merged diff: the new "Untrusted external input (public repo)" section in
  `07-autonomy.md`, the trust-gating to the `{JulienAu, Julien-Au}` login allowlist, the
  fork/author gates in `ship-pr` and the untrusted-data treatment in `implement-issue` /
  `triage`, and the `curl`/`wget` deny in `.claude/settings.json` (lines 50-51). CHANGELOG:
  a `Changed` line under the loop-infrastructure story (the loop infra IS the story, so it
  belongs in the public changelog).

**Session arc being recorded.** This run closes out a multi-tick session: research-driven
product features #37-#40 (readiness/soreness data model, per-muscle soreness map + note,
coach auto-regulation signal, UI wiring), then the readiness-into-progression loop (#53),
then the security hardening for the now-public repo (#54). The throughline: the product
gained a real auto-regulation signal end to end (capture -> coach context -> deterministic
suggestion), and the loop gained the guardrails to keep running that autonomy safely in
the open.

**Challenged.** Verification-first rather than a code subagent (docs-only, no product
code): every CHANGELOG/log claim was checked against `lib/progression.ts`,
`.claude/settings.json`, and `07-autonomy.md` before writing it. No drift found; the PR
descriptions matched the merged code.

**Trust gate.** Both documented PRs (#55, #56) were authored by `JulienAu`, on the
maintainer allowlist - in-scope for the loop. No external/untrusted authorship this tick.

**Deferred to human / operator.** Nothing hit the hard stop-list. Still parked as product
calls (noted for the operator, not filed as auto-implementable issues): more program
templates, and any further auto-regulation tuning of the progression thresholds. Dep
majors + `npm audit fix --force` (bcrypt 6) remain deferred.

**Idle.** After shipping this docs PR: backlog empty. Triage step did not surface a crisp,
single-PR code-health/coverage/small-bug item worth manufacturing this tick, so the run
ends on a clean idle once the docs PR is merged. Within the 3-merge cap.

---

## 2026-06-09 - Ship the log PR, then implement the soreness/note check-in UI

**Context.** Maintainer tick. Decision order per `06-orchestration.md`: drain ready PRs
first, then implement one issue, then write up. Verified state with `gh` before acting:
PR #50 (docs) had three green checks with E2E pending; one open issue, #48.

**Decided / shipped (merged, 2).**
- **PR #50 (docs: changelog the shipped features + log the prior tick).** Polled E2E to
  green (all four checks pass), reviewed the diff (CHANGELOG entries for the shipped
  plate calculator / templates / readiness features + an accurate dated log entry, no
  em-/en-dashes), squash-merged. This drained the only ready PR, satisfying step 1.
- **PR #51 (feat: capture per-muscle soreness and a note in the readiness check-in,
  Closes #48).** Implemented next; green CI; squash-merged.

**Implemented #48.** The readiness data model, `/api/readiness` route, and coach prompt
already supported a partial `MuscleGroup -> 1-5` soreness map and a free-text note (#38),
but the pre-session UI only submitted `readiness` + `sleepQuality`, so that coach
capability was dead. Wired it up in `components/session/readiness-checkin.tsx` behind an
optional, collapsed-by-default "Add soreness / note" toggle so the quick two-tap path is
unchanged: per-muscle soreness rated 1-5 (labels reused from the shared
`MUSCLE_GROUP_LABELS`), tap-again-to-clear, an optional note via the existing `Textarea`
primitive capped at 500 to match the schema. Only rated groups are sent (a partial map);
an empty map / blank note are omitted. The payload is validated client-side with the same
`readinessCheckinInputSchema` the route uses (no duplicated validation). Added
`components/session/readiness-checkin.test.tsx` (quick path, missing-rating guard,
collapsed-by-default, partial-map + note round-trip, tap-to-clear). No change to the
route, schema, prompt, or coach output contract.

**Challenged.** Independent skeptic lens (`code-review`, high) on the diff: no
correctness or convention defects. Pressure-tested the one real regression risk - that the
new client-side `safeParse` could reject a previously-valid quick-path submission - by
probing `readinessCheckinInputSchema` against every payload the component builds (quick
path, soreness + note, max-length note); all validate, so the quick path is a strict
subset of the old behavior. The only note (soreness section has no re-collapse) is
intentional low-friction design, not a defect. Verdict: ready.

**Process notes.** Green-gate passed (lint + typecheck + unit + build); the 5 new
component tests pass under vitest. Test-Postgres schema was already migrated from the
prior tick, so the integration tier (run in CI) needed no `prisma migrate deploy` here. No
route add/remove on the branch, so no stale `.next/types` cleanup needed.

**Deferred to human.** Nothing hit the hard stop-list. Still parked from earlier ticks:
dep majors + `npm audit fix --force` (bcrypt 6); wiring readiness/soreness into the
deterministic `suggestNextWeight` progression and "more program templates" remain product
calls, not filed.

**Idle.** After this: zero open issues, zero open PRs. Backlog genuinely empty; did not
manufacture triage work this tick (cap reached on useful work, clean idle is success). 2
merges this run, under the cap of 3.

---

**Context.** Maintainer tick after the research-driven product run. Decision order per
`06-orchestration.md`: drain ready PRs first, then refill if the backlog is starved, then
implement one issue, then write up. Verified state with `gh` before acting: PR #46 green,
zero open issues.

**Decided / shipped (merged, 1).**
- **PR #46 (docs: log the research-driven product run).** All four CI checks green, docs-only,
  reviewed the diff (a single dated log entry, accurate, no em-/en-dashes). Squash-merged. This
  drained the only ready PR; #43/#44/#45 had already merged earlier in the session, so step 1
  was satisfied.

**Backlog was empty -> triaged (2 issues filed).** Swept code markers (none), lib coverage
holes, the README roadmap, and `npm outdated`/`audit`. The in-range dep bumps were already
applied in #45 and everything left is a major (stop-list), so no dep issue. Filed:
- **#47 - integration coverage for the `/api/readiness` route handlers.** The route shipped in
  #38 had no direct test (only the coach-payload side was covered); other routes are covered in
  `route-ownership.test.ts` but this newer one was missed.
- **#48 - let the readiness check-in capture per-muscle-group soreness (and a note).** The
  schema, route, and coach prompt all already support `soreness` + `note`, but the UI only
  submits readiness + sleep, so that coach capability is effectively dead. Small UI half of an
  already-built feature, not a new product direction.

Deliberately did NOT file: wiring readiness into the deterministic `suggestNextWeight`, and
"more program templates" - both are product calls, not single-PR mechanical work.

**Implemented #47 (PR #49, opened, CI pending).** Added `tests/integration/readiness-route.test.ts`
(GET + POST: 201 + persist, soreness/note round-trip, Zod 4xx with nothing persisted, GET
latest/null, GET scoped to caller). Test-only, no production code. Green-gate `--full` passed
(26 integration tests, E2E green).

**Challenged.** Independent skeptic lens (`code-review`) on the diff: no correctness/convention
defects, but it flagged that the cross-user isolation test only proved the stranger got `null`
because they had no row - not that the owner's row was filtered. Treated as a real (if minor)
finding: rewrote the test so the stranger has an older row and the owner a newer one, so an
unscoped query would have leaked the owner's; now it genuinely proves scoping. Re-verified green.

**Process notes.** The freshly-created test Postgres on :5434 had no schema; the integration
tier failed with `relation "Message" does not exist` until `prisma migrate deploy` was run
against it. Not a code defect - environment setup. Strict `noUncheckedIndexedAccess` rejected
`checkins[0]`; switched to `findFirstOrThrow`. No destructive ops; `find -delete` not needed
this tick (no route add/remove on the branches switched).

**Deferred to human.** Nothing hit the hard stop-list. Dep majors + the `npm audit fix --force`
(bcrypt 6) still parked from #35. #48 left for the next implement tick.

**Next.** Ship #49 on green CI (next tick / human). Then implement #48 (the soreness UI), or
idle if no actionable work remains.

---

## 2026-06-09 - Research-driven product issues (#39, #37, #38, #40, #35)

**Context.** Operator fed in five research-driven product issues and set a merge cap of 2
for this run (operator actively in the loop). Worked them in risk order, lowest first.

**Decided / shipped (merged, 2).**
- **#39 - in-workout plate-loading calculator (PR #41, merged).** Pure greedy per-side
  decomposition in `lib/plates.ts` working in the user's display unit, honest about
  unloadable remainders; a Dialog surfaced from the set logger; per-unit bar/plate config in
  preferences + settings. Additive UI + pure helper.
- **#37 - built-in program templates (PR #42, merged).** 5/3/1 BBB, GZCLP, nSuns, PPL,
  Upper/Lower as static typed `GeneratedProgram` data, validated at module load against the
  existing generation schema and materialized through the same `/api/programs/build` route,
  so the coach treats them like any user-authored program. "Start from a template" picker.

**Opened, not merged (cap reached - left green/pending for the human or next tick).**
- **#38 - readiness/soreness check-in (PR #43).** New `ReadinessCheckin` table (kept STRICTLY
  additive - verified with `prisma migrate diff` -> "No difference detected"; CREATE TABLE +
  INDEX + FK only, no backfill, no destructive change), Zod-validated `/api/readiness`,
  optional skippable pre-session UI, and a `latestReadiness` INPUT field on the coach payload.
  The `<adjustments>` OUTPUT contract is untouched; the prompt only gained guidance to reason
  over readiness.
- **#40 - coach positioning audit (PR #44).** Audit finding: the apply path already prevents
  silent rewrites (Zod-validated, opt-in, user-accepted, scoped to existing program
  exercises). Fix was prompt WORDING only: advise within the program, never restructure,
  always explain the why; framed generated programs as editable drafts. Output contract pinned
  unchanged by a test - so this did NOT hit the stop-list and went out as a normal PR.
- **#35 - in-range dep bumps (PR #45).** `npm update` for patch/minor within range
  (Radix, react-hook-form, vitest, dexie, tsx, @anthropic-ai/sdk 0.98.1, types). Lockfile-only,
  no majors. Deferred majors + the node-tar advisory noted in the PR body.

**Challenged.** Each non-trivial change reviewed by an independent skeptic lens before
merge/open. #38 used the two required lenses: correctness (input threading / JSON coercion /
user-scoping) and migration-stays-additive (confirmed via `migrate diff`). No blocking findings;
the additive-migration property held.

**Deferred to human.** Nothing hit the hard stop-list this run - #38's migration stayed
additive and #40 stayed within the output contract, so both were shipped as normal PRs rather
than drafts. The dep majors and the `npm audit fix --force` (bcrypt 6) remain for a human per
#35's scope.

**Process notes.** Caught and cleaned stale `.next/types` artifacts when switching between
branches that add/remove routes (would otherwise red the typecheck step); `rm -rf` stayed
denied, used targeted `find -delete`. Rebased #38 onto the post-#37 main; the two branches'
additions to `core.test.ts` / `setup.ts` merged cleanly.

**Next.** Ship #43, #44, #45 on green CI (next tick / human). Then idle unless new actionable
work arrives.

---

## 2026-06-08 - Route ownership + steady state

**Decided / shipped.**
- #30 (Closes): route-level integration tests proving per-user data isolation on
  `DELETE /api/sets/[id]`, `PUT /api/sessions/[id]`, `GET /api/exercises/[id]` - owner
  succeeds, stranger gets 404 and the row is left intact. The subagent verified this is
  non-vacuous: the auth mock genuinely controls the acting user (owner cases return 200,
  not 401) and the 404 comes from the ownership branch, so the security property is really
  asserted in both directions.

**Steady state.** The high-value, single-PR backlog is now exhausted. Tested: the pure-logic
modules (schemas, units, preferences, api, last-performance) and route-level ownership.
Remaining gaps are deliberately NOT auto-filed:
- low-ROI browser-IO modules (`sync`, `indexeddb`, `wake-lock`, `sound`, `vibrate`) - hard to
  test meaningfully, little payoff;
- larger product work (the roadmap's in-session AI suggestions, AI-coach unit localization) -
  needs human product scoping per the charter's stop list.

Manufacturing busywork would degrade the tracker and the démarche, so triage files nothing.

**Mode.** The loop transitions to MONITOR MODE: it wakes on a long interval, ships any green
PR, implements any newly-filed actionable issue (with subagent review), and otherwise idles.
This is a clean idle, not a failure - the pipeline stays ready for new work.

**Session tally.** ~12 issues closed (#1-#5, #8, #18-#20, #26-#27, #30), the end-to-end loop
system + autonomy charter + git rollback baseline, imperial-unit support, and broad
unit/integration/security test coverage. The adversarial subagent loop caught two real product
regressions (a mis-classified exercise, a silent kg rounding change) and the process guardrails
caught two slips (a masked red-gate commit, a mixed-scope branch) - all fixed without
force-pushing or touching main directly.

---

## 2026-06-08 - Coverage round + honest triage

**Context.** Drain the test backlog and decide, honestly, whether more work is warranted.

**Decided / shipped.**
- #26 (Closes): unit tests for `lib/preferences.ts` (localStorage defaults, merge, corrupt-JSON
  fallback, round-trip, helpers). Subagent review: READY.
- #27 (Closes): unit tests for `lib/api.ts` error handling - `handleApiError` status mapping
  (ApiError / Prisma P2002 -> 409 / P2025 -> 404 / unknown -> 500 with no message leak) and
  `parseJsonBody` rejection paths. Subagent review: READY; the reviewer ran a probe to confirm
  `instanceof Prisma.PrismaClientKnownRequestError` actually holds, so the 409/404 branches are
  genuinely exercised (not vacuous).

**Triage (honest).** The high-value pure-logic modules now have tests (schemas, units,
preferences, api, last-performance). Rather than manufacture low-ROI tests for IO/DB modules,
filed ONE genuinely valuable item: #30, route-level integration tests for per-user ownership
(data isolation is a security guarantee with zero route-level coverage today). Identified the
mockable auth seam (`getCurrentUserId`) so the issue is implementable, not half-baked.

**Challenged.** Subagent reviews on #26 and #27 (both READY).

**Deferred to human.** None. Larger product work (the roadmap's in-session AI suggestions)
still needs scoping and is intentionally not auto-filed.

**Next.** Implement #30 (intermediate: test Postgres + auth mocking) with subagent review. If
the backlog empties again with no genuinely useful work left, idle cleanly - that is a valid
outcome, not a failure.

---

## 2026-06-08 - Backlog cleared (tests + polish)

**Context.** Drain the triaged batch (#18/#19/#20) and keep the pipeline honest.

**Decided / shipped.**
- #19 (Closes): unit-agnostic set-note placeholder. Trivial copy change, so no subagent
  review per the charter's non-trivial threshold - documented that judgment in the PR.
- #18 (Closes): validation tests for the six untested `lib/schemas` Zod schemas (40 cases).
- #20 (Closes): integration tests for `getLastPerformances`, run against the real test
  Postgres locally (full integration suite 7/7) before shipping, not just typechecked.
- Subagent reviews on #18 and #20 returned READY; the #18 review prompted documenting a
  real `z.coerce.boolean()` footgun ("false" coerces to true).

**Challenged / process guardrails that fired.**
- **Commit on a RED gate, caught and reverted.** A `verify.sh | tail && git commit` chain
  let the pipe mask verify.sh's non-zero exit, so a commit landed while typecheck was red.
  Caught it immediately, fixed the test, re-verified by capturing the exit code to a file.
  Lesson recorded in the loop prompts: never pipe the gate through `tail` in a commit chain.
- **Mixed-scope branch, untangled.** The #18 test commit had been stacked on the #19
  branch; recovered by cherry-picking it onto a clean branch so each PR holds one scope.
- **Non-fast-forward after an amend, reconciled without force.** Amending an already-pushed
  commit broke the push; resolved with `reset --soft` + a new commit (force-push stays
  denied by the charter), never rewriting pushed history.

**Deferred to human.** None.

**Next.** Backlog empty -> triage to refill (uncovered lib modules / small polish), then
implement with subagent review. The big roadmap item (in-session AI suggestions) is left
for a human to scope.

---

## 2026-06-08 - Imperial units complete + backlog refilled

**Context.** Close out issue #1 and keep the pipeline fed.

**Decided / shipped.**
- Shipped #17 (Closes #1): converted the progress page (line chart, weekly-volume bars,
  recap table) to the user's unit by converting the plotted data, not just labels. #1 is
  now fully delivered across #14 (foundation), #15 (logging/history), #17 (charts).
- Noticed #1 had auto-closed early (the progress charts were still kg, so the acceptance
  was not met) and **reopened it** before finishing, rather than leave a half-done issue
  marked done. Truth over green checkmarks.
- Triage refilled the backlog (no TODO/FIXME markers exist, so coverage was the real gap):
  #18 (Zod schema validation tests), #19 (unit-agnostic set-note placeholder), #20
  (integration tests for getLastPerformances).

**Challenged.** Independent skeptic subagent on #17: READY, kg output verified
byte-identical, no double-conversion or mixed units.

**Deferred to human.** None. The AI coach intentionally stays in kg (matches its own
prompt/prose); localizing it would need a prompt-design decision, so it was not forced.

**Next.** #19 (fast win) then #18, each subagent-reviewed; #20 (integration tier) after.
Keep the README/docs/loops démarche current - the growth engine is stars.

---

## 2026-06-08 - Empty states + imperial units (split delivery)

**Context.** Continuing the maintainer loop through the backlog (#5, #1).

**Decided / shipped.**
- Shipped #5 (empty states): a reusable `EmptyState` primitive + friendly empty states
  with a CTA on the progress and history pages. Subagent review: READY.
- Issue #1 (imperial units) was deliberately **split** - the full conversion across every
  surface plus input was too large/regression-prone for one safe PR (charter: split when
  too large). PR #14 (foundation: WeightUnit enum, additive migration, `lib/units.ts`,
  profile API) merged. PR #15 (UX: settings toggle + logging/history conversion) opened.
  Progress charts follow in a third PR that closes #1; the AI coach stays in kg to match
  its own prompt/prose.
- Content/README pass (this PR): added a "this repo largely maintains itself" section to
  the README (the démarche is the growth engine), recorded empty states + the unit
  preference in the CHANGELOG, and logged this run.

**Challenged.** Subagents reviewed every product change. On #1 PR #15 the skeptic caught a
**real silent regression**: rendering raw stored weights via `decimals:1` would have
rounded `82.25 kg -> 82.3 kg` for existing kg users. Fixed to `{decimals:2, group:false}`
(byte-identical to the old raw render) and verified by a second review pass. This is the
adversarial loop earning its keep.

**Deferred to human.** None. Progress-chart conversion and a possible coach localization
are tracked as follow-up work, not blockers.

**Next.** Merge #15 on green, then PR #3-of-#1 (progress charts) to close #1; triage to
refill the backlog once empty.

---

## 2026-06-08 - First product run (catalog + content)

**Context.** Maintainer loop running unsupervised under the charter. Goal: drain ready PRs,
then improve the product, challenging each non-trivial change with a subagent.

**Decided / shipped.**
- Shipped #11 (Closes #4): expanded the seed exercise catalog by 25 movements and filled the
  two muscle groups that had zero coverage (FOREARMS, LOWER_BACK); strengthened the catalog
  test to assert valid enum membership and full-group coverage.
- Content loop (this PR): recorded the now-merged demo-credentials (#6) and catalog (#4)
  features in CHANGELOG, updated the loop-infra line, and logged this run.

**Challenged.** An independent skeptic subagent reviewed the #4 diff and caught a real
mis-classification (Hammer curl tagged FOREARMS; brachialis/biceps are the prime movers).
Fixed to BICEPS before push, then re-verified. The author did not grade its own homework.

**Deferred to human.** None.

**Next.** #5 (polish empty states) with subagent review; then scope #1 (imperial units,
larger, additive only). Triage if the backlog empties.

---

## 2026-06-08 - Bootstrap autonomy

**Context.** Operator switched the repo to a full-autonomy experiment: improve the product
continuously, no per-change approval, self-challenge with subagents, keep a rollback point.

**Decided / shipped.**
- Tagged rollback baseline `autonomy-baseline-2026-06-08` on `main` (post #6/#7 merge) and
  pushed it. Restore with `git checkout autonomy-baseline-2026-06-08`.
- Wrote the autonomy charter (`07-autonomy.md`): mandate, hard guardrails, the
  stop-and-leave-for-human list, the subagent challenge protocol, budgets, this journal.
- Allowed `git tag *` in `.claude/settings.json` so future runs can re-baseline.

**Earlier this session (pre-charter, for the record).**
- Built the end-to-end loop system (PR #9, open): `triage`, `ship-pr`, `write-up` skills +
  `docs/loops/03-06`.
- `implement-issue` produced PR #7 (CHANGELOG); `ship-pr` was dogfooded live and merged #7
  and #6 (closing issues #3 and #2) on green CI.

**Challenged.** Not yet - subagent review protocol starts with the next product change.

**Deferred to human.** None.

**Next.** Merge #9 once green; then work the backlog (#4 seed catalog, #5 empty states,
#1 imperial units), each subagent-challenged before merge per the protocol.

---

## 2026-06-13 - Cardio axis closed out (#175/#176/#177); model note + three CLEAN reviews

**Context.** Eighth ideate batch (#175 TCX export, #176 cardio last-time, #177 pace/speed) implemented and shipped. Operator switched the default model to Opus 4.8; the Fable model then became unavailable to subagents, so this cycle's dev tick ran on the inherited Opus (the Fable-for-dev routing is moot while Fable is inaccessible) - noted so a future run does not treat the routing as broken.

**Decided / shipped.**
- #179/#180/#181 merged on green full CI; all three independent Opus reviews CLEAN (the #181 TCX-export review attacked escaping/ownership/2000-lap perf and the round trip - all held; the #180 pace/speed math was re-derived independently). Three NITs on #181 (unreachable non-finite/zero-HR emission, finished-session button gate) hardened in #182; one pre-existing cross-cutting NIT (history cardio totals include warmups) filed as #183.
- The cardio axis is now closed in and out: TCX/CSV import -> first-class cardio logging with a last-time reference -> pace/speed + conditioning analytics -> TCX/CSV export. This is the file-based neutral ground the 2026-06-12 research identified as the hybrid-athlete white space.

**Challenged.** Two parallel Opus reviews (one security-lensed). Accepted-change rate: 4 merged / 0 abandoned (+ docs).

**Deferred to human.** #169 (Next.js 14->15 major bump) still stop-for-human, untouched. Future: #183 (warmup totals), supersets slice 2, coach-context annotation.

---

## 2026-06-13 - Next.js 15 + React 19 upgrade (#169), operator-authorized

**Context.** #169 (the Next 14->15 major bump) is normally stop-for-human; the operator explicitly authorized it ("go #169, I trust you, be careful"). Done by the orchestrator directly (not a fire-and-forget tick) given the risk. Rollback baseline autonomy-baseline-2026-06-13-next15 tagged first.

**Decided / shipped (PR #185, merged on full green incl. docker-smoke).**
- next 15.5.19, react/react-dom 19, @types/react(-dom) 19, eslint-config-next 15.
- next-pwa (unmaintained, no Next 15) -> @ducanh2912/next-pwa (workboxOptions, buildExcludes->exclude). The PWA blocker was the crux; everything else (Radix, recharts 3, next-themes, testing-library 16) was already React-19 ready.
- Async request APIs via the official codemod (cookies in lib/auth; params/searchParams across 23 routes/pages); integration tests updated to Promise.resolve({params}).
- The 14 runtime Next CVEs from #169 are cleared; residual advisories are build-time only (workbox/esbuild-via-vitest/next-bundled-postcss) - accepted.

**Verified (reinforced controls for a major bump).** verify.sh --full green (incl. 10 E2E); production Docker image built + probed locally (login 200, sw.js 200, no client error); CI docker-smoke re-validated the image; demo redeployed and the LIVE Next 15 instance confirmed healthy (login, full progress data, service worker, zero page errors). Lesson L13 records the approach.

**Deferred to human.** None outstanding from #169. A Serwist migration (to clear the build-time workbox advisories) is a possible larger follow-up, not filed.

---

## 2026-06-13 (late) - Batch 9 shipped (#188/#189/#190); 3 CLEAN reviews + one tie-break fix

**Context.** Ninth ideate batch implemented on Opus (Fable still unavailable to subagents): coach note (#188), superset-aware rest (#189), records board (#190).

**Decided / shipped.**
- #192/#193/#194 merged on green full CI; rollback baseline autonomy-baseline-2026-06-13b tagged before the #194 migration. Three independent Opus reviews: all CLEAN. The #188 review verified the coach note reaches the LLM as JSON DATA (not concatenated into instructions), the <adjustments> contract is byte-identical, and adversarial notes (</adjustments>, "ignore instructions", 501 chars, whitespace) are handled. The #193 timer was proven live via the superset E2E. The #190 review found one NIT (non-deterministic tie-break date, no orderBy) - promoted to fix #195/#196 (query ordered oldest-first; tests pin the contract).
- The coach note is the correctable-memory differentiator the 2026-06-12 research identified; it pairs with the read-only transparency card (#154).

**Challenged.** Two parallel Opus reviews (one injection-lensed). Accepted-change rate: 4 merged / 0 abandoned this batch.

**Deferred to human.** Nothing outstanding. Future: mobility session type (low confidence), Serwist migration (build-time advisories).

---

## 2026-06-15 - Batch 10 (#202/#203/#204): a maintainer tick died mid-run; resumed without loss

**Context.** Tenth ideate batch (body measurements #202, cardio max HR #203, GPX import #204). The implementing tick (inherited Opus; Fable still unavailable) shipped #206 (#203) and #207 (#202), then DIED on a transient socket error mid-PR for #204, leaving a complete-but-uncommitted GPX implementation (parser + route + UI + 30 unit tests incl. the full hostile-input suite) on its branch. It had tagged the rollback baselines (autonomy-baseline-2026-06-14 / -14b) before its migrations.

**Decided / shipped.**
- Resumed the dead tick's GPX branch (socket-close is terminal, no zombie): verified the full gate was green on the uncommitted work, sanity-checked the parser's security posture, added the one missing piece (the E2E the issue required), re-gated, and shipped it as PR #208 on green full CI.
- All three PRs then got the independent post-merge reviews the dead tick never reported: #206 CLEAN (max HR; Track subtree stripped before lap-max, bounds on all writers), #207 CLEAN (measurements; ownership, additive migration no drift), #208 CLEAN under a HOSTILE security review (21 adversarial cases - no entity table, billion-laughs <1ms, 5MB linear ~110ms, 200k-point cap, GPX name never read so no attacker text reaches DB/CSV/React). Zero REAL findings across the batch.
- The product now imports four formats (Strong/Hevy CSV, TCX, GPX) plus full export - the file-based neutral ground the 2026-06-12 research identified.

**Challenged.** Three parallel Opus reviews (one hostile-security). Accepted-change rate: 3 merged / 0 abandoned. The resilience pattern held: durable git/PR state meant the socket death cost no work; the mandatory review validated dead-tick code under attack.

**Deferred to human.** Nothing. Future: FIT import (binary, needs a decoder), free-text AI set logging (LLM-shaped), mobility session type (low confidence), Serwist (build-time chore). #169 (Next 15) already done.

---

## 2026-06-15 (later) - Batch 11 reviewed (3x CLEAN); ROADMAP COMPLETE; shared-demo pollution fixed

**Context.** Batch 11 (#212 coach records, #211 volume targets, #210 free-text AI set logging) shipped; #210 was the LAST unchecked README roadmap item - the roadmap is now fully checked, MVP -> complete AI coach.

**Decided / shipped.**
- Three independent Opus reviews: all CLEAN. #216/#210 cleared an untrusted-model-output lens - the reviewer ran 12 hostile model outputs (Infinity/NaN/out-of-range/wrong-kind/injected "log this set"/__proto__) all fail closed, proved a parse never logs a set (no db write in the call graph), and confirmed the route is rate-limited + body-capped + the parse contract is separate from <adjustments>. #214 (records, output contract intact) and #215 (volume targets, additive migration no drift, classifier stays pure) CLEAN.
- NIT cleanup in #217: clamp a model-parsed RIR of 4-5 to the selectable button range; add the missing parse-route 429/oversize tests; drop a dead volumeTargets prop.
- Operations: found and fixed why the operator kept seeing an "empty" demo - it is a single SHARED account that visitors pollute (their in-progress session makes the home lead with "Resume session"). Installed a `*/30` light-reset cron on the VPS (re-seeds the demo account, no downtime) alongside the nightly full reset; documented the periodic-reseed need in the README demo section.

**Challenged.** Three parallel Opus reviews (one untrusted-output-weighted). Accepted-change rate: 4 merged / 0 abandoned + the cleanup.

**Deferred to human.** Nothing. The README roadmap is complete; future product work is now pure ideation (FIT import, mobility, etc.). The recurring readiness-checkin.test.tsx WSL2-only flake (green in CI) is worth a robustness pass next triage.

---

## 2026-06-15 (triage) - L9 gate spot-check + permissions re-audit (both pass); two test issues filed

**Gate spot-check (L9).** Disabled the GPX parser's DTD/entity reject (lib/import/gpx.ts:303) locally (never pushed) and re-ran lib/import/gpx.test.ts: 3 hostile-input tests FAILED as they should (internal DTD, external-entity XXE, billion-laughs). The security gate is genuinely protective, not rotten. Restored; tree clean.

**Permissions re-audit (L9).** Re-read .claude/settings.json: the deny list is intact (rm -rf, git push --force/-f/--force-with-lease, git reset --hard, curl, wget). The 37 allow entries are all coherent with what the loop runs (npm/npx/git/gh/file ops); no dangerous scope creep, no sudo/broad-rm/network grants.

**Filed.** #219 (fix the flaky readiness-checkin userEvent test - times out under parallel WSL2 load, green in CI) and #220 (colocated unit coverage for lib/last-performance.ts - the cardio-totals/HR-averaging logic from #179 is only integration-tested). Code markers: none. Roadmap: complete. Coverage otherwise healthy (the untrusted set-parse validation is unit-tested; thin wrappers are integration-covered).

---

## 2026-06-16 - Batch 12 (beyond-roadmap polish): 3 CLEAN + 1 dedup fix

**Context.** First ideation past the completed roadmap - mature-product polish, kept anti-busywork (each a verified real gap, not filler): exercise cues in session (#224), per-muscle frequency (#225), e1RM % loading table (#226). All additive, display-only.

**Decided / shipped.**
- #228/#229/#230 merged on green; one consolidated light correctness review (proportionate to display-only/no-contract risk) returned 3/3 CLEAN - it confirmed the non-vacuous bits: frequency counts distinct calendar days (not raw sets) and the loading table converts kg->display unit BEFORE rounding so loads land on real plate jumps. One NIT (the exercise note rendered twice - cue + collapsible) fixed in #232 (#231): the collapsible now holds only the program-specific note.
- The product is feature-complete on its vision; ideation is now polish/completeness. Deferred unchanged: FIT import, mobility session type, Serwist.

**Challenged.** One consolidated Opus correctness review (right-sized for low risk). Accepted-change rate: 4 merged / 0 abandoned.

**Deferred to human.** Nothing. Process note: the in-loop CI poll briefly merged two docs/1-file PRs on "no checks reported" before the workflow registered; both were locally full-gate-green and confirmed green on main post-merge - harden the poll to treat "no checks reported" as wait, not proceed.

---

## 2026-06-17 - Maintenance: demo deploy flipped to a reliable PULL model

**Context.** The GitHub-runner-SSH-in demo deploy (deploy-demo.yml) had been timing out at the connection level from shared runner IPs more often than it succeeded - I had to redeploy directly from the VPS most cycles, and the weekly scheduled run showed as recurring red noise. Diagnosed: connection-level timeout (runner SYN to :22 not getting through), not auth/fail2ban (0 banned, VPS reachable from a fixed IP) - GitHub egress flakiness to a small VPS, unfixable from the workflow side.

**Decided / shipped.**
- Flipped PUSH -> PULL. New VPS cron /home/gymdeploy/bin/auto-deploy.sh (every 2h, `17 */2 * * *`): git-fetches main and runs deploy-demo.sh ONLY when main moved - a host reaching out to GitHub is reliable where CI reaching in is not. Tested end-to-end: it detected main d3ea405 -> b48841f and redeployed; the live demo verified clean+healthy on the new code.
- deploy-demo.yml is now workflow_dispatch-only (#234) - dropped the flaky weekly schedule + its red runs; manual dispatch stays for on-demand. README documents the pull-model preference; memory readme-and-demo-media.md updated with the new commands.
- Also corrected stale "Next.js 14" references to 15 across README + CLAUDE.md (#235) - the repo upgraded in #185.

**Challenged.** Self-verified (infra + docs only): pull-model proven end-to-end, both PRs green on full CI. No subagent review needed.

**Deferred to human.** Nothing. The recurring "I redeploy by hand each cycle" toil is now eliminated; future demos self-update within 2h of a merge.

---

## 2026-06-18 - Batch 13 (beyond-roadmap): proactive home insight + catalog search

**Context.** Idle loop, roadmap complete, backlog empty. Ideated two genuinely-new, single-PR, display-only gaps (not filler): the home dashboard was purely navigational despite the app already deriving rich signals (#237), and the exercise catalog had no search as custom exercises accumulate (#238). Filed both; deliberately did NOT manufacture a weak third.

**Decided / shipped.**
- #238 catalog search (PR #239): pure client-side name filter over the loaded list in components/exercises/exercises-view.tsx, grouping preserved, distinct no-match vs catalog-empty states. 5 component tests.
- #237 home coach insight (PR #240): new lib/home-insight.ts with a PURE `selectHomeInsight` (priority recommended-deload > stalled-lift > fresh-PR > on-track) and a server `getHomeInsight` that composes existing derivations (isStalled/exerciseProgress, recommendDeload, exerciseRecords, isoWeekStart). Display-only, no LLM, no writes; null on a fresh account. 8 unit tests on the selector.
- #241 docs/media: README feature bullets + re-shot home.png (insight card) and catalog.png (search box) against a production build with the deterministic 12-week seed, self-verified healthy.
- Demo force-redeployed to 209b29a (pull-model) and verified live (/login 200).

**Challenged.** #237 (the more complex change, on the home render path) got an independent general-purpose review: verdict SHIP, all checks OK (PR detection mirrors the progress page's records query exactly; bodyweight inline matches effectiveWeight; stall grouped by name is safe given @@unique([userId, name]); ~6 bounded queries, no N+1; empty path renders nothing). Two harmless NITs, no action. #238/#241 self-verified (low risk). Accepted-change rate: 3 merged / 0 abandoned.

**Deferred to human.** Nothing actioned. The deploy output reflagged the Prisma 5.22 -> 7.8 major bump - left as stop-for-human (major dep bump), not auto-taken.

---

## 2026-06-18 - Major dep bump: Prisma ORM 5.22 -> 7.8 (operator-approved)

**Context.** Operator greenlit the major bump ("gp Prisma 7"), same trust posture as the
Next 15 upgrade. Prisma 7 is a real two-major-version migration: the Rust query engine and
the `prisma-client-js` generator are both gone. Researched the authoritative breaking
changes first (capped web check) rather than guessing.

**Decided / shipped (#243).**
- Generator -> `prisma-client`, output the gitignored `prisma/generated`, `moduleFormat=cjs`
  to keep the app CommonJS (no `"type":"module"` blast radius across the Next config files).
- Driver adapter is now mandatory: `lib/db.ts` connects via `@prisma/adapter-pg` + `pg`.
- The new generator splits output into a server `client.ts` (runtime, pulls node:fs) and a
  browser-safe `browser.ts` (enums + types + Prisma type-namespace). A barrel
  `lib/prisma-client.ts` re-exports the BROWSER surface so a 'use client' component pulling
  an enum never drags the server runtime into its bundle (the production build caught this
  exact leak via lib/schemas/profile -> a client component). The 7 server-only runtime users
  (Prisma error class in lib/api.ts, PrismaClient in the seeds, server-only Prisma types)
  import from the generated server client directly; verified none are client-reachable.
- CLI config moved from package.json#prisma.seed to prisma.config.ts (datasource url read
  from process.env, not the throwing `env()` helper - that broke `generate` at image build).
- Dockerfile: new `prod-deps` stage (`npm ci --omit=dev`, with `prisma`+`tsx` promoted to
  dependencies) gives the runner a real production node_modules. Prisma 7's `migrate deploy`
  loads @prisma/config -> a deep closure (effect, c12, ...) that cannot be cherry-picked -
  the same fragility that made the bcrypt #127 image bug recur. This retires the whole
  cherry-pick hack (the wasm query compiler ships inlined as base64 in @prisma/client).

**Reinforced controls (complex-change directive).** `verify.sh --full` (integration + 14
E2E through the new pg adapter). Built the production image LOCALLY and ran the full
docker-smoke (migrate deploy + register + login all 200) before pushing. CI: all 5 jobs
green on a clean runner incl. docker-smoke. Independent review verdict SHIP across 6 risk
lenses (bundling leak, barrel completeness, adapter singleton, config, Dockerfile overlay,
leftovers). Rollback baseline recorded (main @ 520c0b6).

**Deploy snag, found and fixed.** First demo redeploy built + migrated fine but the SEED
died: Prisma 7's client is in the gitignored prisma/generated, and the VPS reset scripts
seed via `npx prisma db seed` (imports @/prisma/generated/client) WITHOUT a prior generate.
Fixed the VPS reset-demo.sh + light-reset.sh to `npx prisma generate &&` before seeding,
re-ran the reset (55 exercises + 12-week history seeded), and verified the live demo on
Prisma 7 (/login 200, demo login 200). Repo-side follow-up #244: a guarded postinstall that
generates the client when the schema is present (no-op in the schema-less Docker stages), so
fresh clones / npm test / the demo host npm ci all get a working client without a manual
generate.

**Challenged.** One independent general-purpose review (SHIP). Accepted-change rate:
2 merged / 0 abandoned. **Deferred to human.** Nothing - the bump was the approved item.

---

## 2026-06-19 - Triage (post-Prisma-7 code-health): coverage + a safe advisory

**Context.** Clean idle (0 PRs/issues). Triage swept: no code markers, roadmap complete. Two real items.

**Shipped.**
- #246: integration coverage for the server `getHomeInsight` (#237 had only the pure
  selector unit-tested). Seeds deterministic rows and asserts every priority branch
  (deload > stall > PR > on-track > none) + user-scoping.
- #247: pinned `form-data` >=4.0.6 via an npm override to clear a high advisory
  (GHSA-hmw2-7cc7-3qxx). It is transitive dev-only (jsdom); `npm audit fix` was
  booby-trapped (it wanted to downgrade prisma 7->6 and next 15->9), so the surgical
  override was the only safe path. Remaining serialize-javascript high needs a next-pwa
  major downgrade -> left for a human.

**Process note (local E2E flake).** `verify.sh --full` E2E failed locally with a VARYING
failure set / moving failure points; root cause was machine load (avg ~26 on 12 cores from
this session's docker builds), not a regression - registration worked 200 against a fresh
server, the change was test-only, and CI's isolated E2E was green. Confirmed by merging on
green CI without weakening any test. The local test Postgres (:5434) also has no E2E reset
hook, so it accumulates state across manual runs - CI provisions a fresh PG per job.

---

## 2026-06-19 - Feature: Garmin FIT file import (#249, the cardio-import wedge)

**Context.** Last ideate filed #249 (FIT import) as the one high-value remaining item; operator said continue, so this loop implemented it. FIT is the BINARY format Garmin/most watches export natively - the research-flagged file-based cardio import wedge, and the one major format TCX/GPX did not cover. Additive, complex (binary parser), so reinforced controls.

**Decided / shipped (#251).**
- lib/import/fit.ts: a hand-rolled, dependency-free decoder of the FIT session-summary
  message (duration/distance/avg+max HR/sport). No third-party FIT library (its parsing is
  extra attack surface), mirroring the no-entity-decode discipline of the XML importers.
  Bounds-checks every offset/length by construction, caps records, verifies the FIT CRC-16,
  range-checks every persisted value via the shared cardio zod schema.
- app/api/import/fit/route.ts: mirrors the GPX/TCX routes (shared import rate bucket, body
  cap, base64-decoded binary, ownership-scoped transactional confirm; a parse never writes).
- Settings exposes "FIT file" (the only binary import, read as base64).

**How correctness was earned (not assumed).** The decoder was validated against fixtures
produced by the OFFICIAL Garmin FIT SDK (@garmin/fitsdk) - added as a dev dep ONLY to
generate spec-compliant bytes, then REMOVED (0 lockfile refs; fixtures embedded as base64).
So the hand-rolled decoder is checked against real bytes a Garmin device would write, not
against my own encoding assumptions. 14 unit (hostile battery: short/bad-sig/bad-header/
oversize-datasize/CRC-mismatch/oversize-blob/random/no-session/out-of-range + a full
truncation sweep that must never throw), 8 route integration, 1 E2E.

**Challenged.** Independent HOSTILE security review (untrusted binary parser): verdict SHIP.
~30 crafted attacks (OOB, DoS, integer/precision, CRC, value-smuggling) all rejected or
bounded; confirmed linear on 5 MB adversarial files (~120 ms), every read in-bounds, zod
backstop rejects NaN/Infinity, ownership scoping intact. No blockers. Full --full gate green
(15 E2E incl. the new spec). Accepted-change rate: 1 merged / 0 abandoned.

**Deferred to human.** Nothing. Per-record GPS/HR streams were intentionally out of scope
(summary-only slice); a future tick could add them if asked.

---

## 2026-06-19 - Watch-data features: multi-file import + detailed track/chart (#253, #254)

**Context.** After FIT import (#251) the operator asked "tu peux tout lancer ! On veut la
meilleure app du monde" - i.e. ship the two natural extensions I had flagged: bulk import
and the detailed pace/HR track. Filed both (#253, #254), then implemented in sliced PRs.

**Decided / shipped.**
- #255 multi-file FIT import: the FIT route takes a `fits[]` batch (1..50) alongside the
  single `fit` (kept byte-for-byte backward-compatible), aggregated preview, partial-success
  confirm (each file its own transaction). "Rapatrie tout mon historique."
- #256 detailed track (#254 slices 1+2): additive nullable Set.track JSONB; the FIT decoder
  reads RECORD messages into a track downsampled to <=500 points (raw bounded at 100k);
  confirm stores it; an HR-over-time Recharts line on the history detail. Decoder validated
  against official Garmin SDK fixtures (dev-only, removed).

**Challenged.** Two independent reviews.
- #255 review caught a real BLOCKER: a per-file confirmOne throw (e.g. a 409 name collision)
  aborted the whole batch AFTER earlier files had committed. Fixed: per-file ApiError is
  skipped (systemic errors still abort); added a collision-in-batch integration test.
- #256 hostile review: SHIP, no blockers - verified the record-stream DoS bounds empirically
  (300k records -> 57 ms, heap capped at 100k, track <=500), value sanitization (negative/
  NaN/out-of-range dropped), additive-only migration, no other Set reader selects the heavy
  column, preview excludes it, numbers-only so no XSS.
Accepted-change rate: 2 merged / 0 abandoned (1 mid-PR fix).

**Deferred to human.** Nothing. Slice 3 (TCX/GPX per-record point capture) left un-filed.

---

## 2026-06-23 - Feature: pace/HR track + chart for GPX imports (#259 GPX slice) + a process slip

**Context.** Ideate-starved cycle; the standout item was the deferred slice 3 of #254 -
extend the imported-activity HR chart beyond FIT. Filed #259, implemented the GPX slice.

**Decided / shipped.**
- Shared lib/import/track.ts (TrackPoint + cleanTrackPoint per-point range sanitization +
  downsampleTrack <=500). The FIT decoder was refactored onto it (its 16 tests still pass;
  the new sanitize-then-stride order is a strict improvement, not byte-identical - the
  commit msg overstated "behaviour-preserving").
- lib/import/gpx.ts builds a downsampled track from the trackpoints it already parses
  (cumulative haversine distance + time + HR, bounded by MAX_TRACKPOINTS); the GPX route
  stores it on confirm. The existing chart renders any set.track, so GPX runs/rides now
  chart with no UI change. TCX sub-slice (its <Trackpoint> samples are still dropped) left
  for a follow-up.

**PROCESS SLIP (recorded honestly).** I committed + pushed the feature DIRECTLY to main -
forgot the `git switch -c` after filing the issue, bypassing the PR/pre-merge-review gate
(violates the one-branch-per-task rule in CLAUDE.md). Recovery: main CI runs on push and
passed all 5 checks (the change had also passed the full local --full gate); I ran the
independent hostile review POST-HOC anyway (no security/correctness blocker; one dead-import
nit); and fixed that forward the right way via PR #260 on a branch. No harm to main, but the
gate-skip is exactly what the charter says to avoid. Lesson: after filing an issue in the
same checkout, branch BEFORE editing.

**Challenged.** Post-hoc independent review (FIX: one trivial dead-import, fixed in #260; two
no-action NITs). Accepted-change rate: 2 merged (74626cc feature on main + #260 cleanup).

**Deferred to human.** Nothing. TCX track sub-slice un-filed.

---

## 2026-06-30 - Feature: TCX pace/HR track (completes #259) + a repeat process slip

**Context.** Idle loop, backlog empty, code-health current. The one clear remaining product
item was the deferred slice 3 of #254/#259: TCX imports dropped their per-second
<Trackpoint> samples, so a Garmin Connect / Polar TCX showed the summary but no HR chart -
the odd one out vs FIT and GPX.

**Decided / shipped (aa28984).** lib/import/tcx.ts now walks the trackpoints (Time /
DistanceMeters / HeartRateBpm) into the shared lib/import/track.ts helper; the TCX route
stores the downsampled track on confirm; the existing chart renders it. Lap totals still
derive only from lap fields (Track stripped first) - trackpoint values never feed totals.
Every imported run/ride (FIT, GPX, TCX) now shows the heart-rate-over-time chart. Tests:
parser (exact 3-point extraction, null-without-trackpoints, 600->cap downsample), route
(track stored / null), TCX E2E (history row + chart), README updated.

**Challenged.** Independent HOSTILE review (untrusted-binary/XML parser): verdict SHIP, no
blockers - doubly-bounded (the 5 MB byte cap admits ~90k tps, well under the 200k backstop),
linear (10k=46ms / 20k=75ms), totals isolated, values numbers-only (XSS-safe), XXE-clean,
confirm-only, ownership-scoped, at parity with FIT/GPX. Full --full gate: integration + the
tcx E2E pass; two unrelated specs (auth, deload) flaked under local parallel load and pass
in isolation; CI on the isolated runner was all-green.

**PROCESS SLIP #2 (recorded honestly).** I pushed this DIRECTLY to main again - same cause
as the 2026-06-23 GPX slip: a prior `git switch main` left me on main and I edited without
branching. Recovery identical: CI ran on the push (all green), post-hoc independent review
(SHIP). Codified as lesson L14 (branch before editing after any main checkout) so the habit,
not the recovery, is the fix.

**Deferred to human.** Nothing - #259 is now fully complete across all three import formats.

---

## 2026-06-30 (triage) - L9 gate spot-check + permissions re-audit: found and closed a rotten gate

**Context.** Backlog empty, code-health current, product wedge complete - but three
untrusted-input parsers (FIT binary, GPX/TCX XML) and a shared value sanitizer had landed
since the last L9 pass (2026-06-15), so the right cycle was verifying those security gates
are genuinely protective.

**Gate spot-check (L9).** Two reverts, never pushed:
- POSITIVE CONTROL: disabled the FIT CRC verify (lib/import/fit.ts) and re-ran fit.test.ts -
  exactly the "rejects a CRC mismatch" hostile test FAILED. That gate is sound. Restored.
- FOUND A ROTTEN GATE: weakened cleanTrackPoint's heart-rate bound (lib/import/track.ts,
  accept ANY hr) and re-ran ALL 88 importer tests - every one still passed. The shared track
  sanitizer (cleanTrackPoint + downsampleTrack), which every FIT/GPX/TCX import feeds and
  whose output is stored on the cardio set AND rendered in the HR chart, had NO direct test:
  its range checks (t in window, distance 0..1000km, hr 40..250, numbers-only) were entirely
  uncovered. A regression weakening them would ship silently. Restored.

**Fixed.** Added lib/import/track.test.ts (10 tests) covering cleanTrackPoint (drops
out-of-window t, out-of-range/non-finite distance and hr, keeps edges, rounds, numbers-only)
and downsampleTrack (null on empty, <=500 cap, even stride). Verified it CLOSES the gap:
re-weakening the hr bound now fails the new test.

**Permissions re-audit (L9).** .claude/settings.json deny list intact (rm -rf, git push
--force/-f/--force-with-lease, git reset --hard, curl, wget). 37 allow entries, no sudo /
network / broad-rm / scope creep - unchanged from 2026-06-15.

**Filed.** No issues - the one gap was closeable in-cycle (a missing test, not a product
decision). Code markers: none. The residual high npm advisory (serialize-javascript via the
next-pwa workbox toolchain) stays human-deferred (a next-pwa major downgrade).

---

## 2026-07-15 - Batch: aerobic decoupling (#278/#268) + GymCoach-native CSV import (#279/#270) - and a shared-worktree main breach

**Context.** Two product ideas from the prior deep-research ideate batch were ready to
implement: #268 (an aerobic-decoupling readout on imported cardio) and #270 (the symmetric
inverse of the history CSV export - a GymCoach-native CSV import). Both are clear product
pluses on the established cardio/import wedge, so the loop implemented and shipped them.

**Decided / shipped.**
- **#278 (merge b2221f5, closes #268) - aerobic decoupling.** New `trackDecoupling()` in
  `lib/cardio.ts` splits an imported activity track at its time midpoint and returns
  `(effFirst - effSecond) / effFirst * 100` where efficiency = speed / mean HR per half;
  null when the track cannot support it (no cumulative distance, no HR, too few samples, or
  a degenerate span). A `TrackDecoupling` server component renders one percentage plus a
  plain-language read (held steady <= ~5 percent, else faded), wired into the history detail
  page. Display-only, no schema or API change. 23 unit + 5 component tests; fast gate + green
  CI; independent Opus skeptic READY pre-push and a clean pre-merge review.
- **#279 (merge 5f92ffb, closes #270) - GymCoach-native CSV import.** New
  `lib/import/gymcoach-csv.ts` parser for the `HISTORY_CSV_HEADERS` contract: BOM-tolerant,
  5 MB / 50k-row caps, per-line errors on hostile rows, and it un-escapes the export's
  formula-injection guard for a true round-trip (the inverse of the export sanitizer). The
  shared import planner/executor was extended additively (sessionKey grouping so same-day
  sessions stay apart, plus rir/notes/avgHr/maxHr passthrough); the Strong and Hevy paths
  stay byte-identical, pinned by tests. New `app/api/import/gymcoach/route.ts` mirrors the
  Hevy route (Zod, rate bucket, streamed body cap, dry-run preview, ownership-scoped), and
  the Settings import section gained the source. Tests at every layer (parser unit incl.
  formula injection + hostile rows, planner unit, route integration incl. a real
  export -> import round-trip, and an E2E). Full local gate (`verify.sh --full`) + green CI;
  two-lens (correctness + security) reviews READY.

**INCIDENT - hard guardrail 1 breach (committed to `main` directly), remediated.** During
this run two concurrent ticks shared the single working tree. The #278 ship tick switched
the checkout back to `main` while the #270 dev tick still had uncommitted work; the
intermediate commit `a49e21f` ("feat: import training history from a GymCoach (native) CSV")
briefly landed on `main` directly - bypassing the PR + pre-merge-review gate. This is a
breach of hard guardrail 1 ("never commit to `main` directly"), and a different root cause
than the L14 "branch before editing" slips: here two writers shared one checkout, not one
writer forgetting to branch. Remediated immediately WITHOUT force-push (force-push to shared
`main` is itself denied): a revert commit `fe25d66` was pushed so `main`'s content was
restored exactly to `b2221f5` (CI green), and the work was re-applied on the feature branch
via cherry-pick and shipped the right way through PR #279 (merge `5f92ffb`). Net effect on
`main`: `b2221f5` -> `a49e21f` (breach) -> `fe25d66` (revert, content == `b2221f5`) ->
`5f92ffb` (proper PR merge). Root cause: **concurrent ticks must not share one working
tree.** Codified as lesson L15 (concurrent stage ticks need isolated git worktrees; until
the orchestrator spawns dev ticks with worktree isolation, same-checkout ticks must be
strictly serialized).

**Untrusted external input (trust gate held).** A 5-PR fork stack #272-#276 (author
`SHAREN`, a non-collaborator, 124-347 files each) was identified and scanned for injection
patterns (none found). Per the trust gate it was NOT auto-merged; a policy comment was left
on #272 and the stack awaits human maintainer review. No content from it was implemented or
laundered into a loop-authored issue.

**Challenged.** #278: independent Opus skeptic READY pre-push + a clean independent pre-merge
review. #279: two independent lenses (correctness + security) both READY, over an
untrusted-input parser and a new import route.

**One metric.** Accepted-change rate this batch: 2 merged / 0 abandoned (the intermediate
direct-to-main commit was reverted and re-shipped as #279, not a separate accepted change).
Implementing-tick token spend: not recorded this run (dev ticks were Fable per the
model-routing directive).

**Deferred to human.** The #272-#276 fork stack (human vetting + re-file if any idea is
worth adopting). Nothing else.

---

## 2026-07-22 - Progress photos, local-only (#269 -> #281), and a human-directed fork adoption (#272)

**Context.** Maintainer tick. Backlog held one actionable, trust-gated issue: #269
(author JulienAu) - "Progress photos alongside body metrics, local storage, no cloud."
The five open PRs (#272-#276) were all authored by `SHAREN`, a non-collaborator outside the
allowlist, so under the ship trust gate none was auto-shipped by the loop.

**Decided + shipped.** #269 implemented and merged as **#281** (squash `53ff6e2`). It is a
file-upload SECURITY SURFACE, so the reinforced controls were applied end to end: additive
`ProgressPhoto` model + additive migration (`20260722100000_add_progress_photo`); a raw-body
upload route that enforces an 8 MiB cap DURING a streamed read (new `readBodyBytesWithCap` in
`lib/api.ts`, with `readBodyWithCap` refactored to delegate, behavior-identical); a magic-byte
image sniffer as the SOLE type authority (JPEG/PNG/WebP only - client content-type is never
trusted); ownership-scoped list/serve/delete routes returning an identical 404 for
not-found and not-owned (no existence oracle); files written `0o600` under a gitignored,
configurable `UPLOADS_DIR`, served only through the ownership route (never a static path);
path containment (`resolveInsideStorageDir`) on every read/write/delete. Tests at every layer
(sniffer unit + hostile buffers; integration for oversize/415/400/ownership/on-disk state;
an E2E upload-and-see-it flow). Full local gate `verify.sh --full` green; five green CI checks.
A fresh rollback baseline `autonomy-baseline-2026-07-22` was tagged before the migration merge.

**Challenged.** Two INDEPENDENT Opus lenses (author was a Fable dev tick, so neither reviewer
graded its own homework): a correctness/does-it-work lens and a security lens. Both returned
READY with zero blocking findings; each independently raised the same non-blocking nit (DELETE
removes the row before the file, so a non-ENOENT `rm` failure would orphan the file) plus minor
hardening (realpath containment, dir mode `0o700`). Folded into follow-up **#282**, not blocked.

**Human-directed fork adoption (#272).** During this run a CONCURRENT loop session (separate
checkout) hardened and merged fork PR **#272** (`SHAREN`, `isCrossRepository`, non-collaborator)
into `main` - "extensible localization + Russian," plus a `Secure`-by-default session-cookie
hardening (`SESSION_COOKIE_SECURE=false` opt-out) and a from-template route reuse fix. The
autonomous ship gate FORBIDS the loop merging a fork / non-allowlisted author's PR even on green
CI, so this tick stopped and surfaced it to the operator rather than acting on it. The operator
confirmed in-session that the localization adoption was INTENDED (a human-in-the-loop decision),
so #272 is kept and documented as an authorized exception, not a breach. Recorded so the
allowlist gate's meaning stays clear: the loop still may not self-merge forks; a human may.

**Infra observation -> #283.** The two concurrent `verify.sh --full` runs contended on the
SHARED test Postgres (:5434) and dev port (:3031): one run's `TRUNCATE ... CASCADE` reset the
DB mid-run, producing a spurious E2E failure that was green on an isolated re-run. This is the
infra twin of L15 (isolated worktrees, but shared test DB/port). Filed #283 (serialize or
isolate the shared infra); interim rule recorded as lesson L16.

**One metric.** Accepted-change rate this batch (loop-authored): 1 merged / 0 abandoned (#281).
Docs PR for this write-up separate. Implementing-tick token spend: not recorded (dev tick was
Fable per the model-routing directive). #272 is a concurrent session's work, not counted here.

**Deferred to human.** #282 (photo-storage hardening) and #283 (shared-infra serialization) are
filed for a later tick. The remaining SHAREN PRs #273-#276 still await human vetting.


## 2026-07-27 - follow-up batch: #286 -> PR #290, #282 -> PR #291

**What ran.** One interactive `/loop` in dynamic pacing (self-scheduled ticks, no cron), acting
as the maintainer loop: ship -> implement -> ship -> write up. Backlog was already full (five
issues filed by the previous batch's reviews), so triage and ideate did not run. Both PRs were
authored, gated and merged by the loop; both close issues the previous batch's skeptics filed,
which is the review->issue->PR->merge circuit closing on itself for the first time.

**Green gate.** #290: fast gate + the backup integration suite (11 passed). #291: `--full`,
including E2E. In both cases the new test was first confirmed to FAIL against the unfixed code
(409 on the duplicate-gym restore; row deleted despite the unlink error), so the tests are
regression tests, not decoration.

**Feedback-blindness check (L2).** The `--full` gate went red twice on E2E specs unrelated to the
change, and the tempting read was "flaky infra, re-run". The actual cause was self-inflicted: the
suite's signups share one per-IP register bucket (5/min), and re-running to confirm the flake is
what starved the next run. Acknowledged the failing step before re-planning, spaced the run out,
got 17/17, and CI passed first try on both PRs. Graduated as lesson **L17** into `CLAUDE.md`, with
**#292** filed to stop the specs sharing one IP.

**One metric.** Accepted-change rate this batch: 2 merged / 0 abandoned (#290, #291), plus this
docs PR. No reverts. Implementing-tick token spend: not recorded separately (both ticks ran in the
same interactive session as the shipping and write-up ticks).

**Deferred.** #283 (serialize the shared test infra), #285 (plate-calculator fallback inventory -
needs a product call, so it stays for a human), #287 (MCP hardening follow-ups), #292 (E2E signup
IPs), and the demo-media re-shoot once the demo seed carries progress photos.


## 2026-08-20 - single-issue batch: #292 -> PR #294 (the loop closes its own lesson)

**What ran.** One maintainer loop: implement -> ship -> write up. The backlog already held the
issue, so triage and ideate did not run. #292 was filed by the *previous* batch's lesson L17 -
the loop hitting a failure mode, recording it, filing it, and then fixing it one batch later. The
interim rule L17 imposed ("wait out the minute before re-running E2E") is now retired because the
cause is gone, not because it was inconvenient.

**Green gate.** `verify.sh` green, `verify.sh --full` green. The acceptance criterion was
measured rather than asserted: a second `npm run test:e2e` started immediately after the first,
inside the 60s rate-limit window, was green - 17/17 tests on both runs. Before #294 that second
run was the reliable way to red the suite.

**Fix the code, not the test - read carefully.** The tempting fix was to raise or disable
`register:<ip>` for the test environment. That would have been the forbidden move in the other
direction: weakening a real product guardrail so the scoreboard goes green. The defect was the
suite's assumption that every spec may share one client identity, so the specs were fixed and the
limit was left exactly as users experience it.

**Docs debt paid.** This write-up also retires the stale text the fix invalidated: the `CLAUDE.md`
green-gate paragraph that described the tier as not repeatable, and lesson L17's open status
(appended a resolution note rather than rewriting it - lessons are a log, not a claim about the
present). Both keep the bounded caveat: CI `retries: 2` means one flaky spec can still burn three
registers on its own IP, and #283 (concurrent runs sharing :5434/:3031) is a different race, still
open.

**One metric.** Accepted-change rate this batch: 1 merged / 0 abandoned (#294), plus this docs PR.
No reverts. Implementing-tick token spend: not recorded separately (dev tick was Fable per the
model-routing directive).

**Deferred.** #283 (serialize or isolate the shared test infra), #285 (plate-calculator fallback
inventory - needs a product call), #287 (MCP hardening follow-ups), and the demo-media re-shoot
once the demo seed carries progress photos.


## 2026-08-20 - five-PR batch: #287/#285/#283 cleared, ideation, and the first "make it pop" feature

**What ran.** One interactive maintainer loop across the day: implement -> ship, three times over
the deferred backlog (#287, #285, #283 - the three items every previous batch had pushed forward),
then an ideate tick on an operator directive, then implement -> ship on the first idea it
produced. Triage did not run; the backlog was already full and ended fuller.

**The deferred list is empty.** #296 (MCP hardening), #297 (plate-calculator fallback editor) and
#298 (shared-infra lock) close the three issues that had been carried as "deferred to human" since
2026-07-15. Two of them were deferred for a reason that turned out to be soft: #285 was tagged
"needs a product call" and the call (restore the editor, describe it as the no-active-gym
fallback) took one paragraph of reasoning; #283 was tagged infra-heavy and took one flock. A
"deferred" tag ages badly - it is worth re-reading the backlog's deferred items as a batch rather
than skipping them each tick.

**Ideation on an operator directive.** The operator asked for cool, demo-able features - ones that
land visually in a screenshot, not just in the changelog. The ideate tick filed six: muscle heat map (#299), training recap poster (#300),
strength level badges (#301), GPX route drawing (#302), year-long training heatmap (#303), PR
celebration (#304), recorded in `docs/loops/ideas-backlog.md` via #305. #299 shipped the same day
as #306; #300-#304 remain open.

**Independent review earned its keep, twice.** Every PR got a pre-merge review by an independent
reviewer, and two of the five came back with a REAL defect that the author, the green gate and CI
had all missed - the settings clobber in #297 and the leaked lock fd in #298. Both were fixed on
the branch before merge, both with tests. Recorded as a reinforcement of lesson **L8** rather than
a new lesson: the mechanism was already known, the batch supplies the rate (2 defects / 5 PRs) and
a sharper shape for it - a new piece of code making an existing pattern unsafe is the author's
reliable blind spot.

**Green gate.** All five PRs: local gate green, CI 5/5 green. #298's acceptance was measured
rather than asserted - a 300s lock holder was started deliberately, and the second run printed the
wait notice, blocked, then went green. #306 also validated its color ramp for common color-vision
deficiencies and for light/dark separation before merge, and fixed an a11y nit from review (the
per-region labels were pruned from the accessibility tree until the svg got `role=group` and each
region `role=img`).

**One metric.** Accepted-change rate this batch: 5 merged / 0 abandoned (#296, #297, #298, #305,
#306), plus this docs PR. No reverts. 2 real defects caught pre-merge by independent review. 6
issues filed (#299-#304). Implementing-tick token spend: not recorded separately (dev ticks were
Fable per the model-routing directive; reviews, ideation and this write-up ran on Opus).

**Deferred.** #300-#304 (the rest of the "make it pop" ideas) and the demo-media re-shoot, which is
now the oldest debt in the repo: the progress page has drifted twice (photos card, muscle heat map)
since the committed screenshots, and the heat map is exactly the frame a clip should open on.


## 2026-08-27 - opening the repo to outside contributors: the policy (#315), the first adopted external report (#314 -> #316 -> PR #318), and three fork PRs vetted

**What ran.** One interactive maintainer loop on an operator directive: encourage external
open-source contributors, and put security vetting passes in front of every external issue and
especially every external PR before it is validated. Sequence: design -> independent adversarial
challenge of the design -> policy PR -> triage the external backlog -> adopt and fix one external
bug -> vet three fork PRs -> write up. Triage ran on the external backlog only; ideate did not run.

**The design was challenged before it was adopted, not after.** The usual protocol reviews a diff;
here an independent reviewer was pointed at the *design*, and four findings reshaped it before a
line was written. (a) Running `scripts/verify.sh` on an external PR is remote code execution on the
operator's host: a contributor's test file, `vitest.config.ts` or `postinstall` hook executes as the
operator's user with `.env` and an authenticated `gh` token in reach, and a git worktree is a
filesystem convenience, not a security boundary. CI became the only executor of unvetted code.
(b) `main` has no branch protection at all - the loop account is not an admin and cannot add it - so
every control in the policy is behavioral until a human enables it; flagged to the operator as the
cheapest, highest-leverage fix in the design. (c) The realistic crafted-diff attack is not an
obvious backdoor but one deleted ownership check inside 2,000 plausible lines, and correlated LLM
review lenses have an unmeasured false-negative rate against exactly that shape; so unvetted authors
are never auto-merged - the loop does all the labor and a human clicks merge. (d) Adopting an issue
needs a threat-model lens, not just a prompt-injection screen, because blast radius attaches to the
change, not to the author. Mid-session the operator added two more rules: vetted status never
softens the passes, and any local execution of external code (vetted included) happens only in an
ephemeral isolated container.

**What shipped as policy (#315, merged).** A new `docs/loops/10-external-contributions.md` is the
single source of truth: three trust tiers (maintainers / vetted / unvetted), the execution gate, a
mechanical hard-block path list that gates execution AND auto-merge, three review passes pinned to a
reviewed commit SHA (`--match-head-commit`), the issue-adoption pipeline, service commitments
(triage inside 24h, a public structured verdict on every external PR), and a promotion ladder where
only a human grants vetted status (SHAREN is the one vetted contributor today). The charter's trust
section, `CLAUDE.md` and the `triage` / `implement-issue` / `ship-pr` skills were rewritten to point
at that one file instead of carrying four copies that had already started to drift. `CONTRIBUTING.md`
now discloses the honest shape of the process to contributors: reviews are AI-assisted, a human
merges for new contributors, external code runs in CI only, the hard-block list is published, and a
DCO sign-off is requested but not enforced. `.coderabbit.yaml` was added as an advisory-only lens -
installing the app is a human action and its verdict is never a merge or trust signal.

**The policy PR's own review came back NOT READY.** Three blocking findings, all real: the new
hard-block path list was written so it applied to the maintainer tier too (it would have silently
ended the loop's own auto-merge autonomy), the `ship-pr` skill still executed unvetted code at its
fix-a-red-gate step despite step 1 forbidding exactly that, and `i18n/**` was missing from the
hard-block list while `messages/**` was listed. All three fixed on the branch, re-review READY.
Third consecutive batch where independent pre-merge review caught real defects, recorded as a
reinforcement of lesson **L8** - notable because this time the defects were in the policy itself, an
artifact whose bugs read as ordinary sentences.

**The first external report the loop adopted.** External user mvnixon filed #314: an authenticated
`GET /mcp` hangs forever. Verified against the code before adopting it - the endpoint runs the MCP
Streamable HTTP transport statelessly, so there is no SSE stream to attach and the response is never
written or closed; unauthenticated GETs 401 early, which is what hid the bug, and Claude Desktop's
connector probes with GET and so could never connect. Re-derived and re-filed as #316 with the
reporter credited, per the new issue-adoption pipeline, and fixed in PR #318 (merged): GET
short-circuits before authentication to a 405 with an `Allow` header, per the spec. The review
confirmed the diagnosis down in the SDK and caught one honesty nit - a test name that overstated
what it covered - fixed before merge. The fix also brings the first test coverage of
`app/mcp/route.ts` (4 integration tests).

**Four external issues, four public verdicts, inside the tick.** #310 (publish a GHCR image): the
analysis is correct, but `.github/workflows` is a hard-blocked path, so it is labeled
`needs-maintainer` with a concrete accept recommendation attached. #309 (an iOS app): a product
decision, not a code decision. #308 (vendoring a third-party exercise dataset): supply-chain and
licensing decisions, plus the issue asserts a "per owner decision" the loop cannot verify - flagged
politely rather than acted on. New labels `needs-maintainer` and `adopted` now carry that state.
Straight out of the challenge findings the loop also filed **#317**: make ownership checks
unremovable by construction (`ensureOwnership` returns the row, with a CI-enforced cross-user test
convention), so the one-line-deletion attack stops being invisible. It touches the auth surface, so
it waits for a maintainer green light.

**The vetting pipeline's first full run: SHAREN #311/#312/#313.** All three touch hard-blocked paths
(`messages/**` for #311, Prisma migrations for #312 and #313), so all three are human-merge by rule,
and all three got read-only multi-lens reviews with a structured verdict posted publicly. #311
(return-to-training, 2,089 lines): security CLEAN on all four lenses, 2 major product/performance
findings (the new-exercise mode is broader than advertised; an unbounded history fan-out sits on the
session hot path). #312 (equipment inventory): security CLEAN - ownership scoping complete on all
nine new queries, the import provably cannot cross tenants, the image validator does real magic-byte
checking and excludes SVG - with 3 major engineering findings (an uncapped export against a 50 MiB
import cap breaks the restore promise; import amplification of roughly 200k serial round trips
inside one 60s locked transaction; `IF NOT EXISTS` migration guards masking schema drift plus an
unqualified `pg_constraint` check) and an untested image-decoder rejection surface. #313 (equipment
history delta): 1 BLOCKING - the new 400s on stale equipment references are fatal in `lib/sync.ts`,
where an offline-logged set is silently destroyed - plus 3 major (5 MiB image blobs shipped in the
RSC session payload; a `JsonNull` vs `DbNull` split between the two writers; a non-idempotent
migration). The shared migration was verified byte-identical across the stack, and the verdicts name
a merge order (#312 then #313, merge commits) and credit explicitly what SHAREN did well.

**Green gate.** Both loop PRs merged on green (local gate + CI). The three external PRs got no local
gate at all, deliberately: under the new policy CI is the only executor of unvetted code, so the
reviews are read-only reads of the diff and the verdicts say so. That is the first time the loop has
reviewed a change it did not run, and the write-up records it as intended behavior rather than a
gap.

**One metric.** Accepted-change rate this batch: 2 merged / 0 abandoned (#315, #318), plus this docs
PR. No reverts. 3 blocking defects caught pre-merge by independent review, all of them in the policy
itself. 2 issues filed (#316, #317); 4 external issues triaged with public verdicts; 3 external PRs
security-vetted with structured verdicts. Implementing-tick token spend: not recorded separately
(the MCP fix ran on Fable per the model-routing directive; the design challenge, all reviews and
this write-up ran on Opus).

**Deferred to the operator.** Enable branch protection on `main` (the loop account lacks admin, and
this is the one control it cannot give itself); optionally install the CodeRabbit app; decide #308,
#309 and #310; merge #311-#313 after the fixups the verdicts list. Still carried: #317 (unremovable
ownership checks, auth surface), #300-#304 (the rest of the "make it pop" ideas) and the demo-media
re-shoot, now the oldest debt in the repo.


## 2026-08-28 - the vetting pipeline's first real workout: #311/#312/#313 merged after five fixup rounds, the ownership ratchet extended (#327), and one review the loop got wrong

**What ran.** A second wave on the same operator directive as the 2026-08-27 entry above, which
covers the policy itself (#315), the first adopted external report (#318), the ownership work
(#322), the GHCR workflow (#321) and the first vetting pass on SHAREN's three fork PRs. This entry
is only what happened after those verdicts were posted: five contributor fixup rounds across three
PRs, a re-review after every one of them, three external merges, one dev tick of the loop's own
(#327), and the follow-ups. Triage and ideate did not run.

**The first time the policy ran end to end on live external code - and the parts that earned their
keep were the boring ones.** SHA pinning is the clearest case. On #312 the checks summary read 6/6
green, and the check runs belonged to the PREVIOUS head; the loop resolved check runs against the
current head SHA through the API before merging, and only that step separates "CI is green" from
"CI is green on the code I am about to merge". SHAREN pushed three times on #312 and twice on #313
during review. Each push invalidated the pinned verdict, and each one triggered a re-review rather
than a merge on stale green. Five pushes, five re-reviews, zero merges on a verdict that had gone
out of date.

**Composition risk was real, not theoretical.** #313's branch predated #312's last two commits and
also touched `app/api/backup/route.ts`, the same file the #312 fixups had just reworked. Git will
auto-merge that cleanly, and a clean auto-merge is not proof that the newer work survives: the
conflict-free case is exactly the one nobody reads. So the loop test-merged locally before
approving - a merge and a diff read, never an execution, which keeps it inside the L18 execution
gate - and confirmed that #312's export pre-count, the test that pins it and the per-gym cap all
came through intact. The same check ran again when merging `main` into #327, where #312 had
independently added three entries to the same `COVERED_ELSEWHERE` map the ratchet edits; both
sides preserved.

**What the contributor did well, recorded because the policy's premise depends on it.** The bet
behind #315 is that the loop does all the labor and a human clicks merge, which only pays if the
labor produces fixes rather than churn. Every one of SHAREN's four rounds on #312 returned the fix
WITH a test rather than the fix alone: the capacity race got a genuine transaction-scoped Postgres
advisory lock (not a snapshot-racy count inside a transaction, which is the fix that looks right
and is not), the migration was rewritten as real `prisma migrate dev` output with the
`IF NOT EXISTS` guards and the unqualified `pg_constraint` probe gone, and import amplification
dropped from roughly 200,000 serial round trips to roughly 200, with validation hoisted ahead of
the purge so a bad import cannot destroy data before failing. On the last push SHAREN preemptively
closed a gap the loop had identified but not yet raised - both export size guards shared one
message, so the new test could not tell which of them had fired - by spying on the heavy query to
prove it never runs. That is a better answer than the message differentiation the reviewer was
going to ask for, because it pins the mechanism instead of a proxy for it. The loop verified the
assertion was not vacuous before accepting it (that query sits on the normal export path and pulls
the image blobs, so a test asserting it never runs would fail if the short-circuit were removed).

**One review the loop got wrong, and the advisory lens that got it right.** The 08-27 review of
#313 called `Set_gymEquipmentId_completedAt_idx` reader-less, and SHAREN removed the index on that
basis. That was wrong. The FK is `ON DELETE SET NULL` with `relationMode` unset, so Postgres itself
has to locate the referencing `Set` rows on every equipment deletion - a single delete, a gym
delete cascading, and backup restore, which cascades across every equipment row the user owns - and
Postgres does not index the referencing side of a foreign key. The CodeRabbit lens, which the
policy carries as advisory only and never as a merge signal, had the mechanism right where the
loop's own review had it wrong; the loop verified the schema independently before conceding, then
filed **#325** with the provenance written into the issue rather than quietly re-adding the index.
CodeRabbit also supplied the sharper form of the export finding the loop had missed: bound the
bytes BEFORE loading them, not refuse after serializing. First real evidence that the third-party
lens earns its slot - and the sharper lesson underneath it is that "no reader in application code"
is the wrong question when a database-level referential action is the reader (**L20**).

**One trust moment, handled without heat.** On #312 round two the contributor's comment said the
export budget fix had shipped "with regression coverage". It had not: `backup-route.test.ts` was
untouched by that fixup range, and every 413 test on the branch was an import/body-read test, not
an export test. The loop verified that independently before saying anything and then said it
plainly - the fixes themselves were trustworthy, which is exactly why the claims attached to them
had to be too, since a review that accepts a coverage claim at face value has silently stopped
being a review. The next round shipped the test.

**The loop's own PR (#327, closing #323).** It finishes the residuals the independent review left
on #322: the ownership ratchet now matches any `[param]` segment rather than the literal `[id]`,
and body-addressed routes - which no path glob can ever see, because only a human can tell that a
payload field is somebody's resource id - are enumerated explicitly with a staleness test that
fails when a listed route leaves the tree. The last three fetch-then-compare validation reads
(`sets/parse`, session start, goal creation) became scoped reads. Independent review then found the
PR's own new artifact incomplete on delivery: `POST /api/gyms` accepts `exerciseConfigs[].exerciseId`
and was missing from the enumeration, with no cross-user coverage - which is precisely the failure
mode the ratchet exists to prevent, arriving in the ratchet itself. Fixed with a cross-user case.
Both new tests were spot-checked by deliberately removing the scope and confirming that exactly the
right test failed. After merging `main`, the reviewer re-implemented the ratchet's logic
independently and ran it against the merged tree: 23 parameterized routes plus 5 body-addressed
entries, 0 unmatched, and SHAREN's two new id vectors (equipment `exerciseId`s, set
`gymEquipmentId`) confirmed to sit on already-matched parameterized routes.

**Green gate, and one process note worth a line.** All four merges green (local gate for #327, CI
for all of them). The external PRs still got no local gate before merge, deliberately, per the
execution gate. #321's first publish ran post-merge and was verified rather than assumed: the
package is public, an anonymous manifest pull returns 200, and the tags are `latest` plus two
`sha-` tags. The process note: a full-gate run on #327 after merging `main` came back red with the
entire ownership suite failing, which looks exactly like the change breaking everything it touches.
It was a stale local test database missing the two new migrations; unit tests were 999/999 green at
the same moment, which is the tell. Diagnosed before anything was touched, `prisma migrate deploy`
fixed it. Recorded because "read what the failure actually says before re-planning" is the repo's
own anti-feedback-blindness rule, and a red that arrives right after a merge is the moment it is
easiest to skip.

**One metric.** Accepted-change rate this wave: 4 merged / 0 abandoned (#311, #312, #313 external;
#327 the loop's own), plus this docs PR. No reverts. 5 contributor fixup rounds across 3 PRs, every
one re-reviewed against a freshly pinned SHA. 4 follow-up issues filed (#324, #325, #326, plus #323
which this wave closed). 1 defect found by independent review in the loop's own PR, in the very
artifact that PR added. Implementing-tick token spend: not recorded separately (the dev tick #327
ran on Fable per the model-routing directive; all reviews and this write-up ran on Opus).

**Deferred.** #324 (return-to-training follow-ups from the #311 review), #325 (the FK index), #326
(tell the user when an equipment selection was not recorded), #320 (browsable exercise library),
#300-#304 (the rest of the "make it pop" ideas), and the demo-media re-shoot, still the oldest debt
in the repo and now further behind: the session logger grew an equipment picker this wave.


## 2026-09-04 - three dev ticks in parallel worktrees (#334/#335/#336), and an external design proposal answered inside the tick (#331)

**What ran.** Three loop-authored dev ticks in parallel, one `git worktree` each, on three
file-disjoint issues left over from the previous wave: #325 (the FK index the 08-27 review
had wrongly told a contributor to delete), #326 (the equipment selection that could be
dropped silently) and #330 (the exercise catalog card at phone width). Each PR got an
independent Opus skeptic review before merge - the author never grades its own homework -
and each was squash-merged on green CI. Alongside them, one external design proposal (#331)
was vetted and answered, and its one loop-adoptable piece was filed as #333. Triage and
ideate did not run. Earlier the same day the operator's own French-locale branch merged
(#332), which is why this write-up also touches the localization lines in the README and
the CHANGELOG.

**Three ticks, three worktrees, zero coordination.** This is the first batch run as
deliberate parallel dev work, and it is worth recording as a success because the two
controls that make it safe were both already in place and neither needed attention during
the run. Each tick got `../gymcoach-wt-<n>` off the same base (L15: a git checkout is
single-writer state), and the three `--full` gates serialized themselves on the machine-wide
`flock` added by #298 (L16: worktrees fix the git race, not the shared test Postgres and dev
port). Result: three PRs, zero merge conflicts, three green first-pass CI runs, no `main`
breach. The one thing the orchestrator still owns is the choice of issues - the same-file
serialization rule decides *what* may run in parallel; worktrees only decide *where*. Now
written into `06-orchestration.md` as the confirmed pattern rather than a contingency.

**The index the loop had told a contributor to delete (#325 -> #334).** The 08-27 review of
SHAREN's #313 called `Set_gymEquipmentId_completedAt_idx` reader-less, and SHAREN removed it
on that basis; the advisory CodeRabbit lens had the mechanism right where the loop's own
review had it wrong (lesson L20). The reader is the referential action: the FK is
`ON DELETE SET NULL` with `relationMode` unset, so Postgres itself locates the referencing
`Set` rows on every equipment deletion - a single delete, a gym delete cascading to its
equipment, and a backup restore, which cascades across every equipment row the user owns -
and Postgres does not index the referencing side of a foreign key. The restoring migration
is guarded with `IF NOT EXISTS`, and the reason is itself the interesting part: the original
index was removed by editing an already-applied migration in place, so a database that
applied the pre-review version already has the index while a fresh one does not. Editing an
applied migration leaves exactly this kind of split-brain behind; the guard is the cost of
that, paid once.

**The silent drop, and why the fix had to live in the sync layer (#326 -> #335).** Since
#313 a set whose equipment reference has gone stale is saved with `gymEquipmentId` null
rather than being rejected - the right call, because rejecting it destroys an offline-logged
set. But it was silent: the picker kept the machine selected and pre-selected it again for
the next set. The interesting constraint is that the set POST is fire-and-forget through
IndexedDB and `flushPendingSets`, so the server's answer is only ever observed inside
`lib/sync.ts`, in the background, with no component on the stack. There is no return value
to check and nowhere to `await`. The fix is therefore a subscription rather than a return
path: sync nulls the local record, reports it in `FlushResult.droppedEquipment` and notifies
`onEquipmentDropped` subscribers; the session runner subscribes, filters by the current
session id, shows a non-blocking warning toast and withdraws the option; set-input clears a
selection the options no longer offer. The review earned its slot twice here - it added a
cross-user equipment-id case to `tests/integration/route-ownership.test.ts` and then proved
the test was not vacuous by removing the `gym: { userId }` scope and confirming that exactly
that test went red, and it found the gap the fix does not close: if no `SessionRunner` is
mounted when the flush runs (the tab was closed, the user navigated away), the local record
is still nulled but nobody is listening, so the notice is lost. Filed as **#337** rather
than bolted on.

**A layout bug whose most visible symptom was not a layout bug (#330 -> #336).** At 400px
the catalog card gave the exercise name roughly 150px, because three tap targets sat in a
trailing column and the repo's `tap` token is 4rem - 64px each, which is a deliberate
accessibility floor and not something to shrink. So the fix moved structure instead: a fixed
64x64 leading media slot (the technique start frame, or a muted play icon at the same size
when the catalog has no media, so every card shares one row alignment), the name taking the
remaining width with `line-clamp-2` instead of truncating mid-word, a compact
`equipmentTypesShort` label (en/ru/fr) sharing one non-wrapping line with the rest time, and
edit/delete on their own full-width row below `sm`. The part worth recording is the "large
grey box" the issue reported in the README screenshot: it was not a rendering bug at all but
the hover state of a ghost button, painted onto whichever card the resting mouse pointer
happened to sit over when the screenshot script fired. Fixed at the capture site -
`scripts/screenshots.mjs` now parks the pointer at (0,0) before each capture - which closes
a whole class of future false bug reports against the committed media. `catalog.png` was
re-shot and looked at. Two reviewer follow-ups came out of this one: **#338** (the default
catalog never sets `equipmentType`, so every seeded exercise is `OTHER` and now reads "Any
equipment" - pre-existing data, made visible by the new label) and **#339** (a French
comment surviving in `tailwind.config.ts`, also pre-existing).

**The external proposal: answered as a sequence, not as a yes.** SHAREN filed #331, arguing
that MCP should be a first-class "external deep coach" interface - GymCoach owning the data,
the deterministic training logic and the safety boundary, the user's own ChatGPT or Claude
doing the deep reasoning, MCP as the bridge - with four scenarios (scheduled post-workout
analysis, a photographed paper log imported through preview, printable sheets, equipment
onboarding by photo and voice). The vetting pass came back clean (no injection, in scope,
and it matches the shape of the MCP layer SHAREN already built in #276), and the
threat-model lens is what shaped the answer. Three findings decided the ordering. `McpAccessToken`
carries a single `canWrite` boolean that today authorizes program authoring only, so adding
session, equipment or import writes under that same boolean would retroactively escalate
every token users have already issued - a token created to let an agent adjust a program
would become one that can rewrite the training log, and programs are re-derivable where
completed sets are the app's ground truth. Hence: scopes ship with or before any write
expansion, never after. Second, `confirmed: true` is asserted by the model and not by the
human, which is tolerable at one-program-change granularity and materially weaker when one
`confirmed` covers N mutations, so batch operations come last and behind preview-then-confirm.
Third, agent-authored equipment text flows back into `get_training_context` and into the
in-app coach prompt, which makes it a store-and-replay channel and means equipment writes
need strict enums and length caps rather than free-form passthrough. The answer posted
inside the tick is a six-PR sequence (session reads, then token scopes with existing
`canWrite` mapped to `programs:write` only, then a write audit log, then dry-run, then
session writes, then equipment and batch), plus five questions whose answers change the
implementation, plus the honest note that PRs 2-6 all touch hard-blocked paths and so are
human-merged exactly as #311-#313 were. The issue is labeled `enhancement` +
`needs-maintainer`: the direction call belongs to the operator, not to the loop. The one
piece that is pure app code and touches no blocked path - the printable A4 workout sheet -
was adopted as **#333**, crediting SHAREN, and is the loop's to take.

**Green gate.** All three PRs passed the local gate and CI before merge. One process defect
showed up in the shipping half and is now closed: this machine's `gh` is 2.4.0, where
`gh pr checks <n> --watch` prints `unknown flag` and then **exits 0** - a missing flag that
fails loudly is an inconvenience, but one that reports success is a gate that can be read as
green without a single check having been resolved. `ship-pr` step 2 now polls
`gh pr view <n> --json statusCheckRollup` and decides on the check conclusions rather than
on an exit code (lesson **L5**, reinforced and finally graduated). A second, harmless one
recorded in the same place: with the PR branch still checked out in a worktree,
`gh pr merge --delete-branch` exits 1 *after* the merge has already landed, which invites a
pointless retry; the cleanup is `git push origin --delete <branch>` plus `git worktree
remove`.

**The stall that cost orchestrator attention (L21).** Two of the three dev ticks
backgrounded a prerequisite - `npm ci` in a fresh worktree, `next start` - and then ended
their turn saying they were waiting to be notified when it completed. Nothing notifies them:
a subagent tick is not re-woken by a background job finishing, so both sat done-but-unfinished
until the orchestrator resumed them. The work was never wrong, only stalled, which is what
makes it easy to miss and worth a lesson: "run it in the background and wait" is an
interactive-session habit, and inside a loop tick it converts an autonomous tick into one
that needs a babysitter. Graduated into `implement-issue` step 5: run bootstrap and the gate
synchronously, poll a server until it answers, never end a turn waiting on a background
process.

**One metric.** Accepted-change rate this batch: 3 merged / 0 abandoned (#334, #335, #336),
plus this docs PR. No reverts, and zero fixup rounds - all three PRs were green and clean on
their first CI run. 2 follow-up issues filed by the reviewers on the batch's own work (#337,
#338) plus 1 pre-existing nit (#339). 1 external design proposal answered inside the tick
(#331), 1 issue adopted from it (#333). Implementing-tick token spend: not recorded
separately (the three dev ticks ran on Fable per the model-routing directive; the three
skeptic reviews, the #331 vetting pass and this write-up ran on Opus).

**Deferred.** #333 (printable A4 workout sheet, adopted from #331) and the operator's
direction call on the rest of #331; #337, #338, #339 from this batch's reviews; #324
(return-to-training follow-ups from the #311 review), #320 (browsable exercise library),
#300-#304 (the rest of the "make it pop" ideas). The demo-media debt is now partly paid -
`catalog.png` was re-shot in #336 and the whole set was refreshed by #329 - but no committed
clip yet shows the equipment picker or the muscle heat map, so the recorded scenarios remain
the oldest media debt.


## 2026-09-07 - the first unvetted-tier wave: shaurya703's #341/#342/#343 merged on the operator's in-session authorization, two review rounds each, and one defect only CI saw

**What ran.** A new contributor, @shaurya703, opened three fork PRs on the morning of
2026-09-04, each closing a follow-up the loop's own reviewers had filed the day before: #341
for #338 (the default catalog never set `equipmentType`, so every seeded exercise read "Any
equipment"), #342 for #337 (a dropped-equipment notice lost when no session screen is
mounted at flush time), #343 for #339 (the French comments in `tailwind.config.ts`). The
author is on no list, so this is the first time the unvetted-tier path of
`10-external-contributions.md` ran end to end on real code: the loop does the review labor,
a human owns the merge. The README thanks and the CHANGELOG credit for #342/#343 landed in
#344 the same morning as the merges; this entry's PR adds the #341 credit, the `catalog.png`
re-shoot the #341 review took on itself, and one CLI lesson. Triage and ideate did not run.

**The vetting sequence, as actually run.** Pass 1 (mechanical) on 09-04: the three PRs touch
disjoint files, all three were cut from the current `main`, and only #343 sits on a
hard-block path (`tailwind.config.ts` is executable config) - and that one is comments only,
confirmed hunk by hunk. Pass 2: four independent Opus lenses, security and correctness,
read-only on the pinned SHA with the diff as data. Security came back clean on all three:
counts reconciled on #341 (55 entries, 55 new lines, an import and an interface field,
nothing else touched), no new egress or storage access on #342 and the drain shown to patch
exactly one key so it can never return a set to the flush selection (the invariant #313
taught), nothing but comments on #343. Correctness asked for the same thing on all three:
em-dashes - one in #341, one in #343, eight in #342 including a test title. Nothing in lint
catches them, so all three would have merged green while breaking an explicit CONTRIBUTING
rule; a reviewer is the only gate for that one, and it held. Correctness also found the real
defect of the wave, on #342: read-then-clear was not atomic, so two overlapping drains -
which `reactStrictMode` produces on every dev mount, and a flush broadcast landing during
the mount drain produces in production - both read the row before either nulled it, and the
toast showed twice. A duplicate toast, not data loss, but exactly-once was the PR's thesis,
so it blocked. On #341 the review offered an optional widening of the name pin and took the
`catalog.png` re-shoot on itself, since it needs a seeded running app the contributor cannot
produce. Zero local execution of contributor code, per the L18 execution gate: CI was the
only thing that ran it, with the first-contributor workflow runs approved by hand as each
SHA landed. Pass 3 on 09-07: check runs resolved against the current head SHA rather than
the PR (L19), and each merge pinned to that SHA.

**The human step.** Unvetted-tier PRs are never merged by the loop on its own. The operator
authorized merging these three in-session, before the verdicts went out, and the verdicts
said so in the open ("once the hyphen is pushed and CI is green on the new SHA, this gets
merged"), so the contributor knew the bar and who had set it. That authorization is the
human merge step the policy requires, and it was scoped: these three PRs, on green CI, after
the fixups. It does not promote the author - the vetted list is a human-granted edit to the
policy file, and it did not change this wave.

**One round on #342 and #343, two on #341 - and what CI caught that review did not.** #343:
one push, the dash replaced by a full stop, merged. #342: one push with the dashes gone and
the drain rewritten to run inside a single Dexie `rw` transaction with `modify()`, which
closes the window for every caller rather than for the one component; a fresh re-review lens
checked that against Dexie's `Collection.modify` source rather than its docs, confirmed the
whole-record put cannot interleave with a flush-path `update()` because IndexedDB serialises
readwrite transactions on one store, and passed it with two non-blocking nits. #341 took
two. The first push dropped the dash and widened the pin, and CI's typecheck went red on it:
the repo compiles with `noUncheckedIndexedAccess`, so `named[0]` is `T | undefined` even
after a length check, and a `tsc --noEmit` run outside the repo's tsconfig does not see
that. Every test passed on that same SHA, and four review lenses plus a re-read of the diff
did not flag it either, because a reviewer reads the types the code implies while the
compiler reads the ones the config imposes. The second push narrowed once and destructured;
green; merged. The sentence worth keeping: CI is not the tiebreaker after review, it is a
lens with a different input, and a strictness flag the repo turns on is exactly the kind of
thing only that lens can see.

**The contributor corrected the reviewers, and was right.** The #341 verdict pitched the
wider pin as roughly 40 names "with no false positive we could find". The contributor found
three in the current names - a pec deck whose aside mentions cables, a barbell hip thrust
whose aside mentions a machine, and a rowing machine that is cardio - all of one shape, an
equipment word that is not the exercise's own equipment, and encoded the fix as two rules
that now document the naming convention: a parenthesised aside names the alternative and is
stripped before matching, and cardio is skipped because another test already pins it. That
lands at 29 pinned names with a floor on the count, so a regex that quietly stops matching
cannot leave the test green and empty. On #342 the contributor flagged the thing the
reviewer's own security argument had leaned on: after the transaction rewrite `modify()`
writes the whole record, so "partial patch cannot clobber" no longer holds and the safety
rests on transaction serialisation instead; the comment in the code was rewritten to say the
actual reason. Unprompted, the same PR reported that its first concurrency test had passed
against the unfixed drain because the fake resolved reads in the same tick, and made the fake
yield so that red-first was real. Recorded because the policy's bet is that review labor
produces fixes rather than churn, and this wave's evidence is that a careful contributor
produces better review than the reviewer on the points they touch. Every round was answered
within hours.

**The merge mechanics, and a lesson.** The three merges were pinned to their head SHAs
through `PUT /repos/{owner}/{repo}/pulls/{n}/merge` with `sha`, not through
`gh pr merge --match-head-commit`, because this host's gh is 2.4.0 and does not know the
flag - the same old-CLI family as L5, met one step later. The endpoint is the same
fail-closed contract (GitHub refuses when the head has moved), so the policy does not change;
the REST form now sits in one sentence beside the flag in `10-external-contributions.md` and
in `ship-pr`, together with the corollary that this box has no `jq` and `gh --jq` is the
substitute (**L22**).

**Green gate.** CI green on every pinned SHA before each merge (#343 on `2203921`, #342 on
`dbb52b1`, #341 on `68cf687`); no local gate on any of them, deliberately. This PR passed
the local gate. The re-shot `catalog.png` was captured against an isolated Postgres and app
port (never the shared :5434 / :3031), then looked at: the first cards now read Barbell,
Dumbbells and Machine beside the rest time, where every one of them said "Any equipment".

**One metric.** Accepted-change rate this wave: 3 external PRs merged / 0 abandoned (#341,
#342, #343), plus #344 and this docs PR from the loop. No reverts. Fixup rounds: 2 on #341,
1 on #342, 1 on #343, every one re-reviewed against a freshly pinned SHA. 0 local executions
of contributor code. 5 review lenses (the mechanical pass plus four independent Opus lenses)
+ 1 re-review (#342 after the transaction rewrite). 1 defect caught by CI alone (the #341
typecheck). 2 reviewer claims corrected by the contributor. README thanks in #344.
Implementing-tick token spend: not applicable, no loop-authored code this wave (reviews and
the write-ups ran on Opus; this close-out tick, docs and a screenshot, ran on Fable).

**Deferred.** The two non-blocking nits from the #342 re-review (`return false` from the
`modify` callback to skip the no-op puts, and a `.catch` on the fire-and-forget mount drain),
offered to the contributor as a follow-up and not filed; #333 (printable A4 workout sheet)
and the operator's direction call on the rest of #331; #324 (return-to-training follow-ups),
#320 (browsable exercise library), #300-#304 (the rest of the "make it pop" ideas). The
demo clips still show neither the equipment picker nor the muscle heat map, which remains
the oldest media debt.

## 2026-09-11 - the printable A4 sheet (#333 -> #346) and the return-to-training follow-ups (#324 -> #347), plus three lessons about the gate

**What ran.** Two loop-authored dev ticks on Fable, serialized on one checkout, each
reviewed by independent Opus lenses before merge and squash-merged on green CI pinned to
its head SHA. #333 (printable A4 workout sheet, adopted from @SHAREN's #331 proposal in the
previous wave) shipped as **#346** on `aa0e78f`; #324 (the follow-ups the #311 review left
behind) shipped as **#347** on `6724ec7`. The loads lens on #347 found something outside
its diff and it was filed rather than bolted on: **#348**. Triage and ideate did not run.
Two feature merges plus this docs PR is the 3-merge cap for the run.

**Why these two, in this order.** #333 was the piece of an external design proposal the
policy allows the loop to adopt on its own - a pure web-app feature on no hard-block path -
and it had been carried forward for a week. #324 was the loop's own review debt: findings
from the #311 review that were filed instead of fixed, which is exactly the kind of issue
that quietly never gets done. Doing the feature first and the debt second was deliberate;
the debt ticket is the one that changes the numbers the app tells a user to lift, so it got
the fresher reviewers and the longer look.

**The sheet (#346).** A new `app/(print)` route group with a chrome-free layout, a pure
builder in `lib/print-sheet.ts` (rows in superset presentation order with the A1/A2 labels,
`targetSets x 3` empty cells - weight in the user's own unit, reps, RIR - plus a blank notes
line), a "Print sheet" button on the program page and a per-workout menu item, `@page` A4
portrait and black-on-white under `@media print`, strings in en/fr/ru, and unit, component
and E2E tests. Product calls taken without a human: the whole program prints by default at
one page per workout and `?workout=<id>` narrows to one session; the weight cell is labelled
with the display unit (kg / lb) rather than a translated word; the sheet renders black on
white **on screen too**, so the browser preview is the paper. One acceptance criterion could
not be met as written - the issue asked for a screenshot of the print preview in the PR body,
and `gh` on this host has no image hosting path - so the capture was produced, looked at, and
delivered to the operator instead; it is committed in this PR as
`docs/screenshots/print-sheet.png`, which is the durable version of that criterion.

**The follow-ups (#347).** Three things, all from the #311 review. The dead
`nonComparableExerciseSessions` input and its `nonComparableHistorySessionCount` output were
removed together with the test that hand-fed them a value - no caller ever populated either.
`constrainGymWeight` was rebuilt on `gymWeightOptions`, so `OTHER` equipment with saved
weight options now snaps like a machine (which `constrainGymWeightAtOrBelow` already did) and
the barbell ceiling is one shared expression, proven output-neutral. And the history read now
fetches the long-term anchor budget (8) plus the recent budget (14) and splits them, so a
comeback session can no longer take a long-term anchor's slot.

**The reviewer shrank the headline claim, and that is the useful part.** The issue feared
that recent sessions could push the long-term pool below the robust-anchor minimum of 3. The
algorithm lens derived that this is unreachable: in any non-normal return mode at most one
recent session exists by construction, so the real effect of the change is 7 -> 8 anchors,
not a rescue. The fix is still right and still shipped - but the log records the corrected
claim, not the one the issue was written on. The reachable case (the comeback session
displacing the oldest anchor) is now pinned by an integration test that was verified red
against the old read before the new one landed.

**What was challenged, by which lenses.** #346: one Opus skeptic with three lenses
(correctness, security/ownership, does-it-actually-work-on-paper), verdict READY with
non-blocking findings. #347: two independent Opus reviews, one on the algorithm and one on
loads plus repo conventions, both READY non-blocking. Five lens-passes, zero blocking
findings, three issues-worth of fixups - which is the pattern this run wrote down as **L25**:
*"READY with findings" is not "merge as is"*. On #346 the fixups were an empty `?workout=`
becoming a 404 through the Zod parse (it had fallen through to "print everything"), `maxSets`
derived from the cell-kind list instead of a second literal `3`, `SyncBootstrap` mounted in
the new print layout so the "live on every protected route" invariant survives a new route
group, and the E2E extended to cover them. On #347 they were honest pool comments (the first
one promised a guarantee the code does not give), the red-first integration test above, and a
dropped assertion that only restated a constant. Each fixup was a commit before the merge and
the merge was pinned to the resulting SHA, not to the reviewed one.

**Three lessons, all about the gate rather than the code.** **L23:** `verify.sh --full` never
runs `prisma migrate deploy`. Docker Desktop is off by default on the operator's box and was
started mid-run, so the tmpfs test Postgres came up empty and the integration tier died with
`relation "Message" does not exist` - an error naming a table nobody had touched. L4 already
said "migrate the test DB", but it said it about fresh worktrees; the checkout was never the
variable, the container is. Graduated into `CLAUDE.md`'s green-gate section and
`implement-issue` step 5, with the command. **L24:** the first gate run on the #347 branch
failed typecheck on `.next/types` stubs for `app/(print)/...`, a route group that exists only
on the #346 branch - `.next` is build state shared across branches, and the gate typechecks
*before* it builds, so the step that would regenerate the stubs never runs. `npm run build` on
the current branch fixes it (`rm -rf` is denied by settings). Graduated into
`implement-issue` step 5. **L25** is above, graduated into the charter's subagent challenge
protocol.

**Merge mechanics.** Both merges went through
`PUT /repos/{owner}/{repo}/pulls/{n}/merge` with `sha=`, per L22 - this host's gh 2.4.0 has no
`--match-head-commit` - after resolving the check runs against the current head SHA rather
than the PR summary (L19). CI green on `aa0e78f` and `6724ec7` respectively; both local gates
green before the push.

**One metric.** Accepted-change rate: 2 loop-authored PRs merged / 0 abandoned / 0 reverted,
plus this docs PR as the third merge of the cap. Fixup rounds: 1 on each PR, both re-verified
on a fresh SHA. 1 issue filed out of review (#348). Implementing-tick token spend: about 135k
on #346 and about 140k on #347, both on Fable; the three reviews cost about 97k, 100k and
103k on Opus. So roughly 275k of implementation bought by roughly 300k of review - review is
now the more expensive half of a feature merge, which is a deliberate trade while the loop
merges its own code unsupervised, and a number worth watching if it keeps growing.

**Deferred.** **#348** (OTHER is the default equipment type and `lib/gym-equipment.ts` copies a
linked item's stack onto every linked exercise regardless of that exercise's own type, so the
new snapping reaches further than a kettlebell rack and a short inherited list can make the
session stepper's `+` a dead button) - filed, not fixed, because the fix is a product call
about inheritance rather than a bug fix. Accepted for now on #346: the cell height is about
6mm, which is tight for handwriting, and the `@media print` block in `globals.css` is
app-wide rather than scoped to the print route group - both known, neither worth a second PR
this run. Still with the operator: the MCP half of #331 (`needs-maintainer`), #320, and
#300-#304. **Media debt:** the recorded clips now lag three shipped features - they show
neither the equipment picker, nor the muscle heat map, nor the print sheet. That is past the
~3-batch staleness cap in the `write-up` skill and is the first thing the next content tick
should spend its time on; the static screenshots are current, with `print-sheet.png` added
here.


## 2026-09-13 - the second SHAREN wave: seven fork PRs reviewed in one run, two auto-merged at the vetted tier, five handed back to the operator with findings

**What ran.** @SHAREN opened seven fork PRs between the evening of 09-12 and midday 09-13:
#350 (progress-photo paths), #351 (calendar history view), #352 (PWA update refresh), #353
(locale switching), #354 (MCP date formatting), #355 (live-session exercise strip) and #356
(inline strength-set editing). SHAREN is on the vetted list, so the auto-merge path of
`10-external-contributions.md` was available - but availability is not the verdict, and this
run is the first where the policy's two independent brakes, the hard-block path gate and the
review findings, did most of the deciding. Two PRs merged; five are open with public verdicts
and a suggested order. No dev tick, no triage, no ideate.

**Pass 1, mechanical, and it disposed of most of the wave.** Two PRs touch nothing on the
hard-block list: #350 is one line in `lib/progress-photo.ts`, #354 is
`components/settings/mcp-section.tsx` plus its test. The other five are all blocked
mechanically, not on merit: #351, #355 and #356 edit `messages/**`, #352 edits
`next.config.js`, and #353 edits `middleware.ts`, `i18n/**` and `messages/**`. The overlap
check also fired: #355 and #356 both modify `components/session/session-runner.tsx` and
`messages/*/session.ts`, so even if both had been mergeable, the rule against auto-handling
two PRs with overlapping files in one run would have kept the second one out - each was
reviewed against today's `main`, and the merged composition is what neither review saw.

**Pass 2, eight lenses, split by PR size.** The four policy lenses (backdoor / egress,
test-gaming, correctness, threat model) were run twice: once over the four small PRs, once
over the three large ones. That split is the practical fix for a requirement the policy
already makes - a lens must state what it checked, and "clean" on a diff too large to have
been read carefully defaults to not ready. Batched that way, every lens could and did claim
it had read the changed lines in full; the one lens that resolved a file by targeted grep
rather than a full read said so in its verdict. Zero local execution of contributor code, per
the L18 execution gate: no checkout, diffs read as data, CI the only executor. CodeRabbit's
"Prompt for AI Agents" blocks appeared on several PRs and were treated as leads only, per the
advisory-lenses rule. No injection attempt was found in any PR body, commit message or
comment.

**What the lenses found.** #350 and #354: CLEAN on all four lenses each, including a check
that #354's new regression test is a real test - it spies with a throwing stub, so it fails
if the formatting call is removed rather than passing vacuously. The other five all came back
with findings, and two of them are the reason this entry exists. On **#353**, all four lenses
landed on the same two majors independently: the locale cookie's `Secure` flag is derived
from `x-forwarded-proto`, a client-controllable header, which contradicts the env-driven rule
`lib/auth.ts:71-84` documents and spells out the reasoning for; and the new public `POST
/api/locale` does not Zod-validate its body, so a literal `null` reaches a property access
and returns 500 on an unauthenticated route. On **#356**, the new `PATCH /api/sets/[id]` is
owner-scoped but drops the finished-session and category guards that the POST path in
`app/api/sessions/[id]/sets/route.ts` enforces, so through the raw API a cardio set can be
given a 500x100 working-set shape; it also omits `gymEquipmentId` from the table's submit
payload, quietly bypassing the equipment snapshot that #313/#325/#326 built. The rest, in
brief: #351 makes the CSV export permanently month-scoped and buckets days in the server
process timezone rather than the lifter's; #352 reloads a visible tab unconditionally, which
mid-workout drops the lifter back to exercise 1; #355 remounts the runner when the current
strip tile is tapped during rest, losing the rest timer and auto-advance, and keys selection
by `exerciseId` rather than `ProgramExercise.id`.

**Two merges, five handed back.** Pass 3 was green CI on every pinned SHA (#350 `63687e7`,
#351 `8c2aa4f`, #352 `e2c02aa`, #353 `67189d3`, #354 `2695bfb`, #355 `d16a3e4`, #356
`798d9c2`). A rollback baseline tag `autonomy-baseline-2026-09-13` was pushed before any
merge. #350 and #354 were merged through `PUT /repos/.../pulls/{n}/merge` with `sha` pinned
to the reviewed SHA (L22; squash, commits `84fe3be` and `0cbcbe4`). The other five stay open
with their structured verdict posted as a comment and a suggested merge order - **#356 before
#355**, because of the `session-runner.tsx` overlap. One follow-up was filed from #352's
threat-model lens and is not about #352 itself: **#357**, the `api-get` service-worker cache
is never purged on logout, labelled `needs-maintainer` because it is auth-adjacent.

**The thing worth keeping from this run.** The five open PRs are not rejected and their author
is not on trial - they are good work sitting on paths the policy says a human owns, carrying
findings a review would not merge past. What made the verdicts useful was not the checklist:
it was giving each lens the specific questions the diff raises (which header is trusted, which
route is public, which sibling route enforces the guard this one skips) instead of a generic
pass. That is what produced four independent lenses converging on the same two majors on #353,
and it is now written into pass 2 of the policy along with the batch-sizing rule (**L26**,
**L27**).

**Green gate.** No local gate on any contributor PR, deliberately - CI on the pinned SHA is
the only executor. This docs PR passed the local gate.

**One metric.** 7 external PRs reviewed, 2 merged, 5 open awaiting a human decision, 0
abandoned, 0 reverts. 0 local executions of contributor code. 9 review passes (1 mechanical +
8 Opus lenses). 1 rollback tag, 1 follow-up issue (#357). Review token spend, on Opus, across
the eight lenses: roughly 68k, 127k, 76k, 102k, 96k, 168k, 80k and 120k, about 837k in total.
Verdict authoring and the two merges ran on Fable, as did this write-up. Implementing-tick
spend: not applicable, no loop-authored product code this wave - which is the interesting
shape of the number. About 840k of review bought two merged one-liners and five documented
decisions for the operator. That is the honest price of doing the review labor for outside
work, and it is the bet `10-external-contributions.md` makes.

**Deferred.** #351, #352, #353, #355 and #356 are with the operator. **#357** is filed, not
fixed. Still standing: #348, #320, #300-#304, and the MCP half of #331. **Media debt:** the
recorded clips still lag the equipment picker, the muscle heat map and the print sheet - past
the ~3-batch cap, and unchanged by this run, which shipped no user-visible capability.

---

## 2026-09-14 - the SHAREN wave closed 7/7: five hard-block PRs merged on an explicit in-session operator authorization, eight delta re-reviews, zero host executions

**Context.** Yesterday's run left five fork PRs open with structured verdicts and a suggested
order, because all five sit on hard-block paths (`messages/**`, `next.config.js`,
`middleware.ts`, `i18n/**`) that `10-external-contributions.md` reserves for a human merge.
Today the operator wrote, in session:

> "Tu peux avancer et valider sans moi suivant tes recommandations, je te fais confiance"

That is the thing to record precisely, because it is easy to write it up as something it is
not. **The policy did not change and the loop did not merge autonomously.** Hard-block paths
are still human-merge-only; what happened is that the human, having read the verdicts, made
the merge decision and delegated its execution to the loop - the same precedent as the #272
fork adoption and the #341-#343 shaurya703 wave. The loop's authority here is the operator's
sentence, nothing else. Had that sentence not been written, the five PRs would still be open.

**What shipped.** All five merged, each as a MERGE commit pinned to the reviewed SHA via
`gh api -X PUT .../pulls/<n>/merge -f merge_method=merge -f sha=<head>`, so @SHAREN keeps
authorship in `git log` (visible under `git log --merges`):

- **#352 -> `d1875e4`** (head `bfeeeff`). PWA clients refresh onto a new bundle when the
  replacement service worker takes over. Maintainer fixup: defer the reload while a
  `/session/` route is on screen (it would drop the lifter back to exercise 1) or the tab is
  hidden, and guard a reload cycle with a 30 s `sessionStorage` stamp - the contributor's
  in-page flag could not survive the reload it had just caused.
- **#353 -> `ad6431b`** (heads `70164d7` then `3b73dc2`). Locale switching works behind a proxy
  and on the public login/signup pages. Maintainer fixups: the `Secure` flag now comes from a
  new `cookieSecureFlag()` exported from `lib/auth.ts` and **shared with the session cookie**,
  instead of being derived from `x-forwarded-proto`; a Zod `z.enum(locales)` body; a
  same-origin check replacing the framework origin check the Server Action had for free; a
  real pending state on the selector; 12 route tests. The second fixup, from the delta
  re-review, takes the browser-facing host from the **first** entry of a chained
  `X-Forwarded-Host`.
- **#351 -> `7b408b6`** (heads `1aea97e` then `9f64ffd`). Calendar workout history. Maintainer
  fixups: the CSV export is unscoped again (month is a view, not an export scope); day
  bucketing moves to the lifter's zone through a validated `?tz=` param set on mount and
  carried on every link; weekday labels built at UTC noon; Monday week start for `fr`; dead
  message keys removed; a filtered-empty state. The second fixup, from the delta re-review,
  carries the zone and the filters onto the session **detail** page, which was still
  formatting in the server zone.
- **#356 -> `c8ec6ef`** (head `67d2f4b`). Inline strength-set editing during a live session,
  and the interesting one: **the contributor closed every major himself**, in 11 commits
  within hours of the verdict being posted - PATCH guards mirroring the POST path, one
  serializable transaction with parameterized `FOR UPDATE` locks and a bounded retry on
  `P2034`, the canonical kg picker, `gymEquipmentId` back in the submit payload, the rollback
  re-read. The loop's fixup tick, which had been scoped to implement those findings, reduced
  to four integration tests for the new branches and picker labels aligned with the row format
  (**L30**).
- **#355 -> `ffb16b1`** (head `fcc9b70`). Live-session exercise strip plus a per-exercise
  detail page. Merged last and on top of #356, per yesterday's suggested order, and it merged
  without conflict. Maintainer fixup: the strip is inert while the runner is not in input mode
  (rest, summary), selection is keyed by `ProgramExercise.id` through `?programExerciseId=`
  rather than by exercise id, and an unconfirmed inline draft is parked per row across strip
  jumps.

**The execution gate held, and became a script.** Zero executions of contributor code on the
host. Every gate run happened inside an ephemeral isolated container (fresh archive of the
committed ref, `--network none`, no `.env`, no `~/.config/gh`, no `~/.ssh`, host
`node_modules` read-only); integration and E2E ran only in CI, which is where the pinned-SHA
pass 3 comes from. The command had been assembled by hand and then copy-pasted five times,
which is how a control quietly stops being applied, so it is graduated here into
`scripts/container-gate.sh` and `scripts/container-run.sh` and documented under "The execution
gate" in `10-external-contributions.md`, three gotchas included (`npm_config_offline=true` or
`npx prisma generate` probes the registry; cap vitest at 6 workers or a 5 s component test
times out; the archive covers the committed tree only) (**L28**).

**Challenged.** Eight independent Opus delta re-reviews, one per fixup delta, every one
READY/CLEAN before its merge; the #356 contributor delta got two lenses (correctness + threat
model) because it added a write route. This is not ceremony: the verdicts that authorized
these merges were written against the pre-fixup SHAs, so without a delta re-review the merge
would have been pinned to a tree nobody had read - and the re-reviews caught two real
follow-ups, the chained `X-Forwarded-Host` on #353 and the un-zoned detail page on #351
(**L29**). Rollback baseline: `autonomy-baseline-2026-09-13`, pushed before the first merge of
the wave, still the tag to reset to.

**Production bugs surfaced.** None new. **#357** (the `api-get` service-worker cache is never
purged on logout) remains open and `needs-maintainer`; #352 widens it via `clientsClaim` and
does not cause it.

**Green gate.** This docs PR passed the local gate on the host (loop-authored code). No
contributor code was gated on the host at any point.

**One metric.** 7 external PRs in the wave, **7 merged** (2 auto-merged at the vetted tier on
09-13, 5 under the operator's in-session authorization today), 0 abandoned, 0 reverts, **0
host executions of contributor code**. 16 review lenses total: 8 initial (09-13) + 8 delta
(today). 6 maintainer fixup commits, 1 rollback tag, 1 follow-up issue (#357) still open.
Fixup ticks on Fable: ~273k (#353), ~276k (#352), ~289k + ~297k (#351, two rounds), ~261k +
~292k (#356, two rounds), ~362k (#355) - about 2.05M. Delta reviews on Opus: ~68k, ~69k, ~96k,
~73k, ~88k, ~120k, ~79k, ~103k - about 696k. With yesterday's ~837k of initial review, the
wave cost roughly 3.6M tokens for 7 merged PRs, about 4,600 net lines of contributed product
code the loop did not write. The shape of that number is the point: most of the spend is
review and fixup labor on someone else's work, and #356 is the case where doing that labor
publicly got the *contributor* to do the fixing - the cheapest merge of the wave.

**Deferred.** #357, #348, #320, #300-#304 and the MCP half of #331 stand. **Media:** the
history calendar joins the captured pages (`docs/screenshots/history.png`;
`scripts/screenshots.mjs` gained an `openLatestCalendarDay` option so the shot lands on a day
that actually has sessions rather than on an empty rest day, and aborts loudly if none does).
Home and progress were re-shot and then reverted on purpose: neither page changed this wave,
and the fresh home capture lost the coach-insight card, which the demo seed only produces on
some run dates - a re-shoot that makes the frame worse is not a refresh. **Media debt stands:**
the recorded clips lag four shipped capabilities (equipment picker, muscle heat map, print
sheet, and this wave's calendar / inline editing / exercise strip), well past the ~3-batch cap.

---

## 2026-09-30 - the third SHAREN wave: eight fork PRs merged 8/8 on an in-session authorization, fourteen delta reviews, a missed 72 h verdict, and the integration tier moved into a container

**Context.** @SHAREN (vetted tier) opened eight independent fork PRs on 2026-09-16 and 09-17:
#362 (MCP equipment backfill), #363 (in-session exercise actions), #364 (gym-aware weight
picker), #365 (in-session equipment weight editing), #366 (barbell loading diagram), #367
(table metric columns), #368 (MCP gym inventory) and #369 (MCP capability index). Six of them
touch a hard-block path: `lib/mcp/**` (#362, #368, #369), `prisma/schema.prisma` plus a
migration (#362), and `messages/**` (#363, #365, #367). Today the operator wrote, in session,
that there were many new PRs from SHAREN and delegated handling them end to end to the loop.
That was taken as the explicit in-session authorization for **this wave**, hard-block PRs
included - the same precedent as 2026-09-14, and the same caveat: **the policy did not change**,
hard-block paths are still human-merge-only, and the loop's authority for the seven merges
outside the automatic path is that sentence and nothing else.

**The missed commitment, stated plainly.** `10-external-contributions.md` promises a full
structured verdict on an external PR within 72 h. These PRs got none until today: the
commitment was missed by about eleven days, on all eight. No verdict was posted in that
window. The verdict comments apologise for it; the policy text is unchanged, because the
promise is right and the loop simply did not keep it.

**Pipeline as run.**

- **Pass 1, mechanical.** Heads pinned, hard-block hits recorded, overlaps mapped:
  `editable-sets-table.tsx` (#364 / #365 / #367), `session-runner.tsx` (#363 / #365),
  `messages/*/session.ts` (#363 / #365 / #367), and `lib/mcp/server.ts` (#362 / #368 / #369),
  the last three all conflicting with `main`'s #371 (`add_workout`).
- **Pass 2, nine independent Opus lenses in two batches** (MCP: #362 / #368 / #369; session UI:
  #363-#367). Four lenses each - backdoor / egress, test weakening, correctness, threat model -
  with correctness split in two for the UI batch. Each lens got the concrete questions the
  diffs raised (**L27**) and had to name what it read in full (**L26**). Verdicts posted as PR
  comments. No injection attempt, no egress, no cross-user path, and no weakened test except
  one loosened assertion on #367.
- **Fixups.** Maintainer fixup ticks, one git worktree per PR, every execution inside
  `scripts/container-run.sh` / `scripts/container-gate.sh` plus a new helper for the
  integration tier (below). Fixups pushed to the contributor's branch; merges pinned to the
  reviewed SHA with `gh api -X PUT .../pulls/<n>/merge -f merge_method=merge -f sha=`. Each
  fixup tick ran a mutation check on its own new tests (revert the fix, confirm the tests
  fail) and reported it (**L36**).
- **Delta reviews (L29).** Every fixup round got an independent Opus delta review, two lenses
  when the delta touched the MCP surface: 14 in all (#368 x4, #364 x2, #363 x2, #362 x2, #369
  x2, #367 x1, #365 x1; none for #366, which merged without a fixup).
- **Pass 3.** Green CI on each pinned SHA, rollback tag `autonomy-baseline-2026-09-30` pushed
  before the first merge. Merge order: #366, #367, #362, #364, #363, #365, #368, #369.

**Findings that mattered.**

- **#364** reset its pending value on every parent re-render; snapped the stored weight on
  open (220 kg became 200, 73 became 72.5 on a plain Apply); and duplicated #366's
  bar-selection helper and diagram.
- **#363** said "active workout" in its copy while the actions edit the saved program; a
  replace skipped confirmation when no working set was logged; a replace left a stale draft.
- **#365** re-snapped a logged set's weight to the equipment selected for new sets on any
  edit, RIR-only included; its weight-list parser split on commas, so "22,5" was saved
  silently as 22 and 5.
- **#362** had correct ownership guards that no test exercised (removing them would have
  failed nothing); a Prisma model inserted between another model's doc comment and that model;
  and it widened write consent silently.
- **#368** annotated three overwriting tools `destructiveHint: false`; let a prompt-injected
  client plant an external image URL that later clients would be handed; and widened write
  consent silently.
- **#369** hard-coded a tool list that was stale against `main` - its own exact-equality test
  would have failed after the merge, which is the test doing its job.
- **The delta reviews paid.** On #363 the delta review caught a regression the fixup itself
  introduced: the 64 px actions button rendered only in input mode, so the card header jumped
  about 24 px at every set / rest transition - fixed in a second round before the merge. On
  #368 it found that an empty `imageBase64` crashed with a raw `TypeError` surfaced to the MCP
  client - fixed.

**Decisions the loop took under the delegation - flagged for the operator.** These are the
loop's calls, not the operator's, and each is listed first in `review-digest.md`:

1. **#363 keeps the contributor's semantics:** the in-session actions edit the saved program.
   The copy now says so and a replace always confirms. A session-scoped override was not
   built.
2. **MCP write consent:** the single write toggle is relabelled "Allow changes to saved data",
   and its description and `docs/chatgpt-mcp.md` name programs, gym inventory and workout
   history. Separate write scopes need a migration and a default for existing tokens: filed
   as **#375**, `needs-maintainer`.
3. **#368:** the external image URL mode was removed from the MCP tool (uploaded bytes or
   clear only); the REST route is unchanged.

**Two process failures, both absorbed.** A stack that received its sibling through the
sibling's branch went "dirty" on GitHub once the sibling landed through `main`: no CI on #369,
and HTTP 405 on #368's pinned merge although its CI was green. Merging `origin/main` into the
stacked branch fixed it, at one extra CI cycle on two PRs (**L31**). And the temptation to
merge a stack's second PR on the strength of its superset-tree CI was declined: #364 and #368
each merged on their own green run first (**L32**). Two late MINORs (#364's wheel nudge on an
off-grid value, #365's leading-comma token) went to a maintainer follow-up instead of a third
container round (**L34**): issue #382, implemented by the loop in **#383** (open at the time of
writing).

**The integration tier left CI-only.** Fixups on the MCP PRs needed their integration tests.
A helper ran them in a container on an `--internal` docker network whose only other member is
a throwaway Postgres on tmpfs - a fresh database per run, `prisma migrate deploy`, then
Vitest, no route to the host or the internet, no credentials. The first run with the unit
tier's six workers failed on foreign keys, because a forced worker cap overrides the
integration config's `fileParallelism: false`; one worker fixed it. The helper graduates in
this PR as `scripts/container-integration.sh` (**L33**).

**CI infrastructure failures.** 8 pushed heads, 18 run attempts, 10 reruns - every rerun for
the same failure: `toomanyrequests: Data limit exceeded` pulling
`public.ecr.aws/docker/library/postgres:16-alpine`, at "Initialize containers" of the
service-container jobs or "Start Postgres" of the smoke job. Zero real CI failures. Attempts
per head: #367 2, #362 2, #364 3, #363 1, #368 4 on its first head and 3 on the re-merged head,
#365 1, #369 2. The run's waiter classified the failed step before calling
`rerun-failed-jobs` (bounded, with a pause); it also learned that the pulls API can report the
old head for a few seconds after a push (**L35**). The mirror that was L2's fix now fails about
half the runs: **#381**.

**Green gate.** No contributor code executed on the host at any point. This docs PR passed the
local gate on the host (loop-authored).

**One metric.** 8 external PRs, **8 merged**, 0 abandoned, 0 reverts: 1 through the vetted
auto-merge path (#366, squash, no fixup), 7 under the operator's authorization (the six
hard-block PRs plus #364, which had no hard-block path but three majors and fixups). 9 pass-2
lenses, 14 delta reviews, 10 fixup / re-merge ticks on contributor branches, 1 maintainer
follow-up dev tick (#383). 0 host executions of contributor code. Token spend per tick was not
recorded for this write-up.

**Follow-up issues filed.** #375 (MCP write scopes, `needs-maintainer`), #376 (rate limit and
body cap on `/mcp`), #377 (one MCP error mapper), #378 (show the sets of a replaced
exercise), #379 (server-side duplicate exercise check), #380 (weights-only equipment update),
#381 (CI: the ECR mirror), #382 (small review follow-ups, PR #383).

**Media.** No captured page (home, progress, generator, catalog) changed, so no re-shoot. The
live-session screen changed a lot - weight picker, actions menu, metric columns, barbell
diagram - so the recorded session clip is now stale, on top of the clip debt already logged on
2026-09-14.

## 2026-10-07 - three merges at the per-run cap, and the first unvetted-tier merge the loop decided on its own

**Context.** One external PR and two loop-authored features shipped: **#420** by @Retsumdk
(unvetted tier, closes #386: clear an exercise's inherited load options only when the gym
item's stack stops applying to it), **#421** (closes #393: rest timer pause and resume, -15/+15 s
replacing +30 s, an optional end-of-rest screen flash) and **#422** (closes #405: copy a finished
workout as text). Three merges is the per-run cap; the run stopped there.

**The delegation.** During the run the operator wrote, in session: "Si il présente aucun risque
et un intérêt, je veux que tu choisisses de merge, ne me demande pas." ("If it presents no risk
and is worth having, I want you to decide to merge it; do not ask me.") Unlike the 2026-09-14
and 2026-09-30 authorizations, this one is **standing**, not scoped to a wave, so it is now
policy: `10-external-contributions.md` records it, and `CLAUDE.md`, `07-autonomy.md`,
`CONTRIBUTING.md` and the `ship-pr` skill are aligned with it in this PR. The loop now merges an
external PR, unvetted tier included, when pass 1 (no hard-block path, injection screen clean),
pass 2 (every lens clean, no blocking or major finding) and pass 3 (green CI on the pinned SHA)
succeed and the PR adds value. Unchanged: unvetted code is never executed on the host; a
hard-block path or any blocking, major or security finding means verdict only (or a
maintainer-tier follow-up), never a merge; the vetted list is granted by a human only. It is
still a review process, not a security guarantee.

**#420, the first merge under it.** Pass 1: `lib/gym-equipment.ts`, `lib/gym-loads.ts`, a unit
test and an integration test - no hard-block path, nothing in the diff or the PR text tried to
steer the loop. Pass 2: four lenses (egress, test integrity, correctness and conventions, threat
model), nothing blocking; the only nits were on the PR body (em-dashes, no `Closes` line). Pass
3: green CI on head `cd3e6ef`. The verdict comment, posted before the instruction, still said a
maintainer would click merge; after the operator's sentence the loop squash-merged it itself,
pinned to that SHA, with no human click. The fix adds `itemStackStopsApplying`, so a type change
the stack never applied under leaves deliberate load options alone (the kettlebell-rack case of
#324). The contributor declined a backfill of configs already cleared by the old rule, and the
loop agreed: `GymExerciseConfig` records no provenance, so a backfill cannot tell an inherited
option list from a deliberate one.

**#421 and #422, loop-authored.** One Opus skeptic each; only minor findings, all fixed on the
branch before merge. #421: the next-set recommendation shown during a paused rest now assumes
the recovery runs until now plus the time left, and a fixed sleep in the superset E2E spec was
removed in favor of waiting on the condition. #422: focus returns to
the button after the hidden-textarea fallback, the fallback selects correctly on iOS Safari, and
a cardio set without a value renders a dash.

**Green gate.** Zero host executions of contributor code: #420 was read on the host and tested
by CI only. #421, #422 and this docs PR passed `bash scripts/verify.sh` on the host
(loop-authored).

**One metric.** 3 PRs merged, 0 abandoned, 0 reverted (1 external, 2 loop-authored); 1 fixup
round each on #421 and #422, none on #420. Token spend per tick was not recorded for this
write-up.

**Promotion proposal (for the human, not applied).** @Retsumdk now has two clean merged PRs:
#385 (four lenses unanimous, minor findings only, which went to follow-up #386) and #420 (which
closed that follow-up, four clean lenses, no fixup). The loop proposes adding `Retsumdk` to the
vetted list in `10-external-contributions.md`. Only a human edits that list; the loop has not
added the name.

**Lessons.** None new: the run hit no failure mode the playbook does not already cover.

**Media.** No captured page (home, progress, generator, catalog) changed, so no re-shoot. The
recorded session clip, already stale since 2026-09-30, now also lacks the new rest timer
controls.

### 2026-10-07 - Retsumdk added to the vetted list

The operator accepted the promotion proposed in the write-up above ("oui"), with one
condition: every PR is still checked for security problems and attacks. The name was
added to `docs/loops/10-external-contributions.md` by the loop on that explicit human
grant. Nothing about the passes changes: the egress and threat-model lenses run on every
Retsumdk PR, a security finding blocks the merge, and hard-block paths stay human-only.

## 2026-10-09 - the first vetted-tier merge, a duplicate rule that met a built-in template, and a bodyweight goal

**Context.** Three merges, the per-run cap: **#425** by @Retsumdk (closes #379: POST
program-exercises refuses an exercise already in the workout with a 409), **#427** (refs #426:
the same rule on the other hand-edit paths) and **#428** (closes #398: a bodyweight goal line on
the progress chart). #424, the vetted-list addition that #425 ran under, is recorded in the
2026-10-07 entry above.

**#425 - the first PR under the vetted tier.** The operator's condition when granting the tier
was that every PR is still checked for security problems and attacks, so the security lens ran
as it does for an unvetted PR, next to a correctness lens. Both clean: the 409 is reached only
after both ownership checks (the workout and the exercise), so it cannot be used to probe
another user's workouts. Merged pinned to head `00c36d9` with no fixup round; the minor notes
(the PUT replace path, the MCP add tool and the program editor still allowed the duplicate)
went to follow-up #426 rather than a fixup on the contributor branch (L34).

**#427 - closing #426, and the rule that was too wide.** The loop extended the refusal to the
PUT that replaces a row's exercise, the MCP add tool and the program editor (which now hides
exercises already in the workout), with a translated 409 toast. Two defects were caught before
merge:
- **Review:** the first PUT check refused any write on a row whose workout already held a
  duplicate from before the rule, so a targets-only edit of a legacy duplicate returned 409. The
  check now runs only when the exercise changes.
- **CI:** the draft also deduped repeated rows in program generation. The integration test that
  builds every built-in template failed: 5/3/1 Boring But Big repeats the main lift in one
  workout on purpose. The generation dedupe was reverted, a test pins that generation keeps a
  deliberate repeat, and the unique constraint under discussion was dropped. The root cause is
  the live runner sharing one set pool per exercise, filed as #429 (open). **L37.**

**#428 - bodyweight goal.** An additive migration (one nullable `User.bodyweightGoalKg`), the
goal set on the bodyweight card in the user's unit, backup format v6 with older backups still
importing. Two review rounds: (1) the first version inferred the direction (cut or bulk) from
the window's first weight, so a goal set the other way after a cut read as "reached"; the status
is now computed from the distance to the goal only. (2) The trend was shown by color only; it
now says "moving toward / away from your goal" in words, after an arrow was tried and dropped
because it pointed the wrong way relative to the color when the weight crossed the goal.
Rollback tag `autonomy-baseline-2026-10-09` (at `98cc2ba`) was pushed before the merge, as for
any migration.

**Green gate.** Zero host executions of contributor code: #425 was read on the host and tested
by CI only. #427, #428 and this docs PR passed `bash scripts/verify.sh` on the host.

**Process incident.** Two review subagents ran `git checkout` during the run, one in the main
checkout and one in another tick's worktree, detaching that tick's `HEAD` mid-work. No commit
landed on `main` and nothing was lost, but it is the L15 race with a reviewer as the second
writer. **L38**, graduated into the `ship-pr` skill and `06-orchestration.md`.

**One metric.** 3 PRs merged, 0 abandoned, 0 reverted (1 external, 2 loop-authored); #425 with
no fixup, #427 with one review fix and one CI-driven revert of part of its own change, #428 with
two review rounds. Token spend per tick was not recorded for this write-up.

**Lessons.** L37 (check a no-duplicates rule against the built-in templates and data first) and
L38 (reviewers never switch a shared checkout).

**Media.** The progress page, one of the captured pages, changed (the goal line and the goal
status on the bodyweight card), so `docs/screenshots/progress.png` is now stale: screenshot debt,
not re-shot in this run. The recorded session clip debt from 2026-09-30 and 2026-10-07 stands.

## 2026-10-13 - the first external merge on a hard-block path, and the hard-block list split in two

**Context.** Four merges: **#432** by @Retsumdk (vetted tier, closes #377: every MCP tool
handler is registered through `guardToolHandler`, and Prisma known-request and validation
errors are mapped to fixed wording instead of reaching the client raw), then three
loop-picked merges at the per-run cap: **#434** (closes #433, the follow-up to #432: the
remaining Prisma error classes - unknown request, initialization, Rust panic - map to
"Server error."), **#435** (closes #404: favourite exercises) and **#436** (closes #394:
duplicate a program or a workout, save a finished session as a workout). #432 sits outside
the cap: it was merged on an explicit operator instruction, not picked by the loop.

**#432 - the first external PR on a hard-block path merged by the loop.** The PR touches
only `lib/mcp/**`, then a hard-block path, so under the policy of the day it stopped at a
verdict. Two Opus lenses ran, the security lens first (egress and backdoor, plus the threat
model of the error mapping: does any branch still hand the caller a raw message, does the
guard swallow a deliberate error the server raises on purpose), then correctness. Both
clean; the verdict was posted. The operator then wrote, in session, quoted verbatim: "T'as
fait un test de sécurité, on a aucun risque si c'est le cas, tu merges toi, ça me convient."
In English: "You ran a security test; if so, we run no risk; you merge it yourself, that
suits me." The loop pushed the rollback tag `autonomy-baseline-2026-10-13` (at `a150458`,
the pre-merge `main`) and merged pinned to head `deb1029`. The one gap the lenses noted - the
other Prisma error classes still passed through - went to follow-up #433, written by the
loop on its own branch (L34), not as a fixup on the contributor's.

**The policy extension.** Right after #432 the loop proposed turning that one-off into a
rule, and the operator confirmed it ("ok ça me va", "ok, that works for me"). The
hard-block list in `10-external-contributions.md` is now two groups. **Group A**,
security-sensitive code (`lib/mcp/**`, `lib/auth*`, `lib/api.ts`, `lib/rate-limit*`,
`app/api/mcp-tokens/**`, the bulk-data routes, `lib/llm/**`, `lib/prompts/**`, Prisma schema
and migrations, `messages/**`, `i18n/**`): the loop may merge an external PR touching it when
every pass is clean, the egress/backdoor and threat-model lenses are both clean, and a
rollback tag is pushed before the merge. **Group B**, paths that steer the loop itself or the
build and supply chain (`.github/**`, `scripts/**`, `.claude/**`, `CLAUDE.md`,
`docs/loops/**`, container, ignore and env files, `middleware.ts`, dependency manifests and
lockfiles, executable configs, `.coderabbit.yaml`): human-merge only. Unchanged: unvetted
code is never executed on the host (and no external code touching either group runs
locally, container included); the vetted list is granted by a human only; any security,
blocking or major finding means no merge. `CLAUDE.md`, `07-autonomy.md`, `CONTRIBUTING.md`
and the `ship-pr` skill are aligned in this write-up's PR. Not changed: an adopted external
issue whose implementation touches a hard-block path is still a human task.

**#434 - closing #433.** Small and loop-authored on `lib/mcp/errors.ts` (maintainer tier,
so the charter applies, not the hard-block list): the three remaining Prisma classes now log
server-side and return "Server error.", with unit tests for each class. An initialization
error can name the database host, which is why it is worth having.

**#435 - favourite exercises.** An additive migration (`Exercise.isFavorite`, default
false), `PATCH /api/exercises/[id]` with a strict boolean schema, backup format v7 (older
backups still import), a favourites section at the top of the catalog and favourites first
in the in-session add and replace pickers. Rollback tag `autonomy-baseline-2026-10-13b` (at
`dd0fcf7`) was pushed before the merge, as for any migration. Three review rounds, all on
the catalog star: (1) starring moves the row to another section, which remounts it and lost
keyboard focus - focus now follows the star; (2) a fast double tap could land on the
neighbouring row's star once the list reordered - only one star save runs at a time across
the whole list; (3) a failed save rolled back to "not favourite" rather than to the previous
override - the rollback now restores the previous value.

**#436 - duplicate and save as workout.** A copied program starts inactive with no end
date; a copied workout lands at the end of its program; a finished session becomes a
workout in a program the user picks, built from the working sets actually done. Copies keep
every `ProgramExercise` column - the copy is built by omission, and a unit test checks it
against the generated column list, so a column added later is copied without a code change
- and keep deliberate repeats such as 5/3/1 Boring But Big's main lift (L37). Review fixes:
the copy name is built from the stored name (never its display translation) plus the
localized suffix, truncated to 120 characters without halving an emoji; the copied program's
`endDate` is null. **CI catch:** the three new `[id]` routes had cross-user tests but were
missing from `COVERED_ELSEWHERE` in the ownership coverage ratchet, which the default gate
does not run (L40). **Sibling catch:** #435 merged first and changed the `Exercise` type, so
#436's earlier green no longer described what would land; `origin/main` was merged into
#436, re-gated and re-run on CI before its merge (L39).

**Green gate.** Zero host executions of contributor code: #432 was read on the host and
tested by CI only. #434, #435, #436 and this docs PR passed `bash scripts/verify.sh` on the
host. This write-up also confirmed L41: in a nested worktree under `.claude/worktrees/`,
`npm run lint` failed with the `@next/next` plugin conflict until `.eslintrc.json` got
`"root": true`; with it, the full default gate is green from the nested worktree.

**One metric.** 4 PRs merged, 0 abandoned, 0 reverted (1 external under explicit operator
instruction, 3 loop-authored at the per-run cap). Fixup work: none on #432 (its gap went to
#434), three review rounds on #435, one review round plus one CI round and one re-gate after
merging `main` on #436. Token spend per tick was not recorded for this write-up.

**Lessons.** L39 (a shared-type merge invalidates a sibling's CI), L40 (a new `[param]`
route joins the ownership ratchet in the same PR) and L41 (`"root": true` for nested
worktrees).

**Media.** Three user-visible pages changed: the exercise catalog (stars and the favourites
section; `docs/screenshots/catalog.png` is a captured page, so it is now stale), the program
detail page (duplicate actions, not a captured still; the `program.gif` clip predates them)
and the history session detail page (Save as a workout; `history.png` captures the calendar,
which did not change). Not shot in this run: screenshot debt now covers progress (2026-10-09) and catalog, and the recorded
session clip debt from 2026-09-30 stands, past the ~3-batch cap; a media run is due.

## 2026-10-13 (afternoon) - the roadmap's first slices: a measured baseline, a merge gate that needs review evidence, a test database that sets itself up

**Context.** The operator committed an overview and an implementation roadmap
(`docs/loops/README.md`, `docs/loops/11-autonomous-development-roadmap.md`, #438): make the
maintenance measurable first, then move rules from prose into code. The loop worked the
first slices the same day. Merged, in order: **#438** (roadmap, operator-authored), **#439**
(M1 run records and baseline), **#440** (launch video v2, operator), **#442** (M2 merge
gate), **#443** (M1 usage from transcripts), **#444** (launch video v3, operator), **#441**
(M2 test database bootstrap), **#447** (L42, unit tier under load), **#445** (closes #381,
CI Postgres image), **#449** (M2/M4 review records), and **#448**, a PreToolUse hook that
refuses HEAD-moving git commands from subagents in checkouts they do not own. #448 changes
`.claude/settings.json` and every agent session's Bash calls, so the loop asked first; the
operator confirmed ("Merge it") and it merged through the gate on its ready record (head
`d16a427`), the first PR to go through the review-record rule end to end: a needs-changes
record on head `61a7125` refused it; the fixup push to `d16a427` voided that record (the gate
counts only records for the approved head, which is L29 made mechanical), and the ready
record on `d16a427` let it through.

**What shipped.**
- **Baseline (#439, #443).** Versioned Zod records under `automation/records/`, rebuilt
  from public GitHub data for 79 PR runs since 2026-08-14: 75 merged, 2 closed unmerged, 2
  open; 0 reverted over the 46 merged runs whose 14-day window has closed, 3 with a fix
  follow-up citing them. #443 adds what GitHub cannot show, from local Claude Code
  transcripts: tokens by kind, summed session time and an API-list-price cost estimate for
  32 of 79 runs, each a lower bound. Loop-authored: known for 16 of 50 merged runs, median
  $1.69. External: known for 15 of 25, median $5.78, which is the maintainer's review,
  fixup and integration work on someone else's PR. Orchestrating sessions ($111.19, 32% of
  the retained total) and unattributed subagents ($99.28, 29%) stay outside any run. Human
  interventions and agent attempts stay unknown for all 79 runs.
- **Merge gate (#442, #449).** `automation/publish/merge.ts`, run by `ship-pr` from a
  detached worktree of freshly fetched `origin/main`, merges only at the approved head SHA
  when the five required checks succeeded on it, from the pinned CI app and one check
  suite. #442 merged itself through the one bootstrap exception it named (a dry run of its
  own gate, then a pinned PUT). Since #449 the gate also needs a structured review record,
  posted as a PR comment from a maintainer account (numeric user id), for that head and
  the PR's `base.sha`; the latest record of every reviewer must be ready. A fixup or a
  rebase therefore voids the old review mechanically (L29). Limit, stated in the roadmap:
  the gate proves review evidence exists for the exact commits, not that the reviewer was
  independent, and it runs with the caller's own token.
- **Test database (#441).** `verify.sh --full` starts, waits for and migrates the test
  Postgres under the existing lock, behind a URL guard (15 self-test cases). Lessons L4 and
  L23 are resolved and the manual step is gone from `CLAUDE.md` and the skills. Validated
  with Docker: from a wiped container 28 migrations applied, unit 1376, integration 372,
  E2E 23; a second fresh worktree reused the container and passed integration.
- **Unit tier under load (#447, L42).** Profiled instead of raising timeouts:
  `formatWeight` built an `Intl.NumberFormat` per call. One formatter per configuration and
  a local worker cap (half the cores) took the slowest test from a 5.2 s timeout to 3.0 to 4.0 s
  (three runs) at load about 20.
- **CI Postgres (#445, closes #381).** 30 of 115 CI attempts over the last 100 runs (26%)
  had died at the ECR mirror's `toomanyrequests`; 37 of 37 failed pull logs said so. The
  image is now pinned by digest and restored from the Actions cache; on PR #445's own run,
  attempts 2 and 3 contacted no registry.

**Review rounds and the catches worth keeping.** Every loop PR had an independent Opus
review before merge, and every one of them changed the code.
- **#439** (two rounds): bot reviews were counted as human reviews, inflating the review
  figure; they are now reported apart (31 of 75 bot, 22 of 75 human or posted verdict, 10
  bound to the final head). The delta review found the report did not say it included two
  PRs still open at collection, #439 itself among them.
- **#443** (one round, nine findings F1 to F9): per-run cost had to be framed as a lower
  bound with its share of all retained usage; a branch seen in the main checkout was being
  taken as attribution evidence. The stricter rule moved known usage from 34 to 32 runs.
- **#442** (two rounds): `automation/**` was missing from the human-merge-only list, so an
  external PR could have edited the gate that grades its own merge; the gate ran from the
  candidate's checkout; any app's check could count. Fixed: group B, a fresh `origin/main`
  worktree, a pinned app id and a single check suite.
- **#441** (one round): two green `--full` runs from the same folder could not show that
  compose named its project after the folder while the container name was fixed, so a second
  worktree would collide. One pinned project now serves every checkout (L43).
- **#447** (one round): the half-cores cap only slowed CI's dedicated 4 vCPU runners; CI
  keeps Vitest's default.
- **#445** (one round): each pull is bounded to 5 minutes; L2 says how to clear a cache entry
  that does not match the pin.
- **#449** (two rounds; the first and the last review were posted as records, the delta
  review in between was not): one lens's later
  ready record could clear another lens's blocking record, and a test asserted it; then an
  edited needs-changes record was dropped as invalid, erasing its stop. Fixed: latest record
  per reviewer, all ready; an edited or broken record refuses the merge (L44).
- **#448** (two fixup rounds, three reviews, merged): round one found the hook blocked the operator's own session
  and three skills; round two found that reading `agent_type` as "subagent" would lock out a
  main session started with `claude --agent`, and that the documented gate cleanup was
  refused. It now keys on `agent_id` only.

**Process failures absorbed.**
- **L33 repeated.** An integration-tier run went out with `VITEST_MAX_WORKERS` set, the
  variable that overrides the integration config's `fileParallelism: false` and lets test
  files truncate each other's tables. Its red said nothing about the change; L42's status line, corrected in #447's fixup, now states that any
  value above 1 must never reach the integration tier.
- **A reviewer moved another tick's checkout.** A review subagent ran `git checkout --detach`
  in a worktree it did not own and moved a dev tick's `HEAD` mid-work: L15 and L38 recurring
  despite both being in the skills. Prose is not a control; #448 is the response.
- **Machine overload.** With several agents, CI watchers and a Docker database on 12 cores
  (load 16 to 33), the unit tier timed out in at least five gate runs (fixed in #447) and two
  `--full` runs failed only at E2E with `ERR_INSUFFICIENT_RESOURCES` at load about 20. The
  second is a concurrency-limit problem for roadmap M2, not fixed here.
- **ECR pull reruns.** Until #445 landed, red CI was read step by step and rerun only when the
  failed step was the image pull (L35).

**Green gate.** `bash scripts/verify.sh` before each loop PR's merge. Two PR bodies record
the load flake on the way (#441: unit timeouts at load 33 on its first push, before its
Docker validation; #443: one timeout, the unit tier then green with two workers); both are
the L42 class #447 fixed. CI ran all five jobs on every merged head.

**One metric.** 11 PRs merged (8 loop-authored, 3 operator: #438, #440, #444), 0 abandoned,
0 reverted. Review-driven fixup rounds: 12 across the 8 merged loop PRs (#439, #442, #449
and #448 two each; #443, #441, #447, #445 one each). Token spend
for this batch was not extracted; the baseline's medians above cover runs up to #439.

**Lessons.** L42 (#447). New: L43 (a proof from the authoring folder cannot see a clash
between folders) and L44 (review a control through the control, and ask whether one actor
can clear another's stop), graduated into `implement-issue` and `ship-pr`.

**Media.** No app page changed. The launch video in the README was replaced twice by the
operator (#440, #444: now a 92-second narrated presentation). Screenshot and clip debt from
the morning entry stands.

## 2026-10-14 - a usage ledger, local limits, a public evidence page, and an eval containment PR that ended by narrowing its claims

**Context.** The operator's standing direction since 2026-10-13: push the roadmap
(`11-autonomous-development-roadmap.md`) as far as possible, then showcase it. Merged, in
order: **#451** (M1 run-time usage ledger), **#452** (M3 eval harness, paid agent disabled),
**#454** (M2 heavy-work slots and subagent dispatch limit), **#456** (#454 follow-ups),
**#457** (public evidence page) and **#455** (closes #453, eval containment). Every merge
went through the merge gate on a ready review record for its final head.

**What shipped.**
- **Usage ledger (#451).** A hook (`automation/hooks/record-usage.cjs`) on `SubagentStop`,
  `SessionEnd` and `UserPromptSubmit` appends numbers only (tokens by kind and model,
  response counts, PR numbers named in the task prompt, hashed branch names, prompt counts,
  never text) to `~/.local/share/gymcoach-runs/ledger.jsonl`; `automation/ledger/` turns it
  into the same per-run records as the transcript scan of #443.
- **Eval harness (#452).** `evals/maintainer/`: a versioned task format, three dev tasks
  replayed from frozen snapshots of real fixes, hidden graders from the fix commits, and
  harness self-check agents (`dry`, `reference`, `broken`, `tamper`). The paid `claude`
  agent shipped hard-disabled after review (see below), tracked in #453.
- **Local limits (#454, #456).** `verify.sh` takes one of `GYMCOACH_HEAVY_SLOTS`
  machine-wide `flock` slots; a session may run at most `GYMCOACH_MAX_SUBAGENTS` (default
  3) subagents, with an optional token budget from the ledger. #456 raised the idle
  liveness window from 15 to 60 minutes after measuring real silent gaps of up to 46
  minutes, and polls only the transcript size while it settles.
- **Evidence page (#457).** `docs/loops/evidence.md`: the 2026-10-13 baseline with its
  denominators, the controls now in code, verifiable review catches and reproduction
  commands, with no improvement claim.
- **Eval containment (#455).** The agent container sits on an internal network whose only
  exit is a proxy that allows `api.anthropic.com:443`; grading runs in throwaway containers
  (`--network none` for unit, an internal network with a throwaway Postgres for
  integration); only regular source files under the application roots are copied from the
  agent (an allowlist); the Prisma schema and client come from the base; tools run as node
  scripts with an empty `NODE_OPTIONS`; and a canary in every vitest run records the test
  framework's functions before any agent code loads and fails the run if one changes.
  Isolation probe: 62 checks, exit 0, no model call. Final replays: `reference` passes all
  three tasks, every other self-check agent fails them.

**Review rounds and the catches worth keeping.**
- **#452** (two fixup rounds, three records). The first review found the agent would load
  the snapshot's project settings (which allow `git push`) and that preserved tests and
  configs were graded as the agent left them. The second was blocking: from inside the
  agent container, `host.docker.internal:2375` answered as the unauthenticated Docker
  Desktop engine API, so an agent could start a container mounting any host path. The
  paid agent was disabled outright and #453 filed; the operator was told to untick
  Docker Desktop's "Expose daemon on tcp://localhost:2375 without TLS".
- **#454** (one fixup round). A missed `SubagentStop` left a running entry for 12 hours,
  and three such leaks would refuse every Agent call for good. Entries now count only
  while the subagent's transcript is recent.
- **#457** (one fixup round). The page's diagram routed reserved paths from the merge gate
  to a human; the gate has no path check, that routing is policy. Corrected.
- **#451** and **#456** merged on their first record (minors only; #456's two README minors
  are fixed in this write-up).
- **#455** (six hardening reviews, then two docs rounds; eight records, the last ready).
  Each of the six hardening reviews was needs-changes with a new way for agent code to pass
  an incomplete fix: a writable grading tree during `prisma generate`; a generator opened
  on the same line as a closing brace and hashes taken after generate; a lone carriage
  return ending a comment and an `.npmrc` whose `node-options` npm copies into
  `NODE_OPTIONS`; a nested `package.json` imports alias and `expect.extend` from
  `messages/en`; matchers made lenient only for strings, spies or test callers. The fixes
  moved from denylists to an allowlist (L45) and then to the identity-recording canary.
  The sixth review confirmed the round-5 cheats were caught and found two more: a built-in
  outside the hand-picked record, made to misbehave only for callers at hidden-test paths,
  and test hooks reached through `globalThis`, which the lexical hook rule did not match.
  The orchestrator had announced before that round that it would be the last, and kept
  it: no seventh hardening round. The README, the roadmap, L45 and the
  `PAID_AGENT_ENABLED` comment now call the canary a tripwire, not a guarantee, and list
  exactly what it records; both bypasses are residual risks filed as #468 (described
  without exploit code). The review of that docs round still found two overclaims (a
  README sentence and the comment an operator reads before enabling the paid agent); the
  next record was ready. The paid agent stays hard-disabled until #468 is closed or the
  operator accepts those risks, plus the credential-risk acceptance and a budget, and any
  paid result gets a diff review of the agent's patch.

**Process failures absorbed.**
- **A hardening race.** #455 took six hardening rounds and about 19 hours open. The
  bypasses were real, but each round fixed the last one found; L46 now caps such races
  and graduates into `ship-pr`.
- **L42 under load.** Gate runs still saw the known `editable-sets-table` unit timeout at
  load about 12 (two `verify.sh` runs on #455's round 4); green alone and on rerun.

**Green gate.** `bash scripts/verify.sh` green before each merge; CI ran all five jobs on
every merged head.

**One metric.** 6 PRs merged (all loop-authored), 0 abandoned, 0 reverted. Review-driven
fixup rounds: 11 (#452 two, #454 one, #457 one, #455 seven: five hardening, two docs).
Token spend, from the new ledger (subagents only, attributed by a PR number in the task
prompt, API-list-price estimate, a lower bound: orchestrating sessions and unattributed
subagents not counted, and the ledger only started when #451 merged, partway through
#452): #452 $10.99 (4 subagents), #454 $15.13 (4), #455 $106.21 (14), #456 $0.41 (1),
#457 $1.41 (2); #451 itself predates the ledger. Eight subagent lines named no PR
($27.59).

**Lessons.** L45 extended through #455's round 6 (in #455). New: L46 (cap an adversarial
hardening race; narrow the claim and file the rest), graduated into `ship-pr` step 4.

**Media.** No app page changed; no screenshot or clip work this batch.

## 2026-10-19 - a stale base refused, changelog fragments, an unvetted MCP PR on a hard-block path, and the issue list cut to 20

**Context.** Since the 2026-10-14 write-up (#469), in merge order: **#470** (@Retsumdk,
weights-only equipment save, closes #380), **#446** (docs), **#472** (#470 follow-ups,
closes #471), **#474** (repeated-exercise blocks, closes #429), **#473** (gate runs in the
ledger, roadmap M1), **#477** (@f1dot4, MCP bodyweight update), **#476** (last-done line,
closes #459), **#481** and **#483** (base-stale gate and record carry-over, roadmap M2,
closes #479, #482), **#485** (#477 polish, closes #478), **#486** (#476 follow-ups, closes
#480), **#488** (@Retsumdk, coach context per block, first item of #475), **#487**
(shared-device cache purge, closes #357), **#489** (`/mcp` body cap and write rate limit,
closes #376), **#491** and **#492** (changelog fragments, lesson L47). Every merge went
through `merge.ts`. #473, #474 and #476 merged on ready records whose base was stale,
before #481 added the base-stale refusal (#476 merged 27 minutes before it). #486, #487
and #488 merged on records carried over a git-proven pure base update. The rest merged on
records for their exact final head and base.

**External work.** #477 is from an unvetted contributor and touches group A paths
(`lib/mcp/**`): it merged after every pass was clean, the security lenses included, with
the rollback tag `autonomy-baseline-2026-10-19` pushed first (at `8961054`, the #473
merge). Its follow-ups (#478) were the loop's own PR, #485. #470 and #488 are from the
vetted @Retsumdk.

**What changed in the loop.**
- **Base-stale refusal (#481, #483).** The gate refuses a PR whose base is not the live
  tip of `main`, and carries records only across a pure base update proven with git. Two
  needs-changes records on #481 before the ready ones; #483 took the round-2 minors (NUL
  separated `ls-tree`, an absent record base counts as not on `main`).
- **The cost it exposed (L47).** In the #485-#489 wave every PR edited the same lines of
  `CHANGELOG.md`, so each merge left the next PRs with a conflict: 3 hand-resolved merges
  (#487 once, #489 twice) and 5 re-attestation rounds (#489 holds six records). #491 moved
  entries into `changelog.d/` fragments; #492 fixed a re-run guard that could drop a
  one-line fragment.
- **A slip the gate caught.** On #492 the record post failed on a transient GitHub API
  error; the gate refused with `no-review` and the merge waited for the re-posted record.
  No new lesson: the control worked as designed.
- **Open-issue cap (operator directive, 2026-10-19).** The tracker is kept at 20 or fewer
  open issues. The backlog was triaged down that day (18 open at this write-up); ideas not
  planned for now were closed and listed in the parked backlog #484. Now in
  `03-triage-loop.md` and the `triage` and `ideate` skills.

**Green gate.** `bash scripts/verify.sh` ran green locally before the merge of each
maintainer and vetted PR; #477 (unvetted) was never run locally, only in CI. CI ran all five
jobs on every merged head. Ledger count: `verify` lines whose end time is strictly after the
#473 merge (2026-10-17T17:23:13Z), excluding this write-up's own run: 21 lines, 19 green
(one `--full` run interrupted, exit null; one `--full` run failed, exit 1).

**One metric.** 16 PRs merged (12 loop-authored, 3 external, 1 docs), 0 abandoned, 0
reverted. Token spend, from the ledger (subagents only, attributed by one PR number in the
task prompt, API-list-price estimate, a lower bound): #481 $8.11, #485 $5.41, #473 $3.58,
#476 $2.72, #477 $1.65, #483 $1.58, #491 $1.54, #487 $1.51, #489 $1.51, #474 $1.45, #486
$0.79, #472 $0.71, #488 $0.64, #446 $0.34; one subagent named #485 and #489 ($2.43); nine
named no PR ($31.14); #470 and #492 have no attributed subagent line.

**Lessons.** L47 (in #491). No new lesson in this write-up.

**Media.** The live-session card gained one muted text line (#476); no captured page
(home, progress, generator, catalog) visibly changed, so no screenshot or clip work.
