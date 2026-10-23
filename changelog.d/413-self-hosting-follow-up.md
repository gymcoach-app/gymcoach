---
section: Fixed
---

The self-hosting guide's snippets were run once against
`docker-compose.selfhost.yml`. Both restore recipes now wait for a healthy
database (`docker compose up -d --wait db`): on a fresh volume, psql run right
after `up -d db` failed. The same-host restore empties the uploads volume
first, so photos added after the backup do not linger. The guide also
describes the `TRUSTED_PROXY_HOPS` setting for two proxies in a row, notes
that the current compose file already forwards the model variables and maps
`host.docker.internal`, keeps a rotated database password out of shell
history, and names the Traefik v2 allowlist middleware.
