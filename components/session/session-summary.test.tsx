import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { Exercise, ProgramExercise, Session } from '@/lib/prisma-client';
import type { PendingSet } from '@/lib/indexeddb';
import { SessionSummary, computeSessionPRs } from './session-summary';

const exo: Exercise = {
  id: 'e1',
  userId: 'u',
  name: 'Squat',
  muscleGroup: 'QUADS',
  category: 'COMPOUND',
  defaultRestSec: 120,
  notes: null,
  usesBodyweight: false,
  equipmentType: 'BARBELL',
  isFavorite: false,
  createdAt: new Date(),
};

const pe: ProgramExercise & { exercise: Exercise } = {
  id: 'pe',
  workoutId: 'w',
  exerciseId: 'e1',
  order: 1,
  targetSets: 3,
  targetRepsMin: 6,
  targetRepsMax: 10,
  targetRIR: 2,
  restSec: 120,
  tempo: null,
  notes: null,
  supersetGroup: null,
  autoregulationMode: 'PRESERVE_RIR',
  fatigueRate: null,
  loadAdjustmentPct: null,
  exercise: exo,
};

function pendingSet(over: Partial<PendingSet>): PendingSet {
  return {
    localId: over.localId ?? 'l1',
    sessionId: 's1',
    exerciseId: 'e1',
    setNumber: over.setNumber ?? 1,
    weight: over.weight ?? 100,
    reps: over.reps ?? 5,
    rir: null,
    notes: null,
    isWarmup: over.isWarmup ?? false,
    isDropSet: false,
    createdAt: 0,
    status: 'synced',
    serverId: 'srv1',
    syncedAt: 0,
    attempts: 0,
    lastError: null,
    ...over,
  };
}

const session = { id: 's1', startedAt: new Date(), notes: null } as unknown as Session;

describe('computeSessionPRs', () => {
  it('flags a weight PR when a working set beats the prior heaviest load', () => {
    const prs = computeSessionPRs([pendingSet({ weight: 110, reps: 5 })], [pe], {
      e1: [{ weight: 100, reps: 5 }],
    });
    expect(prs).toHaveLength(1);
    const [first] = prs;
    expect(first?.exerciseName).toBe('Squat');
    expect(first?.types).toEqual(['weight', 'e1rm']);
  });

  it('flags an e1RM-only PR when more reps at the same load beat the best estimated 1RM', () => {
    // Same load (no weight PR) but more reps -> higher Epley e1RM.
    const prs = computeSessionPRs([pendingSet({ weight: 100, reps: 8 })], [pe], {
      e1: [{ weight: 100, reps: 5 }],
    });
    expect(prs).toHaveLength(1);
    expect(prs[0]?.types).toEqual(['e1rm']);
  });

  it('returns nothing when no set beats the prior session', () => {
    const prs = computeSessionPRs([pendingSet({ weight: 100, reps: 5 })], [pe], {
      e1: [{ weight: 100, reps: 5 }],
    });
    expect(prs).toHaveLength(0);
  });

  it('ignores warmup sets and never compares a set against itself', () => {
    // First working set sets the bar; the second (lighter) one must not PR.
    const prs = computeSessionPRs(
      [
        pendingSet({ localId: 'w', weight: 120, reps: 5, isWarmup: true }),
        pendingSet({ localId: 'a', setNumber: 1, weight: 110, reps: 5 }),
        pendingSet({ localId: 'b', setNumber: 2, weight: 105, reps: 5 }),
      ],
      [pe],
      { e1: [{ weight: 100, reps: 5 }] },
    );
    expect(prs).toHaveLength(1);
    // Only the heaviest-load type from the first set; the warmup at 120 is ignored.
    expect(prs[0]?.types).toContain('weight');
    expect(prs[0]?.bestWeight).toBe(110);
  });
});

