# Security Policy

## Reporting a vulnerability

Please do not open a public issue for security problems. Instead, use GitHub's
private vulnerability reporting ("Report a vulnerability" in the Security tab),
or contact the maintainers privately. We will acknowledge the report and work
on a fix as quickly as we reasonably can.

## Scope and notes

GymCoach is self-hosted. Operators are responsible for:

- Setting a strong, unique `JWT_SECRET` (at least 32 characters).
- Keeping their LLM provider API key (`ANTHROPIC_API_KEY`,
  `OPENROUTER_API_KEY` or `OPENAI_COMPATIBLE_API_KEY`) secret. Note that the AI
  coach sends the user's training data to the configured provider, which with
  `LLM_PROVIDER=openai-compatible` is whatever host
  `OPENAI_COMPATIBLE_BASE_URL` names. An `http://` base URL to another machine
  sends that data and the optional key in clear text: use `https`, or `http`
  only to the same host or a trusted private network.
- Running the app behind HTTPS (a reverse proxy such as Nginx, Caddy or
  Traefik) in production.
- Keeping dependencies up to date (`npm audit`).
