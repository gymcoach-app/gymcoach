'use client';

import Image from 'next/image';
import { useLocale, useTranslations } from 'next-intl';
import { useEffect, useRef, useState } from 'react';
import { Check } from 'lucide-react';
import type { Exercise, ProgramExercise } from '@/lib/prisma-client';
import { getExerciseMedia } from '@/lib/exercise-media';
import { useExerciseName } from '@/components/shared/use-exercise-name';

type SessionExercise = ProgramExercise & { exercise: Exercise };

interface Props {
  exercises: SessionExercise[];
  currentIndex: number;
  completedProgramExerciseIds: ReadonlySet<string>;
  startedProgramExerciseIds?: ReadonlySet<string>;
  exerciseProgress?: ReadonlyMap<string, { done: number; target: number }>;
  // Per-exercise rest states for displaying timer badges (issue #542, PR1).
  exerciseStates?: ReadonlyMap<string, {
    kind: 'input' | 'rest';
    endsAt?: number;
    pausedRemainingMs?: number | null;
    navigatedImmediately?: boolean;
    nextExerciseIdx?: number | null;
  }>;
  onSelect: (index: number) => void;
  onOpen: (index: number) => void;
}

// Uppercases with the active locale, so Turkish initials keep their dot
// ("ile" gives "İ", not "I").
export function abbreviation(name: string, locale?: string): string {
  const words = name.trim().split(/\s+/u).filter(Boolean);
  if (words.length === 0) return '?';
  const upper = (text: string) => {
    try {
      return text.toLocaleUpperCase(locale);
    } catch {
      return text.toUpperCase();
    }
  };
  if (words.length === 1) return upper(Array.from(words[0]!).slice(0, 3).join(''));
  return upper(
    words
      .slice(0, 3)
      .map((word) => Array.from(word)[0] ?? '')
      .join(''),
  );
}

