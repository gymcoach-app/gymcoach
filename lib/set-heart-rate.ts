import { AVG_HR_MAX, AVG_HR_MIN, MAX_HR_MAX, MAX_HR_MIN } from '@/lib/cardio';

// ============================================================
// Heart rate per set from an attached watch file (issue #576)
// ============================================================
// Splits the heart rate samples of a watch recording over the sets of the
// session it is attached to. Pure: no DB, no clock.
//
// A set has no start time, only the moment it was logged (Set.completedAt,
// written once when the set is saved and never changed by a later edit). So
// the window of a set runs from the previous set's log time (the session
// start for the first set) to its own log time: the effort of the set plus
// the rest before it. A sample exactly on a boundary belongs to the set that
// was logged at that instant (start exclusive, end inclusive), except the
// session start, which is inclusive so the first sample of a recording that
// starts with the session is not lost.
//
// Where the result is stored: Set.watchAvgHr / Set.watchMaxHr, two columns
// only this feature writes. Set.avgHr / Set.maxHr stay what the user logged
// or imported on a cardio set, and stay the only heart rate the conditioning
// numbers read (lib/stats.ts, the coach conditioning block), so attaching or
// removing a file can never change them and removing the file clears exactly
// what the file wrote.

export interface HrSample {
  // Seconds from the start of the recording.
  t: number;
  // bpm.
  hr: number;
}

export interface LoggedSet {
  id: string;
  completedAt: Date;
}

export interface SetHeartRate {
  id: string;
  avgHr: number;
  maxHr: number;
}

export interface SplitHeartRateInput {
  sessionStartedAt: Date;
  recordingStartedAt: Date;
  samples: readonly HrSample[];
  sets: readonly LoggedSet[];
}

// One entry per set whose window holds at least one sample; a set whose
// window is empty (logged before the recording started, after it ended, in a
// gap of the recording, or at the same instant as the previous set) gets no
// entry. Neither input needs to be sorted. The result follows the log order
// of the sets.
export function splitHeartRateBySet(input: SplitHeartRateInput): SetHeartRate[] {
  const recordingStartMs = input.recordingStartedAt.getTime();
  const sessionStartMs = input.sessionStartedAt.getTime();
  if (!Number.isFinite(recordingStartMs) || !Number.isFinite(sessionStartMs)) return [];

  // Absolute time of every usable sample, ascending.
  const samples: Array<{ at: number; hr: number }> = [];
  for (const s of input.samples) {
    if (!Number.isFinite(s.t) || s.t < 0) continue;
    if (!Number.isFinite(s.hr) || s.hr < AVG_HR_MIN || s.hr > AVG_HR_MAX) continue;
    samples.push({ at: recordingStartMs + s.t * 1000, hr: s.hr });
  }
  samples.sort((a, b) => a.at - b.at);

  // Sets in log order. The sort is stable, so two sets logged at the same
  // instant keep the order they came in.
  const sets = input.sets
    .filter((set) => Number.isFinite(set.completedAt.getTime()))
    .slice()
    .sort((a, b) => a.completedAt.getTime() - b.completedAt.getTime());

  const out: SetHeartRate[] = [];
  let cursor = 0;
  // Skip what was recorded before the session started.
  while (cursor < samples.length && samples[cursor]!.at < sessionStartMs) cursor += 1;

  for (const set of sets) {
    const end = set.completedAt.getTime();
    let sum = 0;
    let count = 0;
    let peak = 0;
    while (cursor < samples.length && samples[cursor]!.at <= end) {
      const hr = samples[cursor]!.hr;
      sum += hr;
      count += 1;
      if (hr > peak) peak = hr;
      cursor += 1;
    }
    if (count === 0) continue;
    const avgHr = Math.round(sum / count);
    const maxHr = Math.round(peak);
    // Same bounds as every other heart rate column; the samples are already
    // inside them, so this only guards a caller that passed something else.
    if (avgHr < AVG_HR_MIN || avgHr > AVG_HR_MAX) continue;
    if (maxHr < MAX_HR_MIN || maxHr > MAX_HR_MAX) continue;
    out.push({ id: set.id, avgHr, maxHr });
  }
  return out;
}
