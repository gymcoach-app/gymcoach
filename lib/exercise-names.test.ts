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

  it('translates a recognized exercise into Dutch', () => {
    expect(getExerciseDisplayName('Bench Press', 'nl')).toBe('Bankdrukken');
  });

  it('covers every built-in catalog exercise in Dutch', () => {
    const missing = EXERCISE_CATALOG.map((exercise) => exercise.name).filter(
      (name) => getExerciseDisplayName(name, 'nl') === name,
    );
    expect(missing).toEqual([]);
  });

  it('covers every exercise used by built-in program templates in Dutch', () => {
    const names = new Set(
      programTemplates.flatMap((template) =>
        template.program.workouts.flatMap((workout) =>
          workout.exercises.map((exercise) => exercise.name),
        ),
      ),
    );
    const missing = [...names].filter((name) => getExerciseDisplayName(name, 'nl') === name);
    expect(missing).toEqual([]);
  });

  it('translates a recognized exercise into Polish', () => {
    expect(getExerciseDisplayName('Bench Press', 'pl')).toBe('Wyciskanie na ławce płaskiej');
  });

  it('covers every built-in catalog exercise in Polish', () => {
    const missing = EXERCISE_CATALOG.map((exercise) => exercise.name).filter(
      (name) => getExerciseDisplayName(name, 'pl') === name,
    );
    expect(missing).toEqual([]);
  });

  it('covers every exercise used by built-in program templates in Polish', () => {
    const names = new Set(
      programTemplates.flatMap((template) =>
        template.program.workouts.flatMap((workout) =>
          workout.exercises.map((exercise) => exercise.name),
        ),
      ),
    );
    const missing = [...names].filter((name) => getExerciseDisplayName(name, 'pl') === name);
    expect(missing).toEqual([]);
  });

  it('translates a recognized exercise into Turkish', () => {
    expect(getExerciseDisplayName('Barbell Row', 'tr')).toBe('Halter ile kürek çekme');
  });

  it('covers every built-in catalog exercise in Turkish', () => {
    const missing = EXERCISE_CATALOG.map((exercise) => exercise.name).filter(
      (name) => getExerciseDisplayName(name, 'tr') === name,
    );
    expect(missing).toEqual([]);
  });

  it('covers every exercise used by built-in program templates in Turkish', () => {
    const names = new Set(
      programTemplates.flatMap((template) =>
        template.program.workouts.flatMap((workout) =>
          workout.exercises.map((exercise) => exercise.name),
        ),
      ),
    );
    const missing = [...names].filter((name) => getExerciseDisplayName(name, 'tr') === name);
    expect(missing).toEqual([]);
  });

  it('keeps locale dictionaries separate from application messages', () => {
    expect(exerciseNameDictionaries.ru?.['Bench Press']).toBe('Жим лёжа');
  });
});
