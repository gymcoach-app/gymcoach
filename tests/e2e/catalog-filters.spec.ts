import { test, expect, type Page } from '@playwright/test';

// Dedicated client IP so the UI signup does not share a register rate-limit
// bucket with another spec (issue #292).
test.use({ extraHTTPHeaders: { 'x-forwarded-for': '10.111.4.2' } });

// Catalog filters (issue #402): tap a muscle on the body silhouette and keep
// only what a saved gym has, both combined with the search. The gym and the
// three exercises are seeded through the authenticated API; the page then
// reads the real gym rows, which the component tests cannot cover.

async function createExercise(
  page: Page,
  data: { name: string; muscleGroup: string; equipmentType: string },
) {
  const res = await page.request.post('/api/exercises', {
    data: { ...data, category: 'COMPOUND' },
  });
  expect(res.ok()).toBeTruthy();
}

test('a lifter narrows the catalog by muscle and by gym equipment', async ({ page }) => {
  await page.goto('/signup');
  await page.getByLabel('Name').fill('Filter E2E');
  await page.getByLabel('Email').fill(`e2e-catalog-filters-${Date.now()}@test.dev`);
  await page.getByLabel('Password').fill('supersecret');
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page).toHaveURL('/');

  await createExercise(page, {
    name: 'Filter Bar Chest',
    muscleGroup: 'CHEST',
    equipmentType: 'BARBELL',
  });
  await createExercise(page, {
    name: 'Filter Bell Chest',
    muscleGroup: 'CHEST',
    equipmentType: 'DUMBBELL',
  });
  await createExercise(page, {
    name: 'Filter Bell Legs',
    muscleGroup: 'QUADS',
    equipmentType: 'DUMBBELL',
  });

  const barChest = page.getByText('Filter Bar Chest', { exact: true });
  const bellChest = page.getByText('Filter Bell Chest', { exact: true });
  const bellLegs = page.getByText('Filter Bell Legs', { exact: true });

  // Without a saved gym the equipment filter points to the settings.
  await page.goto('/exercises');
  await expect(barChest).toBeVisible();
  await expect(page.getByRole('switch', { name: 'Only what my gym has' })).toHaveCount(0);
  await expect(page.getByText(/Save a gym and its equipment/)).toBeVisible();

  // A home gym with dumbbells only.
  const gymRes = await page.request.post('/api/gyms', {
    data: { name: 'Garage', dumbbellWeights: [5, 10, 15], makeActive: true },
  });
  expect(gymRes.ok()).toBeTruthy();
  await page.reload();

  // Muscle: tap the chest on the silhouette; the list button follows.
  await page.getByRole('button', { name: 'Muscles' }).click();
  await page.locator('path[data-region="chest-left"]').click();
  await expect(page.getByRole('button', { name: 'Chest', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(barChest).toBeVisible();
  await expect(bellChest).toBeVisible();
  await expect(bellLegs).toHaveCount(0);

  // Gym: the barbell exercise goes, and the rule is stated.
  await page.getByRole('switch', { name: 'Only what my gym has' }).click();
  await expect(page.getByText(/Checked against the equipment saved for Garage/)).toBeVisible();
  await expect(bellChest).toBeVisible();
  await expect(barChest).toHaveCount(0);

  // Search on top of both, down to nothing, then clear everything.
  await page.getByRole('searchbox').fill('legs');
  await expect(page.getByText('No exercises match these filters')).toBeVisible();
  await page.getByRole('button', { name: 'Clear filters' }).click();
  await expect(barChest).toBeVisible();
  await expect(bellChest).toBeVisible();
  await expect(bellLegs).toBeVisible();
  await expect(page.getByRole('searchbox')).toHaveValue('');
});
