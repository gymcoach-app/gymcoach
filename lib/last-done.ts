// "Last done N days ago" for the live session (issue #459): how fresh a
// movement is, counted in calendar days in the instance's time zone (the same
// zone next-intl formats dates with), so a set logged late yesterday reads
// "yesterday" and not "today" just because fewer than 24 hours passed.

function calendarDay(at: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
  }).formatToParts(at);
  const part = (type: 'year' | 'month' | 'day') =>
    Number(parts.find((p) => p.type === type)?.value);
  return Date.UTC(part('year'), part('month') - 1, part('day')) / 86_400_000;
}

// Whole calendar days from `from` to `to` in `timeZone`; 0 on the same day.
// Never negative: a clock skew that puts `from` after `to` reads as today.
export function calendarDaysBetween(from: Date, to: Date, timeZone: string): number {
  return Math.max(0, calendarDay(to, timeZone) - calendarDay(from, timeZone));
}

// Per exercise id, the calendar days since its last working set. An exercise
// with no previous working set has no entry, which the session shows as
// "never done".
export function lastDoneDaysByExercise(
  lastDoneAt: ReadonlyMap<string, Date>,
  now: Date,
  timeZone: string,
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [exerciseId, at] of lastDoneAt) {
    out[exerciseId] = calendarDaysBetween(at, now, timeZone);
  }
  return out;
}
