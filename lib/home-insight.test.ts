import { describe, it, expect } from 'vitest';
import {
  createHomeInsightTranslator,
  selectHomeInsight,
  type HomeInsightInput,
} from './home-insight';

function input(over: Partial<HomeInsightInput>): HomeInsightInput {
  return {
    deload: { recommended: false, reasons: [] },
    stalledExerciseNames: [],
    recentPR: null,
    trainingDaysThisWeek: null,
    ...over,
  };
}

describe('selectHomeInsight (issue #237)', () => {
  it('renders Chinese insight numbers, exercise names and singular advice', () => {
    const translate = createHomeInsightTranslator('zh-CN');
    const stalled = selectHomeInsight(input({ stalledExerciseNames: ['卧推'] }), translate);
    expect(stalled?.title).toBe('有 1 个动作的训练表现停滞');
    expect(stalled?.detail).toContain('卧推');
    expect(stalled?.detail).toContain('小幅调整重量、次数或动作技术');
    const consistent = selectHomeInsight(input({ trainingDaysThisWeek: 3 }), translate);
    expect(consistent?.detail).toBe('本周已训练 3 天，继续保持！');
    const pr = selectHomeInsight(
      input({ recentPR: { exerciseName: '硬拉', kind: 'e1rm' } }),
      translate,
    );
    expect(pr?.detail).toContain('硬拉 的估算 1RM');
  });

  it('returns null when there is nothing to surface', () => {
    expect(selectHomeInsight(input({}))).toBeNull();
    // trainingDaysThisWeek of 0 is still nothing worth a card.
    expect(selectHomeInsight(input({ trainingDaysThisWeek: 0 }))).toBeNull();
  });

  it('prioritises a recommended deload above everything else', () => {
    const result = selectHomeInsight(
      input({
        deload: {
          recommended: true,
          reasons: [{ kind: 'stalled-lifts', exerciseNames: ['Squat', 'Bench'] }],
        },
        stalledExerciseNames: ['Squat', 'Bench'],
        recentPR: { exerciseName: 'Deadlift', kind: 'weight' },
        trainingDaysThisWeek: 3,
      }),
    );
    expect(result?.kind).toBe('deload');
    expect(result?.detail).toContain('Squat');
  });

  it('does not surface a deload that is recommended but carries no reasons', () => {
    // Defensive: recommended with an empty reasons array falls through.
    const result = selectHomeInsight(
      input({ deload: { recommended: true, reasons: [] }, trainingDaysThisWeek: 2 }),
    );
    expect(result?.kind).toBe('on-track');
  });

  it('surfaces a stalled lift when no deload is recommended', () => {
    const one = selectHomeInsight(input({ stalledExerciseNames: ['Overhead Press'] }));
    expect(one?.kind).toBe('stall');
    expect(one?.title).toBe('A lift has stalled');
    expect(one?.detail).toContain('Overhead Press');

    const many = selectHomeInsight(input({ stalledExerciseNames: ['A', 'B', 'C'] }));
    expect(many?.title).toBe('3 lifts have stalled');
    expect(many?.detail).toContain('A, B, C');
  });

  it('stall outranks a PR and on-track', () => {
    const result = selectHomeInsight(
      input({
        stalledExerciseNames: ['Row'],
        recentPR: { exerciseName: 'Curl', kind: 'e1rm' },
        trainingDaysThisWeek: 4,
      }),
    );
    expect(result?.kind).toBe('stall');
  });

  it('celebrates a fresh PR when no deload or stall', () => {
    const weight = selectHomeInsight(
      input({ recentPR: { exerciseName: 'Bench', kind: 'weight' }, trainingDaysThisWeek: 1 }),
    );
    expect(weight?.kind).toBe('pr');
    expect(weight?.detail).toContain('heaviest set');
    expect(weight?.detail).toContain('Bench');

    const e1rm = selectHomeInsight(input({ recentPR: { exerciseName: 'Squat', kind: 'e1rm' } }));
    expect(e1rm?.detail).toContain('estimated 1RM');
  });

  it('falls back to an on-track line with training days this week', () => {
    const one = selectHomeInsight(input({ trainingDaysThisWeek: 1 }));
    expect(one?.kind).toBe('on-track');
    expect(one?.detail).toContain('1 day ');

    const many = selectHomeInsight(input({ trainingDaysThisWeek: 3 }));
    expect(many?.detail).toContain('3 days');
  });

  it('always links somewhere actionable', () => {
    const result = selectHomeInsight(input({ trainingDaysThisWeek: 2 }));
    expect(result?.href).toBe('/progress');
  });

  it('renders every insight through the requested locale', () => {
    const translate = createHomeInsightTranslator('ru');
    const result = selectHomeInsight(
      input({
        deload: {
          recommended: true,
          reasons: [{ kind: 'stalled-lifts', exerciseNames: ['Жим лёжа', 'Приседания'] }],
        },
      }),
      translate,
    );
    expect(result?.title).toBe('Похоже, пора восстановиться');
    expect(result?.detail).toContain('Прогресс остановился в 2 упражнениях');
  });
});