describe('SessionSummary PR section', () => {
  it('renders the PR section when a record was set this session', () => {
    render(
      <SessionSummary
        session={session}
        sets={[pendingSet({ weight: 110, reps: 5 })]}
        programExercises={[pe]}
        unit="KG"
        priorSets={{ e1: [{ weight: 100, reps: 5 }] }}
        onBack={() => {}}
        onFinish={() => {}}
        finishing={false}
      />,
    );
    expect(screen.getByText('Personal records this session')).toBeTruthy();
    expect(screen.getByText('heaviest load')).toBeTruthy();
  });

  it('omits the PR section entirely when no record was set', () => {
    render(
      <SessionSummary
        session={session}
        sets={[pendingSet({ weight: 100, reps: 5 })]}
        programExercises={[pe]}
        unit="KG"
        priorSets={{ e1: [{ weight: 100, reps: 5 }] }}
        onBack={() => {}}
        onFinish={() => {}}
        finishing={false}
      />,
    );
    expect(screen.queryByText('Personal records this session')).toBeNull();
  });
});

// Issue #429: a workout holding the same lift twice (5/3/1 BBB) shows each row
// with its own block of sets, not both rows counting the shared pool.
describe('SessionSummary repeated exercise blocks', () => {
  it('counts each block against its own row', () => {
    const bbb = { ...pe, id: 'pe-bbb', order: 2, targetSets: 5 };
    render(
      <SessionSummary
        session={session}
        sets={[
          pendingSet({ localId: 'a', setNumber: 1, weight: 100, block: 0 }),
          pendingSet({ localId: 'b', setNumber: 2, weight: 110, block: null }),
          pendingSet({ localId: 'c', setNumber: 3, weight: 120, block: 0 }),
          pendingSet({ localId: 'd', setNumber: 1, weight: 60, reps: 10, block: 1 }),
        ]}
        programExercises={[pe, bbb]}
        unit="KG"
        onBack={() => {}}
        onFinish={() => {}}
        finishing={false}
      />,
    );
    expect(screen.getByText(/^3\/3 sets/)).toBeInTheDocument();
    expect(screen.getByText(/^1\/5 sets/)).toBeInTheDocument();
  });
});

// Issue #177: cardio recap shows derived pace and speed in the user's unit,
// and omits them for a duration-only cardio set (no NaN/Infinity).
const cardioExo: Exercise = { ...exo, id: 'c1', name: 'Running', category: 'CARDIO' };
const cardioPe: ProgramExercise & { exercise: Exercise } = {
  ...pe,
  id: 'cpe',
  exerciseId: 'c1',
  targetSets: 1,
  exercise: cardioExo,
};

function cardioSet(over: Partial<PendingSet>): PendingSet {
  return pendingSet({
    exerciseId: 'c1',
    weight: 0,
    reps: 1,
    durationSec: 1800,
    distanceM: 5000,
    ...over,
  });
}

describe('SessionSummary cardio pace/speed', () => {
  it('shows pace and speed in metric for a distance cardio set', () => {
    render(
      <SessionSummary
        session={session}
        sets={[cardioSet({ localId: 'c' })]}
        programExercises={[cardioPe]}
        unit="KG"
        onBack={() => {}}
        onFinish={() => {}}
        finishing={false}
      />,
    );
    // 30:00 over 5 km -> 6:00 /km and 10 km/h.
    expect(screen.getByText(/30:00 · 5 km · 6:00 \/km · 10 km\/h/)).toBeTruthy();
  });

  it('shows pace and speed in imperial when the unit is LB', () => {
    render(
      <SessionSummary
        session={session}
        sets={[cardioSet({ localId: 'c' })]}
        programExercises={[cardioPe]}
        unit="LB"
        onBack={() => {}}
        onFinish={() => {}}
        finishing={false}
      />,
    );
    expect(screen.getByText(/9:39 \/mi · 6\.2 mph/)).toBeTruthy();
  });

  it('omits pace and speed for a duration-only cardio set', () => {
    render(
      <SessionSummary
        session={session}
        sets={[cardioSet({ localId: 'c', distanceM: null })]}
        programExercises={[cardioPe]}
        unit="KG"
        onBack={() => {}}
        onFinish={() => {}}
        finishing={false}
      />,
    );
    expect(screen.queryByText(/\/km/)).toBeNull();
    expect(screen.queryByText(/km\/h/)).toBeNull();
  });
});
