import { db } from '@/lib/db';
import {
  applyBodyweight,
  best1RM,
  effectiveWeight,
  dailyConditioning,
  exerciseProgress,
  isStalled,
  isoWeekStart,
  totalVolume,
  weeklyConditioning,
  WEEKLY_CONDITIONING_TARGET_MIN,
} from '@/lib/stats';
import { READINESS_RECENCY_HOURS } from '@/lib/progression';
import { isCardioSet } from '@/lib/cardio';
import { goalProgress } from '@/lib/goals';
import {
  DELOAD_READINESS_LOOKBACK,
  DELOAD_READINESS_MAX_AGE_DAYS,
  deloadReasonLine,
  isDeloadActive,
  recommendDeload,
} from '@/lib/deload';
import { COACH_SYSTEM_PROMPT } from '@/lib/prompts/coach-system-prompt';
import { exerciseRecords, type ExerciseRecord } from '@/lib/records';
import { getLlmProvider } from '@/lib/llm';
import { blockIndexByRow, occurrenceCounts, rowBlockKey, setBlockKey } from '@/lib/exercise-blocks';

// ============================================================
// Structured payload sent to the coach
// ============================================================
// All aggregations are computed server-side to avoid overloading the
// model with hundreds of rows of raw sets.

export interface CoachPayload {
  generatedAt: string;
  // User profile (when filled in), so the coach can tailor its advice. All
  // loads and volumes in the payload already include the bodyweight when
  // applicable - the coach can rely on them directly.
  userProfile: {
    displayName: string | null;
    sex: string | null;
    heightCm: number | null;
    bodyweight: number | null;
    goal: string | null;
    weeklyFrequency: number | null;
    // The user's own free-text note to the coach (issue #188): their current
    // context to weigh (injuries, illness, life constraints). Null = no note.
    // Input signal only; the output contract (the <adjustments> block) is
    // unchanged.
    coachNote: string | null;
  };
  weekCurrent: WeekSummary;
  weekPrevious: WeekSummary | null;
  activeProgram: ProgramSummary | null;
  // Latest pre-session readiness / soreness check-in (issue #38), when the user
  // filled one in recently. Input signal for recovery-anchored auto-regulation;
  // null when there is no recent check-in. The coach reasons over this but its
  // output contract (the <adjustments> block) is unchanged.
  latestReadiness: ReadinessSummary | null;
  // The user's per-exercise target goals (issue #101), with progress computed
  // exactly like the progress page: best bodyweight-adjusted e1RM over the
  // full history vs the target's e1RM. Input signal only; the output contract
  // (the <adjustments> block) is unchanged.
  goals: GoalSummary[];
  // Derived fatigue signals (issue #101): stalled lifts per lib/stats.ts
  // isStalled over the progress page's 12-week window, plus the program-level
  // deload recommendation from lib/deload.ts with its human-readable reasons.
  fatigue: FatigueSummary;
  // Weekly conditioning aggregates (issue #145). Cardio is deliberately
  // excluded from the strength signals above (issue #140), so this dedicated
  // section keeps the coach aware of it: current and previous ISO week via
  // the same lib/stats.ts weeklyConditioning derivation the progress page
  // uses. Input signal only; the output contract (the <adjustments> block)
  // is unchanged.
  conditioning: ConditioningSummary;
  // The workout the user is in RIGHT NOW (issue #111), attached only when the
  // chat is opened from the session runner with a session the user owns.
  // Additive and input-side only; the output contract is unchanged.
  currentSession?: CurrentSessionContext;
  // All-time personal records per strength exercise (issue #212), via the SAME
  // lib/records.ts exerciseRecords derivation the progress page's records board
  // uses: heaviest working set ever (weight x reps) and best estimated 1RM ever,
  // on effective load (bodyweight included), cardio and warm-ups excluded. This
  // lets the debrief acknowledge a fresh PR and anchor advice on the user's
  // bests without inventing records. Compact: capped to the most recently
  // trained exercises (see COACH_RECORDS_CAP). Input signal only; the output
  // contract (the <adjustments> block) is unchanged.
  records: RecordSummary[];
  // For each program exercise: the progression over the last 8 weeks
  // (max loads + 1RM per session, effective values with bodyweight included).
  recentProgress: Array<{
    exerciseId: string;
    exerciseName: string;
    muscleGroup: string;
    usesBodyweight: boolean;
    targetRepsMin: number;
    targetRepsMax: number;
    currentLoad: number | null;
    sessions: Array<{
      date: string;
      maxWeight: number;
      topSetReps: number;
      estimated1RM: number;
    }>;
  }>;
}

