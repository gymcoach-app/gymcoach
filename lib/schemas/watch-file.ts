import { z } from 'zod';
import { AVG_HR_MAX, AVG_HR_MIN, MAX_DURATION_SEC, MAX_HR_MAX, MAX_HR_MIN } from '@/lib/cardio';
import { FIT_MAX_BYTES } from '@/lib/import/fit';
import { GPX_MAX_BYTES } from '@/lib/import/gpx';
import { TCX_MAX_BYTES } from '@/lib/import/tcx';
import { MAX_TRACK_POINTS } from '@/lib/import/track';

const TOO_LARGE = 'File too large: the limit is 5 MB.';

// "Attach a watch file" request (issue #562): one FIT, TCX or GPX recording
// attached to an existing session. Same per-format size caps as the cardio
// imports in lib/schemas/import.ts: FIT is binary and rides base64-encoded
// (cap scaled by the base64 inflation, the parser re-checks the decoded
// length), TCX and GPX are the raw file text. `mode` separates the read-only
// preview from the confirm that writes the heart rate on the session.
const mode = z.enum(['preview', 'confirm']);

export const watchFileInputSchema = z.discriminatedUnion('format', [
  z.object({
    format: z.literal('fit'),
    file: z
      .string()
      .min(1)
      .max(Math.ceil(FIT_MAX_BYTES * 1.4), TOO_LARGE),
    mode,
  }),
  z.object({
    format: z.literal('tcx'),
    file: z.string().min(1).max(TCX_MAX_BYTES, TOO_LARGE),
    mode,
  }),
  z.object({
    format: z.literal('gpx'),
    file: z.string().min(1).max(GPX_MAX_BYTES, TOO_LARGE),
    mode,
  }),
]);

export type WatchFileInputBody = z.infer<typeof watchFileInputSchema>;

// Bounds of the three Session heart rate columns, shared by every writer that
// does not go through lib/import/watch-file.ts (the backup import).
export const sessionAvgHrSchema = z.number().int().min(AVG_HR_MIN).max(AVG_HR_MAX);
export const sessionMaxHrSchema = z.number().int().min(MAX_HR_MIN).max(MAX_HR_MAX);
export const sessionHrTrackSchema = z
  .array(
    z.object({
      t: z.number().int().min(0).max(MAX_DURATION_SEC),
      hr: z.number().int().min(AVG_HR_MIN).max(AVG_HR_MAX),
    }),
  )
  .min(1)
  .max(MAX_TRACK_POINTS);
