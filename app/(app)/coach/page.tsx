import { Sparkles } from 'lucide-react';
import { getTranslations } from 'next-intl/server';
import { db } from '@/lib/db';
import { requireSession } from '@/lib/auth';
import { getLlmProvider } from '@/lib/llm';
import { buildCoachPayload } from '@/lib/coach';
import { summarizeCoachPayload } from '@/lib/coach-context';
import {
  CoachClient,
  type ProgramExerciseDefaults,
} from '@/components/coach/coach-client';
import { CoachContextCard } from '@/components/coach/coach-context-card';
import { CoachNoteCard } from '@/components/coach/coach-note-card';
import { EffortScaleProvider } from '@/components/shared/effort-scale-provider';

export default async function CoachPage() {
  const t = await getTranslations('coach');
  const auth = await requireSession();

  const [history, activeProgram, coachPayload, user] = await Promise.all([
    db.coachSession.findMany({
      where: { userId: auth.userId },
      orderBy: { createdAt: 'desc' },
      take: 20,
      select: {
        id: true,
        weekStart: true,
        weekEnd: true,
        response: true,
        appliedAt: true,
        createdAt: true,
      },
    }),
    db.program.findFirst({
      where: { userId: auth.userId, isActive: true },
      include: {
        workouts: {
          include: {
            exercises: {
              include: { exercise: { select: { name: true } } },
            },
          },
        },
      },
    }),
    // "What your coach sees" (issue #154): the SAME builder the debrief and
    // chat routes use, so the card cannot drift from the payload the AI gets.
    buildCoachPayload(auth.userId),
    // The adjustments editor follows the user's effort scale (issue #390).
    db.user.findUnique({ where: { id: auth.userId }, select: { effortScale: true } }),
  ]);

  const coachContext = summarizeCoachPayload(coachPayload);

  // Map exerciseName -> current program values (to pre-fill adjustments when
  // the coach does not provide an explicit value).
  const programDefaults: Record<string, ProgramExerciseDefaults> = {};
  if (activeProgram) {
    for (const w of activeProgram.workouts) {
      for (const pe of w.exercises) {
        const key = pe.exercise.name;
        if (programDefaults[key]) continue;
        programDefaults[key] = {
          targetRepsMin: pe.targetRepsMin,
          targetRepsMax: pe.targetRepsMax,
          targetSets: pe.targetSets,
          targetRIR: pe.targetRIR,
          restSec: pe.restSec,
        };
      }
    }
  }

  // Pre-serialize the dates for the client component.
  const initialHistory = history.map((h) => ({
    id: h.id,
    weekStart: h.weekStart.toISOString(),
    weekEnd: h.weekEnd.toISOString(),
    response: h.response,
    appliedAt: h.appliedAt?.toISOString() ?? null,
    createdAt: h.createdAt.toISOString(),
  }));

  const provider = getLlmProvider();
  const hasApiKey = provider.isConfigured();

  return (
    <main className="flex-1 px-4 py-6">
      <div className="mx-auto flex max-w-2xl flex-col gap-6">
        <div className="flex items-center gap-3">
          <Sparkles className="size-6" />
          <div>
            <h1 className="text-2xl font-bold tracking-tight">{t('title')}</h1>
            <p className="text-xs text-muted-foreground">
              {t('description')}
            </p>
          </div>
        </div>

        <CoachContextCard summary={coachContext} />

        <CoachNoteCard initialNote={coachPayload.userProfile.coachNote} />

        <EffortScaleProvider scale={user?.effortScale ?? 'RIR'}>
          <CoachClient
            initialHistory={initialHistory}
            hasApiKey={hasApiKey}
            providerLabel={provider.label}
            apiKeyEnvVar={provider.apiKeyEnvVar}
            programDefaults={programDefaults}
          />
        </EffortScaleProvider>
      </div>
    </main>
  );
}