// A compact all-time record for one exercise (issue #212). Mirrors the fields
// the spec asks the coach to see: heaviest working set (weight x reps) and best
// estimated 1RM ever. The dates exerciseRecords also computes are dropped to
// keep the payload compact - the coach references the bests, not their history.
interface RecordSummary {
  exerciseName: string;
  maxWeight: number;
  maxWeightReps: number;
  bestE1RM: number;
}

interface ConditioningWeek {
  // Total cardio duration, whole minutes.
  minutes: number;
  // Total cardio distance, km with 2 decimals (0 when none logged).
  km: number;
  // Distinct sessions containing at least one cardio set.
  sessions: number;
}

interface ConditioningSummary {
  // Always present: a zero-cardio user reads as zeros, never null.
  weekCurrent: ConditioningWeek;
  // Null when the previous ISO week had no cardio session (mirrors the
  // strength summary's weekPrevious semantics).
  weekPrevious: ConditioningWeek | null;
  // Per-day cardio of the CURRENT ISO week (issue #153): the interference
  // signal - WHEN the cardio happened, so the coach can spot a hard run next
  // to a heavy lower-body day. Days without cardio are omitted (compact; a
  // zero-cardio week is an empty array), sorted ascending by date. Input
  // signal only; the output contract (the <adjustments> block) is unchanged.
  days: Array<{ date: string; minutes: number; km: number }>;
  // The weekly guideline the progress page tracks (150 min/week).
  weeklyTargetMin: number;
}

interface GoalSummary {
  exerciseName: string;
  // Target load in kg (effective load for bodyweight exercises).
  targetWeight: number;
  targetReps: number;
  // 0-100, fraction of the way to the goal on the e1RM scale (lib/goals.ts
  // goalProgress), same semantics as the progress page.
  progressPct: number;
  achieved: boolean;
}

interface FatigueSummary {
  // Names of the lifts currently flagged by lib/stats.ts isStalled, sorted.
  stalledExercises: string[];
  deloadRecommended: boolean;
  // Short human-readable reasons (same lines the progress page shows).
  deloadReasons: string[];
  // True while the user runs a planned deload week (issue #112), so the coach
  // supports the deload already underway instead of recommending one. Additive
  // input signal; the output contract is unchanged.
  deloadActive: boolean;
}

// Compact snapshot of the workout in progress (issue #111): what was logged so
// far against the program targets, plus a fresh readiness check-in when one
// exists. No history dump - the rest of the payload already carries recent
// progress. Weights are effective loads (bodyweight included when applicable),
// consistent with the rest of the payload.
export interface CurrentSessionContext {
  workoutName: string | null;
  startedAt: string;
  exercises: Array<{
    exerciseName: string;
    muscleGroup: string;
    usesBodyweight: boolean;
    // Program targets for this exercise in the running workout; null for an
    // exercise logged ad hoc outside the plan.
    target: {
      targetSets: number;
      targetRepsMin: number;
      targetRepsMax: number;
      targetRIR: number;
      restSec: number;
    } | null;
    // Which occurrence of the exercise this row is, 0-based in workout order,
    // when the workout programs it more than once (5/3/1 Boring But Big does
    // the main lift twice); null when the workout holds the exercise once.
    // Two rows can therefore share an exerciseName and still be told apart,
    // each carrying only its own sets. Additive input signal; the output
    // contract is unchanged.
    block: number | null;
    // Sets logged so far in this session for this block, in order.
    setsLogged: Array<{
      setNumber: number;
      weight: number;
      reps: number;
      rir: number | null;
      isWarmup: boolean;
      isDropSet: boolean;
    }>;
  }>;
  // Today's readiness check-in (same recency window that auto-regulates the
  // load suggestions), or null.
  readinessToday: {
    readiness: number;
    sleepQuality: number;
    soreness: Record<string, number> | null;
  } | null;
}

interface ReadinessSummary {
  // ISO date of the check-in.
  date: string;
  // Whole-days-ago since the check-in, so the coach can weight its relevance.
  daysAgo: number;
  // Overall readiness to train, 1 (drained) to 5 (primed).
  readiness: number;
  // Sleep quality the previous night, 1 (poor) to 5 (great).
  sleepQuality: number;
  // Optional per-muscle-group soreness ratings (group -> 1-5).
  soreness: Record<string, number> | null;
  note: string | null;
}

