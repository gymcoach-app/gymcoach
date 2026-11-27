import { test, expect } from '@playwright/test';

// Intensity target of a cardio exercise in a program (issue #558, slice 2):
// an optional RPE from 1 to 10 and an optional heart rate range in bpm next
// to the duration. Running is added to a workout through the editor with
// "20 min, RPE 6, 140 to 150 bpm"; the editor and the print sheet read
// "20 min · RPE 6 · 140-150 bpm", and the live session shows the intensity
// once, in the set logger next to its inputs. Setup data is seeded through the
// authenticated API (the browser context shares cookies with page.request).

test('a cardio exercise carries an RPE and a heart rate target in a program', async ({ page }) => {
  // Fresh user; a unique X-Forwarded-For keeps this spec in its own register
  // rate-limit bucket. Registering seeds the default catalog, Running included.
  const registerRes = await page.request.post('/api/auth/register', {
    headers: { 'x-forwarded-for': '10.111.5.59' },
    data: {
      displayName: 'Cardio Intensity E2E',
      email: `e2e-cardio-intensity-${Date.now()}@test.dev`,
      password: 'supersecret',
    },
  });
  expect(registerRes.ok()).toBeTruthy();

  const programRes = await page.request.post('/api/programs', {
    data: { name: 'Cardio Intensity Program', phase: 'Base' },
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
  // A strength row has no intensity field.
  await expect(dialog.getByLabel('Sets')).toBeVisible();
  await expect(dialog.getByLabel('Target RPE (1-10, optional)')).toHaveCount(0);
  await dialog.locator('#exerciseId').click();
  await page.getByRole('option', { name: 'Running', exact: true }).click();

  const rpe = dialog.getByLabel('Target RPE (1-10, optional)');
  const hrMin = dialog.getByLabel('Heart rate from (bpm, optional)');
  const hrMax = dialog.getByLabel('Heart rate to (bpm, optional)');
  await expect(rpe).toBeVisible();
  await expect(hrMin).toBeVisible();
  await expect(hrMax).toBeVisible();

  // Half a heart rate range and an RPE off the scale are refused in place.
  await dialog.getByLabel('Duration (min)').fill('20');
  await rpe.fill('11');
  await hrMin.fill('140');
  await dialog.getByRole('button', { name: 'Add', exact: true }).click();
  await expect(
    dialog.getByText('Enter a whole number from 1 to 10, or leave it empty.'),
  ).toBeVisible();
  await expect(
    dialog.getByText(
      'Enter both heart rates, between 40 and 250 bpm and lowest first, or leave both empty.',
    ),
  ).toBeVisible();

  await rpe.fill('6');
  await hrMax.fill('150');
  const created = page.waitForResponse(
    (res) =>
      res.request().method() === 'POST' &&
      /\/api\/workouts\/[^/]+\/program-exercises$/.test(res.url()),
  );
  await dialog.getByRole('button', { name: 'Add', exact: true }).click();
  expect((await created).status()).toBe(201);
  await expect(dialog).toBeHidden();

  // The editor reads the whole target on one line.
  const row = page.locator('li:has(button[aria-label="Exercise actions"])').filter({
    hasText: 'Running',
  });
  await expect(row.locator('[data-prescription]')).toHaveText('20 min · RPE 6 · 140-150 bpm');

  // It is saved: still there after a reload, and the editor shows it again.
  await page.reload();
  await expect(row.locator('[data-prescription]')).toHaveText('20 min · RPE 6 · 140-150 bpm');
  await row.getByRole('button', { name: 'Exercise actions' }).click();
  await page.getByRole('menuitem', { name: 'Edit' }).click();
  await expect(rpe).toHaveValue('6');
  await expect(hrMin).toHaveValue('140');
  await expect(hrMax).toHaveValue('150');

  // Emptying the RPE clears it; the heart rate range stays.
  await rpe.fill('');
  const updated = page.waitForResponse(
    (res) => res.request().method() === 'PUT' && /\/api\/program-exercises\/[^/]+$/.test(res.url()),
  );
  await dialog.getByRole('button', { name: 'Save', exact: true }).click();
  expect((await updated).ok()).toBeTruthy();
  await expect(dialog).toBeHidden();
  await expect(row.locator('[data-prescription]')).toHaveText('20 min · 140-150 bpm');

  // Put it back for the print sheet and the live session.
  await row.getByRole('button', { name: 'Exercise actions' }).click();
  await page.getByRole('menuitem', { name: 'Edit' }).click();
  await rpe.fill('6');
  const restored = page.waitForResponse(
    (res) => res.request().method() === 'PUT' && /\/api\/program-exercises\/[^/]+$/.test(res.url()),
  );
  await dialog.getByRole('button', { name: 'Save', exact: true }).click();
  expect((await restored).ok()).toBeTruthy();
  await expect(dialog).toBeHidden();
  await expect(row.locator('[data-prescription]')).toHaveText('20 min · RPE 6 · 140-150 bpm');

  // The print sheet carries the same plan; its boxes stay duration and distance.
  await page.goto(`/programs/${program.id}/print`);
  await expect(page.getByText('20 min · RPE 6 · 140-150 bpm')).toBeVisible();
  await expect(page.locator('[data-print-cell="duration"] [data-print-target]')).toHaveText(
    '20 min',
  );
  await expect(page.locator('[data-print-cell]')).toHaveCount(2);

  // The live session shows the target, and the logger the intensity to hold
  // next to the inputs it prefilled from the duration.
  const sessionRes = await page.request.post('/api/sessions', { data: { workoutId: workout.id } });
  expect(sessionRes.ok()).toBeTruthy();
  const session = await sessionRes.json();
  await page.goto(`/session/${session.id}`);
  await expect(page.getByText('Target: 20 min', { exact: true })).toBeVisible();
  await expect(page.getByTestId('cardio-intensity-target')).toHaveText(
    'Target intensity: RPE 6 · 140-150 bpm',
  );
  // Once on the screen: the card above the logger does not repeat it.
  await expect(page.getByText(/RPE 6/)).toHaveCount(1);
  await expect(page.getByText(/140-150 bpm/)).toHaveCount(1);
  await expect(page.locator('#cardio-duration')).toHaveValue('20:00');
});
