// How close an existing session's start has to be to count as a likely
// duplicate of an imported activity. Same window for every cardio import, on
// the server (lib/import/cardio-session.ts) and in the browser (the Apple
// Health preview). Pure: no database, safe in a client bundle.
export const IMPORT_DUPLICATE_WINDOW_MS = 2 * 60 * 1000;

// True when one of `starts` (epoch ms, any order) lies within the duplicate
// window of `at`.
export function hasStartNear(starts: readonly number[], at: number): boolean {
  for (const s of starts) {
    if (Math.abs(s - at) <= IMPORT_DUPLICATE_WINDOW_MS) return true;
  }
  return false;
}