interface WeekSummary {
  weekStart: string;
  sessions: Array<{
    sessionId: string;
    workoutName: string | null;
    startedAt: string;
    finishedAt: string | null;
    durationMin: number | null;
    notes: string | null;
    totalVolume: number;
    workingSetCount: number;
    exercises: Array<{
      exerciseId: string;
      exerciseName: string;
      muscleGroup: string;
      sets: Array<{
        setNumber: number;
        weight: number;
        reps: number;
        rir: number | null;
        isWarmup: boolean;
        isDropSet: boolean;
        notes: string | null;
      }>;
      bestE1RM: number;
      volume: number;
    }>;
  }>;
}

interface ProgramSummary {
  id: string;
  name: string;
  phase: string;
  workouts: Array<{
    name: string;
    exercises: Array<{
      exerciseName: string;
      targetSets: number;
      targetRepsMin: number;
      targetRepsMax: number;
      targetRIR: number;
    }>;
  }>;
}

// ============================================================
// Building the payload
// ============================================================

// Cap on the all-time records list (issue #212): keep the payload compact by
// sending at most this many records, ordered by how recently the exercise was
// trained, so the coach sees the bests for the lifts the user actually works.
const COACH_RECORDS_CAP = 20;

export async function buildCoachPayload(userId: string): Promise<CoachPayload> {
  const now = new Date();
  const currentWeekStart = isoWeekStart(now);
  const previousWeekStart = new Date(currentWeekStart);
  previousWeekStart.setUTCDate(previousWeekStart.getUTCDate() - 7);
  const eightWeeksAgo = new Date(currentWeekStart);
  eightWeeksAgo.setUTCDate(eightWeeksAgo.getUTCDate() - 7 * 8);

  // We fetch the bodyweight first (1 row, negligible) so we can pass it to
  // weekSummary, which depends on it to compute the effective volumes.
  const user = await db.user.findUnique({
    where: { id: userId },
    select: {
      displayName: true,
      sex: true,
      heightCm: true,
      bodyweight: true,
      goal: true,
      weeklyFrequency: true,
      coachNote: true,
      deloadUntil: true,
    },
  });
  const bodyweight = user?.bodyweight ?? null;

  const [
    currentWeek,
    previousWeek,
    activeProgram,
    latestReadiness,
    goals,
    fatigue,
    records,
    recentSets,
  ] = await Promise.all([
    weekSummary(userId, currentWeekStart, addDays(currentWeekStart, 7), bodyweight),
    weekSummary(userId, previousWeekStart, currentWeekStart, bodyweight),
    fetchActiveProgram(userId),
    fetchLatestReadiness(userId, now),
    fetchGoalsSummary(userId, bodyweight),
    fetchFatigueSummary(userId, bodyweight, now),
    fetchRecordsSummary(userId, bodyweight),
    db.set.findMany({
      where: {
        isWarmup: false,
        completedAt: { gte: eightWeeksAgo },
        session: { userId },
      },
      orderBy: { completedAt: 'asc' },
      select: {
        weight: true,
        reps: true,
        isWarmup: true,
        durationSec: true,
        distanceM: true,
        sessionId: true,
        exerciseId: true,
        exercise: {
          select: {
            id: true,
            name: true,
            muscleGroup: true,
            usesBodyweight: true,
          },
        },
        session: { select: { startedAt: true } },
      },
    }),
  ]);

  // Conditioning aggregates (issue #145): the shared weeklyConditioning
  // derivation over the already-fetched recent sets, windowed to the previous
  // and current ISO weeks (oldest first, zero-filled).
  const conditioningWeeks = weeklyConditioning(
    recentSets.map((s) => ({
      durationSec: s.durationSec,
      distanceM: s.distanceM,
      isWarmup: s.isWarmup,
      sessionId: s.sessionId,
      sessionStartedAt: s.session.startedAt,
    })),
    { windowWeeks: 2, now },
  );
  const [conditioningPrev, conditioningCurrent] = conditioningWeeks;
  // Per-day breakdown of the current ISO week (issue #153): the shared
  // dailyConditioning derivation over the same already-fetched recent sets.
  const conditioningDays = dailyConditioning(
    recentSets.map((s) => ({
      durationSec: s.durationSec,
      distanceM: s.distanceM,
      isWarmup: s.isWarmup,
      sessionStartedAt: s.session.startedAt,
    })),
    { now },
  );
  const conditioning: ConditioningSummary = {
    weekCurrent: {
      minutes: conditioningCurrent?.minutes ?? 0,
      km: conditioningCurrent?.distanceKm ?? 0,
      sessions: conditioningCurrent?.sessions ?? 0,
    },
    weekPrevious:
      conditioningPrev && conditioningPrev.sessions > 0
        ? {
            minutes: conditioningPrev.minutes,
            km: conditioningPrev.distanceKm,
            sessions: conditioningPrev.sessions,
          }
        : null,
    days: conditioningDays,
    weeklyTargetMin: WEEKLY_CONDITIONING_TARGET_MIN,
  };

  // Current load per exercise = workingWeight of the last session.
  const currentLoadByExercise = new Map<string, number>();
  const setsByExercise = new Map<string, typeof recentSets>();
  for (const s of recentSets) {
    const arr = setsByExercise.get(s.exerciseId);
    if (arr) arr.push(s);
    else setsByExercise.set(s.exerciseId, [s]);
  }

  const recentProgress: CoachPayload['recentProgress'] = [];
  // We enrich with target reps from the active program (if the exercise is in it).
  const programTargets = new Map<string, { min: number; max: number }>();
  if (activeProgram) {
    for (const w of activeProgram.workouts) {
      for (const e of w.exercises) {
        programTargets.set(e.exerciseName, { min: e.targetRepsMin, max: e.targetRepsMax });
      }
    }
  }

  for (const [exerciseId, sets] of setsByExercise) {
    if (sets.length === 0) continue;
    const firstSet = sets[0];
    if (!firstSet) continue;
    const exo = firstSet.exercise;
    const points = exerciseProgress(
      applyBodyweight(
        sets.map((s) => ({
          weight: s.weight,
          reps: s.reps,
          isWarmup: s.isWarmup,
          durationSec: s.durationSec,
          sessionId: s.sessionId,
          sessionStartedAt: s.session.startedAt,
          usesBodyweight: exo.usesBodyweight,
        })),
        bodyweight,
      ),
    );
    const lastPoint = points[points.length - 1];
    const currentLoad = lastPoint ? lastPoint.maxWeight : null;
    if (currentLoad != null) currentLoadByExercise.set(exerciseId, currentLoad);
    const target = programTargets.get(exo.name);
    recentProgress.push({
      exerciseId,
      exerciseName: exo.name,
      muscleGroup: exo.muscleGroup,
      usesBodyweight: exo.usesBodyweight,
      targetRepsMin: target?.min ?? 0,
      targetRepsMax: target?.max ?? 0,
      currentLoad,
      sessions: points.map((p) => ({
        date: p.date,
        maxWeight: p.maxWeight,
        topSetReps: p.topSetReps,
        estimated1RM: p.estimated1RM,
      })),
    });
  }

  return {
    generatedAt: now.toISOString(),
    userProfile: {
      displayName: user?.displayName ?? null,
      sex: user?.sex ?? null,
      heightCm: user?.heightCm ?? null,
      bodyweight,
      goal: user?.goal ?? null,
      weeklyFrequency: user?.weeklyFrequency ?? null,
      coachNote: user?.coachNote ?? null,
    },
    weekCurrent: currentWeek,
    weekPrevious: previousWeek.sessions.length === 0 ? null : previousWeek,
    activeProgram,
    latestReadiness,
    goals,
    fatigue: {
      ...fatigue,
      // Planned deload week (issue #112): additive flag; an expired
      // deloadUntil reads as inactive.
      deloadActive: isDeloadActive(user?.deloadUntil ?? null, now),
    },
    conditioning,
    records,
    recentProgress: recentProgress.sort((a, b) =>
      a.exerciseName.localeCompare(b.exerciseName),
    ),
  };
}