export function SessionExerciseStrip({
  exercises,
  currentIndex,
  completedProgramExerciseIds,
  startedProgramExerciseIds,
  exerciseProgress,
  exerciseStates,
  onSelect,
  onOpen,
}: Props) {
  const exerciseName = useExerciseName();
  const locale = useLocale();
  const t = useTranslations('session');
  const currentRef = useRef<HTMLButtonElement>(null);
  // Force re-render every second to update timer badges (issue #542, PR1).
  const [, setNow] = useState(Date.now());

  useEffect(() => {
    currentRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
  }, [currentIndex]);

  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div
      className="-mx-4 mt-3 overflow-x-auto px-4 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      role="group"
      aria-label={t('exerciseStripLabel')}
    >
      <div className="flex w-max gap-2">
        {exercises.map((programExercise, index) => {
          const displayName = exerciseName(programExercise.exercise.name);
          const media = getExerciseMedia(programExercise.exercise.name);
          const isCurrent = index === currentIndex;
          const isComplete = completedProgramExerciseIds.has(programExercise.id);
          const supersetGroup = programExercise.supersetGroup;
          const previousInGroup =
            supersetGroup != null && exercises[index - 1]?.supersetGroup === supersetGroup;
          const nextInGroup =
            supersetGroup != null && exercises[index + 1]?.supersetGroup === supersetGroup;
          const isInSuperset = previousInGroup || nextInGroup;

          return (
            <button
              key={programExercise.id}
              ref={isCurrent ? currentRef : undefined}
              type="button"
              onClick={() => {
                if (isCurrent) onOpen(index);
                else onSelect(index);
              }}
              aria-label={`${index + 1}. ${displayName}${isComplete ? ` · ${t('exerciseCompleted')}` : ''}`}
              aria-current={isCurrent ? 'step' : undefined}
              title={displayName}
              className={`group relative shrink-0 transition-opacity ${
                isCurrent ? 'opacity-100' : 'opacity-45 hover:opacity-75'
              }`}
            >
              <span
                className={`relative block h-14 w-[4.5rem] overflow-hidden rounded-md border bg-muted transition-colors sm:h-16 sm:w-20 ${
                  isCurrent
                    ? 'border-primary ring-2 ring-primary/35'
                    : 'border-border group-hover:border-primary/50'
                }`}
              >
                {media ? (
                  <Image
                    src={media.frames[0]}
                    alt=""
                    fill
                    sizes="80px"
                    className={`object-cover transition-opacity ${isComplete ? 'opacity-55' : ''}`}
                  />
                ) : (
                  <span
                    className={`flex size-full items-center justify-center bg-secondary text-sm font-semibold text-secondary-foreground ${
                      isComplete ? 'opacity-55' : ''
                    }`}
                  >
                    {abbreviation(displayName, locale)}
                  </span>
                )}
                {isComplete && (
                  <span className="absolute right-1 top-1 flex size-5 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-sm">
                    <Check className="size-3.5" strokeWidth={3} aria-hidden />
                  </span>
                )}
                {/* Current exercise indicator when in input mode (issue #542, PR1) */}
                {isCurrent && !isComplete && (() => {
                  const state = exerciseStates?.get(programExercise.id);
                  // Show active indicator only when in input mode (not resting)
                  if (state?.kind === 'rest') return null;

                  // Also check if blocked by superset transition rest from another exercise
                  for (const [, otherState] of exerciseStates?.entries() ?? []) {
                    if (
                      otherState.kind === 'rest' &&
                      'navigatedImmediately' in otherState &&
                      otherState.navigatedImmediately &&
                      'nextExerciseIdx' in otherState &&
                      otherState.nextExerciseIdx === index
                    ) {
                      return null; // Don't show green dot, timer badge will show instead
                    }
                  }

                  // Also check if a superset partner is resting (edge case)
                  if (programExercise.supersetGroup != null) {
                    for (const otherPE of exercises) {
                      if (
                        otherPE.id !== programExercise.id &&
                        otherPE.supersetGroup === programExercise.supersetGroup
                      ) {
                        const partnerState = exerciseStates?.get(otherPE.id);
                        if (partnerState?.kind === 'rest') {
                          return null; // Don't show green dot, timer badge will show instead
                        }
                      }
                    }
                  }
                  return (
                    <span className="absolute right-1 top-1 flex size-5 items-center justify-center rounded-full bg-green-500 text-white shadow-sm">
                      <span className="size-2 rounded-full bg-white" aria-hidden />
                    </span>
                  );
                })()}
                {/* In-progress indicator: started but not current, not resting, not completed */}
                {!isCurrent && !isComplete && (() => {
                  const state = exerciseStates?.get(programExercise.id);
                  const isStarted = startedProgramExerciseIds?.has(programExercise.id);
                  // Show only if started and not resting
                  if (!isStarted || state?.kind === 'rest') return null;

                  // Calculate progress percentage for pie chart
                  const progress = exerciseProgress?.get(programExercise.id);
                  const percentage = progress && progress.target > 0
                    ? (progress.done / progress.target) * 100
                    : 0;
                  const degrees = (percentage / 100) * 360;

                  return (
                    <span
                      className="absolute right-1 top-1 size-5 rounded-full shadow-sm border-2 border-white dark:border-gray-800"
                      style={{
                        background: `conic-gradient(from 0deg, #f97316 0deg, #f97316 ${degrees}deg, #fed7aa ${degrees}deg, #fed7aa 360deg)`
                      }}
                      aria-label={progress ? `${progress.done} of ${progress.target} sets` : undefined}
                    />
                  );
                })()}
                {/* State indicator badge (issue #542, PR1): timer countdown when resting */}
                {(() => {
                  // Show timer badge if this exercise is resting OR if another exercise's
                  // superset transition rest is blocking this one OR if a superset partner is resting
                  let state = exerciseStates?.get(programExercise.id);

                  // Check if any other exercise is resting and navigated to this one
                  // (superset transition rest blocks this exercise)
                  if (!state || state.kind !== 'rest') {
                    for (const [, otherState] of exerciseStates?.entries() ?? []) {
                      if (
                        otherState.kind === 'rest' &&
                        'navigatedImmediately' in otherState &&
                        otherState.navigatedImmediately &&
                        'nextExerciseIdx' in otherState &&
                        otherState.nextExerciseIdx === index
                      ) {
                        state = otherState;
                        break;
                      }
                    }
                  }

                  // Check if any exercise in the same superset group is resting (edge case fix)
                  if ((!state || state.kind !== 'rest') && programExercise.supersetGroup != null) {
                    for (const otherPE of exercises) {
                      if (
                        otherPE.id !== programExercise.id &&
                        otherPE.supersetGroup === programExercise.supersetGroup
                      ) {
                        const partnerState = exerciseStates?.get(otherPE.id);
                        if (partnerState?.kind === 'rest') {
                          state = partnerState;
                          break;
                        }
                      }
                    }
                  }

                  if (!state || state.kind !== 'rest' || !state.endsAt) return null;

                  // Calculate remaining time
                  const remainingMs = state.pausedRemainingMs ??
                    Math.max(0, state.endsAt - Date.now());
                  const remainingSec = Math.ceil(remainingMs / 1000);
                  const minutes = Math.floor(remainingSec / 60);
                  const seconds = remainingSec % 60;
                  const display = minutes > 0
                    ? `${minutes}:${seconds.toString().padStart(2, '0')}`
                    : `${seconds}`;

                  return (
                    <span
                      data-testid="exercise-strip-timer-badge"
                      className="absolute left-1 top-1 flex items-center gap-1 rounded-full bg-blue-500 pl-1 pr-1.5 py-0.5 text-xs font-medium text-white shadow-sm"
                      aria-label={t('exerciseResting', { time: display })}
                    >
                      <span className="relative flex size-3 items-center justify-center">
                        <span className="absolute inset-0 rounded-full border border-white" aria-hidden />
                        {/* Hour hand pointing to 4 (120 degrees) */}
                        <span
                          className="absolute w-px h-1 bg-white"
                          style={{
                            transformOrigin: 'bottom center',
                            transform: 'translateY(-0.125rem) rotate(120deg)'
                          }}
                          aria-hidden
                        />
                        {/* Minute hand pointing to 12 (0 degrees) */}
                        <span
                          className="absolute w-px h-1.5 bg-white"
                          style={{
                            transformOrigin: 'bottom center',
                            transform: 'translateY(-0.1875rem) rotate(0deg)'
                          }}
                          aria-hidden
                        />
                      </span>
                      {display}
                    </span>
                  );
                })()}
              </span>
              {supersetGroup != null && isInSuperset ? (
                <span
                  data-superset-group={supersetGroup}
                  aria-hidden
                  className={`mt-1 block h-1 bg-red-500 ${
                    previousInGroup ? '-ml-1 rounded-l-none' : 'rounded-l-full'
                  } ${nextInGroup ? '-mr-1 rounded-r-none' : 'rounded-r-full'}`}
                />
              ) : (
                <span
                  className={`mx-auto mt-1 block h-0.5 rounded-full transition-all ${
                    isCurrent ? 'w-10 bg-primary' : 'w-0 bg-transparent'
                  }`}
                />
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
