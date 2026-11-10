import { test, expect } from '@playwright/test';

// Freestyle session (issue #388): a lifter with no program starts an empty
// session, picks an exercise from the catalog, logs a set, finishes, and finds
// the session in the history. No program is created on the way.

test('freestyle: start empty, add an exercise, log a set, finish, see it in history', async ({
  page,
}) => {
  const registerRes = await page.request.post('/api/auth/register', {
    headers: { 'x-forwarded-for': '10.111.2.4' },
    data: {
      displayName: 'Freestyle E2E',
      email: `e2e-freestyle-${Date.now()}@test.dev`,
      password: 'supersecret',
    },
  });
  expect(registerRes.ok()).toBeTruthy();

  const exerciseRes = await page.request.post('/api/exercises', {
    data: {
      name: 'E2E Freestyle Hotel Press',
      muscleGroup: 'CHEST',
      category: 'COMPOUND',
      equipmentType: 'DUMBBELL',
    },
  });
  expect(exerciseRes.ok()).toBeTruthy();
  const programsBefore = await (await page.request.get('/api/programs')).json();

  // No active program: the start page still offers the empty session.
  await page.goto('/session/new');
  await expect(page.getByText('Freestyle session')).toBeVisible();
  await page.getByRole('button', { name: 'Start empty session' }).click();
  // The start page is /session/new, so wait for a session id, not just /session/*.
  await page.waitForURL((url) => /^\/session\/(?!new$)[^/]+$/.test(url.pathname));
  const sessionId = new URL(page.url()).pathname.split('/').pop() as string;

  // Empty state: pick the first exercise from the catalog.
  await expect(page.getByText('Add your first exercise')).toBeVisible();
  await page.getByLabel('Search exercises').fill('Hotel');
  const added = page.waitForResponse(
    (res) => res.url().endsWith(`/api/sessions/${sessionId}/exercises`) && res.request().method() === 'POST',
  );
  await page.getByRole('button', { name: 'E2E Freestyle Hotel Press' }).click();
  expect((await added).status()).toBe(201);

  // The runner shows the exercise, and its menu says the change stays in
  // this session (checked before logging: the menu is disabled during rest).
  await expect(page.getByText(/Exercise 1\/1 · E2E Freestyle Hotel Press/)).toBeVisible();
  await page.getByRole('button', { name: 'Exercise actions' }).click();
  await expect(page.getByText(/only changes the current session/i)).toBeVisible();
  await page.keyboard.press('Escape');

  // Log one set with the suggested values.
  await page.getByRole('button', { name: 'Confirm set 1' }).click();
  await expect
    .poll(async () => {
      const res = await page.request.get(`/api/sessions/${sessionId}`);
      const body = (await res.json()) as {
        workoutId: string | null;
        programId: string | null;
        sets: { setNumber: number }[];
      };
      return {
        workoutId: body.workoutId,
        programId: body.programId,
        sets: body.sets.map((set) => set.setNumber),
      };
    })
    .toEqual({ workoutId: null, programId: null, sets: [1] });

  // Finish from the summary.
  await page.getByRole('button', { name: 'Finish', exact: true }).click();
  await expect(page.getByText('Session summary')).toBeVisible();
  await page.getByRole('button', { name: 'Finish the session' }).click();
  await page.waitForURL((url) => url.pathname === '/');

  // It is in the history, with its set, and no program was created.
  await page.goto('/history');
  await expect(page.getByText('Free session').first()).toBeVisible();
  await page.goto(`/history/${sessionId}`);
  await expect(page.getByRole('heading', { name: 'Free session' })).toBeVisible();
  await expect(page.getByText('E2E Freestyle Hotel Press').first()).toBeVisible();
  const programsAfter = await (await page.request.get('/api/programs')).json();
  expect(programsAfter).toEqual(programsBefore);
});