function addDays(d: Date, days: number): Date {
  const out = new Date(d);
  out.setUTCDate(out.getUTCDate() + days);
  return out;
}

async function weekSummary(
  userId: string,
  weekStart: Date,
  weekEndExclusive: Date,
  bodyweight: number | null,
): Promise<WeekSummary> {
  const sessions = await db.session.findMany({
    where: {
      userId,
      startedAt: { gte: weekStart, lt: weekEndExclusive },
    },
    orderBy: { startedAt: 'asc' },
    include: {
      workout: { select: { name: true } },
      sets: {
        orderBy: [{ exerciseId: 'asc' }, { setNumber: 'asc' }],
        include: {
          exercise: {
            select: { name: true, muscleGroup: true, usesBodyweight: true },
          },
        },
      },
    },
  });

  return {
    weekStart: weekStart.toISOString(),
    sessions: sessions.map((s) => {
      const setsByExo = new Map<
        string,
        {
          exerciseId: string;
          exerciseName: string;
          muscleGroup: string;
          usesBodyweight: boolean;
          sets: WeekSummary['sessions'][number]['exercises'][number]['sets'];
        }
      >();
      for (const set of s.sets) {
        // Cardio sets are excluded from the strength summary: they would
        // surface as phantom 0-volume lifts and inflate workingSetCount, the
        // training-load signal the coach reads (issue #140). A deliberate
        // conditioning payload section is a separate, future slice.
        if (isCardioSet(set)) continue;
        const key = set.exerciseId;
        let entry = setsByExo.get(key);
        if (!entry) {
          entry = {
            exerciseId: set.exerciseId,
            exerciseName: set.exercise.name,
            muscleGroup: set.exercise.muscleGroup,
            usesBodyweight: set.exercise.usesBodyweight,
            sets: [],
          };
          setsByExo.set(key, entry);
        }
        entry.sets.push({
          setNumber: set.setNumber,
          weight: set.weight,
          reps: set.reps,
          rir: set.rir,
          isWarmup: set.isWarmup,
          isDropSet: set.isDropSet,
          notes: set.notes,
        });
      }
      const exercises = [...setsByExo.values()].map((e) => {
        const eff = applyBodyweight(
          e.sets.map((set) => ({ ...set, usesBodyweight: e.usesBodyweight })),
          bodyweight,
        );
        return {
          exerciseId: e.exerciseId,
          exerciseName: e.exerciseName,
          muscleGroup: e.muscleGroup,
          sets: e.sets,
          bestE1RM: +best1RM(eff).toFixed(1),
          volume: totalVolume(eff),
        };
      });
      // Weekly total volume = sum of the effective volumes per exercise.
      const sessionTotalVolume = exercises.reduce((acc, e) => acc + e.volume, 0);
      const durationMin =
        s.finishedAt && s.startedAt
          ? Math.round((s.finishedAt.getTime() - s.startedAt.getTime()) / 60000)
          : null;
      return {
        sessionId: s.id,
        workoutName: s.workout?.name ?? null,
        startedAt: s.startedAt.toISOString(),
        finishedAt: s.finishedAt?.toISOString() ?? null,
        durationMin,
        notes: s.notes,
        totalVolume: sessionTotalVolume,
        workingSetCount: s.sets.filter((set) => !set.isWarmup && !isCardioSet(set)).length,
        exercises,
      };
    }),
  };
}

