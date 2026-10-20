import type { Prisma, PrismaClient } from '@/prisma/generated/client';

// ============================================================
// CSV import planning + execution (issues #100/#113)
// ============================================================
// buildStrongImportPlan is pure: it groups parsed rows into sessions, matches
// exercises case-insensitively against the user's catalog, and skips exact
// duplicates. executeStrongImport performs the writes through the transaction
// client it is given, so the route can wrap one import in one transaction and
// a failure rolls everything back. Both are shared by every import format
// (Strong, Hevy) through the normalized row type below; the historical names
// are kept so the Strong call sites stay untouched.

// The format-neutral row every CSV parser normalizes to. StrongCsvRow is the
// base shape; richer exports (Hevy) also carry set flags and real times.
export interface NormalizedImportRow {
  dateKey: string; // YYYY-MM-DD
  workoutName: string;
  exerciseName: string;
  setOrder: number;
  weightKg: number;
  reps: number;
  // Optional extras (issue #113). Absent for Strong rows.
  isWarmup?: boolean;
  isDropSet?: boolean;
  // Cardio rows (issue #134): duration in seconds and optional distance in
  // meters, per the #133 set model (such rows carry weightKg 0 / reps 1).
  // Absent/null on strength rows - their path is unchanged.
  durationSec?: number | null;
  distanceM?: number | null;
  // Richer per-set data the GymCoach native CSV carries (issue #270). Absent
  // for Strong/Hevy rows - their path is unchanged.
  rir?: number | null;
  notes?: string | null;
  avgHr?: number | null;
  maxHr?: number | null;
  // Real session times as ISO strings, when the source export has them.
  startedAtIso?: string | null;
  finishedAtIso?: string | null;
  // Block of a deliberately repeated exercise (issue #475), from the GymCoach
  // native CSV. Absent for Strong/Hevy rows.
  block?: number | null;
  // Explicit session grouping key (issue #270): the GymCoach export carries a
  // session_id, so two same-day sessions with the same workout name stay
  // separate. Absent falls back to the historical (dateKey, workoutName) key.
  sessionKey?: string;
}

export interface PlannedSet {
  exerciseName: string;
  setOrder: number;
  weightKg: number;
  reps: number;
  isWarmup?: boolean;
  isDropSet?: boolean;
  durationSec?: number | null;
  distanceM?: number | null;
  rir?: number | null;
  notes?: string | null;
  avgHr?: number | null;
  maxHr?: number | null;
  block?: number | null;
}

export interface PlannedSession {
  dateKey: string; // YYYY-MM-DD
  workoutName: string;
  sets: PlannedSet[];
  // Earliest/latest real times seen across the session's rows (issue #113);
  // undefined/null falls back to the honest noon-UTC default.
  startedAtIso?: string | null;
  finishedAtIso?: string | null;
}

export interface StrongImportPlan {
  sessions: PlannedSession[];
  // New exercise names to create (original casing of first occurrence),
  // sorted.
  newExerciseNames: string[];
  // Subset of newExerciseNames whose every imported row is cardio (issue
  // #134): created as CARDIO / OTHER instead of ISOLATION / OTHER.
  newCardioExerciseNames: string[];
  totalSets: number;
  // Cardio sets among totalSets (durationSec present), for the summary.
  cardioSetCount: number;
  // Exact duplicates (same day, exercise, set order, weight, reps as an
  // existing set or an earlier row of this file), skipped.
  duplicateCount: number;
}

// Key for exact-duplicate detection. Strength keys are byte-identical to the
// pre-#134 format; cardio sets (durationSec != null) append their
// duration/distance so two different runs logged with the same set order on
// the same day are not collapsed (they all share weight 0 / reps 1). A later
// block of a repeated exercise (issue #475) appends its index, so a 5/3/1 BBB
// set 1 is not collapsed into the heavy block's set 1; block 0 and no block
// share the historical key, as they share a block everywhere else.
export function setDuplicateKey(
  dateKey: string,
  exerciseName: string,
  setOrder: number,
  weightKg: number,
  reps: number,
  durationSec?: number | null,
  distanceM?: number | null,
  block?: number | null,
): string {
  const base = `${dateKey}|${exerciseName.trim().toLowerCase()}|${setOrder}|${weightKg}|${reps}`;
  const withCardio = durationSec == null ? base : `${base}|d${durationSec}|${distanceM ?? 0}`;
  return block ? `${withCardio}|b${block}` : withCardio;
}

