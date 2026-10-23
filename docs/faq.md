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
exports, and cardio files (FIT, GPX, TCX) in the cardio part; it parses and
previews the file before writing anything. **Import a backup** is a different
path: it asks for confirmation, then replaces all of the signed-in account's
data (programs, sessions, sets, goals, bodyweight history, check-ins and coach
conversations) with the file. That cannot be undone, and there is no preview, so
export first if you are unsure.

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

Only if your server exposes the OpenAI Responses API, which `LLM_PROVIDER=codex-lb`
speaks (`CODEX_LB_BASE_URL`, include `/v1`). A server that only offers the older
Chat Completions API will not work. If the server runs on the same machine as the
container, point the base URL at `http://host.docker.internal:8317/v1`: inside the
container, `localhost` is the container itself. The current prebuilt compose file
already maps `host.docker.internal` and forwards the `CODEX_LB_*` variables; a
copy downloaded before October 2026 may need both added, see
[choose a model](self-hosting.md#choose-a-model-for-the-ai-coach). The `demo`
provider gives canned answers with no key and is the quickest way to try the AI
screens.

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

`/mcp/health` answers, but it requires an MCP token. For a liveness probe in a
proxy or uptime monitor, request `/login` and expect `200`.