async function fetchActiveProgram(userId: string): Promise<ProgramSummary | null> {
  const program = await db.program.findFirst({
    where: { userId, isActive: true },
    include: {
      workouts: {
        orderBy: { order: 'asc' },
        include: {
          exercises: {
            orderBy: { order: 'asc' },
            include: { exercise: { select: { name: true } } },
          },
        },
      },
    },
  });
  if (!program) return null;
  return {
    id: program.id,
    name: program.name,
    phase: program.phase,
    workouts: program.workouts.map((w) => ({
      name: w.name,
      exercises: w.exercises.map((pe) => ({
        exerciseName: pe.exercise.name,
        targetSets: pe.targetSets,
        targetRepsMin: pe.targetRepsMin,
        targetRepsMax: pe.targetRepsMax,
        targetRIR: pe.targetRIR,
      })),
    })),
  };
}

// The user's exercise goals with progress on the e1RM scale (issue #101),
// computed exactly like the progress page: best bodyweight-adjusted e1RM over
// the FULL set history of each goal exercise vs the target's e1RM.
async function fetchGoalsSummary(
  userId: string,
  bodyweight: number | null,
): Promise<GoalSummary[]> {
  const goals = await db.exerciseGoal.findMany({
    where: { userId },
    orderBy: { createdAt: 'desc' },
    include: {
      exercise: { select: { id: true, name: true, usesBodyweight: true } },
    },
  });
  if (goals.length === 0) return [];

  const sets = await db.set.findMany({
    where: {
      exerciseId: { in: goals.map((g) => g.exerciseId) },
      isWarmup: false,
      session: { userId },
    },
    select: { exerciseId: true, weight: true, reps: true, isWarmup: true },
  });
  const setsByExercise = new Map<string, typeof sets>();
  for (const s of sets) {
    const arr = setsByExercise.get(s.exerciseId);
    if (arr) arr.push(s);
    else setsByExercise.set(s.exerciseId, [s]);
  }

  return goals.map((goal) => {
    const exerciseSets = setsByExercise.get(goal.exerciseId) ?? [];
    const adjusted = applyBodyweight(
      exerciseSets.map((s) => ({
        ...s,
        usesBodyweight: goal.exercise.usesBodyweight,
      })),
      bodyweight,
    );
    const best = best1RM(adjusted);
    const target = { targetWeight: goal.targetWeight, targetReps: goal.targetReps };
    return {
      exerciseName: goal.exercise.name,
      targetWeight: goal.targetWeight,
      targetReps: goal.targetReps,
      progressPct: Math.round(goalProgress(best, target) * 100),
      achieved: goal.achievedAt != null,
    };
  });
}

