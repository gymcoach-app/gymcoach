'use client';

import { useEffect, useRef, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { FastForward, Minus, Pause, Play, Plus } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { REST_ADJUST_STEP_MS, restRemainingMs } from '@/lib/rest-timer';
import { playRestEndBeep } from '@/lib/sound';
import { formatWeight } from '@/lib/units';
import type { WeightUnit } from '@/lib/prisma-client';
import type { IntraSetRecommendation } from '@/lib/intra-set-autoregulation';

interface Props {
  endsAt: number;
  // Milliseconds left when the rest was paused; null (or omitted) while it runs.
  pausedRemainingMs?: number | null;
  totalSec: number;
  nextLabel: string | null | undefined;
  recommendation?: IntraSetRecommendation | null;
  unit: WeightUnit;
  onEnd: () => void;
  onSkip: () => void;
  onPause: () => void;
  onResume: () => void;
  // Signed change of the remaining time, in milliseconds (issue #393).
  onAdjust: (deltaMs: number) => void;
}

export function RestTimer({
  endsAt,
  pausedRemainingMs = null,
  totalSec,
  nextLabel,
  recommendation = null,
  unit,
  onEnd,
  onSkip,
  onPause,
  onResume,
  onAdjust,
}: Props) {
  const t = useTranslations('session.rest');
  const autoT = useTranslations('session.autoregulation');
  const locale = useLocale();
  const [now, setNow] = useState(() => Date.now());
  const endedRef = useRef(false);

  useEffect(() => {
    endedRef.current = false;
    const id = setInterval(() => setNow(Date.now()), 100);
    return () => clearInterval(id);
  }, [endsAt]);

  const paused = pausedRemainingMs != null;

  // Detect reaching 0: trigger onEnd ONCE and play the beep if the preference
  // allows it. A paused rest never ends on its own, even at zero.
  useEffect(() => {
    if (!paused && !endedRef.current && now >= endsAt) {
      endedRef.current = true;
      playRestEndBeep();
      onEnd();
    }
  }, [now, endsAt, paused, onEnd]);

  const remainingMs = restRemainingMs({ endsAt, pausedRemainingMs }, now);
  const remainingSec = Math.ceil(remainingMs / 1000);
  const progress = Math.min(100, (remainingMs / (totalSec * 1000)) * 100);

  return (
    <Card data-testid="rest-timer">
      <CardContent className="flex flex-col items-center gap-4 py-8">
        <p className="text-xs uppercase tracking-wider text-muted-foreground">
          {paused ? t('pausedTitle') : t('title')}
        </p>

        <div className="relative">
          <p className="text-7xl font-bold tabular-nums">
            <span data-testid="rest-remaining">{remainingSec}</span>
            <span className="ml-2 text-2xl text-muted-foreground">{t('seconds')}</span>
          </p>
        </div>

        <div className="h-2 w-full max-w-xs overflow-hidden rounded-full bg-muted">
          <div
            className="h-full bg-primary transition-[width] duration-100 ease-linear"
            style={{ width: `${progress}%` }}
          />
        </div>

        {nextLabel && (
          <p className="text-center text-sm text-muted-foreground">
            {t('next', { name: nextLabel })}
          </p>
        )}

        {recommendation && (
          <div className="w-full max-w-sm rounded-md border border-primary/30 bg-primary/5 p-3 text-center">
            <p className="text-xs font-medium uppercase text-muted-foreground">
              {autoT('nextSet')}
            </p>
            <p className="mt-1 text-xl font-semibold">
              {formatWeight(recommendation.weight, unit, {
                decimals: 2,
                group: false,
                locale,
              })}{' '}
              × {recommendation.reps} · RIR {recommendation.rir}
            </p>
            <p className="text-xs text-muted-foreground">
              {autoT(`reasons.${recommendation.reason}`)}
            </p>
          </div>
        )}

        <div className="flex w-full max-w-sm gap-2">
          <Button
            variant="outline"
            onClick={() => onAdjust(-REST_ADJUST_STEP_MS)}
            disabled={remainingMs <= 0}
            aria-label={t('removeFifteenLabel')}
            className="min-h-tap flex-1"
          >
            <Minus className="size-4" />
            <span className="ml-1">{t('fifteen')}</span>
          </Button>
          <Button
            variant="outline"
            onClick={paused ? onResume : onPause}
            className="min-h-tap flex-1"
          >
            {paused ? <Play className="size-4" /> : <Pause className="size-4" />}
            <span className="ml-1">{paused ? t('resume') : t('pause')}</span>
          </Button>
          <Button
            variant="outline"
            onClick={() => onAdjust(REST_ADJUST_STEP_MS)}
            aria-label={t('addFifteenLabel')}
            className="min-h-tap flex-1"
          >
            <Plus className="size-4" />
            <span className="ml-1">{t('fifteen')}</span>
          </Button>
        </div>
        <Button variant="default" onClick={onSkip} className="min-h-tap w-full max-w-sm">
          <FastForward className="size-4" />
          <span className="ml-1">{t('skip')}</span>
        </Button>
      </CardContent>
    </Card>
  );
}
