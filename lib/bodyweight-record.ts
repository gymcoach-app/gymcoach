import type { Prisma } from '@/prisma/generated/client';
import { db } from '@/lib/db';
import { currentBodyweightFromEntries } from '@/lib/bodyweight';

export interface RecordBodyweightInput {
  weightKg: number;
  note?: string;
}

export interface BodyweightMutation<T> {
  result: T;
  // User.bodyweight as it was before the mutation, read under the row lock.
  previousBodyweightKg: number | null;
}

// Runs one bodyweight history mutation and re-syncs User.bodyweight, the
// single "current value" the rest of the app reads. The user row is locked
// first so concurrent mutations serialize: "stamped now, so newest by
// construction" does not hold at ReadCommitted, where the commit order on the
// user row can disagree with the measuredAt order (issue #107). When no
// entries remain the profile value is left as is (it may predate the history,
// and clearing it would silently change effective-load math). Shared by the
// REST routes and the MCP user-properties tool so all follow the same rule.
export async function mutateBodyweightHistory<T>(
  userId: string,
  mutate: (tx: Prisma.TransactionClient) => Promise<T>,
): Promise<BodyweightMutation<T>> {
  return db.$transaction(async (tx) => {
    const locked = await tx.$queryRaw<Array<{ bodyweight: number | null }>>`
      SELECT bodyweight FROM "User" WHERE id = ${userId} FOR UPDATE`;
    const result = await mutate(tx);
    const entries = await tx.bodyweightEntry.findMany({
      where: { userId },
      orderBy: [{ measuredAt: 'asc' }, { id: 'asc' }],
      select: { weightKg: true, measuredAt: true },
    });
    const current = currentBodyweightFromEntries(entries);
    if (current !== null) {
      await tx.user.update({
        where: { id: userId },
        data: { bodyweight: current },
      });
    }
    return { result, previousBodyweightKg: locked[0]?.bodyweight ?? null };
  });
}

// Appends one bodyweight measurement through mutateBodyweightHistory.
export async function recordBodyweightEntry(userId: string, input: RecordBodyweightInput) {
  const { result: entry, previousBodyweightKg } = await mutateBodyweightHistory(userId, (tx) =>
    tx.bodyweightEntry.create({
      data: { userId, weightKg: input.weightKg, note: input.note ?? null },
    }),
  );
  return { entry, previousBodyweightKg };
}
