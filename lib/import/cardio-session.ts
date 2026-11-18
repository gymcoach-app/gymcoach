import { db } from '@/lib/db';
import { ApiError } from '@/lib/api';
import { Prisma } from '@/prisma/generated/client';
import type { TrackPoint } from '@/lib/import/track';

// ============================================================
// Imported cardio activity -> session (server side)
// ============================================================
// The one place an imported cardio activity becomes rows: the FIT route and
// the Apple Health route (issue #582) both write through these helpers, so
// the exercise reuse rule, the cardio set convention and the duplicate window
// cannot drift apart.

// How close an existing session's start has to be to count as a likely
// duplicate of an imported activity. Same window for every cardio import.
export const IMPORT_DUPLICATE_WINDOW_MS = 2 * 60 * 1000;

// What the importers hand over: already parsed and range-checked.
export interface ImportedCardioActivity {
  startedAt: Date;
  durationSec: number;
  distanceM: number | null;
  avgHr: number | null;
  maxHr: number | null;
  // Downsampled pace/HR samples (issue #254), when the source carried them.
  track?: TrackPoint[] | null;
}

type Client = Prisma.TransactionClient | typeof db;

// The user's sessions whose start lies between the earliest and the latest of
// `starts`, widened by the duplicate window, oldest first. One query for the
// whole list; for a single start that is exactly its near-duplicates.
export async function findSessionStartsNear(
  userId: string,
  starts: Date[],
  client: Client = db,
): Promise<Date[]> {
  if (starts.length === 0) return [];
  let min = starts[0]!.getTime();
  let max = min;
  for (const s of starts) {
    const t = s.getTime();
    if (t < min) min = t;
    if (t > max) max = t;
  }
  const rows = await client.session.findMany({
    where: {
      userId,
      startedAt: {
        gte: new Date(min - IMPORT_DUPLICATE_WINDOW_MS),
        lte: new Date(max + IMPORT_DUPLICATE_WINDOW_MS),
      },
    },
    select: { startedAt: true },
    orderBy: { startedAt: 'asc' },
  });
  return rows.map((r) => r.startedAt);
}

// True when one of `starts` (epoch ms, any order) lies within the duplicate
// window of `at`.
export function hasStartNear(starts: readonly number[], at: number): boolean {
  for (const s of starts) {
    if (Math.abs(s - at) <= IMPORT_DUPLICATE_WINDOW_MS) return true;
  }
  return false;
}

// Find the user's exercise of that name, or create it as a cardio exercise.
// Ownership-scoped. Refuses (409) to reuse a non-cardio exercise: cardio
// fields are never written onto it.
export async function resolveCardioExercise(
  client: Client,
  userId: string,
  name: string,
  createdNotes: string,
): Promise<{ id: string; created: boolean }> {
  const existing = await client.exercise.findFirst({
    where: { userId, name },
    select: { id: true, category: true },
  });
  if (existing && existing.category !== 'CARDIO') {
    throw new ApiError(
      409,
      `You already have a non-cardio exercise named "${name}". Rename it and retry.`,
    );
  }
  if (existing) return { id: existing.id, created: false };
  const created = await client.exercise.create({
    data: { userId, name, muscleGroup: 'OTHER', category: 'CARDIO', notes: createdNotes },
    select: { id: true },
  });
  return { id: created.id, created: true };
}

// Create the session of one imported activity with its single cardio set.
// A nested write: Prisma creates both rows atomically, or neither.
export async function createCardioSession(
  client: Client,
  userId: string,
  exerciseId: string,
  activity: ImportedCardioActivity,
  sessionNotes: string,
): Promise<{ sessionId: string }> {
  const finishedAt = new Date(activity.startedAt.getTime() + activity.durationSec * 1000);
  const session = await client.session.create({
    data: {
      userId,
      startedAt: activity.startedAt,
      finishedAt,
      notes: sessionNotes,
      sets: {
        create: {
          exerciseId,
          setNumber: 1,
          // Cardio sets store weight = 0 / reps = 1 by convention (#133).
          weight: 0,
          reps: 1,
          durationSec: activity.durationSec,
          distanceM: activity.distanceM,
          avgHr: activity.avgHr,
          maxHr: activity.maxHr,
          ...(activity.track
            ? { track: activity.track as unknown as Prisma.InputJsonValue }
            : {}),
          completedAt: finishedAt,
        },
      },
    },
    select: { id: true },
  });
  return { sessionId: session.id };
}
