import { describe, expect, it } from 'vitest';
import { EXERCISE_CATALOG } from '@/lib/exercise-catalog';
import { programTemplates } from '@/lib/programs/templates';
import {
  exerciseNameDictionaries,
  getExerciseDisplayName,
} from '@/i18n/exercise-names';

describe('exercise name localization', () => {
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
    const missing = [...names].filter(
      (name) => getExerciseDisplayName(name, 'ru') === name,
    );
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

  it('keeps locale dictionaries separate from application messages', () => {
    expect(exerciseNameDictionaries.ru?.['Bench Press']).toBe('Жим лёжа');
  });
});
