import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { Exercise, ProgramExercise } from '@/lib/prisma-client';
import type { PendingSet } from '@/lib/indexeddb';
import { SetsList } from './sets-list';
import { EffortScaleProvider } from '@/components/shared/effort-scale-provider';

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

describe('SetsList PR badge', () => {
  it('shows a weight PR badge when a logged set beats the prior best load', () => {
    render(
      <SetsList
        programExercise={pe}
        sets={[pendingSet({ localId: 'a', setNumber: 1, weight: 110, reps: 5 })]}
        isInputActive={false}
        onDeleteSet={() => {}}
        priorSets={[{ weight: 100, reps: 5 }]}
      />,
    );
    expect(screen.getByText('Weight PR')).toBeTruthy();
  });

  it('does not show a PR badge when the set ties the prior best', () => {
    render(
      <SetsList
        programExercise={pe}
        sets={[pendingSet({ localId: 'a', setNumber: 1, weight: 100, reps: 5 })]}
        isInputActive={false}
        onDeleteSet={() => {}}
        priorSets={[{ weight: 100, reps: 5 }]}
      />,
    );
    expect(screen.queryByText('Weight PR')).toBeNull();
    expect(screen.queryByText('e1RM PR')).toBeNull();
  });
});

describe('SetsList effort scale (issue #390)', () => {
  const sets = [pendingSet({ localId: 'a', setNumber: 1, weight: 100, reps: 5, rir: 2 })];

  it('shows the logged effort as RIR by default', () => {
    render(
      <SetsList programExercise={pe} sets={sets} isInputActive={false} onDeleteSet={() => {}} />,
    );
    expect(screen.getByText(/× 5 · RIR 2/)).toBeInTheDocument();
  });

  it('shows the same set as RPE when the lifter uses RPE', () => {
    render(
      <EffortScaleProvider scale="RPE">
        <SetsList programExercise={pe} sets={sets} isInputActive={false} onDeleteSet={() => {}} />
      </EffortScaleProvider>,
    );
    expect(screen.getByText(/× 5 · RPE 8/)).toBeInTheDocument();
    expect(screen.queryByText(/RIR/)).not.toBeInTheDocument();
  });
});
