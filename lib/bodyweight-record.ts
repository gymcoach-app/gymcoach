import { db } from '@/lib/db';
import { currentBodyweightFromEntries } from '@/lib/bodyweight';

export interface RecordBodyweightInput {
  weightKg: number;
  note?: string;
}

// Appends one bodyweight measurement and re-syncs User.bodyweight, the single
// "current value" the rest of the app reads. The user row is locked first so
// concurrent mutations serialize: "stamped now, so newest by construction"
// does not hold at ReadCommitted, where the commit order on the user row can
// disagree with the measuredAt order (issue #107). Shared by the REST route and
// the MCP user-properties tool so both follow the same rule.
export async function recordBodyweightEntry(userId: string, input: RecordBodyweightInput) {
  return db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${userId} FOR UPDATE`;
    const created = await tx.bodyweightEntry.create({
      data: { userId, weightKg: input.weightKg, note: input.note ?? null },
    });
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
    return created;
  });
}
