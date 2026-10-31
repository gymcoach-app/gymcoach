import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import bcrypt from 'bcrypt';
import { z } from 'zod';
import { db } from '@/lib/db';
import { signSession, SESSION_COOKIE, SESSION_COOKIE_OPTIONS } from '@/lib/auth';
import { rateLimit, clientIp } from '@/lib/rate-limit';
import { ApiError, readJsonWithCap, SMALL_JSON_BODY_MAX_BYTES } from '@/lib/api';

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

export async function POST(req: Request) {
  try {
    const rl = rateLimit(`login:${clientIp(req)}`, 10, 60_000);
    if (!rl.ok) {
      return NextResponse.json(
        { error: 'Too many attempts. Please try again later.' },
        { status: 429, headers: { 'Retry-After': String(rl.retryAfterSec) } },
      );
    }
    const body = await readJsonWithCap(req, SMALL_JSON_BODY_MAX_BYTES);
    const parsed = loginSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid email or password.' }, { status: 400 });
    }

    const { email, password } = parsed.data;
    const user = await db.user.findUnique({ where: { email } });

    // Message intentionally identical for an unknown user and a wrong password
    // (avoids email enumeration, even though we only have 1 user).
    const invalid = NextResponse.json(
      { error: 'Invalid credentials.' },
      { status: 401 },
    );

    if (!user) return invalid;
    const ok = await bcrypt.compare(password, user.passwordHash);
    if (!ok) return invalid;

    const token = await signSession({ userId: user.id, email: user.email });
    (await cookies()).set(SESSION_COOKIE, token, SESSION_COOKIE_OPTIONS);

    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof ApiError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    console.error('[login] error:', err);
    return NextResponse.json({ error: 'Server error.' }, { status: 500 });
  }
}
