import { NextResponse } from 'next/server';
import { z } from 'zod';
import { handleApiError, parseJsonBody, requireApiUserId } from '@/lib/api';
import { LlmError } from '@/lib/llm';
import { aiErrorResponse } from '@/lib/ai-error-response';
import { rateLimit } from '@/lib/rate-limit';
import { generateProgram } from '@/lib/program-generation';

const bodySchema = z.object({
  goal: z
    .string()
    .trim()
    .min(10, 'Describe your goal in a bit more detail.')
    .max(2000),
});

// POST /api/programs/generate: returns a structured program draft for the
// user to preview and edit. Does not persist anything.
export async function POST(req: Request) {
  try {
    const userId = await requireApiUserId();
    const rl = rateLimit(`generate:${userId}`, 10, 60_000);
    if (!rl.ok) {
      return NextResponse.json(
        { error: 'Too many generations. Please wait a moment.' },
        { status: 429, headers: { 'Retry-After': String(rl.retryAfterSec) } },
      );
    }
    const { goal } = await parseJsonBody(req, bodySchema);
    const program = await generateProgram(userId, goal);
    return NextResponse.json({ program });
  } catch (err) {
    if (err instanceof LlmError) {
      return aiErrorResponse('program generation', err);
    }
    return handleApiError(err);
  }
}
