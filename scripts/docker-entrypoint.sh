#!/bin/sh
set -e

# Run Prisma database migrations if DATABASE_URL is set and not explicitly disabled
if [ -n "$DATABASE_URL" ] && [ "$SKIP_DB_MIGRATE" != "true" ]; then
  echo "Applying database migrations..."
  # The Prisma CLI is invoked through its bundle: the .bin shim loses its
  # .wasm files when the image COPY dereferences the symlink.
  node node_modules/prisma/build/index.js migrate deploy
fi

exec "$@"
