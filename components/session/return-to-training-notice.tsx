'use client';

import { RotateCcw } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import type { WeightUnit } from '@/lib/prisma-client';
import type { ReturnRecommendation } from '@/lib/return-to-training';
import { formatWeight } from '@/lib/units';
import { effortValue } from '@/lib/effort';
import { useEffortScale } from '@/components/shared/effort-scale-provider';

interface Props {
  recommendation: ReturnRecommendation | null | undefined;
  unit: WeightUnit;
  usesBodyweight: boolean;
}

export function ReturnToTrainingNotice({ recommendation, unit, usesBodyweight }: Props) {
  const t = useTranslations('session.returnToTraining');
  const locale = useLocale();
  const effortScale = useEffortScale();
  if (!recommendation || recommendation.mode === 'normal') return null;

  const preservedPriorGap =
    recommendation.mode === 'exercise-reintro' &&
    recommendation.returnGapDays != null &&
    recommendation.exerciseGapDays != null &&
    recommendation.returnGapDays > recommendation.exerciseGapDays;
  const description =
    recommendation.mode === 'exercise-reintro'
      ? preservedPriorGap
        ? t('recentReturnAfterGap', { days: recommendation.returnGapDays! })
        : t('exerciseReintro', {
            days: recommendation.returnGapDays ?? recommendation.exerciseGapDays ?? 42,
          })
      : t('muscleReintro');

  return (
    <section
      data-testid="return-to-training-notice"
      className="rounded-md border border-amber-300/70 bg-amber-50 px-3 py-3 text-amber-950 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-100"
    >
      <div className="flex items-start gap-2.5">
        <RotateCcw className="mt-0.5 size-4 shrink-0" aria-hidden />
        <div className="min-w-0 space-y-1 text-xs leading-relaxed sm:text-sm">
          <p className="font-semibold">{t('title')}</p>
          <p>{description}</p>
          <p className="font-medium">
            {t('targets', {
              sets: recommendation.targetSets,
              scale: effortScale,
              value: effortValue(effortScale, recommendation.targetRIR),
            })}
          </p>
          {recommendation.suggestedWeight != null ? (
            <p>
              {usesBodyweight && recommendation.suggestedWeight === 0
                ? t('bodyweightStart')
                : t('startWeight', {
                    weight: formatWeight(recommendation.suggestedWeight, unit, {
                      decimals: 2,
                      locale,
                    }),
                  })}
            </p>
          ) : (
            <p>{t('chooseLoad')}</p>
          )}
          {recommendation.weightCeiling != null && recommendation.weightCeiling > 0 && (
            <p>
              {t('ceiling', {
                weight: formatWeight(recommendation.weightCeiling, unit, {
                  decimals: 2,
                  locale,
                }),
              })}
            </p>
          )}
          <p>{t('calibrate', { scale: effortScale })}</p>
        </div>
      </div>
    </section>
  );
}