// All-time records summary for the coach (issue #212). Reuses the EXACT
// exerciseRecords derivation the progress page's records board uses: full set
// history, cardio excluded at the query (category != CARDIO), warm-ups excluded
// both here and in the derivation, effective load applied so a bodyweight
// movement reads on the load actually moved. The list is then trimmed to the
// most recently trained exercises and the per-record dates are dropped to keep
// the payload compact. Input signal only; the output contract is unchanged.
async function fetchRecordsSummary(
  userId: string,
  bodyweight: number | null,
): Promise<RecordSummary[]> {
  const recordSetsRaw = await db.set.findMany({
    where: {
      isWarmup: false,
      session: { userId },
      exercise: { category: { not: 'CARDIO' } },
    },
    // Oldest first so a tie (same load / e1RM) keeps the EARLIEST date in
    // exerciseRecords, matching the records board's "first to reach it".
    orderBy: { session: { startedAt: 'asc' } },
    select: {
      weight: true,
      reps: true,
      isWarmup: true,
      durationSec: true,
      exercise: { select: { name: true, usesBodyweight: true } },
      session: { select: { startedAt: true } },
    },
  });

  const records = exerciseRecords(
    recordSetsRaw.map((s) => ({
      weight: effectiveWeight(s.weight, s.exercise.usesBodyweight, bodyweight),
      reps: s.reps,
      isWarmup: s.isWarmup,
      durationSec: s.durationSec,
      exerciseName: s.exercise.name,
      sessionStartedAt: s.session.startedAt,
    })),
  );

  // Most-recently-trained exercises first, so a capped list keeps the lifts the
  // user actually works. The latest qualifying set per exercise dates recency;
  // rows arrive oldest-first, so the last seen per name is the most recent.
  const lastTrained = new Map<string, number>();
  for (const s of recordSetsRaw) {
    if (s.isWarmup || s.durationSec != null || s.weight <= 0 || s.reps <= 0) continue;
    lastTrained.set(s.exercise.name, s.session.startedAt.getTime());
  }

  return records
    .slice()
    .sort(
      (a, b) =>
        (lastTrained.get(b.exerciseName) ?? 0) - (lastTrained.get(a.exerciseName) ?? 0),
    )
    .slice(0, COACH_RECORDS_CAP)
    .map((r: ExerciseRecord) => ({
      exerciseName: r.exerciseName,
      maxWeight: r.maxWeight,
      maxWeightReps: r.maxWeightReps,
      bestE1RM: r.bestE1RM,
    }));
}

// The same window the progress page judges stalls over (last 12 weeks).
const FATIGUE_WINDOW_WEEKS = 12;

