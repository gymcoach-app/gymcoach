import { test, expect } from '@playwright/test';

// Cardio target in a program (issue #558, slice 1): a cardio exercise is
// prescribed by a duration and an optional distance instead of sets, reps, RIR
// and rest. Running is added to a workout through the editor with a 20 minute
// target; the editor, the print sheet and the live session read "20 min", and
// the set logger starts from the target. Setup data is seeded through the
// authenticated API (the browser context shares cookies with page.request).

test('a cardio exercise is prescribed by duration and distance in a program', async ({ page }) => {
  // Fresh user; a unique X-Forwarded-For keeps this spec in its own register
  // rate-limit bucket. Registering seeds the default catalog, Running included.
  const registerRes = await page.request.post('/api/auth/register', {
    headers: { 'x-forwarded-for': '10.111.5.58' },
    data: {
      displayName: 'Cardio Target E2E',
      email: `e2e-cardio-target-${Date.now()}@test.dev`,
      password: 'supersecret',
    },
  });
  expect(registerRes.ok()).toBeTruthy();

  const programRes = await page.request.post('/api/programs', {
    data: { name: 'Cardio Target Program', phase: 'Base' },
  });
  expect(programRes.ok()).toBeTruthy();
  const program = await programRes.json();
  const workoutRes = await page.request.post(`/api/programs/${program.id}/workouts`, {
    data: { name: 'Conditioning' },
  });
  expect(workoutRes.ok()).toBeTruthy();
  const workout = await workoutRes.json();

  await page.goto(`/programs/${program.id}`);

  // Add Running through the editor.
  await page.getByRole('button', { name: 'Add an exercise' }).click();
  const dialog = page.getByRole('dialog');
  // Before an exercise is chosen the strength fields of a new row are shown.
  await expect(dialog.getByLabel('Sets')).toBeVisible();
  await dialog.locator('#exerciseId').click();
  await page.getByRole('option', { name: 'Running', exact: true }).click();

  // A cardio exercise asks for a duration and an optional distance, and hides
  // sets, reps, RIR, rest and tempo.
  await expect(dialog.getByLabel('Duration (min)')).toBeVisible();
  await expect(dialog.getByLabel('Distance (km, optional)')).toBeVisible();
  for (const label of ['Sets', 'RIR', 'Reps min', 'Reps max', 'Rest (s)', 'Tempo (optional)']) {
    await expect(dialog.getByLabel(label)).toHaveCount(0);
  }

  // The duration is required.
  await dialog.getByRole('button', { name: 'Add', exact: true }).click();
  await expect(dialog.getByText('Enter a duration in minutes, up to 1440.')).toBeVisible();

  await dialog.getByLabel('Duration (min)').fill('20');
  const created = page.waitForResponse(
    (res) =>
      res.request().method() === 'POST' &&
      /\/api\/workouts\/[^/]+\/program-exercises$/.test(res.url()),
  );
  await dialog.getByRole('button', { name: 'Add', exact: true }).click();
  expect((await created).status()).toBe(201);
  await expect(dialog).toBeHidden();

  // The editor reads "20 min", with no sets or reps text for it.
  const row = page.locator('li:has(button[aria-label="Exercise actions"])').filter({
    hasText: 'Running',
  });
  await expect(row.locator('[data-prescription]')).toHaveText('20 min');
  await expect(row).not.toContainText(/\bsets?\b/i);
  await expect(row).not.toContainText(/\breps?\b/i);
  await expect(row).not.toContainText('RIR');
  await expect(row).not.toContainText(/rest \d+s/i);

  // Editing shows the stored target; adding a distance reads "20 min · 5 km".
  await row.getByRole('button', { name: 'Exercise actions' }).click();
  await page.getByRole('menuitem', { name: 'Edit' }).click();
  await expect(dialog.getByLabel('Duration (min)')).toHaveValue('20');
  await dialog.getByLabel('Distance (km, optional)').fill('5');
  const updated = page.waitForResponse(
    (res) => res.request().method() === 'PUT' && /\/api\/program-exercises\/[^/]+$/.test(res.url()),
  );
  await dialog.getByRole('button', { name: 'Save', exact: true }).click();
  expect((await updated).ok()).toBeTruthy();
  await expect(dialog).toBeHidden();
  await expect(row.locator('[data-prescription]')).toHaveText('20 min · 5 km');

  // It is saved: still there after a reload.
  await page.reload();
  await expect(row.locator('[data-prescription]')).toHaveText('20 min · 5 km');

  // The print sheet carries the same plan.
  await page.goto(`/programs/${program.id}/print`);
  await expect(page.getByText('20 min · 5 km')).toBeVisible();
  await expect(page.getByText(/reps, RIR/)).toHaveCount(0);
  // Its boxes are a duration and a distance with the target pre-printed, not
  // weight, reps and RIR (issue #576).
  await expect(page.locator('[data-print-cell="duration"] [data-print-target]')).toHaveText(
    '20 min',
  );
  await expect(page.locator('[data-print-cell="distance"] [data-print-target]')).toHaveText('5 km');
  await expect(page.locator('[data-print-cell]')).toHaveCount(2);

  // The live session shows the target and the logger starts from it.
  const sessionRes = await page.request.post('/api/sessions', { data: { workoutId: workout.id } });
  expect(sessionRes.ok()).toBeTruthy();
  const session = await sessionRes.json();
  await page.goto(`/session/${session.id}`);
  await expect(page.getByText('Target: 20 min · 5 km')).toBeVisible();
  await expect(page.locator('#cardio-duration')).toHaveValue('20:00');
  await expect(page.locator('#cardio-distance')).toHaveValue('5');
});
