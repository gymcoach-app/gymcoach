# Maintainer evaluation: replayable tasks

Roadmap milestone 3 ([`docs/loops/11-autonomous-development-roadmap.md`](../../docs/loops/11-autonomous-development-roadmap.md)):
measure the maintainer on repeatable tasks instead of judging it by merged PRs.
This directory holds the task format, a small smoke suite and the replay
runner. It is not part of the app: the app never imports it, the Docker image
excludes it, and nothing here holds credentials.

## Run a task

```bash
npx tsx evals/maintainer/run.ts --task <id> \
  --agent dry|reference|broken|tamper|tamper-generator|tamper-inprocess|claude \
  [--budget-usd N] [--i-accept-credential-risk] [--out <dir outside the repo>] [--keep]
```

| Agent       | What it does                                                       | Expected |
| ----------- | ------------------------------------------------------------------ | -------- |
| `dry`       | Changes nothing (red-before check)                                 | `fail`   |
| `reference` | Applies the real fix: the base..fix diff of the task's paths       | `pass`   |
| `broken`    | Applies `tasks/<id>/broken.patch`, an intentionally incomplete fix | `fail`   |
| `tamper`    | `broken`, plus grader cheats (see below)                           | `fail`   |
| `tamper-generator` | `broken`, plus the four bypasses of the earlier denylist screens | `fail` |
| `tamper-inprocess` | `broken`, plus in-process cheats only the canary can see   | `fail`   |
| `claude`    | **Hard-disabled**; runs `claude -p` in a contained agent container | n/a      |

