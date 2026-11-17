import { NextResponse } from 'next/server';
import { z } from 'zod';
import { db } from '@/lib/db';
import { ApiError, handleApiError, parseJsonBody, requireApiUserId } from '@/lib/api';
import { rateLimit } from '@/lib/rate-limit';
import { aiParseSetWithFailure } from '@/lib/set-parse';
import { aiErrorResponse } from '@/lib/ai-error-response';

// Opt-in "Parse with AI" for free-text set logging (issue #210). Parses ONE set
// description into the form fields for the user to confirm - it NEVER logs a set
// and never auto-applies. The deterministic shorthand path is unaffected.
const bodySchema = z.object({
  exerciseId: z.string().min(1),
  // The free-text set description. Bounded so a giant blob cannot be sent to the
  // model; a single set needs only a short phrase.
  text: z.string().trim().min(1).max(500),
});

// POST /api/sets/parse -> { parsed: SetParseResult | null }. A null `parsed`
// (junk, refusal, out-of-range model output) is a normal 200 response, not an
// error: the client simply fills nothing and shows a hint. A provider call
// that failed (bad key, quota, outage, timeout) is a 5xx with
// { error, code, variable? } so the hint can say what to fix (issue #571).
export async function POST(req: Request) {
  try {
    const userId = await requireApiUserId();
    const rl = rateLimit(`set-parse:${userId}`, 20, 60_000);
    if (!rl.ok) {
      return NextResponse.json(
        { error: 'Too many parse requests. Please wait a moment.' },
        { status: 429, headers: { 'Retry-After': String(rl.retryAfterSec) } },
      );
    }

    const { exerciseId, text } = await parseJsonBody(req, bodySchema, {
      maxBytes: 4096,
    });

    // Ownership check: only parse against an exercise the user owns, and read
    // its category to tell the model which shape to return.
    const [exercise, user] = await Promise.all([
      db.exercise.findFirst({
        where: { id: exerciseId, userId },
        select: { name: true, category: true },
      }),
      db.user.findUnique({ where: { id: userId }, select: { unit: true } }),
    ]);
    if (!exercise) {
      throw new ApiError(404, 'Exercise not found.');
    }

    const { parsed, providerError } = await aiParseSetWithFailure(text, {
      exerciseName: exercise.name,
      kind: exercise.category === 'CARDIO' ? 'cardio' : 'strength',
      unit: user?.unit ?? 'KG',
    });

    if (providerError) return aiErrorResponse('set parse', providerError);
    return NextResponse.json({ parsed });
  } catch (err) {
    return handleApiError(err);
  }
}
