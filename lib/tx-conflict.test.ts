import { describe, expect, it } from 'vitest';
import { isTransactionWriteConflict } from './tx-conflict';

// The P2010 shape below is the one the installed Prisma runtime builds for a
// raw query: `new PrismaClientKnownRequestError(message, 'P2010',
// { driverAdapterError })`, where @prisma/adapter-pg sets
// `cause.kind = 'TransactionWriteConflict'` for SQLSTATE 40001 and 40P01.
// tests/integration/session-edit.test.ts provokes the real error against
// Postgres and checks it has this shape.
function rawQueryError(kind: string, originalCode: string) {
  return Object.assign(new Error('Raw query failed'), {
    code: 'P2010',
    meta: { driverAdapterError: { name: 'DriverAdapterError', cause: { kind, originalCode } } },
  });
}

describe('isTransactionWriteConflict', () => {
  it('recognizes the model-query shape', () => {
    expect(isTransactionWriteConflict(Object.assign(new Error('conflict'), { code: 'P2034' }))).toBe(
      true,
    );
  });

  it('recognizes a raw query that hit a serialization failure or a deadlock', () => {
    expect(isTransactionWriteConflict(rawQueryError('TransactionWriteConflict', '40001'))).toBe(true);
    expect(isTransactionWriteConflict(rawQueryError('TransactionWriteConflict', '40P01'))).toBe(true);
  });

  it('does not retry any other raw query failure', () => {
    expect(isTransactionWriteConflict(rawQueryError('postgres', '42601'))).toBe(false);
    expect(isTransactionWriteConflict(rawQueryError('UniqueConstraintViolation', '23505'))).toBe(
      false,
    );
    expect(isTransactionWriteConflict(Object.assign(new Error('raw'), { code: 'P2010' }))).toBe(false);
    expect(
      isTransactionWriteConflict(Object.assign(new Error('raw'), { code: 'P2010', meta: null })),
    ).toBe(false);
  });

  it('does not retry unrelated errors', () => {
    expect(isTransactionWriteConflict(Object.assign(new Error('gone'), { code: 'P2025' }))).toBe(false);
    expect(isTransactionWriteConflict(new Error('boom'))).toBe(false);
    expect(isTransactionWriteConflict(null)).toBe(false);
    expect(isTransactionWriteConflict('P2034')).toBe(false);
  });
});
