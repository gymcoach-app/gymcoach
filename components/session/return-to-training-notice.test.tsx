import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { ReturnRecommendation } from '@/lib/return-to-training';
import { ReturnToTrainingNotice } from './return-to-training-notice';
import { EffortScaleProvider } from '@/components/shared/effort-scale-provider';

const recommendation: ReturnRecommendation = {
  mode: 'exercise-reintro',
  exerciseGapDays: 3,
  returnGapDays: 87,
  muscleGapDays: 3,
  muscleMaintained: true,
  recentMuscleSets: 8,
  baselineMuscleSetsPer28Days: 8,
  recentVolumeRatio: 1,
  targetSets: 2,
  targetRIR: 3,
  weightCeiling: 70,
  suggestedWeight: 60,
  startFraction: 0.8,
  calibrationRequired: true,
  historySessionCount: 4,
  recentHistorySessionCount: 1,
  longTermHistorySessionCount: 3,
  historyBasis: 'recent-and-long-term',
  confidence: 'medium',
};

describe('ReturnToTrainingNotice', () => {
  it('explains a preserved prior gap instead of pretending the latest session was the long break', () => {
    render(
      <ReturnToTrainingNotice recommendation={recommendation} unit="KG" usesBodyweight={false} />,
    );

    expect(
      screen.getByText(
        'The latest session was recent, but it followed a 87-day gap, so return calibration remains active.',
      ),
    ).toBeInTheDocument();
    expect(screen.getByText('Sets today: 2. Target RIR: 3.')).toBeInTheDocument();
    expect(screen.getByText(/^Record an honest RIR after the first set\./)).toBeInTheDocument();
    expect(screen.getByText('Conservative starting load: 60 kg.')).toBeInTheDocument();
  });
});

describe('ReturnToTrainingNotice effort scale (issue #390)', () => {
  it('states the effort target as RPE when the lifter uses RPE', () => {
    render(
      <EffortScaleProvider scale="RPE">
        <ReturnToTrainingNotice recommendation={recommendation} unit="KG" usesBodyweight={false} />
      </EffortScaleProvider>,
    );
    expect(screen.getByText('Sets today: 2. Target RPE: 7.')).toBeInTheDocument();
    expect(screen.getByText(/^Record an honest RPE after the first set\./)).toBeInTheDocument();
    expect(screen.queryByText(/honest RIR/)).not.toBeInTheDocument();
  });
});
