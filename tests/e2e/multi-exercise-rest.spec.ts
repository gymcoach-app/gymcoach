import { test, expect, type Page } from '@playwright/test';

// Multi-exercise independent rest timers (issue #542, PR1): each exercise tracks
// its own rest timer independently. Switching between exercises preserves all
// timers, they continue running in the background, and visual indicators show
// which exercises are resting.

// Dedicated IP for this spec's register rate limit bucket.
test.use({ extraHTTPHeaders: { 'x-forwarded-for': '10.111.2.1' } });

async function seedMultiExerciseSession(
  page: Page,
): Promise<{
  sessionId: string;
  exercises: Array<{ name: string; id: string }>;
}> {
  // Create 3 exercises
  const ex1Res = await page.request.post('/api/exercises', {
    data: { name: 'E2E Multi Ex 1', muscleGroup: 'CHEST', category: 'COMPOUND' },
  });
  expect(ex1Res.ok()).toBeTruthy();
  const ex1 = await ex1Res.json();

  const ex2Res = await page.request.post('/api/exercises', {
    data: { name: 'E2E Multi Ex 2', muscleGroup: 'BACK_THICKNESS', category: 'COMPOUND' },
  });
  expect(ex2Res.ok()).toBeTruthy();
  const ex2 = await ex2Res.json();

  const ex3Res = await page.request.post('/api/exercises', {
    data: { name: 'E2E Multi Ex 3', muscleGroup: 'QUADS', category: 'COMPOUND' },
  });
  expect(ex3Res.ok()).toBeTruthy();
  const ex3 = await ex3Res.json();

  // Create program and workout
  const programRes = await page.request.post('/api/programs', {
    data: { name: 'E2E Multi Rest Program', phase: 'Base' },
  });
  expect(programRes.ok()).toBeTruthy();
  const program = await programRes.json();

  const workoutRes = await page.request.post(`/api/programs/${program.id}/workouts`, {
    data: { name: 'Multi Test' },
  });
  expect(workoutRes.ok()).toBeTruthy();
  const workout = await workoutRes.json();

  // Add all exercises with 15-second rest
  for (const exercise of [ex1, ex2, ex3]) {
    const peRes = await page.request.post(`/api/workouts/${workout.id}/program-exercises`, {
      data: {
        exerciseId: exercise.id,
        targetSets: 2,
        targetRepsMin: 8,
        targetRepsMax: 12,
        targetRIR: 2,
        restSec: 15,
      },
    });
    expect(peRes.ok()).toBeTruthy();
  }

  // Start session
  const sessionRes = await page.request.post('/api/sessions', {
    data: { workoutId: workout.id },
  });
  expect(sessionRes.ok()).toBeTruthy();
  const session = await sessionRes.json();

  return {
    sessionId: session.id,
    exercises: [ex1, ex2, ex3],
  };
}

test('switches between exercises preserving rest timers', async ({ page }) => {
  // Sign up through API
  const registerRes = await page.request.post('/api/auth/register', {
    headers: { 'x-forwarded-for': '10.111.2.1' },
    data: {
      displayName: 'Multi Rest E2E',
      email: `e2e-multi-rest-${Date.now()}@test.dev`,
      password: 'supersecret',
    },
  });
  expect(registerRes.ok()).toBeTruthy();

  const { sessionId, exercises } = await seedMultiExerciseSession(page);

  // Navigate to session
  await page.goto(`/session/${sessionId}`);
  await expect(page.getByRole('heading', { name: 'E2E Multi Ex 1' })).toBeVisible();

  // Log set on exercise 1 to trigger rest
  await page.getByLabel('Quick entry').fill('100x10@2');
  await page.getByRole('button', { name: /log the set/i }).click();

  // Wait for rest timer to appear
  await expect(page.locator('[data-testid="rest-timer"]')).toBeVisible({ timeout: 3000 });

  // Get initial remaining time (should be around 15 seconds)
  const initialTimeText = await page.locator('[data-testid="rest-remaining"]').textContent();
  expect(initialTimeText).toBeTruthy();
  const initialSeconds = parseInt(initialTimeText!);
  expect(initialSeconds).toBeGreaterThanOrEqual(13);
  expect(initialSeconds).toBeLessThanOrEqual(15);

  // Wait 5 seconds
  await page.waitForTimeout(5000);

  // Switch to exercise 2 via strip (find by aria-label containing "2.")
  const ex2Button = page.locator('[role="button"][aria-label*="2. E2E Multi Ex 2"]');
  await ex2Button.click();

  // Verify we switched to exercise 2 (quick entry visible, no rest timer)
  await expect(page.getByRole('heading', { name: 'E2E Multi Ex 2' })).toBeVisible();
  await expect(page.getByLabel('Quick entry')).toBeVisible();
  await expect(page.locator('[data-testid="rest-timer"]')).not.toBeVisible();

  // Verify exercise 1 has timer badge on strip showing remaining time
  const ex1Badge = page.locator('[role="button"][aria-label*="1. E2E Multi Ex 1"]');
  await expect(ex1Badge.locator('[data-testid="exercise-strip-timer-badge"]')).toBeVisible();

  // Log set on exercise 2
  await page.getByLabel('Quick entry').fill('50x12@2');
  await page.getByRole('button', { name: /log the set/i }).click();

  // Verify rest timer appears for exercise 2
  await expect(page.locator('[data-testid="rest-timer"]')).toBeVisible({ timeout: 3000 });

  // Wait 3 more seconds (total 8 seconds elapsed on ex 1)
  await page.waitForTimeout(3000);

  // Switch back to exercise 1
  const ex1Button = page.locator('[role="button"][aria-label*="1. E2E Multi Ex 1"]');
  await ex1Button.click();

  // Verify rest timer shows for exercise 1 with reduced time
  await expect(page.locator('[data-testid="rest-timer"]')).toBeVisible();
  const laterTimeText = await page.locator('[data-testid="rest-remaining"]').textContent();
  expect(laterTimeText).toBeTruthy();
  const laterSeconds = parseInt(laterTimeText!);

  // Should have lost at least 7 seconds (allowing 1s margin)
  expect(laterSeconds).toBeLessThan(initialSeconds - 7);
  expect(laterSeconds).toBeGreaterThan(0);

  // Verify exercise 2 still has timer badge on strip
  const ex2Badge = page.locator('[role="button"][aria-label*="2. E2E Multi Ex 2"]');
  await expect(ex2Badge.locator('text=/⏱️/')).toBeVisible();
});

