import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import bcrypt from 'bcrypt';
import { db } from '@/lib/db';
import { signSession, SESSION_COOKIE, SESSION_COOKIE_OPTIONS } from '@/lib/auth';
import { registerSchema } from '@/lib/schemas/auth';
import { seedExerciseCatalog } from '@/lib/exercise-catalog';
import { rateLimit, clientIp } from '@/lib/rate-limit';
import { ApiError, readJsonWithCap, SMALL_JSON_BODY_MAX_BYTES } from '@/lib/api';

// POST /api/auth/register: creates an account, seeds the default exercise
// catalog for it, and signs the user in. Public route (see middleware).
export async function POST(req: Request) {
  try {
    const rl = rateLimit(`register:${clientIp(req)}`, 5, 60_000);
    if (!rl.ok) {
      return NextResponse.json(
        { error: 'Too many attempts. Please try again later.' },
        { status: 429, headers: { 'Retry-After': String(rl.retryAfterSec) } },
      );
    }

    // Invalid JSON reads as no body, so the schema answers with its 400.
    const body = await readJsonWithCap(req, SMALL_JSON_BODY_MAX_BYTES).catch((err: unknown) => {
      if (err instanceof ApiError && err.status === 413) throw err;
      return null;
    });
    const parsed = registerSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message ?? 'Invalid input.' },
        { status: 400 },
      );
    }

    const { email, password, displayName } = parsed.data;
    const existing = await db.user.findUnique({ where: { email } });
    if (existing) {
      return NextResponse.json(
        { error: 'An account with this email already exists.' },
        { status: 409 },
      );
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const user = await db.user.create({
      data: { email, passwordHash, displayName: displayName ?? null },
    });

    // Give the new account a starter catalog so the app is not empty.
    await seedExerciseCatalog(db, user.id);

    const token = await signSession({ userId: user.id, email: user.email });
    (await cookies()).set(SESSION_COOKIE, token, SESSION_COOKIE_OPTIONS);

    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof ApiError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    console.error('[register] error:', err);
    return NextResponse.json({ error: 'Server error.' }, { status: 500 });
  }
}
