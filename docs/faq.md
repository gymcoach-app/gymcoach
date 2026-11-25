# GymCoach FAQ

Short answers to the questions self-hosters ask most. Setup, backups, upgrades
and model choice are covered in more depth in
[docs/self-hosting.md](self-hosting.md).

## Setup

### Which architectures does the image support?

`linux/amd64` only. ARM hosts and Raspberry Pis are tracked in
[#411](https://github.com/gymcoach-app/gymcoach/issues/411); building from source
on the target machine is the workaround until that lands.

### Do I need Node.js on the server?

No. The prebuilt image contains the app; the server needs Docker and Docker
Compose. Node 20+ is only needed to build from source or to run the tests.

### Can I change the port?

Yes. Set `GYMCOACH_PORT=8080` in `.env` and run `docker compose up -d`. The
container port stays `3000`; only the host side changes. The value is the whole
publish spec, so `GYMCOACH_PORT=127.0.0.1:8080` binds loopback only, which is
what you want once a proxy handles the traffic: publishing on all interfaces
lets Docker bypass `ufw` and answer on the LAN.

### Can I serve it under a subpath, like example.com/gym?

No. GymCoach is built as a standalone Next.js app without a base path, and no
configuration exposes one. Use a subdomain (`gym.example.com`) instead.

## Accounts and access

### Login seems to work, then bounces back to the login page. Why?

Over plain HTTP (`http://192.168.1.10:3000`), browsers discard the `Secure`
session cookie, so the session never sticks. Either put an HTTPS proxy in front
(recommended), or opt out explicitly for a trusted LAN:

```bash
# .env
SESSION_COOKIE_SECURE=false
```

Never leave that setting on an internet-facing instance.

### Can I create accounts for my family or gym friends?

Yes. The signup page is public and every account has its own data (sessions,
programs, photos). There is no admin role or shared view. Registration is
rate-limited to 5 attempts per minute per IP.

### Can I turn off registration?

There is no switch for it yet. To keep an instance private, keep it on a VPN
(Tailscale or WireGuard) or add an IP allowlist in the reverse proxy. Both are
described in
[keeping an instance private](self-hosting.md#keeping-an-instance-private).

### I forgot my password. Is there a reset flow?

No, the app has no password reset. The simplest recovery uses the app's own
hashing: sign up a temporary account with the password you want, copy its hash
onto the locked account, then delete the temporary account.

```bash
docker compose exec db psql -U gymcoach -d gymcoach -c \
  "UPDATE \"User\" SET \"passwordHash\" = (SELECT \"passwordHash\" FROM \"User\" WHERE email = 'temp@example.com') WHERE email = 'you@example.com';"
```

The temporary account can stay; it is only an extra login on the instance.
Deleting it takes one more step, because the signup seeds an exercise catalog
for it and a few tables reference the user without a cascade. For an account
that only signed up, this is enough:

```bash
docker compose exec db psql -U gymcoach -d gymcoach -c \
  "DELETE FROM \"Exercise\" WHERE \"userId\" = (SELECT id FROM \"User\" WHERE email = 'temp@example.com'); DELETE FROM \"User\" WHERE email = 'temp@example.com';"
```

If that account already has programs, sessions or coach conversations, delete
those rows first: `Program`, `Session` and `Conversation` also reference the
user without a cascade, and Postgres refuses the delete while they exist.

If you have a database backup, restoring it is the alternative.

### Could a password have ended up in a URL or a log?

Yes, in one case, on every version before the one that fixed it (see the
changelog entry for #593): someone pressed "Sign in" or "Create account"
before the page had finished loading, which happens on a slow phone or a slow
connection. The form was then sent by the browser itself as a plain page
request, `/login?email=...&password=...` or
`/signup?displayName=...&email=...&password=...`, and the page came back
empty. The person usually typed again and got in, without noticing.

Nobody else could trigger this for them. The password is readable in such a
URL (URL-encoded, not hashed), and the URL went wherever page requests go.
What may hold it:

- **The access log of whatever handles the requests in front of GymCoach**:
  your reverse proxy (Nginx, Caddy, Traefik), and any service that terminates
  TLS before it, such as a CDN or a tunnel provider, whose logs you may not
  control. It is in the request line, and in the referer field of the
  requests that page made next if the log format records it. GymCoach itself
  does not log requests. Search the logs you keep for `/login?` and
  `/signup?` followed by `password=`, for example
  `grep -E '/(login|signup)\?[^ "]*password=' access.log`, and delete or
  redact the matching lines, in rotated and archived files too.
- **The history of the browser that was used**, and of the other devices that
  browser syncs its history to.
- **The offline cache of the app in that browser** (the service worker's
  `pages` cache). GymCoach removes these entries by itself the next time the
  app is opened in that browser after the upgrade.

If you find such a line, or cannot rule it out for logs someone else can
read:

1. **Change the password of the account.** There is no self-service password
   change in the app: it is the admin procedure above ("I forgot my
   password"), and the temporary account it creates must be deleted
   afterwards, with the second command given there.
2. **Sign everyone out.** A new password does not end a session that was
   opened with the old one: sessions are signed tokens valid for 30 days and
   are not stored on the server. Set a new `JWT_SECRET` and restart the app;
   every session on the instance ends and everyone signs in again.
3. **Review the account's MCP tokens** (Settings). A token is not tied to the
   password or to `JWT_SECRET`: it has no expiry and works until it is
   revoked. Someone who signed in with the leaked password could have created
   one. Revoke any token the account's owner does not recognise.
4. **Change the password wherever else it was used.**

Since the fix, the forms are sent as a POST, the server answers a `/login` or
`/signup` URL that carries a query string with a redirect to the bare page,
and neither page is kept in the offline cache.

## Data

### Where does my data live?

Two Docker volumes: `postgres-data` (all structured data) and `uploads`
(progress photos). Both are prefixed with the Compose project name, usually the
directory name. `.env` holds the database password and the JWT secret; it is
part of the backup.

### What should I back up?

The database, the uploads volume, and `.env`. The
[backup section of the self-hosting guide](self-hosting.md#back-up-the-database-and-the-uploads)
has copy-paste commands. Keep `.env` separate from archives you share.

### Is there a way to export just my account?

Yes. **Settings -> Data -> Export all my data (JSON)** downloads a JSON file
with that account's data, and **Import a backup** loads it back. Import asks for
confirmation, then replaces all of the account's data, and cannot be undone. It
is useful for keeping a readable copy or moving one account's history; it is not
a replacement for the volume backup.

### Can I import from another app?

The **Import training history** section of Settings accepts Hevy and Strong
exports, cardio files (FIT, GPX, TCX) in the cardio part, an Apple Health
export and a Strava archive (see the next two questions); it parses and
previews the file before writing anything. **Import a backup** is a different
path: it asks for confirmation, then replaces all of the signed-in account's
data (programs, sessions, sets, goals, bodyweight history, check-ins and coach
conversations) with the file. That cannot be undone, and there is no preview, so
export first if you are unsure.

### How do I import my workouts from Apple Health?

1. On the iPhone, open the **Health** app, tap your profile picture (top right),
   then **Export All Health Data**. The phone builds an `export.zip`; on a long
   history this takes a few minutes and the file can weigh hundreds of MB.
2. Save it where the browser can reach it (Files, AirDrop to a Mac, ...).
3. In GymCoach, open **Settings**, **Import training history**, pick
   **Apple Health** as the source and choose the `export.zip` (the `export.xml`
   inside it works too).
4. Check the preview, then confirm.

What to expect:

- **The file stays on your device.** The browser reads it as a stream and only
  sends workout summaries (type, start, duration, distance, average and peak
  heart rate) to your GymCoach server, a few hundred at a time. Routes, ECGs
  and every other health record in the export are never read or sent.
- **Cardio only.** Running, walking, hiking, cycling, swimming, rowing,
  elliptical, stair climbing and jump rope land on an exercise of that name;
  every other activity (interval training, yoga, a sport) goes to
  **Cardio (imported)**. Traditional strength, functional strength and core
  training are skipped and counted in the preview: Apple Health stores no
  exercises, sets or loads for them, so there is nothing to log per set.
- **No duplicates.** A workout that starts within 2 minutes of a session you
  already have is skipped, so importing a newer export later only adds what is
  new. The same goes for one effort saved twice in the export (the watch and
  an app that synced it).
- **Body weight is optional.** The preview has a switch to also import your
  body mass records into the bodyweight log: one entry a day (the last
  measurement of that day, the day being the one on your phone's clock, taken
  from the time zone offset the export writes with each date), and days that
  already have an entry are left alone. If an imported entry is newer than
  everything in the log, it becomes your current bodyweight.
- **One export, up to 2 GB.** Only the export file of the archive is read (the
  first one, if a zip was repacked with several), and an `export.zip` whose
  export unpacks to more than 2 GB, or that holds more than 50 000 files
  before it, is refused with a message.
- **A long history takes a moment.** Imports share a limit of 10 requests a
  minute per account; past a few thousand workouts the page waits for the
  limit and continues on its own. Keep the tab open.

### How do I import my activities from Strava?

1. On strava.com (the website, not the app), open **Settings**, **My Account**,
   then **Get Started** under **Download or Delete Your Account**, and press
   **Request Your Archive**. Strava emails a download link, usually within a
   few hours.
2. Download the zip (`export_<number>.zip`). Do not unzip it.
3. In GymCoach, open **Settings**, **Import training history**, pick **Strava**
   as the source and choose the zip.
4. GymCoach checks every activity, then shows one preview: how many activities
   will be imported, per exercise, and what is left out. Confirm to import.

What to expect:

- **The archive stays on your device.** The browser unzips it as a stream and
  reads two things only: `activities.csv` and the files of the `activities`
  folder (`.fit`, `.gpx`, `.tcx`, each possibly `.gz`). Photos, videos and the
  rest of the archive are never decompressed. Each activity file is then sent
  to your GymCoach server through the same FIT, GPX and TCX imports as a file
  you would pick by hand, so the result is identical: one cardio session per
  activity, with duration, distance, heart rate and the pace track when the
  file has them.
- **No duplicates.** An activity that starts within 2 minutes of a session you
  already have is left out of the import, so a newer archive only adds what is
  new.
- **Activities without a file are skipped.** An activity typed in by hand on
  Strava has a row in `activities.csv` but no file; the preview counts them.
  Strength sessions logged on Strava carry no exercises or sets either way.
- **Session names are not imported.** The activity name is only used to tell
  you which files could not be read. A file over 5 MB, or in a format other
  than FIT, GPX and TCX, is skipped and counted.
- **A long history takes a while.** Imports share a limit of 10 requests a
  minute per account. FIT files (what most watches upload) go 50 to a request,
  so thousands of them take a few minutes. GPX and TCX files go one to a
  request, once for the preview and once for the import: count about 5 a
  minute. The page waits for the limit and continues on its own; keep the tab
  open. **Cancel** stops at any point; what was already imported stays, and
  running the import again skips it.
- **Other languages.** Strava writes the header of `activities.csv` in your
  account's language. GymCoach finds the file column by its content, so the
  import does not depend on the language.

### I restored the database but my progress photos are gone. Why?

Photos live in the `uploads` volume, not in Postgres. Restore the
`uploads.tar.gz` archive alongside the dump; the commands are in the
[self-hosting guide](self-hosting.md#restore-onto-the-same-host).

### How do I move GymCoach to a new server?

Back up the three parts on the old host, copy `docker-compose.yml`, `.env` and
the backup folder, and follow
[restore onto a new host](self-hosting.md#restore-onto-a-new-host). Point DNS
or the tunnel at the new machine once the login page answers locally.

## The AI coach

### Do I need an API key?

No. Without a key GymCoach is a plain tracker; the coach screens say that no
provider is configured. Add a key to turn on the weekly debrief, the chat,
program generation and the free-text set parser.

### Can I use a local model?

Yes. `LLM_PROVIDER=openai-compatible` talks to any server that speaks the OpenAI
Chat Completions API (Ollama, LM Studio, vLLM, llama.cpp server): set
`OPENAI_COMPATIBLE_BASE_URL` (include `/v1`) and `OPENAI_COMPATIBLE_MODEL`; a key
is optional. If the server runs on the same machine as the container, point the
base URL at `http://host.docker.internal:11434/v1` (Ollama's port): inside the
container, `localhost` is the container itself. A server that exposes the OpenAI
Responses API instead works with `LLM_PROVIDER=codex-lb` (`CODEX_LB_BASE_URL`).
The chat works with almost any model; suggested program changes, program
generation and the free-text set parser need a capable one, because they ask for
strict JSON that is validated before it is applied. Raise the server's context
length first (for Ollama, `OLLAMA_CONTEXT_LENGTH`, for example 16384): the
default is often too small for the coach's prompt, which is then cut without an
error. The current prebuilt compose
file already maps `host.docker.internal` and forwards these variables; an older
copy may need both added, see
[a local model](self-hosting.md#run-the-coach-on-a-local-model). The `demo`
provider gives canned answers with no key and is the quickest way to try the AI
screens.

### What does the AI provider receive?

Every AI call sends a summary built on the server for that call, never your
database.

- **Weekly debrief and chat coach.** Your profile (the fields you filled in,
  such as display name, goal, bodyweight and weekly frequency), your recent
  sessions and sets, your active program, your records and goals, your latest
  readiness check-in and your weekly cardio totals. Text you wrote is part of
  it: your note to the coach, session and set notes, the readiness note. The
  chat also sends the conversation, and the workout in progress when you open
  it during a session.
- **Heart rate.** When your cardio or a session carries heart rate (an imported
  activity, cardio logged with a heart rate, or a watch file attached to a
  session), the average and the peak in bpm are part of that summary. The heart
  rate curve itself is not sent.
- **Program generation** sends your profile fields, your exercise list and the
  goal you typed. **The set parser** sends the text you typed, the exercise
  name and your unit.
- **MCP.** The context tool gives the agent you connected the same summary,
  plus the equipment of your active gym and your unit.

Nothing is sent with `LLM_PROVIDER=demo`, and a local model (see above) keeps
everything on your machine. The "What your coach sees" card on the Coach page
shows a short version of the coach summary.

### What does the coach cost to run?

Your provider bills per token; there are no numbers in the repository because
prices change. The chat reply is the biggest single cost (up to 4096 output
tokens per reply); the weekly debrief, program generation and the free-text set
parser follow. Use a smaller model if the bill matters, or `LLM_PROVIDER=demo` to
click through without spending. GymCoach has no built-in spend cap, so watch the
provider dashboard. See
[choose a model](self-hosting.md#choose-a-model-for-the-ai-coach).

### Does it work offline?

The tracker is a PWA and keeps working offline for logging; data syncs when the
server is reachable. The AI features need the server and the model provider.

## Operations

### How do I upgrade?

Back up first, then `docker compose pull && docker compose up -d`. Migrations
apply on start. Pin a `sha-<short>` tag if you do not want `latest` to move.
The [upgrade section](self-hosting.md#upgrade-and-roll-back) covers rollback and
its database caveat.

### Where are the logs?

```bash
docker compose logs -f app
docker compose logs -f db
```

### Is there a health check endpoint?

Yes: `GET /api/health`, no login needed. It answers `200` with
`{"status":"ok"}` when the app can query its database and `503` with
`{"status":"unavailable"}` when it cannot. The body says nothing else (no
version, no configuration, no error text), so it is safe to point a proxy or an
uptime monitor at it. The image runs the same probe as its Docker healthcheck:
`docker compose ps` shows the app as `healthy`. (`/mcp/health` is a different
endpoint: it checks an MCP token.)
