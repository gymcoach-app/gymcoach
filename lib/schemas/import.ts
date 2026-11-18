import { z } from 'zod';
import { STRONG_CSV_MAX_BYTES } from '@/lib/import/strong-csv';
import { TCX_MAX_BYTES } from '@/lib/import/tcx';
import { GPX_MAX_BYTES } from '@/lib/import/gpx';
import { FIT_MAX_BYTES } from '@/lib/import/fit';
import {
  APPLE_HEALTH_FUTURE_SLACK_MS,
  APPLE_HEALTH_MAX_UTC_OFFSET_MIN,
  APPLE_HEALTH_MIN_DATE,
  isAppleHealthStrengthType,
} from '@/lib/import/apple-health';
import {
  AVG_HR_MAX,
  AVG_HR_MIN,
  MAX_DISTANCE_M,
  MAX_DURATION_SEC,
  MAX_HR_MAX,
  MAX_HR_MIN,
} from '@/lib/cardio';
import { bodyweightKgSchema } from '@/lib/schemas/bodyweight';

// Strong CSV import request (issue #100). The csv field carries the raw file
// text (untrusted): the size cap is enforced here AND on the content-length
// before parsing. `unit` is the unit the Strong app was set to when exporting
// (a unit suffix in the CSV header overrides it); `mode` separates the
// read-only dry-run preview from the transactional confirm.
export const strongImportInputSchema = z.object({
  csv: z.string().min(1).max(STRONG_CSV_MAX_BYTES, 'File too large: the limit is 5 MB.'),
  unit: z.enum(['KG', 'LB']).default('KG'),
  mode: z.enum(['preview', 'confirm']),
});

export type StrongImportInput = z.infer<typeof strongImportInputSchema>;

// Hevy CSV import request (issue #113). Same cap and modes; no unit field -
// Hevy exports weight in kg (the lbs header variant is converted by the
// parser, not chosen by the user).
export const hevyImportInputSchema = z.object({
  csv: z.string().min(1).max(STRONG_CSV_MAX_BYTES, 'File too large: the limit is 5 MB.'),
  mode: z.enum(['preview', 'confirm']),
});

export type HevyImportInput = z.infer<typeof hevyImportInputSchema>;

// GymCoach native CSV import request (issue #270): the history CSV export fed
// back in. Same cap and modes; no unit field - the export stores weight in kg.
export const gymcoachImportInputSchema = z.object({
  csv: z.string().min(1).max(STRONG_CSV_MAX_BYTES, 'File too large: the limit is 5 MB.'),
  mode: z.enum(['preview', 'confirm']),
});

export type GymcoachImportInput = z.infer<typeof gymcoachImportInputSchema>;

// TCX cardio import request (issue #152). The xml field carries the raw file
// text (untrusted XML - the parser refuses DTDs/entities by construction and
// the size cap is enforced here AND on the streamed body read); same
// preview/confirm modes as the CSV imports.
export const tcxImportInputSchema = z.object({
  xml: z.string().min(1).max(TCX_MAX_BYTES, 'File too large: the limit is 5 MB.'),
  mode: z.enum(['preview', 'confirm']),
});

export type TcxImportInput = z.infer<typeof tcxImportInputSchema>;

// GPX track import request (issue #204). The gpx field carries the raw file
// text (untrusted XML - lib/import/gpx.ts refuses DTDs/entities by
// construction, caps the trackpoint count, and the size cap is enforced here
// AND on the streamed body read); same preview/confirm modes as the others.
export const gpxImportInputSchema = z.object({
  gpx: z.string().min(1).max(GPX_MAX_BYTES, 'File too large: the limit is 5 MB.'),
  mode: z.enum(['preview', 'confirm']),
});

export type GpxImportInput = z.infer<typeof gpxImportInputSchema>;

