---
section: Fixed
---

The self-host compose file now passes `OPENROUTER_MAX_TOKENS` and the
codex-lb variables (`CODEX_LB_BASE_URL`, `CODEX_LB_API_KEY`,
`CODEX_LB_MODEL`) to the app, so setting them in `.env` takes effect, and maps
`host.docker.internal` so a model server on the host is reachable from the
container. A test keeps every provider variable the code reads passed through.
Found in the review of #505.
