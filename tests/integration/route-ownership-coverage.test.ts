import { describe, it, expect } from 'vitest';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';

// Ratchet for issues #317 and #323: every API route that addresses a resource
// the caller does not own by construction must be referenced by an
// ownership-aware integration test, so such a route cannot ship without a
// cross-user case and an existing one cannot silently lose its coverage.
//
// Two families are covered:
// - PARAMETERIZED routes, matched on any `[param]` path segment rather than
//   the literal `[id]`, so a future `[gymId]`-style segment cannot escape.
// - BODY-ADDRESSED routes, which take someone's resource id in the request
//   body and are invisible to any path-based glob; they are enumerated below
//   because only a human can tell that a payload field is a resource id.
//
// This test needs no database; it only reads the tree.

const ROOT = process.cwd();
const API_DIR = join(ROOT, 'app', 'api');
const OWNERSHIP_SUITE = 'tests/integration/route-ownership.test.ts';

// Routes whose cross-user coverage lives in a dedicated suite instead of the
// main ownership suite. The mapped file must exist AND reference the route;
// the quality of its cross-user assertions is review's job.
const COVERED_ELSEWHERE: Record<string, string> = {
  'app/api/bodyweight/[id]/route.ts': 'tests/integration/bodyweight-route.test.ts',
  'app/api/goals/[id]/route.ts': 'tests/integration/goals-route.test.ts',
  'app/api/measurements/[id]/route.ts': 'tests/integration/measurements-route.test.ts',
  'app/api/gym-equipment/[id]/route.ts': 'tests/integration/gym-equipment-api.test.ts',
  'app/api/gym-equipment/[id]/image/route.ts': 'tests/integration/gym-equipment-api.test.ts',
  'app/api/gym-equipment/[id]/weights/route.ts':
    'tests/integration/gym-equipment-weights-api.test.ts',
  'app/api/gyms/[id]/equipment/route.ts': 'tests/integration/gym-equipment-api.test.ts',
  'app/api/progress-photos/[id]/route.ts': 'tests/integration/progress-photos-route.test.ts',
  'app/api/progress-photos/[id]/image/route.ts': 'tests/integration/progress-photos-route.test.ts',
  'app/api/goals/route.ts': 'tests/integration/goals-route.test.ts',
  'app/api/programs/[id]/duplicate/route.ts': 'tests/integration/program-copy.test.ts',
  'app/api/workouts/[id]/duplicate/route.ts': 'tests/integration/program-copy.test.ts',
  // Also body-addressed: the target programId is checked there too.
  'app/api/sessions/[id]/save-as-workout/route.ts': 'tests/integration/program-copy.test.ts',
};

// Routes that take a resource id in the request body AND are not already
// matched by the parameterized glob above - listing a parameterized route
// here would only duplicate an it.each name. So a body-addressed route on a
// `[param]` path (gyms/[id]/equipment, sessions/[id]/sets) belongs above, not
// here. Add an entry when a new NON-parameterized route accepts someone's id
// in its payload; the ratchet cannot infer these.
const BODY_ADDRESSED_ROUTES: string[] = [
  'app/api/sessions/route.ts', // workoutId
  'app/api/goals/route.ts', // exerciseId
  'app/api/sets/parse/route.ts', // exerciseId
  'app/api/coach/chat/route.ts', // conversationId
  'app/api/gyms/route.ts', // exerciseConfigs[].exerciseId
];

function findParameterizedRoutes(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...findParameterizedRoutes(full));
    } else if (entry.name === 'route.ts' && /\[[^\]]+\]/.test(relative(ROOT, full))) {
      out.push(relative(ROOT, full));
    }
  }
  return out;
}

function assertCovered(routePath: string, ownershipSource: string): void {
  // Import specifiers drop the .ts extension.
  const specifier = routePath.replace(/\.ts$/, '');
  if (ownershipSource.includes(specifier)) return;
  const mapped = COVERED_ELSEWHERE[routePath];
  if (!mapped) {
    throw new Error(
      `${routePath} is not referenced by ${OWNERSHIP_SUITE} and has no ` +
        `COVERED_ELSEWHERE entry. Add a cross-user case for it (or map its ` +
        `dedicated suite here).`,
    );
  }
  const mappedSource = readFileSync(join(ROOT, mapped), 'utf8');
  expect(
    mappedSource.includes(specifier),
    `${mapped} no longer references ${routePath}; its coverage claim is stale.`,
  ).toBe(true);
}

describe('ownership-test coverage ratchet (issues #317, #323)', () => {
  const parameterizedRoutes = findParameterizedRoutes(API_DIR);
  const ownershipSource = readFileSync(join(ROOT, OWNERSHIP_SUITE), 'utf8');

  it('finds the parameterized routes (sanity: the glob is not silently empty)', () => {
    expect(parameterizedRoutes.length).toBeGreaterThanOrEqual(10);
  });

  it.each(parameterizedRoutes)('%s is referenced by an ownership-aware test', (routePath) => {
    assertCovered(routePath, ownershipSource);
  });

  it.each(BODY_ADDRESSED_ROUTES)('%s is referenced by an ownership-aware test', (routePath) => {
    assertCovered(routePath, ownershipSource);
  });

  it('lists only body-addressed routes that exist', () => {
    for (const routePath of BODY_ADDRESSED_ROUTES) {
      // existsSync, not readFileSync: a missing file must produce this
      // message rather than a raw ENOENT.
      expect(
        existsSync(join(ROOT, routePath)),
        `${routePath} is listed as body-addressed but is missing; the list is stale.`,
      ).toBe(true);
    }
  });
});
