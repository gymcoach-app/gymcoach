import { test, expect, type Page } from '@playwright/test';

// Supersets slice 1 (issue #146): pair two exercises in the program builder
// (A1/A2 labels), then run the workout - the session runner presents the pair
// consecutively with the superset badge, auto-advances A1 -> A2 after a set,
// and Next cycles back into the group while it has sets remaining. Setup data
// is seeded through the authenticated API (the browser context shares cookies
// with page.request).

async function seedPairableWorkout(
  page: Page,
  opts: { restSec?: number; namePrefix?: string; supersetGroup?: number } = {},
): Promise<{
  programId: string;
  workoutId: string;
}> {
  const restSec = opts.restSec ?? 15;
  const prefix = opts.namePrefix ?? 'E2E';
  const benchRes = await page.request.post('/api/exercises', {
    data: { name: `${prefix} Bench`, muscleGroup: 'CHEST', category: 'COMPOUND' },
  });
  expect(benchRes.ok()).toBeTruthy();
  const bench = await benchRes.json();

  const rowRes = await page.request.post('/api/exercises', {
    data: { name: `${prefix} Row`, muscleGroup: 'BACK_THICKNESS', category: 'COMPOUND' },
  });
  expect(rowRes.ok()).toBeTruthy();
  const row = await rowRes.json();

  const programRes = await page.request.post('/api/programs', {
    data: { name: `${prefix} Superset Program`, phase: 'Base' },
  });
  expect(programRes.ok()).toBeTruthy();
  const program = await programRes.json();

  const workoutRes = await page.request.post(`/api/programs/${program.id}/workouts`, {
    data: { name: 'Upper A' },
  });
  expect(workoutRes.ok()).toBeTruthy();
  const workout = await workoutRes.json();

  for (const exercise of [bench, row]) {
    const peRes = await page.request.post(`/api/workouts/${workout.id}/program-exercises`, {
      data: {
        exerciseId: exercise.id,
        targetSets: 2,
        targetRepsMin: 8,
        targetRepsMax: 12,
        targetRIR: 2,
        restSec,
        ...(opts.supersetGroup != null ? { supersetGroup: opts.supersetGroup } : {}),
      },
    });
    expect(peRes.ok()).toBeTruthy();
  }
  return { programId: program.id, workoutId: workout.id };
}

test('a lifter can pair two exercises as a superset and run the A1/A2 flow', async ({ page }) => {
  // Sign up through the API (fresh user; the cookie lands in the context). A
  // unique X-Forwarded-For keeps this spec in its own register rate-limit
  // bucket.
  const registerRes = await page.request.post('/api/auth/register', {
    headers: { 'x-forwarded-for': '10.111.0.4' },
    data: {
      displayName: 'Superset E2E',
      email: `e2e-superset-${Date.now()}@test.dev`,
      password: 'supersecret',
    },
  });
  expect(registerRes.ok()).toBeTruthy();

  const { programId, workoutId } = await seedPairableWorkout(page);

  // Builder: pair the second exercise with the previous one.
  await page.goto(`/programs/${programId}`);
  await expect(page.getByText('E2E Row')).toBeVisible();
  await page.getByRole('button', { name: 'Exercise actions' }).nth(1).click();
  await page.getByRole('menuitem', { name: 'Pair with previous' }).click();

  // Both rows now carry their derived superset labels.
  await expect(page.getByText('Superset A1')).toBeVisible();
  await expect(page.getByText('Superset A2')).toBeVisible();

  // Unpair would be offered too (pairing is reversible), but keep the pair.
  // Start a session on the workout.
  const sessionRes = await page.request.post('/api/sessions', {
    data: { workoutId },
  });
  expect(sessionRes.ok()).toBeTruthy();
  const session = await sessionRes.json();

  // Runner: A1 first, with the superset badge.
  await page.goto(`/session/${session.id}`);
  await expect(page.getByText('Superset A1')).toBeVisible();
  await expect(page.getByText(/Exercise 1\/2 · E2E Bench/)).toBeVisible();

  // Log a working set on A1. For a same-superset transition, the runner shows
  // A2 immediately while the short rest is still counting down so the lifter
  // can move into position; skipping rest must not navigate a second time.
  await page.getByLabel('Quick entry').fill('60x8@2');
  await page.getByRole('button', { name: /log the set/i }).click();
  await expect(page.getByTestId('rest-remaining')).toBeVisible();
  await expect(page.getByText('Superset A2')).toBeVisible();
  await expect(page.getByText(/Exercise 2\/2 · E2E Row/)).toBeVisible();
  await page.getByRole('button', { name: /skip/i }).click();
  await expect(page.getByText('Superset A2')).toBeVisible();
  await expect(page.getByText(/Exercise 2\/2 · E2E Row/)).toBeVisible();

  // Next from the last member cycles back into the group while sets remain.
  await page.getByRole('button', { name: /next/i }).click();
  await expect(page.getByText('Superset A1')).toBeVisible();
  await expect(page.getByText(/Exercise 1\/2 · E2E Bench/)).toBeVisible();
});

