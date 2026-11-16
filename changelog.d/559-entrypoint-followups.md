---
section: Changed
---
The image's migration entrypoint is installed as `gymcoach-entrypoint.sh`, so
the Node base image's own `docker-entrypoint.sh` stays in place, and
`SKIP_DB_MIGRATE` is documented in `.env.example` and the self-hosting guide
(#559 follow-up).
