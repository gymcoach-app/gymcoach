import { test, expect, type Page } from '@playwright/test';

// Effort scale (issue #390): a lifter switches to RPE in the settings, logs a
// set at RPE 8, and sees RPE everywhere while the set stores RIR 2.

async function seedSession(page: Page): Promise<string> {
  const exerciseRes = await page.request.post('/api/exercises', {
    data: {
      name: 'E2E Effort Scale Squat',
      muscleGroup: 'QUADS',
      category: 'COMPOUND',
      equipmentType: 'BARBELL',
    },
  });
  expect(exerciseRes.ok()).toBeTruthy();
  const exercise = await exerciseRes.json();

  const programRes = await page.request.post('/api/programs', {
    data: { name: 'E2E Effort Scale Program', phase: 'Base' },
  });
  expect(programRes.ok()).toBeTruthy();
  const program = await programRes.json();

  const workoutRes = await page.request.post(`/api/programs/${program.id}/workouts`, {
    data: { name: 'Leg day' },
  });
  expect(workoutRes.ok()).toBeTruthy();
  const workout = await workoutRes.json();

  // Target RIR 1 (RPE 9), so picking RPE 8 below is a real change and not the
  // pre-filled value.
  const peRes = await page.request.post(`/api/workouts/${workout.id}/program-exercises`, {
    data: {
      exerciseId: exercise.id,
      targetSets: 3,
      targetRepsMin: 5,
      targetRepsMax: 5,
      targetRIR: 1,
      restSec: 90,
    },
  });
  expect(peRes.ok()).toBeTruthy();

  const sessionRes = await page.request.post('/api/sessions', {
    data: { workoutId: workout.id },
  });
  expect(sessionRes.ok()).toBeTruthy();
  const session = await sessionRes.json();
  return session.id;
}

test('RPE setting: enter RPE 8, see RPE, store RIR 2', async ({ page }) => {
  const registerRes = await page.request.post('/api/auth/register', {
    headers: { 'x-forwarded-for': '10.111.2.3' },
    data: {
      displayName: 'Effort Scale E2E',
      email: `e2e-effort-scale-${Date.now()}@test.dev`,
      password: 'supersecret',
    },
  });
  expect(registerRes.ok()).toBeTruthy();

  const sessionId = await seedSession(page);

  // A new account logs in RIR.
  await page.goto(`/session/${sessionId}`);
  await expect(page.getByTestId('effort-header')).toHaveText('RIR');

  // Switch to RPE in the settings and save.
  await page.goto('/settings');
  await page.locator('#effortScale').click();
  await page.getByRole('option', { name: /^RPE/ }).click();
  const saved = page.waitForResponse(
    (res) => res.url().endsWith('/api/profile') && res.request().method() === 'PATCH',
  );
  await page.getByRole('button', { name: 'Save', exact: true }).first().click();
  expect((await saved).ok()).toBeTruthy();
  await page.reload();
  await expect(page.locator('#effortScale')).toContainText('RPE');

  // The logger now reads RPE: header, pre-filled target (RIR 1 = RPE 9), chips.
  await page.goto(`/session/${sessionId}`);
  await expect(page.getByTestId('effort-header')).toHaveText('RPE');
  await expect(page.getByText(/· RPE 9 ·/).first()).toBeVisible();
  const effort = page.getByRole('combobox', { name: 'Set 1 perceived exertion' });
  await expect(effort).toHaveText('9');
  await expect(page.getByTestId('effort-chips').getByRole('button')).toHaveText([
    '7',
    '8',
    '9',
    '10',
  ]);

  // Enter RPE 8 and confirm the set.
  await effort.click();
  await page.getByRole('option', { name: '8', exact: true }).click();
  await expect(effort).toHaveText('8');
  await page.getByRole('button', { name: 'Confirm set 1' }).click();

  // The set stores RIR 2.
  await expect
    .poll(async () => {
      const res = await page.request.get(`/api/sessions/${sessionId}`);
      const body = (await res.json()) as { sets: { rir: number | null }[] };
      return body.sets.map((set) => set.rir);
    })
    .toEqual([2]);

  // It reads back as RPE 8 after a reload, in the logger and in the history.
  await page.reload();
  await expect(page.getByRole('combobox', { name: 'Set 1 perceived exertion' })).toHaveText('8');
  await page.goto(`/history/${sessionId}`);
  await expect(page.getByRole('columnheader', { name: 'RPE' })).toBeVisible();
  await expect(page.getByRole('columnheader', { name: 'RIR' })).toHaveCount(0);
  // Columns: set number, load, reps (5), effort. Only the effort cell reads 8.
  const row = page.getByRole('row').filter({ has: page.getByRole('cell', { name: '8', exact: true }) });
  await expect(row).toHaveCount(1);
  await expect(row.getByRole('cell').nth(3)).toHaveText('8');
});
