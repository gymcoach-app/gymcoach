import { describe, expect, it } from 'vitest';
import { db } from '@/lib/db';
import { getReturnToTrainingRecommendations } from '@/lib/return-to-training-history';
import { RETURN_LONG_TERM_ANCHOR_SESSION_LIMIT } from '@/lib/return-to-training';

const now = new Date('2026-07-12T12:00:00.000Z');

function daysAgo(days: number): Date {
  return new Date(now.getTime() - days * 86_400_000);
}

function finishedAt(days: number): Date {
  return new Date(daysAgo(days).getTime() + 60 * 60_000);
}

describe('return-to-training history builder', () => {
  it('separates a stale exercise from a recently trained primary muscle', async () => {
    const user = await db.user.create({
      data: {
        email: 'return-history-' + Date.now() + '@test.dev',
        passwordHash: 'x',
        bodyweight: 80,
      },
    });
    const dumbbellPress = await db.exercise.create({
      data: {
        userId: user.id,
        name: 'Incline Dumbbell Press',
        muscleGroup: 'CHEST',
        category: 'COMPOUND',
        equipmentType: 'DUMBBELL',
      },
    });
    const barbellPress = await db.exercise.create({
      data: {
        userId: user.id,
        name: 'Barbell Bench Press',
        muscleGroup: 'CHEST',
        category: 'COMPOUND',
        equipmentType: 'BARBELL',
      },
    });

    for (const [index, age] of [60, 70, 80].entries()) {
      const session = await db.session.create({
        data: { userId: user.id, startedAt: daysAgo(age), finishedAt: finishedAt(age) },
      });
      await db.set.create({
        data: {
          sessionId: session.id,
          exerciseId: dumbbellPress.id,
          setNumber: index + 1,
          weight: 20,
          reps: 10,
          rir: 2,
          completedAt: daysAgo(age),
        },
      });
    }

    for (const age of [5, 8, 35, 42]) {
      const session = await db.session.create({
        data: { userId: user.id, startedAt: daysAgo(age), finishedAt: finishedAt(age) },
      });
      await db.set.createMany({
        data: [1, 2].map((setNumber) => ({
          sessionId: session.id,
          exerciseId: barbellPress.id,
          setNumber,
          weight: 80,
          reps: 8,
          rir: 2,
          completedAt: daysAgo(age),
        })),
      });
    }

    const current = await db.session.create({
      data: { userId: user.id, startedAt: now },
    });
    await db.set.create({
      data: {
        sessionId: current.id,
        exerciseId: dumbbellPress.id,
        setNumber: 1,
        weight: 40,
        reps: 5,
        rir: 0,
        completedAt: daysAgo(1),
      },
    });

    const recommendations = await getReturnToTrainingRecommendations({
      userId: user.id,
      programExercises: [
        {
          id: 'pe-return',
          exerciseId: dumbbellPress.id,
          targetSets: 4,
          targetRepsMin: 8,
          targetRIR: 2,
          exercise: dumbbellPress,
        },
      ],
      excludeSessionId: current.id,
      now,
      bodyweight: user.bodyweight,
      gym: {
        dumbbellWeights: [10, 12, 14, 15, 16, 19],
        plateWeights: [1.25, 2.5, 5, 10, 20],
        barWeights: [20],
        exerciseConfigs: [],
      },
    });

    expect(recommendations['pe-return']).toMatchObject({
      mode: 'exercise-reintro',
      exerciseGapDays: 60,
      muscleGapDays: 5,
      muscleMaintained: true,
      targetSets: 2,
      targetRIR: 3,
      weightCeiling: 19,
      suggestedWeight: 16,
      historySessionCount: 3,
    });
  });

  it('caps detailed history and ignores unfinished prior sessions', async () => {
    const user = await db.user.create({
      data: { email: 'return-history-bounded-' + Date.now() + '@test.dev', passwordHash: 'x' },
    });
    const exercise = await db.exercise.create({
      data: {
        userId: user.id,
        name: 'Bounded History Row',
        muscleGroup: 'BACK_THICKNESS',
        category: 'COMPOUND',
        equipmentType: 'CABLE',
      },
    });

    for (let index = 0; index < RETURN_LONG_TERM_ANCHOR_SESSION_LIMIT + 4; index += 1) {
      const age = 50 + index;
      const session = await db.session.create({
        data: { userId: user.id, startedAt: daysAgo(age), finishedAt: finishedAt(age) },
      });
      await db.set.create({
        data: {
          sessionId: session.id,
          exerciseId: exercise.id,
          setNumber: 1,
          weight: 50 + index,
          reps: 8,
          rir: 2,
          completedAt: daysAgo(age),
        },
      });
    }

    const abandonedSession = await db.session.create({
      data: { userId: user.id, startedAt: daysAgo(1), finishedAt: null },
    });
    await db.set.create({
      data: {
        sessionId: abandonedSession.id,
        exerciseId: exercise.id,
        setNumber: 1,
        weight: 999,
        reps: 1,
        rir: 0,
        completedAt: daysAgo(1),
      },
    });

    const recommendations = await getReturnToTrainingRecommendations({
      userId: user.id,
      programExercises: [
        {
          id: 'pe-bounded',
          exerciseId: exercise.id,
          targetSets: 4,
          targetRepsMin: 8,
          targetRIR: 2,
          exercise,
        },
      ],
      excludeSessionId: null,
      now,
    });

    expect(recommendations['pe-bounded']).toMatchObject({
      exerciseGapDays: 50,
      muscleGapDays: 50,
      mode: 'muscle-reintro',
      historySessionCount: RETURN_LONG_TERM_ANCHOR_SESSION_LIMIT,
    });
  });

  it('keeps the full long-term pool when several recent sessions precede an old gap', async () => {
    // Issue #324: the session read used to cap the whole pool, so a lifter
    // with a handful of sessions in the last two weeks lost long-term anchors
    // to them. This shape resolves to normal mode (the recent sessions are
    // dense), so it pins the split itself: every recent session is kept and
    // the long-term pool is still full.
    const user = await db.user.create({
      data: { email: 'return-history-split-' + Date.now() + '@test.dev', passwordHash: 'x' },
    });
    const exercise = await db.exercise.create({
      data: {
        userId: user.id,
        name: 'Split Pool Row',
        muscleGroup: 'BACK_THICKNESS',
        category: 'COMPOUND',
        equipmentType: 'CABLE',
      },
    });
    const recentAges = [2, 5, 8, 11, 13, 14];
    const longTermAges = Array.from(
      { length: RETURN_LONG_TERM_ANCHOR_SESSION_LIMIT + 2 },
      (_, index) => 100 + index * 7,
    );
    for (const age of [...recentAges, ...longTermAges]) {
      const session = await db.session.create({
        data: { userId: user.id, startedAt: daysAgo(age), finishedAt: finishedAt(age) },
      });
      await db.set.create({
        data: {
          sessionId: session.id,
          exerciseId: exercise.id,
          setNumber: 1,
          weight: 40,
          reps: 8,
          rir: 2,
          completedAt: daysAgo(age),
        },
      });
    }

    const recommendations = await getReturnToTrainingRecommendations({
      userId: user.id,
      programExercises: [
        {
          id: 'pe-split',
          exerciseId: exercise.id,
          targetSets: 4,
          targetRepsMin: 8,
          targetRIR: 2,
          exercise,
        },
      ],
      excludeSessionId: null,
      now,
    });

    expect(recommendations['pe-split']).toMatchObject({
      recentHistorySessionCount: recentAges.length,
      longTermHistorySessionCount: RETURN_LONG_TERM_ANCHOR_SESSION_LIMIT,
      historySessionCount: recentAges.length + RETURN_LONG_TERM_ANCHOR_SESSION_LIMIT,
    });
  });

  it('anchors an exercise reintroduction on the full long-term pool after one comeback session', async () => {
    // The reachable shape the split improves: one session just after a long
    // gap keeps the exercise in reintro mode (the prior gap is preserved), and
    // the anchor pool must still hold every long-term session. The old read
    // spent one of the eight slots on the comeback session.
    const user = await db.user.create({
      data: { email: 'return-history-comeback-' + Date.now() + '@test.dev', passwordHash: 'x' },
    });
    const exercise = await db.exercise.create({
      data: {
        userId: user.id,
        name: 'Comeback Press',
        muscleGroup: 'CHEST',
        category: 'COMPOUND',
        equipmentType: 'MACHINE',
      },
    });
    const comebackAge = 2;
    const longTermAges = Array.from(
      { length: RETURN_LONG_TERM_ANCHOR_SESSION_LIMIT },
      (_, index) => 100 + index * 7,
    );
    for (const age of [comebackAge, ...longTermAges]) {
      const session = await db.session.create({
        data: { userId: user.id, startedAt: daysAgo(age), finishedAt: finishedAt(age) },
      });
      await db.set.create({
        data: {
          sessionId: session.id,
          exerciseId: exercise.id,
          setNumber: 1,
          weight: 60,
          reps: 8,
          rir: 2,
          completedAt: daysAgo(age),
        },
      });
    }

    const recommendations = await getReturnToTrainingRecommendations({
      userId: user.id,
      programExercises: [
        {
          id: 'pe-comeback',
          exerciseId: exercise.id,
          targetSets: 3,
          targetRepsMin: 8,
          targetRIR: 2,
          exercise,
        },
      ],
      excludeSessionId: null,
      now,
    });

    expect(recommendations['pe-comeback']).toMatchObject({
      mode: 'exercise-reintro',
      recentHistorySessionCount: 1,
      longTermHistorySessionCount: RETURN_LONG_TERM_ANCHOR_SESSION_LIMIT,
    });
  });

  it('anchors each block of a repeated lift on its own past sets', async () => {
    // Issue #475: a 5/3/1 Boring But Big day holds the squat twice. The heavy
    // block must anchor on past heavy sets and the 5x10 block on past 5x10
    // sets, like getLastPerformances. Legacy sets stored without a block, and
    // sets whose stored block points past the current rows, read as block 0.
    const user = await db.user.create({
      data: { email: 'return-history-blocks-' + Date.now() + '@test.dev', passwordHash: 'x' },
    });
    const squat = await db.exercise.create({
      data: {
        userId: user.id,
        name: 'Block Squat',
        muscleGroup: 'QUADS',
        category: 'COMPOUND',
        equipmentType: 'BARBELL',
      },
    });

    const heavyBlockByAge = new Map<number, number | null>([
      [60, 0],
      [70, 2],
      [80, null],
    ]);
    for (const [age, heavyBlock] of heavyBlockByAge) {
      const session = await db.session.create({
        data: { userId: user.id, startedAt: daysAgo(age), finishedAt: finishedAt(age) },
      });
      await db.set.createMany({
        data: [
          ...[1, 2, 3].map((setNumber) => ({
            sessionId: session.id,
            exerciseId: squat.id,
            setNumber,
            weight: 100,
            reps: 5,
            rir: 1,
            block: heavyBlock,
            completedAt: daysAgo(age),
          })),
          ...[1, 2, 3].map((setNumber) => ({
            sessionId: session.id,
            exerciseId: squat.id,
            setNumber,
            weight: 60,
            reps: 10,
            rir: 2,
            block: 1,
            completedAt: daysAgo(age),
          })),
        ],
      });
    }

    const recommendations = await getReturnToTrainingRecommendations({
      userId: user.id,
      programExercises: [
        {
          id: 'pe-heavy',
          exerciseId: squat.id,
          order: 0,
          targetSets: 3,
          targetRepsMin: 5,
          targetRIR: 1,
          exercise: squat,
        },
        {
          id: 'pe-bbb',
          exerciseId: squat.id,
          order: 1,
          targetSets: 5,
          targetRepsMin: 10,
          targetRIR: 2,
          exercise: squat,
        },
      ],
      excludeSessionId: null,
      now,
    });

    const heavy = recommendations['pe-heavy']!;
    const bbb = recommendations['pe-bbb']!;
    expect(heavy.historySessionCount).toBe(3);
    expect(bbb.historySessionCount).toBe(3);
    expect(heavy.exerciseGapDays).toBe(60);
    expect(bbb.exerciseGapDays).toBe(60);
    expect(heavy.weightCeiling).not.toBeNull();
    expect(bbb.weightCeiling).not.toBeNull();
    expect(bbb.weightCeiling!).toBeLessThanOrEqual(60);
    expect(bbb.weightCeiling!).toBeLessThan(heavy.weightCeiling!);
  });
});
