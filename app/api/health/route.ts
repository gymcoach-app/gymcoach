import { NextResponse } from 'next/server';
import { isDatabaseHealthy } from '@/lib/health';

// Health probe for container healthchecks, reverse proxies and uptime monitors
// (issue #576). Public route (listed in middleware PUBLIC_PATHS): a probe has
// no session.
//
// The body is one of two fixed objects. It never carries an error message, a
// version, an environment value or any configuration, because anyone who can
// reach the instance can read it.

export const dynamic = 'force-dynamic';

const HEADERS = { 'Cache-Control': 'no-store' };

export async function GET() {
  if (await isDatabaseHealthy()) {
    return NextResponse.json({ status: 'ok' }, { headers: HEADERS });
  }
  return NextResponse.json({ status: 'unavailable' }, { status: 503, headers: HEADERS });
}
