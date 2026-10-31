'use client';

import { HeartPulse } from 'lucide-react';
import { useFormatter, useTranslations } from 'next-intl';
import {
  Bar,
  BarChart,
  CartesianGrid,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { WEEKLY_CONDITIONING_TARGET_MIN } from '@/lib/stats';

// One weekly conditioning point, serialized at the Server Component boundary.
export interface ConditioningWeekView {
  weekKey: string; // YYYY-Www
  weekStartIso: string; // Monday 00:00 UTC
  minutes: number;
  distanceKm: number;
  sessions: number;
}

interface Props {
  // Zero-filled window, oldest first (lib/stats weeklyConditioning).
  weeks: ConditioningWeekView[];
}

// Conditioning card (issue #135, display-only): weekly cardio minutes as bars
// against the WHO 150 min/week reference line, with distance and session
// count as secondary labels. The parent hides the card entirely while the
// user has never logged a cardio set.
export function ConditioningCard({ weeks }: Props) {
  const t = useTranslations('progress.conditioning');
  const history = useTranslations('history');
  const common = useTranslations('common');
  const coach = useTranslations('coach.client');
  const format = useFormatter();
  const chartData = weeks.map((w) => ({
    ...w,
    label: format.dateTime(new Date(w.weekStartIso), {
      day: '2-digit',
      month: '2-digit',
    }),
  }));
  const current = weeks[weeks.length - 1];
  const totalMinutes = weeks.reduce((acc, w) => acc + w.minutes, 0);
  const totalKm = +weeks.reduce((acc, w) => acc + w.distanceKm, 0).toFixed(2);

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center gap-2">
          <HeartPulse className="size-4 text-primary" />
          <h2 className="text-base font-semibold">{t('title')}</h2>
        </div>
        <p className="text-xs text-muted-foreground">
          {t('description', { target: WEEKLY_CONDITIONING_TARGET_MIN })}
        </p>
      </CardHeader>
      <CardContent>
        <div className="h-56 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={chartData} margin={{ top: 5, right: 10, bottom: 0, left: -10 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
              <XAxis dataKey="label" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
              <Tooltip
                contentStyle={{
                  background: 'hsl(var(--popover))',
                  border: '1px solid hsl(var(--border))',
                  borderRadius: 6,
                  fontSize: 12,
                }}
                formatter={(value, name) => {
                  if (name === 'minutes')
                    return [
                      history('minutes', { count: Number(value ?? 0) }),
                      history('detail.duration'),
                    ];
                  return [value ?? '', name];
                }}
                labelFormatter={(label, payload) => {
                  const p = payload?.[0]?.payload as ConditioningWeekView | undefined;
                  if (!p) return label;
                  const extras = [
                    p.distanceKm > 0 ? `${p.distanceKm} km` : null,
                    common('counts.sessions', { count: p.sessions }),
                  ]
                    .filter(Boolean)
                    .join(' · ');
                  return `${coach('weekOf', { date: String(label) })} · ${extras}`;
                }}
              />
              <ReferenceLine
                y={WEEKLY_CONDITIONING_TARGET_MIN}
                stroke="hsl(var(--primary))"
                strokeDasharray="4 4"
                label={{
                  value: history('minutes', { count: WEEKLY_CONDITIONING_TARGET_MIN }),
                  position: 'insideTopRight',
                  fontSize: 11,
                  fill: 'hsl(var(--primary))',
                }}
              />
              <Bar dataKey="minutes" fill="#10b981" name="minutes" />
            </BarChart>
          </ResponsiveContainer>
        </div>
        <p className="mt-2 text-xs text-muted-foreground">
          {t('summary', {
            minutes: current?.minutes ?? 0,
            distance: current && current.distanceKm > 0 ? String(current.distanceKm) : 'none',
            current: current ? 'present' : 'none',
            sessions: current?.sessions ?? 0,
            weeks: weeks.length,
            totalMinutes,
            totalDistance: totalKm > 0 ? String(totalKm) : 'none',
          })}
        </p>
      </CardContent>
    </Card>
  );
}
