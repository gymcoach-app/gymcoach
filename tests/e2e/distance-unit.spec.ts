import { test, expect } from '@playwright/test';

// Distance unit setting (issue #582): a runner prescribes "30 min, 5 km",
// switches the distance unit to miles in the settings, and reads miles in the
// program editor, the print sheet, the live session and the history, while the
// stored values stay the 5000 meters typed first: re-saving the row and
// logging the prefilled set never drift to the 5005 m that 3.11 mi converts to.

test('the distance unit setting switches cardio to miles without touching stored meters', async ({
  page,
}) => {
  // Fresh user; a unique X-Forwarded-For keeps this spec in its own register
  // rate-limit bucket. Registering seeds the default catalog, Running included.
  const registerRes = await page.request.post('/api/auth/register', {
    headers: { 'x-forwarded-for': '10.111.58.23' },
    data: {
      displayName: 'Distance Unit E2E',
      email: `e2e-distance-unit-${Date.now()}@test.dev`,
      password: 'supersecret',
    },
  });
  expect(registerRes.ok()).toBeTruthy();

  const programRes = await page.request.post('/api/programs', {
    data: { name: 'Distance Unit Program', phase: 'Base' },
  });
  expect(programRes.ok()).toBeTruthy();
  const program = await programRes.json();
  const workoutRes = await page.request.post(`/api/programs/${program.id}/workouts`, {
    data: { name: 'Easy run' },
  });
  expect(workoutRes.ok()).toBeTruthy();
  const workout = await workoutRes.json();

  // A new account reads kilometers: add Running, 30 min and 5 km.
  await page.goto(`/programs/${program.id}`);
  await page.getByRole('button', { name: 'Add an exercise' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.locator('#exerciseId').click();
  await page.getByRole('option', { name: 'Running', exact: true }).click();
  await dialog.getByLabel('Duration (min)').fill('30');
  await dialog.getByLabel('Distance (km, optional)').fill('5');
  const created = page.waitForResponse(
    (res) =>
      res.request().method() === 'POST' &&
      /\/api\/workouts\/[^/]+\/program-exercises$/.test(res.url()),
  );
  await dialog.getByRole('button', { name: 'Add', exact: true }).click();
  expect((await created).status()).toBe(201);
  await expect(dialog).toBeHidden();
  const row = page.locator('li:has(button[aria-label="Exercise actions"])').filter({
    hasText: 'Running',
  });
  await expect(row.locator('[data-prescription]')).toHaveText('30 min · 5 km');

  // The setting starts on automatic; switch to miles and save.
  await page.goto('/settings');
  await expect(page.locator('#distanceUnit')).toContainText('Automatic');
  await page.locator('#distanceUnit').click();
  await page.getByRole('option', { name: 'Miles (mi)' }).click();
  const saved = page.waitForResponse(
    (res) => res.url().endsWith('/api/profile') && res.request().method() === 'PATCH',
  );
  await page.getByRole('button', { name: 'Save', exact: true }).first().click();
  const savedRes = await saved;
  expect(savedRes.ok()).toBeTruthy();
  expect((await savedRes.json()).distanceUnit).toBe('MI');
  await page.reload();
  await expect(page.locator('#distanceUnit')).toContainText('Miles (mi)');

  // The program editor reads miles.
  await page.goto(`/programs/${program.id}`);
  await expect(row.locator('[data-prescription]')).toHaveText('30 min · 3.11 mi');

  // Editing shows miles; changing only the duration keeps the 5000 m stored.
  await row.getByRole('button', { name: 'Exercise actions' }).click();
  await page.getByRole('menuitem', { name: 'Edit' }).click();
  await expect(dialog.getByLabel('Distance (mi, optional)')).toHaveValue('3.11');
  await dialog.getByLabel('Duration (min)').fill('35');
  const updated = page.waitForResponse(
    (res) => res.request().method() === 'PUT' && /\/api\/program-exercises\/[^/]+$/.test(res.url()),
  );
  await dialog.getByRole('button', { name: 'Save', exact: true }).click();
  const updatedRes = await updated;
  expect(updatedRes.ok()).toBeTruthy();
  expect(updatedRes.request().postDataJSON()).toMatchObject({
    targetDurationSec: 2100,
    targetDistanceM: 5000,
  });
  await expect(dialog).toBeHidden();
  await expect(row.locator('[data-prescription]')).toHaveText('35 min · 3.11 mi');

  // The print sheet reads miles.
  await page.goto(`/programs/${program.id}/print`);
  await expect(page.locator('[data-print-cell="distance"] [data-print-target]')).toHaveText(
    '3.11 mi',
  );

  // The live session shows the target in miles and the logger starts from it.
  const sessionRes = await page.request.post('/api/sessions', { data: { workoutId: workout.id } });
  expect(sessionRes.ok()).toBeTruthy();
  const session = await sessionRes.json();
  await page.goto(`/session/${session.id}`);
  await expect(page.getByText('Target: 35 min · 3.11 mi')).toBeVisible();
  await expect(page.getByLabel('Distance (mi, optional)')).toHaveValue('3.11');
  await expect(page.locator('#cardio-duration')).toHaveValue('35:00');

  // Log the prefilled set, then finish.
  await page.getByRole('button', { name: /log the set/i }).click();
  await expect(page.getByText('35:00 · 3.11 mi')).toBeVisible();
  await page.getByRole('button', { name: 'Finish' }).click();
  await expect(page.getByText('Session summary')).toBeVisible();
  // Distance, pace and speed share the unit.
  await expect(page.getByText(/1\/1 sets · 35:00 · 3\.11 mi · 11:16 \/mi · 5\.3 mph/)).toBeVisible();
  await page.getByRole('button', { name: 'Finish the session' }).click();
  await expect(page).toHaveURL('/');

  // The set stores the 5000 m of the target, not a re-converted 5005 m.
  await expect
    .poll(async () => {
      const res = await page.request.get(`/api/sessions/${session.id}`);
      const body = await res.json();
      return (body.sets as Array<{ distanceM: number | null }>).map((s) => s.distanceM);
    })
    .toEqual([5000]);

  // History reads miles.
  await page.goto(`/history/${session.id}`);
  await expect(page.getByText('Total: 35:00 · 3.11 mi · 11:16 /mi · 5.3 mph')).toBeVisible();
  await expect(page.getByRole('cell', { name: '3.11 mi', exact: true })).toBeVisible();

  // Back to kilometers: the same session reads the 5 km typed at the start.
  const back = await page.request.patch('/api/profile', { data: { distanceUnit: 'KM' } });
  expect(back.ok()).toBeTruthy();
  await page.reload();
  await expect(page.getByText('Total: 35:00 · 5 km · 7:00 /km · 8.6 km/h')).toBeVisible();
});