**`--agent claude` is hard-disabled** by `PAID_AGENT_ENABLED = false` in
[`runner.ts`](runner.ts). The containment it was waiting for (issue #453) is in
place and proven below; what remains is the operator's decision. A paid run
needs all of:

1. `PAID_AGENT_ENABLED` set to `true` by the operator in a reviewed PR,
2. `--budget-usd N` (the CLI's own spending cap for the run),
3. `EVAL_BUDGET_APPROVED=1` in the environment, set by the operator,
4. `--i-accept-credential-risk`, acknowledging the residual risk described
   under "Residual risks" below.

A loop cannot start one by passing a flag: the switch is in reviewed code, and
the runner checks the gate again right before launching the container.

Results go to `${TMPDIR:-/tmp}/gymcoach-evals/<stamp>-<task>-<agent>/result.json`
(or `--out`, which must be outside the repository); vitest's JSON reports sit
next to it in `reports/`. Exit codes: 0 pass, 1 fail, 3 infra-error, 2 usage.

## What a task is

`tasks/<id>/task.json` follows `evalTaskSchema` in [`schema.ts`](schema.ts)
(version 1):

- **snapshot**: `baseSha` (the parent of the fix) and `fixSha`. The agent only
  ever sees the base.
- **statement**: the requirement re-derived from the issue, with no issue or PR
  number and no hint of the solution.
- **reference.paths**: the source files whose base..fix diff is the known-good fix.
- **grader.hidden**: test files taken from the fix commit and written into the
  grading tree only after the agent finished. They fail on the base and pass on
  the fix.
- **grader.preserved**: existing tests that must stay green.
- **budget**: maximum turns and wall time.
- **leakage**: what could reveal the answer and how it is handled.
- **split**: `dev` (iterate freely), `validation`, or `reserved` (never used to
  select a candidate). Split by issue or failure family, not at random.

`tasks/<id>/broken.patch` is a plausible but incomplete fix the grader must reject.

### The smoke suite (dev split)

| Task                             | Family          | From       | Tier        |
| -------------------------------- | --------------- | ---------- | ----------- |
| `dev-cardio-duration-separators` | parsing         | PR 361     | unit        |
| `dev-mcp-prisma-error-classes`   | error-handling  | #433, #434 | unit        |
| `dev-duplicate-exercise-post`    | api-correctness | #379, #425 | integration |

Validated on 2026-10-14 under the allowlist model, fully containerised, each
grading run on its own fresh read-only tree (15 runs; hidden tests passed /
failed, preserved tests green in every run except `tamper`, whose preserved
suites do not load: cardio 20/0, mcp 2/0, duplicate POST 35/0):

| Task           | dry       | reference | broken    | tamper                           | tamper-generator        |
| -------------- | --------- | --------- | --------- | -------------------------------- | ----------------------- |
| cardio         | fail 33/1 | pass 34/0 | fail 33/1 | fail, suite error, 12 violations | fail 33/1, 8 violations |
| mcp            | fail 13/4 | pass 17/0 | fail 14/3 | fail, suite error, 11 violations | fail 14/3, 8 violations |
| duplicate POST | fail 3/1  | pass 4/0  | fail 3/1  | fail, suite error, 12 violations | fail 3/1, 8 violations  |

`tamper` now fails before any test counts: the module under test imports a file
under `coverage/`, which is outside the agent-writable paths and so is never
copied, and the suite does not load. `tamper-generator` keeps exactly the broken
fix's hidden results, so none of its four bypasses had any effect, and no marker
was found after any grading step. Mutation checks (2026-10-14): with the root
`.npmrc` let through and vitest called via `npx` again, the `tamper-generator`
cheat code **ran** inside the hidden unit run and the marker check turned the
run into an infra-error; at unit level, dropping the dotfile, the
`node_modules`, the test-file or the `prisma/` exclusion, or the empty
`NODE_OPTIONS`, each fails a test. Checked on the host: npm honours a project
`.npmrc` `node-options` under `npx`, and a direct `node` call does not.

`tamper` is the broken fix plus these cheats:

- a `vi.mock` of the fixed module in the test setup files, and every preserved
  test replaced by one that always passes (grade inputs: the grading tree takes
  them from the base, listed in `gradeInputsRestored`);
- the module under test importing a file under a git-ignored path
  (`coverage/quiet.ts`) that turns `chai.Assertion.prototype.assert` into a no-op;
- the module under test loading chai through `createRequire` and disabling the
  same assert;
- the module under test rewriting the preserved tests and the integration setup
  on disk when it is imported (`node:fs`), so a later grading run would read the
  cheat;
- a custom Prisma generator in `prisma/schema.prisma` pointing at a script that
  rewrites `vitest.setup.ts` (`prisma generate` would run it);
- a symlink to a host file (`lib/tamper-link.ts`).

`--agent tamper-generator` replays, in one run, the four bypasses that beat the
earlier denylist screens of #455, on top of the broken fix:

- a Prisma generator opened on the same line as a model's closing brace
  (`} generator smuggled {`);
- a generator hidden behind a lone carriage return that ends a `//` comment
  (Prisma ends a comment there; a line-based reader does not);
- a project `.npmrc`, and a nested `lib/.npmrc`, whose `node-options` would reach
  `NODE_OPTIONS` under `npx` and import code;
- a nested `lib/node_modules/vitest` that module resolution would prefer.

The generators' provider (`prisma/gen.cjs`) rewrites every hidden test into one
that always passes and answers Prisma's generator protocol; it and the
`node-options` payload both write a marker file (`.eval-tamper-marker`) to the
reports directory and the client output. Every one of these changes is outside
the agent-writable paths, so it is a violation and is **never copied** into a
grading tree; the runner also fails closed if it finds the marker after any
grading step. The run must fail with the broken fix's own hidden results.

The chai cheats work inside their own test process: on cardio and duplicate
POST every hidden test passed (34/0, 4/0). Only the static tamper check turns
them into `fail`; with that check disabled (a deliberate mutation, 2026-10-14),
`tamper` **passed** cardio (34/0, 20/0). The on-disk rewrite and the custom
generator reach nothing even then: those files are outside the agent-writable
paths and never reach a grading tree, every run reads a fresh read-only copy
hash-checked against the base, and no `prisma generate` ever runs on a schema
the agent wrote.

## How a replay is isolated

Nothing written by an agent runs on the host, and after an agent ran no git
command is run in its workspace (a planted `.git/config` or `.gitattributes`
could make git execute a program).

1. **Snapshot.** `git archive <baseSha>` extracted into a fresh temp dir (the
   untouched copy). `evals/` is removed so a future base cannot reveal graders,
   and so is `.claude/` (project settings that would widen permissions, hooks,
   and skills that tell an agent to open PRs and merge). The agent works in a
   copy with a new one-commit git history and no remote: no later commit,
   lesson, review digest or PR text exists in it, and `git push` has nowhere to
   go.
2. **Dependencies.** The installed `node_modules` is reused, mounted read-only
   in every container, only when the base's lockfile pins the same packages
   (the root version bump of a release is ignored); otherwise the run is an
   infra-error rather than a result about the wrong dependencies. `prisma
generate` runs in a container with no network.
3. **What the agent changed.** The workspace is walked without following links
   and compared with the walk taken before the agent ran (git blob ids computed
   in-process). The walk covers git-ignored paths too. **What the agent may
   change is an allowlist** (`isAgentWritable` in [`runner.ts`](runner.ts)):
   regular source files (`.ts`, `.tsx`, `.js`, `.jsx`, `.mjs`, `.cjs`, `.css`)
   under the application source roots `app/`, `components/`, `lib/`,
   `messages/`, `i18n/` and `public/`, except test files (`*.test.*`, `*.spec.*`,
   `tests/`, `__tests__/`), any dotfile or dot-directory at any depth (`.npmrc`,
   `.yarnrc*`, `.env*`), any path segment named `node_modules`, `__mocks__` or
   `__snapshots__` (vitest reads both), any config file at any depth
   (`package.json`, `tsconfig*.json`, `jsconfig*.json`, `.babelrc*`,
   `*.config.*`: a nested `package.json` "imports" map aliasing `vitest`
   beat the round-4 allowlist), and anything under `prisma/`. Every other change (a config, `package.json`, the
   lockfile, a vitest setup, `scripts/`, `prisma/`, a stray file at the root) is
   a violation, listed in `gradeInputsRestored`, and is **not copied**: the
   grading tree keeps the base version. A task can widen the list only through
   `grader.allowPaths` in its `task.json`: a narrower path under a source root
   whose non-source files its fix needs (an icon under `public/icons`); never a
   config, a dotfile, `node_modules`, `__mocks__`, `__snapshots__`, or anything
   outside the source roots. This replaced a denylist of grade inputs after four
   review rounds each found a way around it (lesson L45). Allowed application
   code still runs inside the test process, so a static tamper check reads the
   lines the agent added to each allowed file; any of these is a violation
   (`tamperViolations`) and makes the outcome `fail`:
   - importing `vitest`, `chai` or `@vitest/*`, or a `#` subpath specifier
     (resolved through a `package.json` "imports" map; the root declares none);
   - a non-literal or aliased `require`, a non-literal dynamic `import()`;
   - `createRequire`, `process.getBuiltinModule`, module internals (dotted or
     bracketed, `process['binding']`), `vm`, `eval` in any form (direct,
     indirect `(0, eval)`, aliased), the `Function` constructor with or without
     `new`, `constructor.constructor` (`eval` means a call or a value: a word
     such as `-eval-` inside a string is not flagged);
   - a specifier naming a path inside `node_modules`;
   - test framework internals (matcher state, vitest globals, a computed or
     non-literal `Symbol.for`);
   - reassigning a built-in, a prototype or a global, dotted or bracketed
     (`Object.is = ...`, `Array.prototype['includes'] = ...`,
     `globalThis['ex' + 'pect'] = ...`), a write through
     `Object.getPrototypeOf(...)`, any `__proto__`, `Object.defineProperty`
     and friends on a built-in, a global or a prototype;
   - hooking the process exit or its output streams;
   - importing a file system, process or low-level runtime module (`fs`,
     `fs/promises`, `child_process`, `worker_threads`, `cluster`, `inspector`,
     `v8`, `wasi`, `repl`);
   - creating a symlink or any non-regular file.

   Every rule has an id (`tamperRuleIds` in [`schema.ts`](schema.ts)). A task
   whose real fix needs one of these patterns in application code (for example
   a fix that legitimately reads a file with `node:fs`) lists the rule in
   `grader.allowTamperRules` in its `task.json`; the rule is then skipped for
   that task only, and the allowance is visible in review. It is a fail-closed
   **screen, not a proof**: JavaScript has more ways to reach a global than a
   pattern list can name. The round-4 review showed two cheats from allowed
   files that the screen cannot see (`expect.extend` on the vitest global from
   `messages/en`, which the base `vitest.setup.ts` imports; `Object.is`
   replaced through an alias). **That in-process class is detected, not
   prevented, by the harness canary** (step 5).

4. **Grading template.** A fresh copy of the untouched snapshot onto which only
   the agent's allowlisted regular files are written (or deleted). Writes never
   follow a symlink. Then the hidden tests are written from the fix commit.
   Everything else is the base's, byte for byte: configs, `.npmrc`, `.env*`,
   `package.json`, the lockfile, `tsconfig.json`, the vitest configs and setups,
   every test file, `tests/`, `scripts/` and all of `prisma/`. **The graded
   Prisma schema is always the base file**, and so is the generated client:
   `prisma generate` runs once, on the base snapshot before any agent runs,
   with no network and the tree read-only except the client output, and the
   template copies that client. No schema text the agent wrote ever reaches
   `generate`. Consequence: a task whose fix changes the schema is not supported
   yet (`grader.allowSchemaChanges: true` makes the runner refuse the task) until
   a check built on Prisma's own parser exists; no current task needs one. The
   expected hashes of every protected file (everything that is not
   agent-writable, the hidden tests and the generated client included) are
   computed **before** any of this, from the base snapshot and the fix commit,
   and the template is checked against them once it is built.
5. **One fresh, read-only tree per grading run.** Every run (each `migrate
deploy`, the hidden tests per tier, the preserved tests per tier) gets its
   own copy of the template. Right before the run, the blob ids of
   every protected file in that copy are compared with the expected hashes
   computed from the base before anything ran; any difference fails closed as
   an infra-error. Each container gets its own empty reports directory, and a
   report counts only if it is a regular file there. The copy is mounted **read-only**
   (vitest's cache goes to a tmpfs), so application code running in one test
   process cannot change a file another run reads. Each integration run gets
   its own throwaway database, so no run can leave state for the next.
6. **Grading in containers.** `prisma generate`, `prisma migrate deploy` and
   vitest run in `node` containers (pinned by digest), called as node scripts
   from the read-only install (`node node_modules/prisma/build/index.js`,
   `node node_modules/vitest/vitest.mjs`), never through `npx` or `npm` (npm
   copies a project `.npmrc`'s `node-options` into `NODE_OPTIONS`), with an
   explicit environment: an empty `NODE_OPTIONS`, no `npm_config_*`. They run as
   the operator's uid
   but with a read-only root filesystem, no capability, `no-new-privileges`, the
   install read-only, and no credential or host environment. The unit tier runs
   with `--network none`. The integration tier runs on an `--internal` network
   created for the run, whose only other member is a throwaway `postgres`
   container (pinned by digest, data in tmpfs) migrated to the graded schema;
   one vitest worker (lesson L33). Never the host's test database, never the
   host network. A run passes only when vitest also exits 0.
7. **The `claude` agent (hard-disabled).** It runs in the same hardened `node`
   container on an `--internal` network whose only other member is an egress
   proxy ([`egress-proxy.cjs`](egress-proxy.cjs), dependency-free, in its own
   hardened container). The proxy serves HTTP CONNECT only, to port 443 of the
   hosts in `EGRESS_ALLOWLIST` (just `api.anthropic.com`), and refuses an
   allowlisted name that resolves to a private, loopback or link-local address.
   The agent container sees only the snapshot at `/work` (read-write), the
   install and the `claude` binary (read-only), and a fresh `HOME` on tmpfs
   (`/dev/shm`) holding the eval settings and a copy of the model credential,
   mounted read-only over itself. Only the listed environment variables are
   passed (`HTTPS_PROXY`, `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1`, ...; no
   `GH_TOKEN`, `GITHUB_TOKEN` or `DATABASE_URL`). Only the eval settings load
   (`--setting-sources user`, `--settings`, `--strict-mcp-config`). Those
   settings are a convenience, **not a security control**: write access plus
   `npx vitest` already runs arbitrary code. The containers, the `--internal`
   network and the proxy are the boundary. On a timeout the container is
   removed, which stops every process the agent started.
8. **Cleanup.** Containers, networks and temp dirs (the credential copy among
   them) are removed on every exit path: normal exit, an error, and SIGINT,
   SIGTERM or SIGHUP. Containers run through an asynchronous spawn, so a signal
   is handled at once, not after the docker client returns. SIGKILL of the
   runner skips the cleanup; the **next run sweeps** what it left: `/dev/shm`
   homes owned by the user and `gymcoach-eval-*` containers and networks older
   than three hours (a task's `budget.maxWallSeconds` is capped at two hours in
   the schema, so a concurrent run is never touched; a resource of unknown age
   is kept). With `--keep`, the kept
   workspace is scrubbed of any file named like a credential or containing a
   credential value, with a warning.
9. **Networks.** Eval networks are `--internal` and use their own range,
   `10.250.0.0/16` in `/28` slices, because Docker's default address pools are
   shared with every other project on the machine and run out. Docker only
   checks that range against its own networks, not the host's routes: on a
   machine whose LAN or VPN uses it, set `GYMCOACH_EVAL_SUBNET` to another free
   `/16` prefix (`a.b`).

### Proof without a model call

`npx tsx evals/maintainer/probe-isolation.ts` builds the agent container exactly
as above (proxy, `--internal` network, mounts, read-only credential) and a
unit-tier grading container, and runs shell probes instead of `claude`. It exits
0 only when every check holds. On 2026-10-14 it exited 0; the number of checks
depends on how many host addresses the machine has (62 to 66 on this one).

Host addresses are dialled **by IP**, not only by name: `host.docker.internal`
does not resolve on an `--internal` network, so a name-only check would pass
whatever the routing. The probe finds the host's address as a container on the
default bridge sees it (192.168.65.2 on this machine, where the host's test
Postgres on 5434 **is** reachable from a plain container), and dials it, the
docker bridge gateway (172.17.0.1), Docker Desktop's host addresses
(192.168.65.254, 192.168.65.1) and the gateway of the agent's own network, on
ports 2375 and 5434, directly and through the proxy. A DNS check confirms that a
public name does not resolve on the internal network.

- From the agent container, all of these failed, as they must: reading the gh
  token, `~/.git-credentials`, `~/.ssh`, `~/.gitconfig` or the live checkout by
  absolute path; a gh config in `HOME`, a git remote, `git push`, `gh api`; a
  token in the environment; writing to `node_modules`, the binary, the root
  filesystem or the credential copy; `sudo`; reaching the Docker Desktop engine
  API (`host.docker.internal:2375`), the host's test Postgres (`:5434`),
  `github.com:443` or a public IP directly; and, through the proxy, the Docker
  API, `github.com` or plain HTTP. Two checks must succeed and did: a TLS
  handshake with `api.anthropic.com` through the proxy (no request sent), and
  `claude --version` with the read-only credential.
- From the grading container, the same file, environment and network checks
  failed, and so did a write to the (read-only) grading tree.

The no-model-call CLI commands (`claude --version`, `claude --help`) contacted no
host at all (the proxy's log stayed empty with an empty allowlist).

### The harness canary

Allowed application code runs inside the test process of the run that grades
it. The file allowlist keeps it from changing configs, setups or tooling; it
cannot keep it from changing the test framework in memory. Rather than
enumerate those cheats, every vitest run of the grader (hidden and preserved,
unit and integration) carries a **canary** (`canaryFiles` in
[`runner.ts`](runner.ts)) that checks the framework still rejects what it must:

- **Grader-owned files.** Per eval run, four files with unpredictable names
  (`x<random>.*`) are written into every grading tree like the hidden tests:
  hash-checked before each run, never agent-writable, never in the agent's
  workspace. Vitest is called with a grader-owned config that wraps the base
  one (`mergeConfig`): the canary setup is appended after the base setup
  files and the canary test is added to the file list.
- **A setup probe in every test file.** Vitest isolates test files, so the
  probe is a setup file: it runs in every file's context, once right after the
  base setup (where a cheat imported by `vitest.setup.ts` lives) and again in
  `afterAll` (after the file's own imports, where the module under test runs).
  It checks that `toBe`, `toEqual`, `toStrictEqual`, `toMatchObject`,
  `toContain`, `toThrow`, `toBeNull`, chai's `assert.strictEqual` and
  `chai.expect` reject values derived from the run's nonce, that `toBe` accepts
  equal ones, that `Object.is` behaves, and that no watched matcher function was
  replaced during the file. A failure makes that file fail.
- **A standalone canary test** whose title carries this run's nonce (passed to
  the grading container only, never to the agent). The grader reads the JSON
  report: the canary test must be present with the nonce and passed, and no
  file may report an integrity failure. Otherwise the run is `canary-failed` or
  `canary-missing`, a tamper violation, and the outcome is `fail`.

What it covers: the integrity of matchers, chai assertions and `Object.is`,
whichever allowed file the change comes from. What it does not cover: code
that special-cases the hidden tests' own inputs (for example a function that
returns the expected value only for the exact arguments a hidden test uses).
No harness can rule that out without reading the fix; the hidden tests are
the fix commit's real tests, which makes guessing their inputs the cheat's
whole difficulty.

`--agent tamper-inprocess` is the self-check: the broken fix plus the two
in-process cheats from the round-4 review, both passing the static screen.
With the canary disabled, it **passes** (see the replay table); with it, it
fails as `canary-failed`.

## Residual risks

What a paid run would still accept, stated plainly:

- **The credential is readable by the agent.** The agent can read the copy of the
  operator's Claude credential it runs with, and it can reach the model API. So
  exfiltration through the API itself (for example in a prompt that a later
  conversation could read back) is conceivable. The credential cannot leave by
  any other network path. This is the risk `--i-accept-credential-risk`
  acknowledges.
- **A token refresh would fail, not rotate.** The OAuth refresh host is not
  allowlisted and the credential copy is read-only, so a refresh inside the
  container cannot rotate the operator's login; the run fails instead. Not
  exercised: that needs a real call.
- **Hosts a real call needs are unverified beyond `api.anthropic.com`.** No
  model call has been made through the proxy. If the CLI needs another host
  for a real call, the first approved run fails as an infra-error, never a
  result; the proxy log names the refused host.
- **In-process tampering is detected, not prevented.** The file allowlist
  closes configs and tooling; the static screen is an early signal; the canary
  detects altered matchers, assertions and `Object.is`. Code that special-cases
  the hidden tests' inputs, or sabotages the JSON reporter itself in ways the
  canary does not probe, remains a validity risk within one run. It can no
  longer reach another run (fresh read-only tree per run, hash check, fresh
  database), and the containers keep it a validity risk only, never a host
  security risk. Cross-checking hidden-test counts against the reference run is
  a possible next hardening.
- **Training-data contamination.** The repository is public: a model's
  training data may include the later commits, PRs and lessons that the snapshot
  removes. Nothing in a replay can undo that; a task's result for a model trained
  after its fix date should be read with that in mind, and synthetic tasks are
  immune to it.
- **The proxy shares Docker's default bridge.** It can reach whatever that bridge
  reaches, but it only opens connections to allowlisted public hosts.
- **The snapshot's `CLAUDE.md` is kept**: it is part of the repository the agent
  maintains. Its publishing instructions have no effect without a remote, `gh` or
  a token.
- **A turn cap is recorded in the task but not passed to the CLI** (it has no such
  flag); the budget and the wall-time timeout bound the run.

## Outcomes and the denominator

`pass` needs every hidden and preserved test file to report at least one passing
test and no failure, vitest to exit 0, and the canary to be `ok` in every run. A run that produced no report, a setup
error, a patch that does not apply or a database that does not start is
`infra-error`: recorded in `result.json` with its reason, counted in every
report, never silently dropped. A hidden file that does not even load (for
example a missing export) is a failed suite, so it is a `fail`, not an infra
error.

## Not done yet

This is the first slice. Still to come (roadmap M3): 20-30 tasks across more
families (UI behaviour, migrations, CI diagnosis, interruption recovery,
untrusted instructions, review/merge races), validation and reserved splits,
repeated trials with variability and cost per successful task, and a first
budgeted `claude` baseline once the operator enables the paid agent and sets an
evaluation budget.
