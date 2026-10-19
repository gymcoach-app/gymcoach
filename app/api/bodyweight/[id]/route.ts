import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { ApiError, handleApiError, requireApiUserId } from '@/lib/api';
import { mutateBodyweightHistory } from '@/lib/bodyweight-record';

interface Params {
  params: Promise<{ id: string }>;
}

// DELETE /api/bodyweight/[id]: remove one measurement. User.bodyweight is the
// "current value" mirror of the newest entry, so after the delete it re-syncs
// to the newest remaining entry. When no entries remain the profile value is
// left as is (it may predate the history, and clearing it would silently
// change effective-load math).
export async function DELETE(_req: Request, props: Params) {
  const params = await props.params;
  try {
    const userId = await requireApiUserId();
    // Ownership lives in the query scope itself (issue #317).
    const entry = await db.bodyweightEntry.findFirst({
      where: { id: params.id, userId },
    });
    if (!entry) {
      throw new ApiError(404, 'Entry not found.');
    }

    // The shared helper locks the user row so the re-sync serializes with
    // concurrent bodyweight mutations (issue #107), matching the POST route.
    await mutateBodyweightHistory(userId, (tx) =>
      tx.bodyweightEntry.delete({ where: { id: params.id, userId } }),
    );
    return NextResponse.json({ ok: true });
  } catch (err) {
    return handleApiError(err);
  }
}