export function buildStrongImportPlan(
  rows: NormalizedImportRow[],
  existingExerciseNames: string[],
  existingSetKeys: ReadonlySet<string>,
): StrongImportPlan {
  const known = new Set(existingExerciseNames.map((n) => n.trim().toLowerCase()));
  const newByLower = new Map<string, string>();
  // For each NEW exercise name: true while every one of its rows is cardio.
  const newAllCardioByLower = new Map<string, boolean>();
  const sessionsByKey = new Map<string, PlannedSession>();
  const seenKeys = new Set<string>(existingSetKeys);
  let totalSets = 0;
  let cardioSetCount = 0;
  let duplicateCount = 0;

  for (const row of rows) {
    const isCardio = row.durationSec != null;
    const dupKey = setDuplicateKey(
      row.dateKey,
      row.exerciseName,
      row.setOrder,
      row.weightKg,
      row.reps,
      row.durationSec,
      row.distanceM,
      row.block,
    );
    if (seenKeys.has(dupKey)) {
      duplicateCount++;
      continue;
    }
    seenKeys.add(dupKey);

    const lower = row.exerciseName.trim().toLowerCase();
    if (!known.has(lower) && !newByLower.has(lower)) {
      newByLower.set(lower, row.exerciseName.trim());
      newAllCardioByLower.set(lower, isCardio);
    } else if (newAllCardioByLower.has(lower) && !isCardio) {
      // Mixed strength + cardio rows: keep the conservative strength default.
      newAllCardioByLower.set(lower, false);
    }

    const sessionKey = row.sessionKey ?? `${row.dateKey}|${row.workoutName}`;
    let session = sessionsByKey.get(sessionKey);
    if (!session) {
      session = { dateKey: row.dateKey, workoutName: row.workoutName, sets: [] };
      sessionsByKey.set(sessionKey, session);
    }
    session.sets.push({
      exerciseName: row.exerciseName,
      setOrder: row.setOrder,
      weightKg: row.weightKg,
      reps: row.reps,
      ...(row.isWarmup !== undefined && { isWarmup: row.isWarmup }),
      ...(row.isDropSet !== undefined && { isDropSet: row.isDropSet }),
      ...(isCardio && { durationSec: row.durationSec, distanceM: row.distanceM ?? null }),
      ...(row.rir != null && { rir: row.rir }),
      ...(row.notes != null && { notes: row.notes }),
      ...(row.avgHr != null && { avgHr: row.avgHr }),
      ...(row.maxHr != null && { maxHr: row.maxHr }),
      ...(row.block != null && { block: row.block }),
    });
    totalSets++;
    if (isCardio) cardioSetCount++;

    // Track the earliest start / latest end across the session's rows.
    if (row.startedAtIso) {
      if (!session.startedAtIso || row.startedAtIso < session.startedAtIso) {
        session.startedAtIso = row.startedAtIso;
      }
    }
    if (row.finishedAtIso) {
      if (!session.finishedAtIso || row.finishedAtIso > session.finishedAtIso) {
        session.finishedAtIso = row.finishedAtIso;
      }
    }
  }

  const sessions = [...sessionsByKey.values()].sort((a, b) =>
    a.dateKey.localeCompare(b.dateKey),
  );
  for (const s of sessions) {
    s.sets.sort(
      (a, b) =>
        a.exerciseName.localeCompare(b.exerciseName) || a.setOrder - b.setOrder,
    );
  }

  return {
    sessions,
    newExerciseNames: [...newByLower.values()].sort((a, b) => a.localeCompare(b)),
    newCardioExerciseNames: [...newByLower.entries()]
      .filter(([lower]) => newAllCardioByLower.get(lower))
      .map(([, name]) => name)
      .sort((a, b) => a.localeCompare(b)),
    totalSets,
    cardioSetCount,
    duplicateCount,
  };
}