// FIT activity import request (issue #249). FIT is a BINARY format, so each file
// is carried base64-encoded; the route decodes it to bytes for the parser.
// Base64 inflates by ~4/3, so the per-file string cap is the byte cap scaled up
// (the parser re-checks the decoded length against FIT_MAX_BYTES).
//
// A single file rides in `fit` (the original contract, kept for compatibility);
// a batch (issue #253, "import my whole watch history") rides in `fits`, capped
// at FIT_MAX_BATCH files. At least one of the two must be present; if both are
// sent the route takes the batch path (`fits` wins). Same preview/confirm modes
// as the other imports.
export const FIT_MAX_BATCH = 50;
const fitFileString = z
  .string()
  .min(1)
  .max(Math.ceil(FIT_MAX_BYTES * 1.4), 'File too large: the limit is 5 MB.');

export const fitImportInputSchema = z
  .object({
    fit: fitFileString.optional(),
    fits: z.array(fitFileString).min(1).max(FIT_MAX_BATCH).optional(),
    mode: z.enum(['preview', 'confirm']),
  })
  .refine((d) => d.fit !== undefined || d.fits !== undefined, {
    message: 'Provide a FIT file.',
  });

export type FitImportInput = z.infer<typeof fitImportInputSchema>;

// Apple Health import request (issue #582). The export itself (hundreds of MB)
// never reaches the server: the browser streams it through
// lib/import/apple-health.ts and posts only compact activity summaries, in
// batches. Everything here is untrusted all the same, so every field is
// re-validated with the bounds of the cardio set contract and of the
// bodyweight log. A strength-type workout is refused: the client skips those,
// and the route must not be a way around that rule.
//
// 500 workouts a request rather than fewer: every request costs one charge of
// the shared import rate bucket (10 a minute), so the batch size is what
// decides how long a multi-year history takes.
export const APPLE_HEALTH_MAX_WORKOUTS_PER_REQUEST = 500;
export const APPLE_HEALTH_MAX_BODY_MASS_PER_REQUEST = 1000;

const appleHealthInstant = z
  .string()
  .datetime({ message: 'Invalid date.' })
  .transform((s) => new Date(s))
  .refine(
    (d) =>
      d.getTime() >= APPLE_HEALTH_MIN_DATE.getTime() &&
      d.getTime() <= Date.now() + APPLE_HEALTH_FUTURE_SLACK_MS,
    'Date out of range.',
  );

const appleHealthWorkoutSchema = z.object({
  activityType: z
    .string()
    .regex(/^[A-Za-z0-9]{1,60}$/, 'Invalid activity type.')
    .refine((t) => !isAppleHealthStrengthType(t), 'Strength workouts are not imported.'),
  startedAt: appleHealthInstant,
  durationSec: z.number().int().min(1).max(MAX_DURATION_SEC),
  distanceM: z.number().positive().max(MAX_DISTANCE_M).nullable(),
  avgHr: z.number().int().min(AVG_HR_MIN).max(AVG_HR_MAX).nullable(),
  maxHr: z.number().int().min(MAX_HR_MIN).max(MAX_HR_MAX).nullable(),
});

const appleHealthBodyMassSchema = z.object({
  measuredAt: appleHealthInstant,
  weightKg: bodyweightKgSchema,
  // The UTC offset of the Apple timestamp, minutes east of UTC: it sets the
  // local day the "one entry per day" rule uses. Absent means UTC.
  utcOffsetMin: z
    .number()
    .int()
    .min(-APPLE_HEALTH_MAX_UTC_OFFSET_MIN)
    .max(APPLE_HEALTH_MAX_UTC_OFFSET_MIN)
    .default(0),
});

export const appleHealthImportInputSchema = z
  .object({
    mode: z.enum(['preview', 'confirm']),
    workouts: z
      .array(appleHealthWorkoutSchema)
      .max(APPLE_HEALTH_MAX_WORKOUTS_PER_REQUEST)
      .default([]),
    bodyMass: z
      .array(appleHealthBodyMassSchema)
      .max(APPLE_HEALTH_MAX_BODY_MASS_PER_REQUEST)
      .default([]),
  })
  .refine((d) => d.workouts.length > 0 || d.bodyMass.length > 0, {
    message: 'Nothing to import.',
  });

export type AppleHealthImportInput = z.infer<typeof appleHealthImportInputSchema>;
