// Editing a finished session and logging a past one (issue #389).
//
// Nothing in the app stores a record, a streak or a next load: they are all
// read back from `Session.startedAt` and `Set.completedAt`. So the one rule
// that keeps every derived number right after an edit is that a set's
// `completedAt` always lies inside its session's [startedAt, finishedAt]
// window. A set stamped "now" inside a session dated last month would be the
// "last performance" of its exercise and sit in this week's progress charts.
//
// Time zones: the browser turns the lifter's wall-clock date and time into an
// instant, in its own zone, and the server only ever sees that instant. The
// calendar buckets instants by the lifter's zone again on the way out, so a
// session lands on the day that was picked.
//
// Pure and client-safe: no database access here.

/** Longest session the editor accepts, in minutes (24 hours). */
export const MAX_SESSION_DURATION_MIN = 24 * 60;

/**
 * How far past the server clock a session may end before it counts as being
 * in the future. A phone clock a few seconds ahead of the server must not
 * make "finished just now" fail.
 */
export const FUTURE_TOLERANCE_MS = 60 * 1000;

/**
 * Earliest instant a session may be dated at: 2000-01-01, the floor the
 * imports use too (APPLE_HEALTH_MIN_DATE). It bounds the dates this feature
 * WRITES; an older imported session keeps its date and stays editable.
 */
export const MIN_SESSION_START_MS = Date.UTC(2000, 0, 1);

const MINUTE_MS = 60 * 1000;

/** Whole minutes between two instants, as the history shows them. */
export function durationMinutes(startedAt: Date, finishedAt: Date): number {
  return Math.round((finishedAt.getTime() - startedAt.getTime()) / MINUTE_MS);
}

/** True when a session ending at `finishedAt` has not happened yet. */
export function endsInFuture(finishedAt: Date, now: Date): boolean {
  return finishedAt.getTime() > now.getTime() + FUTURE_TOLERANCE_MS;
}

/**
 * The window of an edited session. The request carries only what the lifter
 * changed: without a start the session stays where it is, to the second;
 * without a duration it keeps the stored one, to the millisecond (and
 * whatever its length: an imported session may last longer than the editor
 * lets one type, or not at all).
 */
export function resolveEditedWindow(input: {
  startedAt: Date;
  finishedAt: Date;
  newStartedAt?: Date;
  newDurationMin?: number;
}): { startedAt: Date; finishedAt: Date } {
  const startedAt = input.newStartedAt ?? input.startedAt;
  const durationMs =
    input.newDurationMin != null
      ? input.newDurationMin * MINUTE_MS
      : Math.max(0, input.finishedAt.getTime() - input.startedAt.getTime());
  return { startedAt, finishedAt: new Date(startedAt.getTime() + durationMs) };
}

export interface RetimedSets {
  /** The sets whose `completedAt` changes, with their new value. */
  changes: { id: string; completedAt: Date }[];
  /**
   * True when the sets could not simply follow the session and were squeezed
   * into the new window: the time between two sets changed, so anything
   * derived from that spacing (the per-set heart rate of a watch file) is
   * stale.
   */
  rescaled: boolean;
}

/**
 * Moves the sets of a session along with it. Each set keeps its offset from
 * the session start when the result fits the new window. When it does not (a
 * shorter duration, a set stamped outside the old window), the offsets are
 * mapped linearly onto the new window, which keeps the order of the sets.
 */
export function retimeSets(input: {
  oldStartedAt: Date;
  newStartedAt: Date;
  newFinishedAt: Date;
  sets: readonly { id: string; completedAt: Date }[];
}): RetimedSets {
  const oldStart = input.oldStartedAt.getTime();
  const newStart = input.newStartedAt.getTime();
  const windowMs = Math.max(0, input.newFinishedAt.getTime() - newStart);
  const offsets = input.sets.map((set) => set.completedAt.getTime() - oldStart);
  let low = 0;
  let high = windowMs;
  for (const offset of offsets) {
    if (offset < low) low = offset;
    if (offset > high) high = offset;
  }
  const rescaled = low < 0 || high > windowMs;
  const span = high - low;

  const changes: RetimedSets['changes'] = [];
  input.sets.forEach((set, index) => {
    const offset = offsets[index] ?? 0;
    const mapped = rescaled && span > 0 ? Math.round(((offset - low) / span) * windowMs) : offset;
    const next = newStart + Math.min(windowMs, Math.max(0, mapped));
    if (next !== set.completedAt.getTime()) {
      changes.push({ id: set.id, completedAt: new Date(next) });
    }
  });
  return { changes, rescaled };
}

/**
 * The `completedAt` of a set added to a finished session: one second after
 * the session's last set (the start when it has none), never outside the
 * session window. Several sets added at the very end share `finishedAt`; the
 * readers that need an order then fall back on the set number.
 */
export function addedSetCompletedAt(input: {
  startedAt: Date;
  finishedAt: Date;
  lastSetAt: Date | null;
}): Date {
  const start = input.startedAt.getTime();
  const finish = Math.max(start, input.finishedAt.getTime());
  const candidate = (input.lastSetAt?.getTime() ?? start) + 1000;
  return new Date(Math.min(finish, Math.max(start, candidate)));
}