// Supersets slice 2 (issue #189): the rest between superset members is short
// (the transition rest), while the rest after the LAST member of the group -
// before the group repeats - is the full per-exercise rest. A full rest of 90s
// vs the 20s transition makes the two unmistakable on the timer.
test('a superset gives a short rest between members and a full rest after the group', async ({
  page,
}) => {
  const registerRes = await page.request.post('/api/auth/register', {
    headers: { 'x-forwarded-for': '10.111.0.5' },
    data: {
      displayName: 'Superset Rest E2E',
      email: `e2e-superset-rest-${Date.now()}@test.dev`,
      password: 'supersecret',
    },
  });
  expect(registerRes.ok()).toBeTruthy();

  const { workoutId } = await seedPairableWorkout(page, {
    restSec: 90,
    namePrefix: 'Rest',
    supersetGroup: 1, // both members paired up front
  });

  const sessionRes = await page.request.post('/api/sessions', {
    data: { workoutId },
  });
  expect(sessionRes.ok()).toBeTruthy();
  const session = await sessionRes.json();

  await page.goto(`/session/${session.id}`);
  await expect(page.getByText('Superset A1')).toBeVisible();

  // Reads the big countdown number on the rest timer.
  const restValue = page.getByTestId('rest-remaining');

  // Each member targets 2 sets. While ANY member of the group still owes a set,
  // logging a member starts a SHORT transition rest (<= 20s) and alternates
  // A1 <-> A2. Only after the very last set of the group (group complete) does
  // the FULL per-exercise rest (here 90s, > 20) run before the group repeats.

  // A1 set 1 -> transition (A2 still owes sets).
  await page.getByLabel('Quick entry').fill('60x8@2');
  await page.getByRole('button', { name: /log the set/i }).click();
  await expect(restValue).toBeVisible();
  expect(Number(await restValue.textContent())).toBeLessThanOrEqual(20);
  await page.getByRole('button', { name: /skip/i }).click();
  await expect(page.getByText('Superset A2')).toBeVisible();

  // A2 set 1 -> transition (A1 still owes its 2nd set).
  await page.getByLabel('Quick entry').fill('50x10@2');
  await page.getByRole('button', { name: /log the set/i }).click();
  await expect(restValue).toBeVisible();
  expect(Number(await restValue.textContent())).toBeLessThanOrEqual(20);
  await page.getByRole('button', { name: /skip/i }).click();
  await expect(page.getByText('Superset A1')).toBeVisible();

  // A1 set 2 -> transition (A2 still owes its 2nd set).
  await page.getByLabel('Quick entry').fill('60x8@2');
  await page.getByRole('button', { name: /log the set/i }).click();
  await expect(restValue).toBeVisible();
  expect(Number(await restValue.textContent())).toBeLessThanOrEqual(20);
  await page.getByRole('button', { name: /skip/i }).click();
  await expect(page.getByText('Superset A2')).toBeVisible();

  // A2 set 2 -> group complete: the FULL rest runs (> 20s) before the repeat.
  await page.getByLabel('Quick entry').fill('50x10@2');
  await page.getByRole('button', { name: /log the set/i }).click();
  await expect(restValue).toBeVisible();
  expect(Number(await restValue.textContent())).toBeGreaterThan(20);

  // Rest controls (issue #393): a paused rest holds its time, +15 s adds to
  // it while paused, and resuming brings the countdown back.
  await page.getByRole('button', { name: 'Pause' }).click();
  await expect(page.getByText('Rest paused')).toBeVisible();
  const pausedAt = Number(await restValue.textContent());
  // A still-running countdown would have moved on by the time +15 s lands,
  // so the exact sum proves the paused rest held its time.
  await page.getByRole('button', { name: 'Add 15 seconds' }).click();
  await expect(restValue).toHaveText(String(pausedAt + 15));
  await page.getByRole('button', { name: 'Resume' }).click();
  await expect(page.getByRole('button', { name: 'Pause' })).toBeVisible();
});

