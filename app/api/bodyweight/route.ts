import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { bodyweightEntryInputSchema } from '@/lib/schemas/bodyweight';
import { handleApiError, parseJsonBody, requireApiUserId } from '@/lib/api';
import { recordBodyweightEntry } from '@/lib/bodyweight-record';

// GET /api/bodyweight: the user's bodyweight history, newest first.
export async function GET() {
  try {
    const userId = await requireApiUserId();
    const entries = await db.bodyweightEntry.findMany({
      where: { userId },
      orderBy: { measuredAt: 'desc' },
    });
    return NextResponse.json(entries);
  } catch (err) {
    return handleApiError(err);
  }
}

// POST /api/bodyweight: log a measurement. User.bodyweight (the current value
// the rest of the app reads) re-syncs to the newest entry in the same
// transaction; recordBodyweightEntry owns that rule for this route and MCP.
export async function POST(req: Request) {
  try {
    const userId = await requireApiUserId();
    const data = await parseJsonBody(req, bodyweightEntryInputSchema);
    const entry = await recordBodyweightEntry(userId, data);
    return NextResponse.json(entry, { status: 201 });
  } catch (err) {
    return handleApiError(err);
  }
}
