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

/** Earliest instant a session may start at (the history calendar starts in 1970). */
export const MIN_SESSION_START_MS = 0;

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
 * The end of an edited session. The form shows the duration in whole minutes,
 * so a form saved without touching that field (the stored duration still
 * rounds to the submitted minutes) keeps the stored duration to the
 * millisecond: moving a session to another day never trims its last seconds.
 */
export function resolveEditedFinish(input: {
  oldStartedAt: Date;
  oldFinishedAt: Date;
  newStartedAt: Date;
  durationMin: number;
}): Date {
  const storedMs = input.oldFinishedAt.getTime() - input.oldStartedAt.getTime();
  const unchanged = storedMs > 0 && Math.round(storedMs / MINUTE_MS) === input.durationMin;
  return new Date(input.newStartedAt.getTime() + (unchanged ? storedMs : input.durationMin * MINUTE_MS));
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
  const low = Math.min(0, ...offsets);
  const high = Math.max(windowMs, ...offsets);
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