test('does not auto-navigate when timer expires on non-viewed exercise', async ({ page }) => {
  // Sign up through API
  const registerRes = await page.request.post('/api/auth/register', {
    headers: { 'x-forwarded-for': '10.111.2.1' },
    data: {
      displayName: 'No Auto Nav E2E',
      email: `e2e-no-auto-nav-${Date.now()}@test.dev`,
      password: 'supersecret',
    },
  });
  expect(registerRes.ok()).toBeTruthy();

  // Create session with 2 exercises, 15-second rest
  const ex1Res = await page.request.post('/api/exercises', {
    data: { name: 'E2E Auto Nav Ex 1', muscleGroup: 'CHEST', category: 'COMPOUND' },
  });
  expect(ex1Res.ok()).toBeTruthy();
  const ex1 = await ex1Res.json();

  const ex2Res = await page.request.post('/api/exercises', {
    data: { name: 'E2E Auto Nav Ex 2', muscleGroup: 'BACK_THICKNESS', category: 'COMPOUND' },
  });
  expect(ex2Res.ok()).toBeTruthy();
  const ex2 = await ex2Res.json();

  const programRes = await page.request.post('/api/programs', {
    data: { name: 'E2E Auto Nav Program', phase: 'Base' },
  });
  expect(programRes.ok()).toBeTruthy();
  const program = await programRes.json();

  const workoutRes = await page.request.post(`/api/programs/${program.id}/workouts`, {
    data: { name: 'Auto Nav Test' },
  });
  expect(workoutRes.ok()).toBeTruthy();
  const workout = await workoutRes.json();

  for (const exercise of [ex1, ex2]) {
    const peRes = await page.request.post(`/api/workouts/${workout.id}/program-exercises`, {
      data: {
        exerciseId: exercise.id,
        targetSets: 2,
        targetRepsMin: 8,
        targetRepsMax: 12,
        targetRIR: 2,
        restSec: 15,
      },
    });
    if (!peRes.ok()) {
      console.error('peRes failed:', peRes.status(), await peRes.text());
    }
    expect(peRes.ok()).toBeTruthy();
  }

  const sessionRes = await page.request.post('/api/sessions', {
    data: { workoutId: workout.id },
  });
  expect(sessionRes.ok()).toBeTruthy();
  const session = await sessionRes.json();

  // Navigate to session
  await page.goto(`/session/${session.id}`);
  await expect(page.getByRole('heading', { name: 'E2E Auto Nav Ex 1' })).toBeVisible();

  // Log set on ex 1 -> 15s rest
  await page.getByLabel('Quick entry').fill('100x10@2');
  await page.getByRole('button', { name: /log the set/i }).click();

  // Wait for rest timer
  await expect(page.locator('[data-testid="rest-timer"]')).toBeVisible({ timeout: 3000 });

  // Switch to ex 2 immediately
  const ex2Button = page.locator('[role="button"][aria-label*="2. E2E Auto Nav Ex 2"]');
  await ex2Button.click();
  await expect(page.getByRole('heading', { name: 'E2E Auto Nav Ex 2' })).toBeVisible();

  // Wait 17 seconds for ex 1 timer to expire
  await page.waitForTimeout(17000);

  // Verify still viewing ex 2 (no auto-navigate)
  await expect(page.getByRole('heading', { name: 'E2E Auto Nav Ex 2' })).toBeVisible();
  await expect(page.getByLabel('Quick entry')).toBeVisible();

  // Switch back to ex 1
  const ex1Button = page.locator('[role="button"][aria-label*="1. E2E Auto Nav Ex 1"]');
  await ex1Button.click();

  // Verify ex 1 is in input mode (timer expired silently)
  await expect(page.getByRole('heading', { name: 'E2E Auto Nav Ex 1' })).toBeVisible();
  await expect(page.getByLabel('Quick entry')).toBeVisible();
  await expect(page.locator('[data-testid="rest-timer"]')).not.toBeVisible();

  // Badge should be gone too
  await expect(ex1Button.locator('[data-testid="exercise-strip-timer-badge"]')).not.toBeVisible();
});