// Derived fatigue signals (issue #101), mirroring the progress page: stalled
// lifts per isStalled over the per-session e1RM series of the last 12 weeks,
// and the program-level deload recommendation fed by those stalls plus the
// recent readiness check-ins.
async function fetchFatigueSummary(
  userId: string,
  bodyweight: number | null,
  now: Date,
  // deloadActive is derived from the user row in buildCoachPayload, so this
  // helper returns everything but that flag.
): Promise<Omit<FatigueSummary, 'deloadActive'>> {
  const since = new Date(now);
  since.setUTCHours(0, 0, 0, 0);
  since.setUTCDate(since.getUTCDate() - FATIGUE_WINDOW_WEEKS * 7);
  const readinessSince = addDays(now, -DELOAD_READINESS_MAX_AGE_DAYS);

  const [sets, recentCheckins] = await Promise.all([
    db.set.findMany({
      where: {
        isWarmup: false,
        completedAt: { gte: since },
        session: { userId },
      },
      select: {
        weight: true,
        reps: true,
        isWarmup: true,
        durationSec: true,
        sessionId: true,
        exerciseId: true,
        exercise: { select: { name: true, usesBodyweight: true } },
        session: { select: { startedAt: true } },
      },
    }),
    db.readinessCheckin.findMany({
      where: { userId, createdAt: { gte: readinessSince } },
      orderBy: { createdAt: 'desc' },
      take: DELOAD_READINESS_LOOKBACK,
      select: { readiness: true },
    }),
  ]);

  const setsByExercise = new Map<string, typeof sets>();
  for (const s of sets) {
    const arr = setsByExercise.get(s.exerciseId);
    if (arr) arr.push(s);
    else setsByExercise.set(s.exerciseId, [s]);
  }

  const stalledExercises: string[] = [];
  for (const exerciseSets of setsByExercise.values()) {
    const first = exerciseSets[0];
    if (!first) continue;
    const points = exerciseProgress(
      applyBodyweight(
        exerciseSets.map((s) => ({
          weight: s.weight,
          reps: s.reps,
          isWarmup: s.isWarmup,
          durationSec: s.durationSec,
          sessionId: s.sessionId,
          sessionStartedAt: s.session.startedAt,
          usesBodyweight: first.exercise.usesBodyweight,
        })),
        bodyweight,
      ),
    );
    if (isStalled(points.map((p) => p.estimated1RM))) {
      stalledExercises.push(first.exercise.name);
    }
  }
  stalledExercises.sort((a, b) => a.localeCompare(b));

  const recommendation = recommendDeload({
    stalledExerciseNames: stalledExercises,
    recentReadiness: recentCheckins.map((c) => c.readiness),
  });
  return {
    stalledExercises,
    deloadRecommended: recommendation.recommended,
    deloadReasons: recommendation.reasons.map(deloadReasonLine),
  };
}

// The most recent readiness check-in, but only if it is recent enough to be
// relevant (within the last 7 days). Returns null otherwise. This is an INPUT
// signal for the coach; it does not change the coach output contract.
async function fetchLatestReadiness(
  userId: string,
  now: Date,
): Promise<ReadinessSummary | null> {
  const sevenDaysAgo = addDays(now, -7);
  const checkin = await db.readinessCheckin.findFirst({
    where: { userId, createdAt: { gte: sevenDaysAgo } },
    orderBy: { createdAt: 'desc' },
  });
  if (!checkin) return null;

  const daysAgo = Math.floor(
    (now.getTime() - checkin.createdAt.getTime()) / (1000 * 60 * 60 * 24),
  );

  // soreness is stored as JSON; coerce to a plain { group: 1-5 } map defensively.
  let soreness: Record<string, number> | null = null;
  if (checkin.soreness && typeof checkin.soreness === 'object' && !Array.isArray(checkin.soreness)) {
    const entries = Object.entries(checkin.soreness as Record<string, unknown>).filter(
      ([, v]) => typeof v === 'number',
    ) as Array<[string, number]>;
    if (entries.length > 0) soreness = Object.fromEntries(entries);
  }

  return {
    date: checkin.createdAt.toISOString(),
    daysAgo,
    readiness: checkin.readiness,
    sleepQuality: checkin.sleepQuality,
    soreness,
    note: checkin.note,
  };
}

// ============================================================
// Live session context for the in-session chat (issue #111)
// ============================================================