const DATE_INPUT = /^(\d{4})-(\d{2})-(\d{2})$/;
const TIME_INPUT = /^(\d{2}):(\d{2})$/;

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

/**
 * An instant as the values of a date and a time field, in the zone of the
 * runtime (the browser's, where the editor runs).
 */
export function toLocalInputs(instant: Date): { date: string; time: string } {
  return {
    date: `${instant.getFullYear()}-${pad(instant.getMonth() + 1)}-${pad(instant.getDate())}`,
    time: `${pad(instant.getHours())}:${pad(instant.getMinutes())}`,
  };
}

/**
 * The instant of a date field ("2026-11-03") and a time field ("18:30") read
 * in the zone of the runtime. Null for anything that is not a real date and
 * time. A wall-clock time skipped by a daylight saving change resolves to the
 * instant the clocks jumped to, as the platform does.
 */
export function fromLocalInputs(date: string, time: string): Date | null {
  const d = DATE_INPUT.exec(date);
  const t = TIME_INPUT.exec(time);
  if (!d || !t) return null;
  const year = Number(d[1]);
  const month = Number(d[2]);
  const day = Number(d[3]);
  const hours = Number(t[1]);
  const minutes = Number(t[2]);
  if (hours > 23 || minutes > 59) return null;
  const instant = new Date(year, month - 1, day, hours, minutes, 0, 0);
  if (
    Number.isNaN(instant.getTime()) ||
    instant.getFullYear() !== year ||
    instant.getMonth() !== month - 1 ||
    instant.getDate() !== day
  ) {
    return null;
  }
  return instant;
}

export type TimingInputs = { date: string; time: string; duration: string };

export type ParsedTiming =
  | { ok: true; startedAt: Date; durationMin: number }
  | { ok: false; reason: 'invalid' | 'future' };

/**
 * Reads the three fields of the timing form (date, start time, duration in
 * minutes) the way the server will judge them, so the form can say what is
 * wrong before sending anything. The server stays the authority.
 */
export function parseTimingInputs(inputs: TimingInputs, now: Date): ParsedTiming {
  const startedAt = fromLocalInputs(inputs.date, inputs.time);
  const duration = inputs.duration.trim();
  if (!startedAt || !/^\d{1,4}$/.test(duration)) return { ok: false, reason: 'invalid' };
  const durationMin = Number(duration);
  if (
    durationMin < 1 ||
    durationMin > MAX_SESSION_DURATION_MIN ||
    startedAt.getTime() < MIN_SESSION_START_MS
  ) {
    return { ok: false, reason: 'invalid' };
  }
  if (endsInFuture(new Date(startedAt.getTime() + durationMin * MINUTE_MS), now)) {
    return { ok: false, reason: 'future' };
  }
  return { ok: true, startedAt, durationMin };
}

/** The fields of the timing form for a stored session, in the runtime's zone. */
export function timingInputsOf(startedAt: Date, finishedAt: Date): TimingInputs {
  return {
    ...toLocalInputs(startedAt),
    duration: String(Math.max(0, durationMinutes(startedAt, finishedAt))),
  };
}

export type TimingEdit =
  | { ok: true; changes: { startedAt?: Date; durationMin?: number } }
  | { ok: false; reason: 'invalid' | 'future' };

/**
 * What the lifter changed in the timing form of a stored session. Only a
 * field that no longer reads as the stored session is a change: the fields
 * show whole minutes, so sending them back untouched would drop the seconds
 * of the start, and in the hour a daylight saving change repeats it would
 * move the start by an hour. An untouched form gives no change at all.
 */
export function parseTimingEdit(input: {
  startedAt: Date;
  finishedAt: Date;
  inputs: TimingInputs;
  now: Date;
}): TimingEdit {
  const stored = timingInputsOf(input.startedAt, input.finishedAt);
  const changes: { startedAt?: Date; durationMin?: number } = {};

  if (input.inputs.date !== stored.date || input.inputs.time !== stored.time) {
    const startedAt = fromLocalInputs(input.inputs.date, input.inputs.time);
    if (!startedAt || startedAt.getTime() < MIN_SESSION_START_MS) {
      return { ok: false, reason: 'invalid' };
    }
    changes.startedAt = startedAt;
  }
  const duration = input.inputs.duration.trim();
  if (duration !== stored.duration) {
    if (!/^\d{1,4}$/.test(duration)) return { ok: false, reason: 'invalid' };
    const durationMin = Number(duration);
    if (durationMin < 1 || durationMin > MAX_SESSION_DURATION_MIN) {
      return { ok: false, reason: 'invalid' };
    }
    changes.durationMin = durationMin;
  }
  if (changes.startedAt === undefined && changes.durationMin === undefined) {
    return { ok: true, changes };
  }
  const window = resolveEditedWindow({
    startedAt: input.startedAt,
    finishedAt: input.finishedAt,
    newStartedAt: changes.startedAt,
    newDurationMin: changes.durationMin,
  });
  if (endsInFuture(window.finishedAt, input.now)) return { ok: false, reason: 'future' };
  return { ok: true, changes };
}
