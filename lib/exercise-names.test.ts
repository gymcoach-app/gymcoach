import { describe, expect, it } from 'vitest';
import { EXERCISE_CATALOG } from '@/lib/exercise-catalog';
import { programTemplates } from '@/lib/programs/templates';
import { exerciseNameDictionaries, getExerciseDisplayName } from '@/i18n/exercise-names';

describe('exercise name localization', () => {
  it.each([
    ['Bench Press', '卧推'],
    ['Barbell Bench Press', '杠铃卧推'],
    ['Squat', '深蹲'],
    ['Deadlift', '硬拉'],
    ['Lat Pulldown', '高位下拉'],
    ['Romanian Deadlift', '罗马尼亚硬拉'],
    ['Lateral Raise', '侧平举'],
    ['Biceps Curl', '二头弯举'],
    ['Triceps Pushdown', '三头下压'],
    ['Incline dumbbell press (30 deg)', '上斜哑铃卧推（30°）'],
    ['Incline dumbbell curl (bench 60 deg)', '上斜哑铃弯举（凳面 60°）'],
    ['Leg press (45 deg)', '腿举（45°）'],
    ['Seated leg curl', '坐姿腿弯举'],
    ['Lying leg curl', '俯卧腿弯举'],
    ['Chin-up', '反握引体向上'],
    ['Pull-up', '引体向上'],
    ['Machine rear delt fly', '器械反向飞鸟'],
    ['Bench Press · Barbell', '卧推 · 杠铃'],
    ['Bench Press · Dumbbells', '卧推 · 哑铃'],
    ['Bench Press · Smith machine', '卧推 · 史密斯机'],
    ['Leg Press · Machine', '腿举 · 固定器械'],
    ['Leg Raises · Bodyweight', '举腿 · 自重'],
    ['Lat Pulldowns with Close Neutral Grip · Cable', '窄距对握高位下拉 · 绳索'],
    ['Lat Pulldowns with Close Overhand Grip · Cable', '窄距正握高位下拉 · 绳索'],
  ])('localizes %s into Simplified Chinese', (name, expected) => {
    expect(getExerciseDisplayName(name, 'zh-CN')).toBe(expected);
  });

  it('matches Chinese dictionary names case-insensitively with surrounding whitespace', () => {
    expect(getExerciseDisplayName('  bArBeLl BeNcH pReSs  ', 'zh-CN')).toBe('杠铃卧推');
    expect(getExerciseDisplayName('Bulgarian Split Squat', 'zh-CN')).toBe('保加利亚分腿蹲');
    expect(getExerciseDisplayName('Leg extension', 'zh-CN')).toBe('腿屈伸');
  });

  it.each([
    '',
    '  My Bench Press 2  ',
    'Bench Press · My equipment',
    'Butterfly with Close Grip · Machine',
    'Leg Curls on Leg Extension Machine · Machine',
  ])('preserves unknown or ambiguous Chinese exercise names: %s', (name) => {
    expect(getExerciseDisplayName(name, 'zh-CN')).toBe(name);
  });

  it('preserves English and unsupported locale exercise names', () => {
    expect(getExerciseDisplayName('Barbell Bench Press', 'en')).toBe('Barbell Bench Press');
    expect(getExerciseDisplayName('Bench Press', 'ja')).toBe('Bench Press');
  });

  it('covers every built-in catalog exercise in Simplified Chinese', () => {
    const missing = EXERCISE_CATALOG.map((exercise) => exercise.name).filter(
      (name) => getExerciseDisplayName(name, 'zh-CN') === name,
    );
    expect(missing).toEqual([]);
  });

  it('covers every exercise used by built-in program templates in Simplified Chinese', () => {
    const names = new Set(
      programTemplates.flatMap((template) =>
        template.program.workouts.flatMap((workout) =>
          workout.exercises.map((exercise) => exercise.name),
        ),
      ),
    );
    const missing = [...names].filter((name) => getExerciseDisplayName(name, 'zh-CN') === name);
    expect(missing).toEqual([]);
  });

  it('has no conflicting normalized Chinese exercise names', () => {
    const translations = new Map<string, string>();
    for (const [name, translation] of Object.entries(exerciseNameDictionaries['zh-CN'] ?? {})) {
      const normalized = name.trim().toLocaleLowerCase('en-US');
      if (translations.has(normalized)) {
        expect(translation).toBe(translations.get(normalized));
      }
      translations.set(normalized, translation);
    }
  });

  it('translates a recognized exercise into Russian', () => {
    expect(getExerciseDisplayName('Bench Press', 'ru')).toBe('Жим лёжа');
  });

  it('translates a recognized exercise into French', () => {
    expect(getExerciseDisplayName('Bench Press', 'fr')).toBe('Développé couché');
  });

  it('keeps English and unknown custom names unchanged', () => {
    expect(getExerciseDisplayName('Bench Press', 'en')).toBe('Bench Press');
    expect(getExerciseDisplayName('Шея зад · Misc', 'ru')).toBe('Шея зад · Misc');
  });

  it('matches known names case-insensitively', () => {
    expect(getExerciseDisplayName('bEnCh PrEsS', 'ru')).toBe('Жим лёжа');
  });

  it('covers every built-in catalog exercise in Russian', () => {
    const missing = EXERCISE_CATALOG.map((exercise) => exercise.name).filter(
      (name) => getExerciseDisplayName(name, 'ru') === name,
    );
    expect(missing).toEqual([]);
  });

  it('covers every built-in catalog exercise in French', () => {
    const missing = EXERCISE_CATALOG.map((exercise) => exercise.name).filter(
      (name) => getExerciseDisplayName(name, 'fr') === name,
    );
    expect(missing).toEqual([]);
  });

  it('covers every exercise used by built-in program templates in French', () => {
    const names = new Set(
      programTemplates.flatMap((template) =>
        template.program.workouts.flatMap((workout) =>
          workout.exercises.map((exercise) => exercise.name),
        ),
      ),
    );
    const missing = [...names].filter((name) => getExerciseDisplayName(name, 'fr') === name);
    expect(missing).toEqual([]);
  });

  it('covers every exercise used by built-in program templates in Russian', () => {
    const names = new Set(
      programTemplates.flatMap((template) =>
        template.program.workouts.flatMap((workout) =>
          workout.exercises.map((exercise) => exercise.name),
        ),
      ),
    );
    const missing = [...names].filter((name) => getExerciseDisplayName(name, 'ru') === name);
    expect(missing).toEqual([]);
  });

  it('covers every built-in catalog exercise in German', () => {
    const missing = EXERCISE_CATALOG.map((exercise) => exercise.name).filter(
      (name) => getExerciseDisplayName(name, 'de') === name,
    );
    expect(missing).toEqual([]);
  });

  it('covers every exercise used by built-in program templates in German', () => {
    const names = new Set(
      programTemplates.flatMap((template) =>
        template.program.workouts.flatMap((workout) =>
          workout.exercises.map((exercise) => exercise.name),
        ),
      ),
    );
    const missing = [...names].filter((name) => getExerciseDisplayName(name, 'de') === name);
    expect(missing).toEqual([]);
  });

  it('translates a recognized exercise into Spanish', () => {
    expect(getExerciseDisplayName('Bench Press', 'es')).toBe('Press de banca');
  });

  it('covers every built-in catalog exercise in Spanish', () => {
    const missing = EXERCISE_CATALOG.map((exercise) => exercise.name).filter(
      (name) => getExerciseDisplayName(name, 'es') === name,
    );
    expect(missing).toEqual([]);
  });

  it('covers every exercise used by built-in program templates in Spanish', () => {
    const names = new Set(
      programTemplates.flatMap((template) =>
        template.program.workouts.flatMap((workout) =>
          workout.exercises.map((exercise) => exercise.name),
        ),
      ),
    );
    const missing = [...names].filter((name) => getExerciseDisplayName(name, 'es') === name);
    expect(missing).toEqual([]);
  });

  it('translates a recognized exercise into Portuguese', () => {
    expect(getExerciseDisplayName('Bench Press', 'pt')).toBe('Supino reto');
  });

  it('covers every built-in catalog exercise in Portuguese', () => {
    const missing = EXERCISE_CATALOG.map((exercise) => exercise.name).filter(
      (name) => getExerciseDisplayName(name, 'pt') === name,
    );
    expect(missing).toEqual([]);
  });

  it('covers every exercise used by built-in program templates in Portuguese', () => {
    const names = new Set(
      programTemplates.flatMap((template) =>
        template.program.workouts.flatMap((workout) =>
          workout.exercises.map((exercise) => exercise.name),
        ),
      ),
    );
    const missing = [...names].filter((name) => getExerciseDisplayName(name, 'pt') === name);
    expect(missing).toEqual([]);
  });

  it('translates a recognized exercise into Italian', () => {
    expect(getExerciseDisplayName('Bench Press', 'it')).toBe('Panca piana');
  });

  it('covers every built-in catalog exercise in Italian', () => {
    const missing = EXERCISE_CATALOG.map((exercise) => exercise.name).filter(
      (name) => getExerciseDisplayName(name, 'it') === name,
    );
    expect(missing).toEqual([]);
  });

  it('covers every exercise used by built-in program templates in Italian', () => {
    const names = new Set(
      programTemplates.flatMap((template) =>
        template.program.workouts.flatMap((workout) =>
          workout.exercises.map((exercise) => exercise.name),
        ),
      ),
    );
    const missing = [...names].filter((name) => getExerciseDisplayName(name, 'it') === name);
    expect(missing).toEqual([]);
  });

  it('keeps locale dictionaries separate from application messages', () => {
    expect(exerciseNameDictionaries.ru?.['Bench Press']).toBe('Жим лёжа');
  });
});
