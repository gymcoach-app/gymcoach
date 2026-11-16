---
section: Fixed
---
Production Docker image automatically applies Prisma migrations on startup via `docker-entrypoint.sh` before running the Next.js server, making standalone deployments and container auto-updates self-migrating.