// Builds the compact currentSession section. Ownership-checked: returns null
// when the session does not exist or belongs to another user, so a tampered
// sessionId silently degrades to a normal chat instead of erroring or leaking.
export async function buildCurrentSessionContext(
  userId: string,
  sessionId: string,
  now: Date = new Date(),
): Promise<CurrentSessionContext | null> {
  const [session, user] = await Promise.all([
    db.session.findFirst({
      where: { id: sessionId, userId },
      include: {
        workout: {
          include: {
            exercises: {
              orderBy: { order: 'asc' },
              include: {
                exercise: {
                  select: { id: true, name: true, muscleGroup: true, usesBodyweight: true },
                },
              },
            },
          },
        },
        sets: {
          orderBy: [{ exerciseId: 'asc' }, { setNumber: 'asc' }],
          include: {
            exercise: {
              select: { id: true, name: true, muscleGroup: true, usesBodyweight: true },
            },
          },
        },
      },
    }),
    db.user.findUnique({ where: { id: userId }, select: { bodyweight: true } }),
  ]);
  if (!session) return null;
  const bodyweight = user?.bodyweight ?? null;

  // Sets are pooled per block (issue #429), exactly as the live runner pools
  // them (components/session/session-runner.tsx): the bare exerciseId for an
  // exercise the workout holds once, one pool per occurrence for a
  // deliberately repeated one. Before #475 both rows of a repeated lift were
  // handed the same interleaved list, so the coach read a 5/3/1 workout's
  // 5x10 back-off sets as more of the top set and could not tell the two
  // targets apart.
  const plannedExercises = session.workout?.exercises ?? [];
  const rowBlocks = blockIndexByRow(plannedExercises);
  const exerciseOccurrences = occurrenceCounts(plannedExercises);

  const setsByBlockKey = new Map<string, typeof session.sets>();
  for (const s of session.sets) {
    const key = setBlockKey(s, exerciseOccurrences);
    const arr = setsByBlockKey.get(key);
    if (arr) arr.push(s);
    else setsByBlockKey.set(key, [s]);
  }

  const serializeSets = (sets: typeof session.sets, usesBodyweight: boolean) =>
    sets.map((s) => ({
      setNumber: s.setNumber,
      // Effective load, consistent with the rest of the payload.
      weight: effectiveWeight(s.weight, usesBodyweight, bodyweight),
      reps: s.reps,
      rir: s.rir,
      isWarmup: s.isWarmup,
      isDropSet: s.isDropSet,
    }));

  // Planned exercises first, in workout order, then anything logged ad hoc.
  const exercises: CurrentSessionContext['exercises'] = [];
  const claimed = new Set<string>();
  for (const pe of plannedExercises) {
    const key = rowBlockKey(pe, rowBlocks);
    claimed.add(key);
    exercises.push({
      exerciseName: pe.exercise.name,
      muscleGroup: pe.exercise.muscleGroup,
      usesBodyweight: pe.exercise.usesBodyweight,
      block: rowBlocks.get(pe.id) ?? null,
      target: {
        targetSets: pe.targetSets,
        targetRepsMin: pe.targetRepsMin,
        targetRepsMax: pe.targetRepsMax,
        targetRIR: pe.targetRIR,
        restSec: pe.restSec,
      },
      setsLogged: serializeSets(
        setsByBlockKey.get(key) ?? [],
        pe.exercise.usesBodyweight,
      ),
    });
  }
  for (const [key, sets] of setsByBlockKey) {
    if (claimed.has(key)) continue;
    const first = sets[0];
    if (!first) continue;
    exercises.push({
      exerciseName: first.exercise.name,
      muscleGroup: first.exercise.muscleGroup,
      usesBodyweight: first.exercise.usesBodyweight,
      block: null,
      target: null,
      setsLogged: serializeSets(sets, first.exercise.usesBodyweight),
    });
  }

  // Today's check-in: same recency window that auto-regulates the in-session
  // load suggestions, so the chat and the runner read the same signal.
  const readinessSince = new Date(now.getTime() - READINESS_RECENCY_HOURS * 60 * 60 * 1000);
  const checkin = await db.readinessCheckin.findFirst({
    where: { userId, createdAt: { gte: readinessSince } },
    orderBy: { createdAt: 'desc' },
  });
  let readinessToday: CurrentSessionContext['readinessToday'] = null;
  if (checkin) {
    let soreness: Record<string, number> | null = null;
    if (checkin.soreness && typeof checkin.soreness === 'object' && !Array.isArray(checkin.soreness)) {
      const entries = Object.entries(checkin.soreness as Record<string, unknown>).filter(
        ([, v]) => typeof v === 'number',
      ) as Array<[string, number]>;
      if (entries.length > 0) soreness = Object.fromEntries(entries);
    }
    readinessToday = {
      readiness: checkin.readiness,
      sleepQuality: checkin.sleepQuality,
      soreness,
    };
  }

  return {
    workoutName: session.workout?.name ?? null,
    startedAt: session.startedAt.toISOString(),
    exercises,
    readinessToday,
  };
}

// ============================================================
// Coach call (routed through the configured LLM provider)
// ============================================================

export interface CoachCompletion {
  markdown: string;
  modelUsed: string;
  promptText: string; // JSON payload sent, for auditing
}

// Builds the prompt and delegates to the active LLM provider (Anthropic SDK or
// OpenRouter, selected via LLM_PROVIDER). Provider errors surface as LlmError,
// which the API route maps to an HTTP status.
export async function callCoach(payload: CoachPayload): Promise<CoachCompletion> {
  const provider = getLlmProvider();
  const userMessage = JSON.stringify(payload, null, 2);

  const { text, modelUsed } = await provider.complete({
    system: COACH_SYSTEM_PROMPT,
    messages: [{ role: 'user', content: userMessage }],
    temperature: 0.4,
    maxTokens: 8000,
  });

  return { markdown: text, modelUsed, promptText: userMessage };
}
