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
  // Per-exercise rest states for displaying timer badges (issue #542, PR1).
  exerciseStates?: ReadonlyMap<string, {
    kind: 'input' | 'rest';
    endsAt?: number;
    pausedRemainingMs?: number | null;
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
                {/* State indicator badge (issue #542, PR1): timer countdown when resting */}
                {(() => {
                  const state = exerciseStates?.get(programExercise.id);
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
                      className="absolute left-1 top-1 flex items-center gap-0.5 rounded-full bg-blue-500 px-1.5 py-0.5 text-xs font-medium text-white shadow-sm"
                      aria-label={t('exerciseResting', { time: display })}
                    >
                      ⏱️ {display}
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