test('allows switching between exercises during rest (issue #542)', async ({
  page,
}) => {
  const registerRes = await page.request.post('/api/auth/register', {
    headers: { 'x-forwarded-for': '10.111.0.10' },
    data: {
      displayName: 'Switch E2E',
      email: `e2e-switch-${Date.now()}@test.dev`,
      password: 'supersecret',
    },
  });
  expect(registerRes.ok()).toBeTruthy();

  // Create superset + third exercise
  const { programId, workoutId } = await seedPairableWorkout(page, {
    namePrefix: 'Switch',
    restSec: 30,
  });

  // Add third exercise
  const ex3Res = await page.request.post('/api/exercises', {
    data: { name: 'Switch Squat', muscleGroup: 'QUADS', category: 'COMPOUND' },
  });
  expect(ex3Res.ok()).toBeTruthy();
  const ex3 = await ex3Res.json();

  const pe3Res = await page.request.post(`/api/workouts/${workoutId}/program-exercises`, {
    data: {
      exerciseId: ex3.id,
      targetSets: 2,
      targetRepsMin: 8,
      targetRepsMax: 12,
      targetRIR: 2,
      restSec: 30,
    },
  });
  expect(pe3Res.ok()).toBeTruthy();

  // Pair first two as superset via UI
  await page.goto(`/programs/${programId}`);
  await page.getByRole('button', { name: 'Exercise actions' }).nth(1).click();
  await page.getByRole('menuitem', { name: /pair.*previous/i }).click();

  // Start session via API
  const sessionRes = await page.request.post('/api/sessions', {
    data: { workoutId },
  });
  expect(sessionRes.ok()).toBeTruthy();
  const session = await sessionRes.json();

  await page.goto(`/session/${session.id}`);

  // Log set on A1 -> transition rest, auto-navigate to A2
  await page.getByLabel('Quick entry').fill('100x8@2');
  await page.getByRole('button', { name: /log the set/i }).click();

  // Wait for rest timer to start and verify we're on A2
  await expect(page.getByTestId('rest-remaining')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Switch Row' })).toBeVisible();

  // Switch back to A1 - should show rest timer, not input
  await page.getByRole('button', { name: /1\. Switch Bench/ }).click();
  await expect(page.getByRole('heading', { name: 'Switch Bench' })).toBeVisible();
  await expect(page.getByTestId('rest-timer')).toBeVisible();

  // Switch to third exercise - should show input (not resting)
  await page.getByRole('button', { name: /3\. Switch Squat/ }).click();
  await expect(page.getByRole('heading', { name: 'Switch Squat' })).toBeVisible();
  await expect(page.getByLabel('Quick entry')).toBeVisible();

  // Switch back to A2 - rest timer should still be running
  await page.getByRole('button', { name: /2\. Switch Row/ }).click();
  await expect(page.getByRole('heading', { name: 'Switch Row' })).toBeVisible();
  await expect(page.getByTestId('rest-timer')).toBeVisible();
});

test('superset partner resting blocks input and shares timer (issue #542 edge case)', async ({
  page,
}) => {
  const registerRes = await page.request.post('/api/auth/register', {
    headers: { 'x-forwarded-for': '10.111.0.11' },
    data: {
      displayName: 'Edge Case E2E',
      email: `e2e-edge-case-${Date.now()}@test.dev`,
      password: 'supersecret',
    },
  });
  expect(registerRes.ok()).toBeTruthy();

  const { programId, workoutId } = await seedPairableWorkout(page, {
    namePrefix: 'Edge',
    restSec: 30,
  });

  // Pair as superset via UI
  await page.goto(`/programs/${programId}`);
  await page.getByRole('button', { name: 'Exercise actions' }).nth(1).click();
  await page.getByRole('menuitem', { name: /pair.*previous/i }).click();

  // Start session via API
  const sessionRes = await page.request.post('/api/sessions', {
    data: { workoutId },
  });
  expect(sessionRes.ok()).toBeTruthy();
  const session = await sessionRes.json();

  await page.goto(`/session/${session.id}`);

  // Log first set on A1
  await page.getByLabel('Quick entry').fill('100x8@2');
  await page.getByRole('button', { name: /log the set/i }).click();
  await page.getByRole('button', { name: /skip/i }).click();

  // Log first set on A2 - A2 starts resting
  await page.getByLabel('Quick entry').fill('50x12@2');
  await page.getByRole('button', { name: /log the set/i }).click();

  // Wait for rest timer to start
  await expect(page.getByTestId('rest-remaining')).toBeVisible();
  const restValue = page.getByTestId('rest-remaining');

  // Switch to A1 - should show RestTimer (not SetInput) because A2 is resting
  await page.getByRole('button', { name: /1\. Edge Bench/ }).click();
  await expect(page.getByRole('heading', { name: 'Edge Bench' })).toBeVisible();
  await expect(page.getByTestId('rest-timer')).toBeVisible();
  await expect(page.getByLabel('Quick entry')).not.toBeVisible();
});

