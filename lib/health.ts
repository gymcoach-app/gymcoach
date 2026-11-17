import { db } from '@/lib/db';

// Database probe behind GET /api/health (issue #576).
//
// The endpoint is unauthenticated, so it has to stay cheap whatever a caller
// does with it: at most one probe query is outstanding at a time. Every caller
// that arrives while it is pending waits on that same query against its own
// timeout, so a database that hangs holds one pool connection, not one per
// request.

export const HEALTH_DB_TIMEOUT_MS = 2000;

let pending: Promise<boolean> | null = null;

function probe(): Promise<boolean> {
  if (!pending) {
    pending = Promise.resolve()
      .then(() => db.$queryRaw`SELECT 1`)
      .then(
        () => true,
        () => false,
      )
      .finally(() => {
        pending = null;
      });
  }
  return pending;
}

/**
 * True when the database answered a trivial query within `timeoutMs`. Never
 * throws and never returns the failure: the caller only learns yes or no.
 */
export async function isDatabaseHealthy(
  timeoutMs: number = HEALTH_DB_TIMEOUT_MS,
): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<boolean>((resolve) => {
    timer = setTimeout(() => resolve(false), timeoutMs);
  });
  try {
    return await Promise.race([probe(), timeout]);
  } finally {
    clearTimeout(timer);
  }
}
