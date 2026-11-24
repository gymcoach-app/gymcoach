// Is this error a serialization failure or a deadlock that the database asks
// the caller to retry? Pure, so it is unit-tested without a database.
//
// Prisma reports the same Postgres condition (SQLSTATE 40001 or 40P01) in two
// shapes, depending on which call hit it:
// - a model query (findMany, update, ...) or the commit: code P2034;
// - a raw query ($queryRaw, $executeRaw, e.g. a SELECT ... FOR UPDATE): code
//   P2010, with the driver adapter's own error under
//   meta.driverAdapterError, whose cause.kind is 'TransactionWriteConflict'
//   (@prisma/adapter-pg maps both SQLSTATEs to that kind).
// A retry loop that only knows P2034 lets the second shape through as a 500.

function field(value: unknown, key: string): unknown {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>)[key] : undefined;
}

export function isTransactionWriteConflict(err: unknown): boolean {
  const code = field(err, 'code');
  if (code === 'P2034') return true;
  if (code !== 'P2010') return false;
  const cause = field(field(field(err, 'meta'), 'driverAdapterError'), 'cause');
  return field(cause, 'kind') === 'TransactionWriteConflict';
}
