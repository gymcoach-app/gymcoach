'use client';

import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useMemo, useState, useTransition } from 'react';
import { useFormatter, useLocale, useTranslations } from 'next-intl';
import { CalendarDays, ChevronLeft, ChevronRight } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import {
  buildMonthGrid,
  dateKeyInTimeZone,
  formatMonthKey,
  isDateKey,
  parseMonthKey,
  shiftCalendarMonth,
} from '@/lib/history-calendar';

export interface HistoryCalendarSession {
  id: string;
  startedAt: string;
  title: string;
  programName: string | null;
  workingSets: number;
  volumeLabel: string | null;
  durationLabel: string | null;
  cardioDistanceLabel: string | null;
  cardioDurationLabel: string | null;
  cardioHeartRateLabel: string | null;
}

interface Props {
  monthKey: string;
  initialDay?: string;
  sessions: HistoryCalendarSession[];
  selectedProgramId?: string;
  timeZone: string;
}

export function HistoryCalendar({
  monthKey,
  initialDay,
  sessions,
  selectedProgramId,
  timeZone,
}: Props) {
  const t = useTranslations('history.calendar');
  const history = useTranslations('history');
  const common = useTranslations('common');
  const locale = useLocale();
  const format = useFormatter();
  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams();
  const [isPending, startTransition] = useTransition();

  const month = useMemo(() => parseMonthKey(monthKey), [monthKey]);
  const weekStartsOn = weekStartsOnForLocale(locale);
  const cells = useMemo(() => buildMonthGrid(month, weekStartsOn), [month, weekStartsOn]);
  const todayKey = dateKeyInTimeZone(new Date(), timeZone);

  const sessionsByDate = useMemo(() => {
    const grouped = new Map<string, HistoryCalendarSession[]>();
    for (const session of sessions) {
      const dateKey = dateKeyInTimeZone(session.startedAt, timeZone);
      if (!dateKey.startsWith(`${monthKey}-`)) continue;
      const daySessions = grouped.get(dateKey) ?? [];
      daySessions.push(session);
      grouped.set(dateKey, daySessions);
    }
    for (const daySessions of grouped.values()) {
      daySessions.sort((a, b) => a.startedAt.localeCompare(b.startedAt));
    }
    return grouped;
  }, [monthKey, sessions, timeZone]);

  const defaultDate = useMemo(() => {
    if (isDateKey(initialDay) && initialDay.startsWith(`${monthKey}-`)) return initialDay;
    if (todayKey.startsWith(`${monthKey}-`)) return todayKey;
    return [...sessionsByDate.keys()].sort()[0] ?? `${monthKey}-01`;
  }, [initialDay, monthKey, sessionsByDate, todayKey]);

  const [selectedDate, setSelectedDate] = useState(defaultDate);

  useEffect(() => {
    setSelectedDate(defaultDate);
  }, [defaultDate]);

  // The server buckets days in whatever zone the URL carries (falling back to
  // its own). On the first paint the URL has none, so hand the browser zone
  // over once; the page re-renders with the lifter's days.
  useEffect(() => {
    const browserZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (!browserZone || search.get('tz') === browserZone) return;
    const params = new URLSearchParams(search.toString());
    params.set('tz', browserZone);
    router.replace(`${pathname}?${params.toString()}`);
  }, [pathname, router, search]);

  // URLs carry the zone the current URL already has (the browser zone once
  // the effect above ran), never the server-resolved one, so the two cannot
  // diverge and trigger a replace on every navigation.
  const urlZone = search.get('tz') ?? timeZone;
  const selectedSessions = sessionsByDate.get(selectedDate) ?? [];
  // Calendar labels are pure dates: build them at UTC noon and format them in
  // UTC, so they never shift with the browser or server zone.
  const weekdayLabels = useMemo(() => {
    const sunday = Date.UTC(2024, 0, 7, 12);
    return Array.from({ length: 7 }, (_, index) => {
      const dayOffset = (weekStartsOn + index) % 7;
      const date = new Date(sunday + dayOffset * 86_400_000);
      return format.dateTime(date, { weekday: 'short', timeZone: 'UTC' });
    });
  }, [format, weekStartsOn]);

  const monthLabel = format.dateTime(new Date(Date.UTC(month.year, month.monthIndex, 1, 12)), {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });
  const selectedDateLabel = format.dateTime(dateKeyToUtcDate(selectedDate), {
    ...DATE_LABEL_FORMAT,
  });
  const filteredEmpty = Boolean(selectedProgramId) && sessionsByDate.size === 0;

  function navigateToMonth(delta: number) {
    const target = shiftCalendarMonth(month, delta);
    updateLocation(formatMonthKey(target), undefined);
  }

  function goToToday() {
    updateLocation(todayKey.slice(0, 7), todayKey);
  }

  function updateLocation(nextMonth: string, day: string | undefined) {
    const params = new URLSearchParams(search.toString());
    params.set('month', nextMonth);
    if (day) params.set('day', day);
    else params.delete('day');
    if (selectedProgramId) params.set('programId', selectedProgramId);
    params.set('tz', urlZone);
    const href = `${pathname}?${params.toString()}`;
    startTransition(() => router.push(href));
  }

  function selectDay(dateKey: string) {
    setSelectedDate(dateKey);
    const params = new URLSearchParams(window.location.search);
    params.set('day', dateKey);
    if (!params.has('tz')) params.set('tz', urlZone);
    window.history.replaceState(null, '', `${pathname}?${params.toString()}`);
  }

  return (
    <div className="flex flex-col gap-4" aria-busy={isPending}>
      <Card className={cn('overflow-hidden transition-opacity', isPending && 'opacity-60')}>
        <CardContent className="p-3 sm:p-4">
          <div className="mb-3 flex items-center justify-between gap-2">
            <Button
              type="button"
              variant="outline"
              size="icon"
              onClick={() => navigateToMonth(-1)}
              disabled={isPending}
              aria-label={t('previousMonth')}
            >
              <ChevronLeft className="size-5" />
            </Button>
            <div className="min-w-0 text-center">
              <div className="truncate text-lg font-semibold capitalize">{monthLabel}</div>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-7 px-2 text-xs"
                onClick={goToToday}
                disabled={isPending}
              >
                {t('today')}
              </Button>
            </div>
            <Button
              type="button"
              variant="outline"
              size="icon"
              onClick={() => navigateToMonth(1)}
              disabled={isPending}
              aria-label={t('nextMonth')}
            >
              <ChevronRight className="size-5" />
            </Button>
          </div>

          <div className="grid grid-cols-7 text-center" aria-label={monthLabel}>
            {weekdayLabels.map((label, index) => (
              <div
                key={`${label}-${index}`}
                className="pb-2 text-xs font-medium uppercase text-muted-foreground"
              >
                {label}
              </div>
            ))}
            {cells.map((cell, index) => {
              if (!cell.dateKey || !cell.dayNumber) {
                return (
                  <div key={`blank-${index}`} className="aspect-square min-h-11" aria-hidden />
                );
              }

              const daySessions = sessionsByDate.get(cell.dateKey) ?? [];
              const isToday = cell.dateKey === todayKey;
              const isSelected = cell.dateKey === selectedDate;
              const dateLabel = format.dateTime(dateKeyToUtcDate(cell.dateKey), {
                ...DATE_LABEL_FORMAT,
              });
              const accessibleLabel = daySessions.length
                ? `${dateLabel}, ${t('workoutCount', { count: daySessions.length })}`
                : dateLabel;

              return (
                <button
                  key={cell.dateKey}
                  type="button"
                  aria-label={accessibleLabel}
                  aria-pressed={isSelected}
                  onClick={() => selectDay(cell.dateKey!)}
                  className={cn(
                    'relative flex aspect-square min-h-11 flex-col items-center justify-center rounded-lg border border-transparent text-sm transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                    isToday && 'border-primary font-semibold',
                    isSelected && 'bg-primary text-primary-foreground hover:bg-primary/90',
                  )}
                >
                  <span>{cell.dayNumber}</span>
                  {daySessions.length > 0 && (
                    <span
                      className={cn(
                        'mt-0.5 flex min-h-3 min-w-3 items-center justify-center rounded-full bg-primary px-1 text-[9px] font-bold leading-3 text-primary-foreground',
                        isSelected && 'bg-primary-foreground text-primary',
                      )}
                      aria-hidden
                    >
                      {daySessions.length > 1 ? daySessions.length : ''}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </CardContent>
      </Card>

      {filteredEmpty && (
        <Card>
          <CardContent className="py-4 text-center text-sm text-muted-foreground">
            {history('noFiltered')}
          </CardContent>
        </Card>
      )}

      <section className="flex flex-col gap-2" aria-labelledby="selected-day-heading">
        <div className="flex items-center gap-2">
          <CalendarDays className="size-5 text-muted-foreground" />
          <h2 id="selected-day-heading" className="text-lg font-semibold capitalize">
            {selectedDateLabel}
          </h2>
        </div>

        {selectedSessions.length === 0 ? (
          <Card>
            <CardContent className="py-6 text-center text-sm text-muted-foreground">
              {t('noSessions')}
            </CardContent>
          </Card>
        ) : (
          <ul className="flex flex-col gap-2">
            {selectedSessions.map((session) => {
              const returnParams = new URLSearchParams({ month: monthKey, day: selectedDate });
              if (selectedProgramId) returnParams.set('programId', selectedProgramId);
              returnParams.set('tz', urlZone);
              return (
                <li key={session.id}>
                  <Link
                    href={`/history/${session.id}?${returnParams.toString()}`}
                    className="block"
                  >
                    <Card className="transition-colors hover:bg-accent/40">
                      <CardContent className="flex items-center justify-between gap-3 p-4">
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-base font-medium">{session.title}</p>
                          <p className="mt-0.5 text-xs text-muted-foreground">
                            {format.dateTime(new Date(session.startedAt), {
                              hour: '2-digit',
                              minute: '2-digit',
                              timeZone,
                            })}
                          </p>
                          <div className="mt-2 flex flex-wrap gap-1.5 text-xs">
                            {session.programName && (
                              <Badge variant="secondary">{session.programName}</Badge>
                            )}
                            {session.cardioDistanceLabel && (
                              <Badge variant="outline">{session.cardioDistanceLabel}</Badge>
                            )}
                            {session.cardioDurationLabel && (
                              <Badge variant="outline">{session.cardioDurationLabel}</Badge>
                            )}
                            {session.cardioHeartRateLabel && (
                              <Badge variant="outline">{session.cardioHeartRateLabel}</Badge>
                            )}
                            {!session.cardioDurationLabel && (
                              <>
                                <Badge variant="outline">
                                  {common('counts.sets', { count: session.workingSets })}
                                </Badge>
                                {session.volumeLabel && (
                                  <Badge variant="outline">{session.volumeLabel}</Badge>
                                )}
                                {session.durationLabel && (
                                  <Badge variant="outline">{session.durationLabel}</Badge>
                                )}
                              </>
                            )}
                          </div>
                        </div>
                        <ChevronRight className="size-5 shrink-0 text-muted-foreground" />
                      </CardContent>
                    </Card>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}

// An explicit list rather than Intl.Locale weekInfo: that API is missing from
// some runtimes, and server and client must agree on the grid to hydrate.
const MONDAY_FIRST_LOCALES = ['ru', 'fr', 'de'];

export function weekStartsOnForLocale(locale: string): 0 | 1 {
  const normalized = locale.toLowerCase();
  return MONDAY_FIRST_LOCALES.some((prefix) => normalized.startsWith(prefix)) ? 1 : 0;
}
const DATE_LABEL_FORMAT = {
  weekday: 'long',
  day: 'numeric',
  month: 'long',
  year: 'numeric',
  timeZone: 'UTC',
} as const;

function dateKeyToUtcDate(dateKey: string): Date {
  const [year, month, day] = dateKey.split('-').map(Number);
  if (year === undefined || month === undefined || day === undefined) {
    throw new Error(`Invalid date key: ${dateKey}`);
  }
  return new Date(Date.UTC(year, month - 1, day, 12));
}
