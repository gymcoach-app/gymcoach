import { dateKeyInTimeZone } from '@/lib/history-calendar';

// "Last done N days ago" for the live session (issue #459): how fresh a
// movement is, counted in calendar days in the lifter's time zone, so a set
// logged late yesterday reads "yesterday" and not "today" just because fewer
// than 24 hours passed. The day is bucketed with the history calendar's
// helper, so both features agree on which day a session belongs to.

function dayNumber(at: Date, timeZone: string): number {
  return Date.parse(`${dateKeyInTimeZone(at, timeZone)}T00:00:00Z`) / 86_400_000;
}

// Whole calendar days from `from` to `to` in `timeZone`; 0 on the same day.
// Never negative: a clock skew that puts `from` after `to` reads as today.
export function calendarDaysBetween(from: Date, to: Date, timeZone: string): number {
  return Math.max(0, dayNumber(to, timeZone) - dayNumber(from, timeZone));
}

// Per exercise id, the calendar days since it was last done (an ISO
// timestamp). An exercise with no entry has never been done, which the
// session shows as "never done".
export function lastDoneDaysByExercise(
  lastDoneAt: Readonly<Record<string, string>>,
  now: Date,
  timeZone: string,
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [exerciseId, at] of Object.entries(lastDoneAt)) {
    out[exerciseId] = calendarDaysBetween(new Date(at), now, timeZone);
  }
  return out;
}

// The lifter's zone, as the browser reports it. Only meaningful client-side:
// on the server it is the process zone (UTC in Docker), which is exactly the
// zone the review of #476 ruled out for the day boundary.
export function browserTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}