// Honest default: Strong's export has no start/end times, so the session is
// pinned to noon UTC of its day.
export function sessionDateFromKey(dateKey: string): Date {
  return new Date(`${dateKey}T12:00:00.000Z`);
}

export interface StrongImportResult {
  createdSessions: number;
  createdSets: number;
  createdExercises: number;
}

type Db = PrismaClient | Prisma.TransactionClient;

// Performs the writes for a plan through the given client. Call it inside
// db.$transaction so a mid-import failure rolls back every row. `sourceLabel`
// names the originating app in the created notes (default keeps the Strong
// call sites byte-identical).
export async function executeStrongImport(
  tx: Db,
  userId: string,
  plan: StrongImportPlan,
  sourceLabel = 'Strong',
): Promise<StrongImportResult> {
  // Resolve the user's exercises case-insensitively, creating the missing
  // ones (OTHER / ISOLATION; the user can re-categorize later).
  const existing = await tx.exercise.findMany({
    where: { userId },
    select: { id: true, name: true },
  });
  const idByLower = new Map(existing.map((e) => [e.name.trim().toLowerCase(), e.id]));

  // Exercises whose imported rows are all cardio are created as CARDIO
  // (issue #134); everything else keeps the conservative ISOLATION default.
  const cardioLowers = new Set(
    plan.newCardioExerciseNames.map((n) => n.trim().toLowerCase()),
  );
  let createdExercises = 0;
  for (const name of plan.newExerciseNames) {
    const lower = name.trim().toLowerCase();
    if (idByLower.has(lower)) continue;
    const isCardio = cardioLowers.has(lower);
    const created = await tx.exercise.create({
      data: {
        userId,
        name,
        muscleGroup: 'OTHER',
        category: isCardio ? 'CARDIO' : 'ISOLATION',
        notes: isCardio
          ? `Imported from ${sourceLabel}.`
          : `Imported from ${sourceLabel}. Adjust the muscle group and category.`,
      },
    });
    idByLower.set(lower, created.id);
    createdExercises++;
  }

  let createdSessions = 0;
  let createdSets = 0;
  for (const session of plan.sessions) {
    if (session.sets.length === 0) continue;
    // Real export times win (issue #113); otherwise the honest noon default.
    const startedAt = session.startedAtIso
      ? new Date(session.startedAtIso)
      : sessionDateFromKey(session.dateKey);
    // A garbled export can claim an end before the start; never trust it
    // below the start time.
    const finishedAtRaw = session.finishedAtIso ? new Date(session.finishedAtIso) : null;
    const finishedAt =
      finishedAtRaw && finishedAtRaw.getTime() >= startedAt.getTime()
        ? finishedAtRaw
        : startedAt;
    const created = await tx.session.create({
      data: {
        userId,
        startedAt,
        finishedAt,
        notes: `Imported from ${sourceLabel} - ${session.workoutName}`,
      },
    });
    createdSessions++;

    await tx.set.createMany({
      data: session.sets.map((s) => {
        const exerciseId = idByLower.get(s.exerciseName.trim().toLowerCase());
        if (!exerciseId) {
          // Cannot happen for a plan built by buildStrongImportPlan; guards
          // against a malformed plan reaching the DB.
          throw new Error(`Unresolved exercise: ${s.exerciseName}`);
        }
        return {
          sessionId: created.id,
          exerciseId,
          setNumber: s.setOrder,
          weight: s.weightKg,
          reps: s.reps,
          isWarmup: s.isWarmup ?? false,
          isDropSet: s.isDropSet ?? false,
          durationSec: s.durationSec ?? null,
          distanceM: s.distanceM ?? null,
          rir: s.rir ?? null,
          notes: s.notes ?? null,
          avgHr: s.avgHr ?? null,
          maxHr: s.maxHr ?? null,
          // Imported sessions carry no workout, so the stored block is kept
          // as exported: it still splits history and last performance.
          block: s.block ?? null,
          completedAt: startedAt,
        };
      }),
    });
    createdSets += session.sets.length;
  }

  return { createdSessions, createdSets, createdExercises };
}
