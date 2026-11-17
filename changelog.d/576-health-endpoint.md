---
section: Added
---
Health endpoint and container healthcheck: `GET /api/health` needs no login and
answers `200 {"status":"ok"}` when the database answers a trivial query within
two seconds, `503 {"status":"unavailable"}` otherwise, with no version,
configuration or error detail in the body. The production image declares a
`HEALTHCHECK` on it and the `app` service of `docker-compose.selfhost.yml` and
`docker-compose.prod.yml` repeats it, so `docker compose ps` shows the app as
healthy; the probe runs with the image's own `node`, no curl or wget is added
(#576).
