import { fireEvent, render, screen } from '@testing-library/react';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { SessionExerciseStrip, abbreviation } from './session-exercise-strip';

vi.mock('@/components/shared/use-exercise-name', () => ({
  useExerciseName: () => (name: string) => name,
}));

beforeAll(() => {
  Element.prototype.scrollIntoView = vi.fn();
});

const exercises = [
  {
    id: 'pe-1',
    exerciseId: 'exercise-1',
    supersetGroup: 1,
    exercise: { id: 'exercise-1', name: 'Squats · Barbell' },
  },
  {
    id: 'pe-2',
    exerciseId: 'exercise-2',
    supersetGroup: 1,
    exercise: { id: 'exercise-2', name: 'Custom Rear Delt Raise' },
  },
  {
    id: 'pe-3',
    exerciseId: 'exercise-3',
    supersetGroup: null,
    exercise: { id: 'exercise-3', name: 'Standing Calf Raise' },
  },
] as never;

describe('SessionExerciseStrip', () => {
  it('shows media, completion state, fallback initials, and selects an exercise', () => {
    const onSelect = vi.fn();
    const onOpen = vi.fn();
    render(
      <SessionExerciseStrip
        exercises={exercises}
        currentIndex={0}
        completedProgramExerciseIds={new Set(['pe-1'])}
        onSelect={onSelect}
        onOpen={onOpen}
      />,
    );

    expect(screen.getByRole('presentation')).toHaveAttribute(
      'src',
      expect.stringContaining('Barbell_Squat'),
    );
    expect(screen.getByText('CRD')).toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'Workout exercises' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '1. Squats · Barbell · Completed' })).toHaveAttribute(
      'aria-current',
      'step',
    );

    const active = screen.getByRole('button', { name: '1. Squats · Barbell · Completed' });
    const inactive = screen.getByRole('button', { name: '2. Custom Rear Delt Raise' });
    expect(active).toHaveClass('opacity-100');
    expect(inactive).toHaveClass('opacity-45');

    fireEvent.click(inactive);
    expect(onSelect).toHaveBeenCalledWith(1);
    fireEvent.click(active);
    expect(onOpen).toHaveBeenCalledWith(0);
  });

  it('is always clickable (issue #542, PR1: strip stays usable during rest)', () => {
    const onSelect = vi.fn();
    const onOpen = vi.fn();
    render(
      <SessionExerciseStrip
        exercises={exercises}
        currentIndex={0}
        completedProgramExerciseIds={new Set()}
        onSelect={onSelect}
        onOpen={onOpen}
      />,
    );

    const active = screen.getByRole('button', { name: '1. Squats · Barbell' });
    const inactive = screen.getByRole('button', { name: '2. Custom Rear Delt Raise' });

    // Strip is never disabled (no aria-disabled attribute)
    expect(active).not.toHaveAttribute('aria-disabled');

    // Clicking current opens detail
    fireEvent.click(active);
    expect(onOpen).toHaveBeenCalledWith(0);

    // Clicking non-current selects it
    fireEvent.click(inactive);
    expect(onSelect).toHaveBeenCalledWith(1);
  });

  it('marks completion per program row, so a repeated exercise is tracked separately', () => {
    const repeated = [
      ...(exercises as unknown as Array<Record<string, unknown>>),
      {
        id: 'pe-4',
        exerciseId: 'exercise-1',
        supersetGroup: null,
        exercise: { id: 'exercise-1', name: 'Squats · Barbell' },
      },
    ] as never;
    render(
      <SessionExerciseStrip
        exercises={repeated}
        currentIndex={0}
        completedProgramExerciseIds={new Set(['pe-1'])}
        onSelect={vi.fn()}
        onOpen={vi.fn()}
      />,
    );
    expect(
      screen.getByRole('button', { name: '1. Squats · Barbell · Completed' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '4. Squats · Barbell' })).toBeInTheDocument();
  });

  it('connects adjacent superset exercises and leaves standalone exercises unmarked', () => {
    render(
      <SessionExerciseStrip
        exercises={exercises}
        currentIndex={0}
        completedProgramExerciseIds={new Set()}
        onSelect={vi.fn()}
        onOpen={vi.fn()}
      />,
    );

    const firstLine = screen
      .getByRole('button', { name: '1. Squats · Barbell' })
      .querySelector('[data-superset-group="1"]');
    const secondLine = screen
      .getByRole('button', { name: '2. Custom Rear Delt Raise' })
      .querySelector('[data-superset-group="1"]');
    const standaloneLine = screen
      .getByRole('button', { name: '3. Standing Calf Raise' })
      .querySelector('[data-superset-group]');

    expect(firstLine).toHaveClass('-mr-1', 'rounded-l-full', 'rounded-r-none');
    expect(secondLine).toHaveClass('-ml-1', 'rounded-l-none', 'rounded-r-full');
    expect(standaloneLine).not.toBeInTheDocument();
  });
});

describe('abbreviation', () => {
  it('builds up to three initials, or the first three letters of one word', () => {
    expect(abbreviation('Custom Rear Delt Raise')).toBe('CRD');
    expect(abbreviation('Plank')).toBe('PLA');
    expect(abbreviation('   ')).toBe('?');
  });

  it('uppercases with the locale, so Turkish initials keep the dotted I', () => {
    expect(abbreviation('Dambıl ile kürek çekme', 'tr')).toBe('DİK');
    expect(abbreviation('Dambıl ile kürek çekme', 'en')).toBe('DIK');
  });
});
