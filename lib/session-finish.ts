// When does a session end? (issue #571)
//
// Tapping Finish used to stamp `finishedAt` with the time of the tap. A user
// who forgets and taps it hours later (or the next morning) then gets a
// session that "lasted" all that time in the history, the stats and the coach
// payload. The rule below ends such a session at its last logged set instead.
//
// `lastSetAt` is the latest `Set.completedAt` of the session. That column is
// stamped by the server when the set is recorded, and the logger records a
// set once it is done: a strength set after its reps, a cardio set after the
// user typed the duration they just did. So for a cardio set too the
// timestamp marks the END of the effort and `durationSec` must not be added
// to it.
//
// Known limit: a set logged offline is stamped when the queue reaches the
// server, not when it was performed. The runner flushes that queue right
// before it finishes, so such a session ends "now", exactly as before.

/** A Finish tapped longer than this after the last set is a late one. */
export const LATE_FINISH_THRESHOLD_MS = 30 * 60 * 1000;

export interface FinishTimeInput {
  /** The time of the finish request. */
  now: Date;
  /** Session.startedAt. */
  startedAt: Date;
  /** Latest Set.completedAt of the session, null when it has no set. */
  lastSetAt: Date | null;
}

/**
 * The `finishedAt` to store when the user finishes a session:
 * - no set: now;
 * - last set at most LATE_FINISH_THRESHOLD_MS ago (or in the future, a clock
 *   quirk): now;
 * - last set older than that: the time of that set, never earlier than
 *   `startedAt`.
 */
export function resolveFinishedAt({ now, startedAt, lastSetAt }: FinishTimeInput): Date {
  if (!lastSetAt) return now;
  if (now.getTime() - lastSetAt.getTime() <= LATE_FINISH_THRESHOLD_MS) return now;
  return lastSetAt.getTime() < startedAt.getTime() ? startedAt : lastSetAt;
}
