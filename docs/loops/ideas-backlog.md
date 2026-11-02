# Ideas backlog

Append-only log the `ideate` loop keeps so it never re-proposes a shipped or rejected idea.
One line per idea: `STATUS - title (issue #N, date) - one-line note`. STATUS is
`proposed`, `shipped`, or `rejected`.

Grounding for ideas lives in Memory `research-product-direction.md` (the competitor-review
research and the product wedge). See `docs/loops/08-ideation-loop.md` for how this is used.

## Log

- shipped - warm-up set calculator from the working weight (issue #69, 2026-06-09) - pure lib/warmup.ts + display-only dialog, additive
- shipped - detect personal records (heaviest set + best e1RM) and surface a badge (issue #70, 2026-06-09) - pure lib/records.ts on top of stats e1RM, derived on read, no table
- shipped - training consistency calendar (sessions-per-week + current streak) (issue #71, 2026-06-09) - read-only derivation on the progress page, no new model
- rejected - bodyweight/body-measurement trend (2026-06-09) - needs a non-additive history table; no safe single-PR slice; left for a human
- rejected - supersets/circuits (2026-06-09) - needs a schema change (non-additive)
- rejected - CSV import from Strong/Hevy (2026-06-09) - large parser + untrusted-input handling; bigger than one tight PR
- rejected - e1RM strength trend, per-muscle weekly volume (2026-06-09) - already shipped in lib/stats.ts and on the progress page
- shipped - surface personal records hit during a session on the post-session summary (issue #80, 2026-06-09) - reuse lib/records.ts detectPRs in components/session/session-summary.tsx, additive
- shipped - volume landmarks (MEV/MRV reference bands) on the weekly per-muscle volume chart (issue #81, 2026-06-09) - weekly working-set counts vs default 10/20 sets band in lib/stats.ts, display-only
- shipped - detect stalled lifts (no e1RM progress over recent sessions) and flag them on the progress page (issue #82, 2026-06-09) - pure derivation over exerciseProgress/best1RM, display-only badge
- shipped - recommend a deload week when multiple lifts stall or readiness is chronically low (issue #88, 2026-06-10, PR #93) - pure lib/deload.ts over existing stall + readiness signals, display-only banner
- shipped - quick set logging via shorthand input like 100x8@9 (issue #89, 2026-06-10, PR #94) - deterministic parser lib/set-shorthand.ts, first slice of the roadmap's natural-language set logging, no LLM
- shipped - per-exercise target goals (weight x reps) with progress toward goal (issue #90, 2026-06-10, PR #95 + fix #97) - additive ExerciseGoal table + Zod API + progress bar; first feature shipped under the complex-features directive
- rejected - in-session exercise substitution picker (2026-06-10) - changes what a logged set refers to mid-session; needs a product call on program vs session scope, not a safe default
- shipped - bodyweight tracking (additive BodyweightEntry table + trend card) (issue #99, 2026-06-10, PR #103 + fix #109) - re-evaluated 2026-06-09 rejection; sync race fixed post-merge review
- shipped - import training history from a Strong app CSV export (issue #100, 2026-06-10, PR #105 + hardening #108) - re-evaluated rejection; security review found and fixed body-cap bypass, transaction timeout, CSV formula injection
- shipped - give the AI coach the user's goals and fatigue signals (issue #101, 2026-06-10, PR #104) - payload + prompt input-side only; post-merge review verdict CLEAN
- deferred - supersets/circuits (2026-06-10) - now allowed by the directive (nullable group column is additive) but the session-runner UX surface is too heavy for one tight PR; revisit as its own batch with a UX-first slice
- shipped - ask the coach mid-session with live session context (issue #111, 2026-06-11, PR #116) - post-merge review CLEAN (double ownership gate, contracts byte-identical)
- shipped - start a deload week in one tap from the recommendation (issue #112, 2026-06-11, PR #115) - post-merge review CLEAN; latent negative-weight doc contradiction filed as #118
- shipped - import training history from a Hevy CSV export (issue #113, 2026-06-11, PR #117) - security review CLEAN (shared caps/rate budget verified, Strong path byte-identical)
- shipped - first-class cardio sets (duration/distance + CARDIO category) (issue #133, 2026-06-11, PR #137 + fix #141) - multi-lens review CLEAN; one coach-payload pollution finding fixed same-day
- shipped - importers map cardio rows onto the new fields (issue #134, 2026-06-11, PR #138) - security review CLEAN incl. 8 adversarial probes
- shipped - conditioning card on the progress page (issue #135, 2026-06-11, PR #139) - correctness review CLEAN
- shipped - include cardio duration/distance in the CSV history export (issue #144, 2026-06-12, PR #148) - column order pinned; closes the data-ownership gap
- shipped - dedicated conditioning section in the AI coach payload (issue #145, 2026-06-12, PR #149) - review CLEAN on all seven lenses incl. the two-writers scan
- shipped - supersets slice 1: program-level pairing + A1/A2 session flow (issue #146, 2026-06-12, PR #150) - review CLEAN; E2E proven live; later slices (shared rest, circuits) still un-filed
- shipped - TCX file import (duration/distance/HR) (issue #152, 2026-06-12, PR #158) - hostile security review CLEAN: no entity decoding by construction, adversarial 5MB inputs linear; nits filed as #161
- shipped - per-day conditioning + interference guidance (issue #153, 2026-06-12, PR #157) - review CLEAN; daily window aligned to the strength week at the UTC instant
- shipped - 'What your coach sees' transparency card (issue #154, 2026-06-12, PR #156 + fix #162) - review found the footer overclaimed privacy; reworded to the truth same-day
- rejected - OAuth cloud integrations (Garmin/Strava/Apple Health), watch companion / rep auto-counting, black-box auto-push program generator, nutrition/macro tracking, real-time GPS recorder (2026-06-12 research anti-recommendations) - recorded so future runs never propose them
- shipped - export a cardio session as a TCX file (issue #175, 2026-06-13, PR #181 + hardening #182) - the outbound data-ownership half; hostile review CLEAN (escaping + ownership), round-trips through the parser
- shipped - show last-time cardio performance in the session (issue #176, 2026-06-13, PR #179) - review CLEAN; ungated the cardio branch, HR averaged
- shipped - cardio pace and speed (derived) on the session summary and history (issue #177, 2026-06-13, PR #180) - review CLEAN, math re-derived; warmup-totals inconsistency filed as #183
- shipped - a free-text note to your coach (correctable AI memory) (issue #188, 2026-06-13, PR #194) - multi-lens review CLEAN incl. injection posture (note is JSON data, not instructions; contract byte-identical)
- shipped - supersets slice 2: superset-aware rest timer (issue #189, 2026-06-13, PR #193) - review CLEAN, E2E proven live (short between members, full after group)
- shipped - a Records board (all-time bests per exercise) (issue #190, 2026-06-13, PR #192 + fix #196) - review CLEAN; tie-break date made deterministic
- shipped - body-measurement tracking (waist/arms/etc.) with a trend (issue #202, 2026-06-14, PR #207) - additive BodyMeasurement table; multi-lens review CLEAN (ownership, bounds, migration drift)
- shipped - maximum heart rate on cardio sets (issue #203, 2026-06-14, PR #206) - additive Set.maxHr; review CLEAN (bounds on all writers, Track subtree stripped before lap-max extraction)
- shipped - import a GPX file as a cardio session (issue #204, 2026-06-15, PR #208) - third file format; hostile security review CLEAN (21 adversarial cases, no entity table, linear at 5MB, name never read)
- shipped - free-text (AI-parsed) set logging (issue #210, 2026-06-15, PR #216) - the LAST roadmap item; multi-lens review CLEAN incl. untrusted-output (12 hostile model outputs fail closed, a parse never logs a set)
- shipped - user-settable weekly volume targets (issue #211, 2026-06-15, PR #215) - additive VolumeTarget; review CLEAN (classifyWeeklySets stays pure)
- shipped - give the AI coach your all-time records (issue #212, 2026-06-15, PR #214) - review CLEAN, output contract intact
- shipped - show the exercise's notes/cues in the session set logger (issue #224, 2026-06-16, PR #228 + dedup fix #232) - review CLEAN; the one NIT (cue shown twice) fixed
- shipped - per-muscle weekly training frequency on the progress page (issue #225, 2026-06-16, PR #229) - review CLEAN; distinct-day counting, not set count
- shipped - e1RM-based percentage loading table on the per-exercise progress view (issue #226, 2026-06-16, PR #230) - review CLEAN; converts to display unit before rounding
- shipped - proactive coach insight card on the home dashboard (issue #237, 2026-06-18, PR #240) - pure selector over existing signals (deload > stall > PR > on-track), display-only, no LLM call
- shipped - search/filter box on the exercise catalog (issue #238, 2026-06-18, PR #239) - client-side name filter over the loaded list, no API change
- shipped - import a Garmin FIT file as a cardio session (issue #249, 2026-06-19, PR #251) - the research "killer wedge" (Garmin exports FIT natively); hand-rolled binary decoder of the session-summary message (duration/distance/avg+max HR), reuses the TCX/GPX cardio import pipeline + hostile-input controls; decoder validated against fixtures the official Garmin SDK generated (dev-only, removed after); distinct from the anti-recommended OAuth/cloud Garmin integration
- shipped - import multiple cardio activity files at once, FIT first (issue #253, 2026-06-19, PR pending) - batch array on the FIT route (single `fit` kept backward-compatible), aggregated preview, partial-success confirm; the "rapatrie tout mon historique" flow
- shipped (slices 1+2) - store + chart the detailed pace/HR track of an imported activity (issue #254, 2026-06-19, PR #256) - additive Set.track JSON column, FIT record-message decode downsampled to <=500 points, HR-over-time chart on the history detail. Remaining slice 3 (TCX/GPX point capture) un-filed.
- shipped (GPX slice) - capture the pace/HR track from GPX/TCX imports for the chart (issue #259, 2026-06-23, PR #260) - shared lib/import/track.ts (TrackPoint + cleanTrackPoint + downsampleTrack), FIT refactored onto it, GPX now builds + stores a downsampled track so GPX runs/rides get the HR chart. TCX sub-slice (parse the dropped <Trackpoint> samples) still pending.

## Deep-research ideate batch (2026-06-30)

Run from the heavy deep-research workflow (competitors + Reddit/forums + GitHub trackers,
103 agents, ~1.7M tokens; adversarially verified). Operator explicitly opted into the heavy
fan-out for this run. Filed the strongest NEW, single-PR, wedge-fitting, anti-recommendation-respecting
slices; epics noted for a human, not filed. All requesters were external/non-maintainer, so
each idea is re-derived in our own words from verified facts (untrusted-input policy).

- proposed - aerobic decoupling (HR drift) metric on imported cardio sessions (issue #268) - display-only derivation over the Set.track we already store; Intervals.icu capability gap, endurance wedge. Single PR.
- proposed - progress photos alongside body metrics, local storage no cloud (issue #269) - Hevy gap; additive ProgressPhoto table + ownership-scoped upload (size cap + image-type allowlist) + gallery. Single PR with reinforced upload controls.
- proposed - import training history from a generic (GymCoach) CSV (issue #270) - first-hand migration demand (wger discussion #1202); symmetric inverse of the history CSV export, reuses the hardened Strong/Hevy import pipeline. Single PR.
- NOT FILED (already shipped) - mobile numeric keypad for reps/weight (research finding #5): set-input.tsx already sets inputMode="numeric"/"decimal" - the verify step caught this before filing. Good gate.
- NOT FILED (EPIC, for a human) - longitudinal training-load model (CTL/ATL/Form / fitness-fatigue-form with readiness zones), an Intervals.icu flagship. Highest-value opportunity but multi-PR (load-score derivation + chart + readiness integration). Strong capability evidence, no first-hand demand.
- NOT FILED (uncertain / larger) - ingest HRV/sleep from FIT wellness files into the existing readiness model (finding #9). Wedge-safe ONLY as ingestion of already-on-box files (NOT OAuth sync); but HRV/sleep live in Garmin monitoring FIT files, not activity FIT, so it is a bigger parser job; demand source is competing vendors. Note for a human.
- NOT FILED (capability-not-demand) - shareable program export/import link + relative muscle-activation map (Liftosaur features, finding #6); scriptable programs is an epic. Candidates for a future bounded ideate run if the above drain.
- NOT FILED (low priority / thin) - public REST API for body stats ingestion (finding #7, brushes the no-external-sync anti-rec); endless/no-end-date routines (finding #8, n=1, unverified our model forces dates).

## "Make it pop" ideate batch (2026-08-20)

Operator directive for this round: the next features should be COOL - impressive,
demo-able, "wow" features a lifter would show a friend and that make a launch video or a
screenshot shine. Not chores, not plumbing. Same constraints as always (self-hosted, no
external SaaS, LLM optional, en/ru i18n, mobile-first Shadcn/Tailwind), and each idea is
still a single-PR slice built on data we already have. Filed six (the directive raised the
usual cap of three for this round).

- proposed - muscle heat map on the progress page, front/back body tinted by weekly volume (issue #299) - inline-SVG silhouettes over the existing weeklySetsByMuscleGroup + MEV/MRV band (personal VolumeTarget wins); the most screenshot-friendly view in the app, no new data
- proposed - training recap poster, your year in tonnage/PRs/streaks (issue #300) - pure lib/recap.ts aggregation + a poster page at /progress/recap with a period switcher; PNG/next-og export deliberately deferred to a follow-up slice
- proposed - strength level badges, e1RM on a bodyweight-relative Beginner-to-Elite scale (issue #301) - pure lookup table in lib/strength-standards.ts keyed by canonical lift + sex, hidden when sex/bodyweight are missing; no leaderboard, no external dataset
- proposed - draw the route of a GPX-imported run or ride (issue #302) - GPX already parses lat/lon for Haversine and discards it; keep it on TrackPoint and render a self-contained SVG polyline. Explicit non-goal: no map tiles, a tile request would leak the GPS trace off-box
- proposed - year-long training heatmap, contribution-graph day grid (issue #303) - lib/training-heatmap.ts over the existing UTC ISO-week helpers + a CSS-grid card; complements (does not replace) the 12-week consistency card
- proposed - celebrate a personal record in-session (issue #304) - CSS-only burst over the existing detectPRs badge, reusing lib/vibrate.ts and lib/sound.ts, gated on a sound preference and prefers-reduced-motion; no confetti dependency
- NOT FILED (deferred slice) - PNG/OG image export of the recap poster via next/og; wanted, but the Docker standalone bundling of the wasm/font is its own risk and belongs in a second PR once the poster exists
- NOT FILED (still an epic, for a human) - the longitudinal training-load model (CTL/ATL/Form) noted in the 2026-06-30 batch remains the highest-value multi-PR opportunity

## 2026-10-29 - competitor scan (operator request, recurring daily)

Scanned openGym (17.2k stars), wger, workout.cool, SparkyFitness, Liftosaur, LiftLog, plus Fitbod, Hevy and Strong. The open list was at 19 of 20, so one idea was opened and the rest parked in #484.

- proposed - generate today's session from muscle recovery and the chosen gym's equipment (issue #539) - Fitbod's flagship; new pure lib/muscle-recovery.ts, a separate single-workout schema so the debrief contract is unchanged
- parked (#484) - body-fat estimate from tape measurements, US Navy method (openGym #648, #197)
- parked (#484) - scheduled automatic backups to a mounted folder with retention (LiftLog #533)
- parked (#484) - conditioning timers: EMOM, AMRAP and Tabata
- parked (#484) - merge a duplicate exercise into another
- parked (#484) - mark each set against the same set last time
- parked (#484) - weekly debrief pushed to the user's own ntfy or Gotify (sends data off-box: maintainer decision)
- parked (#484) - switch off unused modules
- NOT FILED - native apps, F-Droid builds (most-reacted competitor asks; GymCoach is a PWA by design); OIDC and invite-only signup are already tracked (#407, #408)
