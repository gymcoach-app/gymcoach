# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Rest timer controls: a running rest can be paused and resumed, and adjusted
  by -15 s or +15 s (replacing the single +30 s button). An optional device
  setting, off by default, flashes the screen when a rest ends; with reduced
  motion it shows a single static colour change instead (#421, closes #393).
- Copy a finished workout as text: the session detail page in the history has
  a "Copy as text" button that puts a plain-text recap (exercises, sets, notes)
  on the clipboard for a chat or a training log. It falls back to a hidden
  textarea copy where the Clipboard API is unavailable, such as a self-hosted
  instance reached over plain http (#422, closes #405).
- Bodyweight goal: the bodyweight card on the progress page takes an optional
  goal weight, entered in your unit, and draws it as a dashed line on the
  chart. The card shows the distance left to lose or gain, "Goal reached"
  within 0.25 kg, and says in words whether the trend is moving toward or away
  from the goal. Stored as one nullable column (additive migration); backups
  move to format v6 and older backups still import (#428, closes #398).
- Favourite exercises: a star on each exercise of the catalog marks it as a
  favourite, favourites get their own section at the top of the catalog and
  come first in the in-session add and replace pickers. Stored as one boolean
  column defaulting to false (additive migration), set through
  `PATCH /api/exercises/[id]`; backups move to format v7 and older backups
  still import (#435, closes #404).
- Duplicate a program or a workout, and save a finished session as a workout.
  A copied program starts inactive with no end date; a copied workout lands at
  the end of its program. Copies keep every programmed-exercise setting and any
  deliberate repeat (such as the main lift of 5/3/1 Boring But Big). The
  history page of a finished session gets a "Save as a workout" button that
  builds a workout in a program of your choice from the working sets actually
  done (#436, closes #394).
- Autonomous development roadmap and a first measured baseline of the
  maintainer. `docs/loops/README.md` now separates what exists from what is
  planned, and `docs/loops/11-autonomous-development-roadmap.md` sets the
  milestones (#438). A new `automation/` directory, kept out of the app and the
  Docker image, holds versioned run records (Zod, unknown never written as 0)
  and a baseline rebuilt from public GitHub data: 79 PR runs since 2026-08-14,
  75 merged, 0 reverted over the 46 complete 14-day windows (#439). Agent
  tokens, session time and an API-list-price cost estimate are recovered from
  local Claude Code transcripts where a session is attributable to a PR: 32 of
  79 runs, each figure a lower bound; median $1.69 for 16 of 50 loop-authored
  runs, $5.78 for 15 of 25 external runs (the maintainer's review and fixup
  work) (#443).
- A merge gate for every maintainer merge: `automation/publish/merge.ts`,
  run from a fresh `origin/main` worktree, merges only at the reviewed head SHA
  and only when all five required CI checks succeeded on that SHA from the
  pinned CI app and one check suite (#442). It also requires a structured
  review record, posted as a PR comment by a maintainer account (matched by
  numeric user id) for that exact head and base; the latest record of every
  reviewer must be ready, so one lens cannot clear another's stop, and an
  edited record refuses the merge (#449). `automation/**` joined the
  human-merge-only paths for external PRs.

### Fixed

- MCP tool errors no longer leak raw database errors: every tool handler is
  registered through one guard that maps Prisma errors to fixed wording
  (conflict, related record missing, not found) or a generic "Server error.",
  so a client never sees the query text, its arguments or server paths.
  Community contribution by @Retsumdk (#432, closes #377); the remaining Prisma
  error classes (unknown request, initialization, Rust panic) followed in #434
  (closes #433).

- A workout can no longer hold the same exercise twice by hand: adding an
  exercise already in the workout returns 409, both through the REST API and
  the MCP add tool, and so does replacing a row's exercise with one the
  workout already holds (a targets-only edit still saves). The program editor
  now hides exercises already in the workout, as the in-session menu already
  did, and a refused add or replace shows a translated message. Two rows for one exercise shared
  one set pool in the live runner. Generated programs and built-in templates
  still keep a deliberate repeat, such as the main lift of 5/3/1 Boring But
  Big; logging that repeat as its own block is tracked in #429. The POST check
  is a community contribution by @Retsumdk (#425, closes #379); the other
  paths followed in #427 (closes #426).

- Editing a gym equipment item no longer wipes the load options of linked
  exercises on any type change: they are cleared only when the item's stack
  had applied to the exercise and stops applying under the new type. Existing
  configs are not backfilled, because a stored config does not record whether
  its options were inherited. Community contribution by @Retsumdk (#420,
  closes #386).

- CI no longer fails at the Postgres image pull: over the last 100 CI runs, 30
  of 115 attempts (26%) had died on the ECR public mirror's rate limit. The
  integration, E2E and Docker smoke jobs now start Postgres from an image
  pinned by digest and kept in the GitHub Actions cache, pulled by digest from
  one of three registries only on a cache miss, with the loaded image checked
  against the pin (#445, closes #381).
- The unit tier no longer times out when other processes load the machine:
  `formatWeight` reuses one `Intl.NumberFormat` per configuration instead of
  building one per call, and local runs cap Vitest at half the cores (CI keeps
  the default). Under load about 20, the slowest test went from a 5.2 s timeout
  to 2.9 s (#447).

### Changed

- The repository moved to the `gymcoach-app` GitHub organization. The image is
  now published as `ghcr.io/gymcoach-app/gymcoach`; the old
  `ghcr.io/julien-au/gymcoach` path no longer receives updates. Old GitHub
  URLs redirect.
- `bash scripts/verify.sh --full` starts the test Postgres on :5434 itself
  (when Docker runs), waits for it over TCP and applies the migrations, under
  one compose project shared by every checkout. A guard refuses any database
  other than `localhost:5434/gymcoach_test`. The manual `prisma migrate deploy`
  step after starting or restarting the test container is gone (#441).

## [1.0.0] - 2026-10-05

First tagged release: everything shipped since the open-source bootstrap on
2026-05-26.

### Added

- One-command self-hosting: `docker-compose.selfhost.yml` runs the prebuilt
  GHCR image next to Postgres and applies migrations on start, so a new
  instance needs no clone and no build. The README leads with it.
- In-session exercise actions: the exercise card of a live session has an
  actions menu to replace the current exercise with another one from the same
  muscle group, add an exercise, or remove one, without leaving the session.
  These actions edit the saved program, not just today's workout, and the menu
  says so; a replace always asks for confirmation. Superset members now switch
  before the rest period starts. Community contribution by @SHAREN (#363).
- Gym-aware weight picker: the weight and reps fields of the live logger open a
  drum-style picker limited to the loads your gym's equipment can actually make.
  A selection stays pending until you press Apply, the picker opens on the exact
  stored value (an off-grid weight is not rounded just by opening it), the
  pending load is previewed on a barbell diagram, and manual decimal entry is
  still available. Community contribution by @SHAREN (#364); a follow-up in #383
  stops a wheel nudge from rewriting an off-grid value to the nearest row.
- Edit a machine's selectable weights from the live session: when the current
  exercise is linked to a gym equipment item, its weight list can be corrected
  in place. A decimal comma is accepted, invalid entries are named instead of
  dropped, and sets you already logged keep the constraints of their own
  equipment rather than those of the item selected for new sets. Community
  contribution by @SHAREN (#365); a follow-up in #383 refuses a token that
  starts with a comma and previews the list that will be saved.
- Metric columns in the live sets table: a column picker shows estimated 1RM,
  estimated 10RM or volume, and volume can sit next to either rep-max estimate.
  The choice is remembered in the browser. Community contribution by @SHAREN
  (#367).
- MCP equipment backfill for past workouts: tools to preview, apply, list and
  undo the assignment of a gym equipment item to historical sets of finished
  sessions that have none. An apply never overwrites an existing assignment,
  covers up to 500 sets, and writes a durable, per-user audit record that the
  undo checks before reverting (a new table and migration). Community
  contribution by @SHAREN (#362).
- MCP gym inventory tools: list your gyms, read a gym's full inventory, read an
  equipment image, update the shared free weights, add or update an equipment
  item, and set or clear its image. Tools that overwrite return the previous
  values. Over MCP an image can only be uploaded as bytes (JPEG, PNG or WebP) or
  cleared; the external image URL mode stays available in the app's own API
  only. Community contribution by @SHAREN (#368).
- MCP capability index: `get_mcp_capability_index` is a read-only tool that
  lists the connector's 22 tools grouped by task, for clients that cannot list
  tools themselves, and says whether the connection has write access. Community
  contribution by @SHAREN (#369).
- Calendar view on the history page: sessions are laid out on a month grid you
  can page through, with a day's sessions listed under it and a program filter
  on top. Days are bucketed in your own timezone (the browser sends its IANA
  zone as `?tz=`, validated server-side, and the zone travels on every link and
  on the session detail page), the week starts on Monday in French and Russian,
  and the CSV export stays a full-history export narrowed only by the program
  filter - the displayed month is a view, not an export scope. Community
  contribution by @SHAREN (#351).
- Live-session exercise navigation: a horizontal strip of the session's
  exercises sits under the header, showing each one's position and whether it
  is done, scrolling the current one into view and letting you jump straight to
  another. Tapping the current tile opens a new exercise detail page (muscle
  group, equipment, technique media, your recent sessions on that movement and
  its best estimated 1RM) with a back link into the exact session you left. The
  strip is inert while you are resting or on the summary, selection travels in
  the URL as the program row id so a workout that programs the same exercise
  twice does not confuse the two, and an unconfirmed set draft is parked per row
  across jumps. Community contribution by @SHAREN (#355).
- Inline set editing during a live session: the sets you have already logged
  are shown as an editable table, so a mistyped weight, rep count or RIR is
  corrected in place instead of deleted and re-entered. Edits go through a new
  owner-scoped `PATCH /api/sets/[id]` that enforces the same guards as logging
  (no edits on a finished session, no strength fields on a cardio set) and
  re-derives goal achievement in the same serializable transaction as the
  write, so a corrected set cannot leave a stale goal behind. Offline edits
  queue and replay like logged sets. Community contribution by @SHAREN (#356).
- Printable A4 workout sheet: a "Print sheet" button on a program page, and a
  "Print sheet" item in each workout's menu, open a chrome-free page that
  prints one A4 portrait sheet per workout. Each sheet lists the exercises in
  superset presentation order (with the A1/A2 labels), their plan line, rest,
  tempo and planned notes, a blank notes line, and an empty weight / reps / RIR
  cell for every planned set, so a session can be filled in by hand at the gym
  and re-entered later. The weight cell is labelled with your display unit,
  `?workout=<id>` narrows the sheet to a single session, and the on-screen
  toolbar does not print. Adopted from the direction proposal by @SHAREN
  (#331), re-derived as #333.
- French as a third interface language: the whole UI is now available in
  English, French and Russian, picked in Settings, with an unknown locale still
  falling back to English.
- Physical gym equipment inventory: each saved gym can now hold the concrete
  stations and items you actually train on (name, type, description,
  manufacturer, model, quantity, item-specific weight options), linked to the
  exercises they serve and optionally illustrated with an uploaded JPEG, PNG or
  WebP image or an external HTTPS image URL. Linked exercises feed the existing
  equipment-aware load selection, uploads are signature-checked and capped, and
  every read and write is scoped to the owner. The backup export/import
  round-trips equipment, images and exercise links (v4). The inventory is
  managed through owner-scoped API endpoints for now; its first UI surface is
  the equipment picker in the logger below. Community contribution by @SHAREN
  (#312).
- Equipment on your logged sets: while logging, you can pick the specific
  machine or item you used, and the set stores a server-derived snapshot of its
  name and load options so history stays readable after the inventory is
  renamed or deleted. The selection survives offline logging, the IndexedDB
  queue and sync, and is treated as optional metadata - a stale, unlinked or
  foreign reference is dropped rather than losing the set. Backups move to v5 to
  carry it, and restore stays backward compatible with earlier versions.
  Community contribution by @SHAREN (#313).
- Return-to-training calibration: after a long layoff, the first session back
  starts easier. When an exercise (or its primary muscle group) has been unused
  for long enough, that session alone gets fewer working sets, a higher target
  RIR and a conservative first load derived from long-term history, respecting
  the saved gym's loadable options and never exceeding the return-session
  ceiling. Later sets hand back to the normal intra-set autoregulation, the
  saved program is not rewritten, and you can always log what you actually did.
  Community contribution by @SHAREN (#311).
- Prebuilt production Docker image: every push to `main` publishes
  `ghcr.io/gymcoach-app/gymcoach` (`latest` plus an immutable `sha-<short>` tag,
  linux/amd64) from the same Dockerfile the PR smoke test already validates, so
  self-hosting no longer requires a local build. `docker-compose.prod.yml` still
  builds from source by default, so existing setups are unchanged; the README
  documents the pull. Requested by @mvnixon (#310).
- Muscle heat map on the progress page: front and back body silhouettes whose
  regions are tinted by the latest completed week's working sets per muscle
  group, compared against that muscle's MEV/MRV band (a personal volume target
  wins over the defaults, exactly as the volume-landmarks card). Untrained,
  under-MEV, in-band and over-MRV read as four steps of one warm ramp, checked
  for separation in light and dark and for common color-vision deficiencies;
  every region is labelled and keyboard-reachable for screen readers. Derived
  on read from existing set history - display-only, and it never affects
  progression.
- ChatGPT / external-agent MCP connector: an authenticated Streamable HTTP
  MCP endpoint exposes your training context and program editing to any
  MCP-compatible agent. Access uses per-user bearer tokens created in
  Settings - stored as SHA-256 hashes, read-only by default, write-scoped
  only on explicit opt-in, revocable anytime; every tool is bound to the
  token owner's data and write tools require an explicit confirmation
  argument. Community contribution by @SHAREN (#276).
- Exercise technique media: about 80 catalog exercises now show start/end
  position photos in the logger and the catalog, vendored from the Unlicense
  free-exercise-db project - served locally, no hotlinking, no tracking.
  Community contribution by @SHAREN (#275).
- Saved gyms and equipment-aware load selection: describe each gym you train
  in (dumbbells, plates, bars, machines) and load suggestions round to what
  is actually loadable there, including plate-math reachability for barbells.
  The backup export/import round-trips gym profiles (v3). Community
  contribution by @SHAREN (#274).
- Per-set workout autoregulation: during a session, the suggested next set
  adapts to how the previous one actually went, in two modes (keep effort
  stable and let reps drift, or adjust load to keep reps stable). Changes are
  conservative by design - clamped per set, increases gated behind readiness
  and deload state, and always just a prefill you can override. Community
  contribution by @SHAREN (#273).
- Progress photos alongside your body metrics: upload a photo (JPEG, PNG or
  WebP) and compare any two side by side to see change over time, on the
  Progress page. Storage is local-only - files live under a configurable,
  gitignored `UPLOADS_DIR` on the server and are served solely through an
  ownership-scoped route, never a public static path. Every upload is validated
  by its magic bytes (not the client's declared content-type), capped in size
  during a streamed read, and written non-executable. No cloud, no third party.
- Interface localization: an extensible message-catalog system
  (`messages/<locale>`) with English and Russian across the app's screens; an
  unknown locale falls back to English. Community contribution by @SHAREN
  (#272), which also added the OpenAI-Responses-compatible `codex-lb` LLM
  provider option.
- Aerobic decoupling (HR drift) on an imported cardio session: the history
  detail page now shows how much your pace-per-heartbeat efficiency faded
  between the first and second half of a run or ride, with a plain-language
  read ("held steady" under ~5 percent, "faded" above). Derived purely from
  the stored activity track (cumulative distance + heart rate); shown only
  when the track can support it, and it changes no schema or API.
- Import your training history from a GymCoach-native CSV: the symmetric
  inverse of the history CSV export brings the same columns back in through
  the hardened import pipeline (streamed size/row caps, Zod on every value,
  dry-run preview with per-line errors, exact-duplicate skipping,
  transactional confirm, ownership-scoped exercises). It un-escapes the
  export's formula-injection guard for a true round-trip, and the Strong and
  Hevy import paths are unchanged (pinned byte-identical by tests).
- Multi-user accounts: registration, profiles, per-user data isolation, and
  rate limiting.
- Workout logging with sets, reps, RIR, warmups, and drop sets.
- Progress charts, estimated 1RM (Epley) tracking, and bodyweight-aware tonnage
  for movements like pull-ups and dips.
- Installable PWA with offline-first session logging (IndexedDB + background
  sync) and a screen wake lock during sessions.
- Pluggable LLM provider: Anthropic SDK or any OpenRouter model, switchable via
  the `LLM_PROVIDER` environment variable.
- AI program generation from a natural-language goal, with Zod-validated output.
- Streaming conversational AI coach that uses your training context.
- `demo` LLM provider with canned responses (no API key) plus demo media for the
  AI flows, so the app and live demo work without a real key.
- Demo credentials shown on the login screen when demo mode is enabled, so the
  live demo is one click to try.
- Expanded the default exercise catalog with common machine, cable, dumbbell, and
  accessory movements, including coverage for the forearms and lower-back groups.
- Friendly empty states with a clear call to action on the progress and history
  pages when there is no data yet.
- Weight-unit preference: choose kilograms or pounds for displaying and entering
  weights everywhere (logging, history, summaries, and progress charts). Data is
  always stored in kg.
- In-workout plate-loading calculator: from the set logger, see the per-side plate
  breakdown for a target weight in your display unit, with configurable bar and
  plate inventory per unit, and an honest note when a weight cannot be loaded
  exactly.
- Built-in program templates (5/3/1 Boring But Big, GZCLP, nSuns, Push/Pull/Legs,
  Upper/Lower, plus Starting Strength, StrongLifts 5x5, Madcow 5x5, PHUL, PHAT,
  and a beginner Full Body 3x): start a program from a template through the same
  generation path the AI uses, then edit it like any program.
- Readiness explainability in the session UI: when a recent readiness/soreness
  check-in holds or steps down a suggested load, a short badge next to the
  suggestion says why ("Held - reported soreness" / "Lighter - low readiness
  today"). Nothing is shown when there is no readiness signal.
- Optional pre-session readiness check-in (overall readiness and sleep quality on
  1-5 scales, plus optional per-muscle-group soreness and a short note): skippable,
  never blocks starting a session, and feeds the AI coach as one more
  auto-regulation signal when it is recent.
- In-workout warm-up set calculator: from the set logger, suggest a short ramp of
  warm-up sets (40/60/80 percent of the working weight, descending reps) in your
  display unit, each rounded down to a loadable increment (2.5 kg / 5 lb) and
  clamped to stay below the working weight, with an empty-bar lead-off set. It is
  display-only and never creates or mutates a set.
- Personal-record badge: a working set is flagged when it moves a heavier load than
  ever before, or when its estimated 1RM (Epley) beats your best prior estimate, for
  the same exercise. Records are derived on read from existing set history (no
  records table, no migration); warm-up sets are excluded and ties never count.
- Training consistency card on the progress page: per-week trained days over the
  last 12 ISO weeks plus the current streak of consecutive on-streak weeks, derived
  on read from finished sessions (no new model). A week is on streak when it has at
  least one trained day, or meets your weekly-frequency target when one is set; the
  partial current week does not break the streak.
- Personal records on the post-session summary: a "Personal records this session"
  card flags exercises that beat your last session, reusing the in-session PR math
  (`detectPRs`) against a "since last session" baseline so a set is never compared
  with itself. Heaviest load and best estimated 1RM are shown as separate badges;
  warm-up sets are excluded.
- Volume landmarks card on the progress page: weekly working-set counts per muscle
  group classified against a default MEV/MRV band (10-20 sets/week) as below,
  within, or above the productive range. Display-only reference defaults, derived
  on read; warm-up sets are excluded and the band does not affect progression.
- Stalled-lift detection on the progress page: a "Stalled lifts" card flags
  exercises whose best estimated 1RM has not improved (beyond a 0.5 percent
  tolerance) over the last three sessions. Pure derivation over existing set
  history; needs at least three sessions before it can flag.
- Deload-week recommendation on the progress page: a display-only banner appears
  when at least two lifts are stalled or the average readiness over the last
  five check-ins (max 14 days old) sits at or below the hold boundary (2/5),
  listing the concrete reasons and what a deload week is. Pure derivation over
  the existing stall and readiness signals; no schema or suggestion change.
- Quick set logging via shorthand: type `100x8`, `100 8 9`, or `100x8@9` in a
  single field of the set logger to fill the weight, reps, and effort fields
  (RPE maps to the stored RIR). Deterministic parser in the user's display
  unit; the classic fields keep working unchanged.
- Import a GPX file as a cardio session: bring a route export from Strava,
  Komoot or Apple Fitness in as one cardio session (distance computed from
  the GPS track, duration from the timestamps, heart rate from the track
  extension) - the third file-import format, file-based and no-OAuth like the
  rest. The parser does no XML entity decoding, so XXE and entity bombs are
  impossible by construction.
- Body-measurement tracking: log tape measurements (waist, arms, thighs, ...)
  from a card on the progress page, with the latest value per site and a
  trend, in your display unit. Stored alongside, and mirroring, bodyweight.
- Maximum heart rate on cardio sets: the peak HR is stored, imported from and
  exported to TCX, and shown next to the average; the CSV export gains
  avg/max HR columns.
- Exercise cues in the session: an exercise's technique note (e.g. "keep
  elbows tucked, pause at the bottom") now shows as an always-visible line
  while you log it, so the form reminder is there exactly when you need it.
- Per-muscle weekly training frequency on the progress page: each muscle
  group's number of distinct training days per week ("Nx/week"), next to its
  volume - frequency is a distinct training variable from total volume.
- An e1RM percentage loading table on the per-exercise progress view: the
  loads at 95-60% of your best estimated 1RM, rounded to a loadable plate
  jump in your unit, for planning percentage-based work (5/3/1, etc.).
- Free-text, AI-parsed set logging (the last roadmap item): an opt-in
  "Parse with AI" button turns a plain description ("bench, 100 kilos, 5 reps,
  2 in the tank" or "ran 5k in 25 minutes") into the set fields for you to
  confirm. The deterministic shorthand stays the fast path; the model output
  is validated and fails closed, and a parse never logs a set on its own.
- The AI coach now sees your all-time records, so a weekly debrief can
  acknowledge a new PR and anchor advice on your bests.
- Personal weekly volume targets: set your own MEV/MRV per muscle group; the
  volume-landmark card uses them where set and the defaults otherwise.
- A free-text note to your coach: write a short note the AI coach reads -
  injuries, illness, life constraints - so its advice accounts for your own
  current context. It is the correctable half of "what your coach sees"; the
  note is sent as data, never as instructions, and the output contract is
  unchanged.
- Records board: an all-time-bests section on the progress page showing your
  heaviest set and best estimated 1RM for each lift, with dates.
- Superset rest timer: in a paired (A1/A2) superset the rest is short between
  the two exercises and full only after the group, instead of a full rest
  after every set.
- Export a cardio session as a TCX file: download a finished cardio session
  (duration, distance, average heart rate) as a standard .tcx you can import
  into Strava or any analysis tool - the outbound half of file-based data
  ownership, no cloud account or OAuth. It round-trips back through the
  importer to the same numbers.
- Cardio "last time" in the session: starting a cardio exercise now shows
  your last session's duration, distance, and average heart rate - the
  cardio counterpart of the strength last-performance reference (it was
  previously hidden for cardio).
- Pace and speed on cardio: the session summary and history now show derived
  pace (min/km or /mi) and speed (km/h or mph) for cardio sets with a
  distance, in your unit.
- Complete backup export/restore: the JSON backup now round-trips every
  piece of your data - cardio duration/distance/heart rate, supersets,
  per-exercise goals, bodyweight history, readiness check-ins, and coach
  conversations - not just sessions and programs. Restore validates the file
  as untrusted input (size-capped, every value bounded, all-or-nothing) and
  still accepts older backup files.
- Import a TCX file as a cardio session: duration, distance, and average
  heart rate land on the first-class cardio model, with a dry-run preview
  and duplicate warning - file-based, no cloud account, no OAuth. The
  parser is a minimal extractor with no entity decoding at all, so XML
  attacks (XXE, entity bombs) are impossible by construction; verified by a
  hostile independent security review.
- "What your coach sees": a transparency card on the coach page showing the
  exact structured context the AI receives (goals and progress, stalled
  lifts, deload state, conditioning vs target, readiness), with a truthful
  note about what is and is not sent.
- The AI coach now sees conditioning per day (current week) and is guided
  to flag interference - a long run the day before heavy lower-body work -
  and to suggest sequencing, with reasons; the structured output contract
  is unchanged.
- Average heart rate on cardio sets (new optional field, also importable
  from TCX), shown in the session detail.
- Supersets in programs (slice 1): pair exercises in the program builder and
  they run as A1/A2 in the session - consecutive presentation, group badge,
  and Next cycling within the group - while set logging, rest timing, and
  program generation stay exactly as before.
- The AI coach now sees your conditioning: weekly cardio minutes, distance,
  and sessions (current and previous week) against the 150 min/week
  guideline, as a dedicated payload section; the structured output contract
  is unchanged.
- The CSV history export now includes duration_sec and distance_m columns,
  so cardio work round-trips out of the app just like it comes in; existing
  column positions are unchanged.
- Cardio, first-class: exercises can be CARDIO and their sets log duration
  (mm:ss) and distance instead of weight x reps - offline queue included -
  while staying out of every lifting metric (tonnage, e1RM, PRs, MEV/MRV,
  stalled lifts, goals, and the AI coach's strength signals).
- The Strong and Hevy CSV imports now map cardio rows onto duration/distance
  (meters/miles and km variants) instead of skipping them; unusable rows are
  still counted and reported, and the strength import paths are pinned
  unchanged.
- Conditioning card on the progress page: weekly cardio minutes, distance,
  and session count over the last 8 weeks against the 150 min/week guideline,
  shown as soon as any cardio has ever been logged (including for
  cardio-only users).
- CI now smoke-tests the production Docker image on every PR (build + real
  register/login probes), the regression net for image-only failures like
  the bcrypt one that briefly broke the public demo's login.
- Demo-mode production image: the Dockerfile and prod compose now accept the
  build-time demo flags (one-click demo login), and a run-once `seed-demo`
  compose service fills the demo account with the rich deterministic dataset
  and resets it on every deploy. Normal self-host builds are unchanged.
- One-tap deload week: the deload recommendation banner can now start a
  7-day planned deload; while active, every suggested load steps down 10%
  (reason "planned deload", shown in the suggestion badge), it never stacks
  with a readiness step-down, a session badge shows the state, and the AI
  coach is told a deload is underway. Ends automatically or in one tap.
- Ask the coach mid-session: a button in the session runner opens the
  streaming chat with the live workout attached (sets logged so far, program
  targets, today's readiness check-in) so advice is immediate and grounded;
  the chat stays free-form and all structured output contracts are unchanged.
- Import from Hevy: the CSV import now accepts Hevy exports too (real session
  times, warmup and drop-set markers), behind the same hardened pipeline as
  the Strong format - shared size/row caps, streamed body limit, shared rate
  limit, dry-run preview, transactional confirm with duplicate skipping.
- Bodyweight tracking: log dated bodyweight entries from a trend card on the
  progress page (12-week chart, quick add in your display unit, deletable
  entries). The newest entry keeps the profile's current bodyweight in sync
  (transactionally, locked against concurrent edits), which feeds the
  effective-load math everywhere; editing the profile field directly never
  creates an entry. Stored in a new additive `BodyweightEntry` table.
- The AI coach now sees your per-exercise goals (with progress toward each)
  and your fatigue signals (stalled lifts, deload-week recommendation) in its
  payload, with prompt guidance to anchor advice on them; the structured
  adjustments output contract is unchanged.
- Import your training history from a Strong app CSV export: dry-run preview
  (sessions/sets/new-exercise counts plus per-line errors), then a one-click
  transactional import with exact-duplicate skipping. The file is treated as
  untrusted input: 5 MB and 50000-row caps enforced while streaming the body,
  every value Zod-validated after unit conversion, rate-limited, and the
  whole import rolls back on any failure.
- Per-exercise target goals: set one "weight x reps" goal per exercise, see a
  progress bar toward it on the progress page (best estimated 1RM vs the
  target's, Epley), and an "Achieved" badge stamped from the first set that
  meets both the weight and the reps - using the effective load for bodyweight
  exercises. Deleting the achieving set re-derives the achievement from the
  remaining history. Stored in a new additive `ExerciseGoal` table with
  Zod-validated, ownership-scoped API routes.
- Test pyramid (unit, integration, E2E) with CI running lint, typecheck, unit,
  integration, build, and E2E on every pull request.
- Docker and Docker Compose setup for local development and production.

### Changed

- The plate calculator in the live session draws the per-side load as a
  barbell diagram, and in a gym with several bars it chooses the closest
  achievable load across them. Community contribution by @SHAREN
  (#366); a follow-up in #383 ranks the bars on the distance to the target
  first.
- MCP write access is worded for what it covers. The Settings toggle is now
  "Allow changes to saved data", and its description and
  `docs/chatgpt-mcp.md` name the three kinds of data a write-enabled
  connection can change: programs, gym inventory and workout history. A
  write-enabled token still covers all of them; separate write scopes are
  tracked in #375. The connector documentation lists 10 read tools and 12
  write tools.
- Return-to-training now loads its recent and long-term history windows on
  separate budgets. The read fetches the long-term anchor pool (8 sessions) plus
  the recent window (up to 14 sessions) and splits them, so sessions logged
  since a comeback no longer take anchor slots away from the older history the
  conservative opening load is derived from. Same suggestions for a normal
  training history; more anchors for a lifter coming back. (#324)
- Load snapping now reads one option list everywhere. An exercise with the
  default `OTHER` equipment type and saved weight options snaps to them in the
  ordinary progression path, exactly as the return-session ceiling already did,
  and both share the same barbell plate-math ceiling. (#324)

- Opened the project to outside contributors with a published security-vetting
  process. `docs/loops/10-external-contributions.md` is now the single source of
  truth for how external issues and pull requests are handled: three trust tiers
  (maintainers, vetted contributors, unvetted), an execution gate (unvetted code
  is executed by CI only, never on a maintainer's machine, and even vetted code
  runs locally only in an ephemeral isolated container), a published list of
  hard-blocked paths that forces a human merge, three review passes pinned to a
  reviewed commit SHA, and service commitments (triage within a day, a public
  structured verdict on every external PR). CONTRIBUTING.md states the same
  terms plainly for contributors: the reviews are AI-assisted, a human clicks
  merge for new contributors, and a DCO sign-off is requested but not enforced.
  The optional CodeRabbit configuration is an advisory lens only, never a merge
  or trust signal.

- Upgraded to Next.js 15 and React 19, resolving the runtime security
  advisories that npm audit reported against Next.js 14. The PWA service
  worker moved to the maintained @ducanh2912/next-pwa; behavior is unchanged.

- Migrated the entire codebase (UI, comments, prompts, docs) from French to
  English.
- Grew the autonomous-loop maintenance infrastructure into a full self-maintenance
  pipeline: the green-gate (`scripts/verify.sh`); the `implement-issue`, `triage`,
  `ship-pr`, `ideate`, and `write-up` skills; an autonomy charter with guardrails;
  and the loop playbook in `docs/loops/`, including the ideation loop that
  manufactures product feature ideas so the loop grows the product (not just the
  repo) and the memory/learning/regrounding architecture that frames the loop as a
  feedback control system.
- Sharpened the AI coach's positioning: it advises within your program rather than
  silently restructuring it, always explains the why behind a suggestion, and
  frames generated programs as editable drafts. The program-adjustment output
  contract is unchanged.
- The deterministic next-weight suggestion now factors in a recent readiness
  check-in: high soreness on the worked muscle group or low overall readiness
  holds the load (no increment), and very poor recovery applies a single
  conservative step-down. Readiness can only hold or reduce the suggestion, never
  raise it, and with no recent check-in the suggestion is unchanged. A user
  preference "Let readiness/soreness adjust my suggested weights" (default on)
  governs this: turning it off drops the readiness signal before it reaches the
  suggestion, reproducing the pure programmed-progression behavior from before
  the readiness integration.
- Widened the autonomy charter per an operator directive: complex features
  (data-safe migrations, LLM output-contract changes, multi-surface work) now
  ship without human review when they are a clear product plus, compensated by
  reinforced non-regression controls (full local gate before the PR, tests at
  every touched layer, contract tests, multi-lens review, rollback tag before
  migrations, verify-in-app). The stop-for-human list narrows to destructive
  data migrations, auth/security changes, and major dependency bumps; security
  boundaries are unchanged.
- Hardened the autonomous maintenance loop against untrusted external input now
  that the repo is public: external issues, PRs, comments, diffs, and CI logs are
  treated as data and never as instructions; only issues/PRs authored by the
  maintainer login allowlist are auto-implemented or auto-merged; forks and
  non-maintainer PRs are never auto-merged; and the loop refuses prompt-injection
  and secret-exfiltration attempts. Documented in the autonomy charter and
  `CLAUDE.md`, with the loop's `curl`/`wget` denied in the harness config as
  defense in depth.

### Removed

- Internal cleanup in the return-to-training recommender: the
  `nonComparableExerciseSessions` input and the `nonComparableHistorySessionCount`
  output were never populated by any caller, so they and the test that hand-fed
  them a value were removed. No user-visible behavior change. (#324)

### Fixed

- A gym equipment item's weight stack is no longer copied onto every linked
  exercise regardless of the exercise's own equipment type. OTHER is the
  default exercise type, so an AI-generated or imported exercise linked to a
  cable or machine item silently inherited its stack and the session stepper
  then snapped to stack values. The copy is now gated on the exercise's type
  (`itemStackAppliesToExercise`): machine and cable exercises inherit, OTHER
  inherits only from an OTHER item, self-loading types never do. Already
  saved options are left alone. Community contribution by @Retsumdk (#385);
  review follow-ups are tracked in #386.
- Installed PWA clients no longer serve a stale bundle after a deploy: when a
  replacement service worker takes over, the open tab reloads onto the new
  version instead of waiting for the app to be closed and reopened. The reload
  is deferred while a live session is on screen (it would drop you back to
  exercise 1) and while the tab is hidden, and a 30 s guard in `sessionStorage`
  prevents a reload loop if a rolling deploy serves mixed versions. Community
  contribution by @SHAREN (#352).
- Switching the interface language now works behind a reverse proxy and on the
  login and signup pages. The language selector posts to a small public
  `/api/locale` route instead of a Server Action, with a Zod-validated body, a
  same-origin check that reads the browser-facing host from the first entry of a
  chained `X-Forwarded-Host`, and a real pending state on the control. The
  locale cookie's `Secure` flag follows the same env-driven rule as the session
  cookie (`SESSION_COOKIE_SECURE`, production default) rather than being derived
  from a client-supplied header. Community contribution by @SHAREN (#353).
- Progress-photo storage paths are now built with POSIX separators, so a
  server running on Windows no longer writes a backslash into the stored
  relative path and then fails to read the photo back on any other platform.
  The path-containment guard is unchanged. Community contribution by @SHAREN
  (#350).
- The "last used" date on an MCP connection in Settings is now formatted with
  the app's locale through `next-intl` instead of the browser's own
  `toLocaleDateString`, so it reads the same on the server and on the client
  and no longer depends on the machine's regional settings. Community
  contribution by @SHAREN (#354).
- Every exercise in the default catalog now carries its equipment type. The
  seeded catalog never set `equipmentType`, so all 55 entries were `OTHER`: the
  logger's load rounding could not pick the barbell, dumbbell or stack branch
  for them, and the catalog card read "Any equipment" (#338). Newly registered
  and demo-seeded users now get typed entries (Barbell, Dumbbell, Cable,
  Machine, Bodyweight, Cardio) with the matching load rounding and labels;
  existing rows are not migrated. Community contribution by @shaurya703 (#341).
- A dropped-equipment notice no longer gets lost when the sync completes with
  no session screen open. The notice is written to the queued set itself and
  drained, exactly once, by the next session screen that mounts, so logging a
  set offline, closing the app and reopening it later still tells you the
  machine was not recorded. Community contribution by @shaurya703 (#342).
- The two remaining French comments in the Tailwind config are in English, and
  the 64px tap-target token now documents why it is that size and what it
  costs. Community contribution by @shaurya703 (#343).
- The logger no longer stays silent when the equipment you picked was not
  recorded. A set whose equipment reference had gone stale by the time it
  reached the server (the item was deleted, unlinked from the exercise, or
  belongs to another gym) is still saved, with the equipment simply dropped -
  but nothing said so, and the picker kept offering the same stale machine for
  the next set. Sets now come back through the background sync with that signal
  attached: the session shows a non-blocking warning, withdraws the dropped item
  from the picker, and clears a selection the picker no longer offers.
- The exercise catalog is readable at phone width again. Each card now leads
  with a fixed technique thumbnail (or a muted placeholder when the exercise has
  no media), the exercise name takes the remaining width and wraps to two lines
  instead of truncating mid-word, the equipment badge became a compact label
  that shares one line with the rest time, and edit/delete moved to their own
  row on narrow screens.
- Deleting a piece of gym equipment, deleting a gym, or restoring a backup no
  longer scans the whole set table once per equipment item. `Set.gymEquipmentId`
  is the referencing side of a foreign key with `ON DELETE SET NULL`, and
  Postgres does not index that side on its own, so the composite index it needs
  is back.
- An authenticated `GET /mcp` no longer hangs forever. The endpoint serves the
  MCP Streamable HTTP transport statelessly, so there is no event stream for a
  GET to attach to and the response was never written or closed; unauthenticated
  GETs failed early with a 401, which hid the problem, while an MCP client that
  probes with GET (Claude Desktop's connector does) could never connect. GET now
  answers 405 with an `Allow` header before authentication, as the Streamable
  HTTP spec prescribes. Reported by @mvnixon (#314).
- The plate-calculator fallback inventory is editable again in Settings, in
  both kilograms and pounds. Its editor had been dropped when saved gyms
  landed, leaving the no-active-gym fallback (and the only place an lb plate
  inventory lives) unreachable from the UI. The restored card also displays
  the stored values properly - its inputs were uncontrolled before, so
  hydrated bars and plates never showed - and settings cards now re-read
  stored preferences before every write, so editing plates and then toggling
  another setting no longer reverts the plates.
- A hung `codex-lb` upstream can no longer stall an AI request forever: the
  request is aborted if response headers do not arrive within 120 seconds and
  surfaces as a 504 instead of hanging.
- Two concurrent `scripts/verify.sh --full` runs no longer corrupt each other:
  the integration and E2E tiers take a machine-wide lock, so the second run
  waits for the shared test database and dev port instead of truncating tables
  under the first run's suite.
- The E2E suite is repeatable back to back: each spec file now signs up from its
  own client IP (`x-forwarded-for`) instead of sharing the default
  `register:<ip>` bucket, so a second run started inside the rate limit's 60s
  window no longer reds unrelated specs. The registration rate limit itself is
  unchanged.
- Restoring a backup no longer fails on a file that carries the same saved-gym
  name twice: the first gym of that name is kept and later duplicates are
  skipped, instead of the unique-name constraint aborting the whole restore.
  Imported gym weight arrays are also normalized (rounded, deduped, sorted)
  exactly as the gym editor does, so a hand-edited file cannot store a shape
  the app would never write.
- Neutralized leading formula characters in the CSV history export so
  imported exercise names or notes cannot plant spreadsheet formulas
  (CSV/DDE injection) in an exported file.
- Mapped the popover color token so dropdown menus render opaque instead of
  transparent.
- Used a literal `DATABASE_URL` in the E2E CI job environment.

### Security

- Made API route ownership checks structural instead of deletable. Routes that
  address someone's data now read it through a scoped query that cannot return
  another user's row, rather than fetching first and comparing the owner
  afterwards, so the check cannot be removed one line at a time without the
  read itself failing. A CI-enforced ratchet keeps it that way: every route with
  a `[param]` segment, plus an enumerated list of routes that take a resource id
  in the request body, must have a cross-user test that asserts the side effect
  did not happen, and the enumeration fails the suite when it goes stale. Owners
  see no behavior change; a stranger gets a 404 with nothing created, sent or
  posted.
- Hardened the MCP endpoint: setting `MCP_ALLOWED_ORIGINS` and/or
  `MCP_ALLOWED_HOSTS` turns on DNS-rebinding protection and makes CORS echo
  only allowlisted origins (with `Vary: Origin` on both the allow and the deny
  answer) instead of `*`. Both are opt-in, so existing deployments keep their
  current behavior until they set them. The MCP training-context tool also
  stopped selecting the token owner's email address, which it never used.
- Hardened progress-photo storage: deleting a photo now unlinks the file before
  its row, so an unlink failure other than "already gone" keeps the photo
  listed instead of orphaning bytes; path containment resolves symlinks
  (`realpath`) on top of the textual check; and per-user directories are
  `0o700` (files stay `0o600`), including directories created by an earlier
  version.
- Session cookies are now `Secure` by default in production; self-hosting over
  plain HTTP requires an explicit `SESSION_COOKIE_SECURE=false` opt-out.

[Unreleased]: https://github.com/gymcoach-app/gymcoach/compare/v1.0.0...HEAD
[1.0.0]: https://github.com/gymcoach-app/gymcoach/releases/tag/v1.0.0
