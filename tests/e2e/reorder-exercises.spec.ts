import { test, expect, type Page } from '@playwright/test';

// Reordering exercises in the program editor (issue #557, step 1): "Move up"
// and "Move down" in an exercise's three-dot menu. The last exercise goes to
// the top (one move with the mouse, one with the keyboard), the order
// survives a reload, a superset pair moves as one block, and the next session
// follows the saved order. Setup data is seeded through the authenticated API
// (the browser context shares cookies with page.request).

const NAMES = ['Reorder Bench', 'Reorder Squat', 'Reorder Running'] as const;

async function seedWorkout(page: Page): Promise<{ programId: string; workoutId: string }> {
  const programRes = await page.request.post('/api/programs', {
    data: { name: 'Reorder Program', phase: 'Base' },
  });
  expect(programRes.ok()).toBeTruthy();
  const program = await programRes.json();

  const workoutRes = await page.request.post(`/api/programs/${program.id}/workouts`, {
    data: { name: 'Full body' },
  });
  expect(workoutRes.ok()).toBeTruthy();
  const workout = await workoutRes.json();

  for (const name of NAMES) {
    const exerciseRes = await page.request.post('/api/exercises', {
      data: { name, muscleGroup: 'QUADS', category: 'COMPOUND' },
    });
    expect(exerciseRes.ok()).toBeTruthy();
    const exercise = await exerciseRes.json();
    const peRes = await page.request.post(`/api/workouts/${workout.id}/program-exercises`, {
      data: {
        exerciseId: exercise.id,
        targetSets: 2,
        targetRepsMin: 8,
        targetRepsMax: 12,
        targetRIR: 2,
        restSec: 60,
      },
    });
    expect(peRes.ok()).toBeTruthy();
  }
  return { programId: program.id, workoutId: workout.id };
}

// The exercise names of the workout card, top to bottom.
function exerciseNames(page: Page) {
  return page.locator('li:has(button[aria-label="Exercise actions"]) p:first-of-type');
}

// Resolves once the order endpoint has answered the move started by `action`.
async function saved(page: Page, action: () => Promise<void>) {
  const response = page.waitForResponse(
    (res) => res.request().method() === 'PUT' && /\/api\/workouts\/[^/]+\/order$/.test(res.url()),
  );
  await action();
  expect((await response).ok()).toBeTruthy();
}

test('a lifter can move exercises up and down in the program editor', async ({ page }) => {
  // Fresh user; a unique X-Forwarded-For keeps this spec in its own register
  // rate-limit bucket.
  const registerRes = await page.request.post('/api/auth/register', {
    headers: { 'x-forwarded-for': '10.111.3.1' },
    data: {
      displayName: 'Reorder E2E',
      email: `e2e-reorder-${Date.now()}@test.dev`,
      password: 'supersecret',
    },
  });
  expect(registerRes.ok()).toBeTruthy();

  const { programId, workoutId } = await seedWorkout(page);

  await page.goto(`/programs/${programId}`);
  await expect(exerciseNames(page)).toHaveText([...NAMES]);
  const menus = page.getByRole('button', { name: 'Exercise actions' });

  // The edges are disabled: nothing above the first row, nothing below the last.
  await menus.nth(0).click();
  await expect(page.getByRole('menuitem', { name: 'Move up' })).toBeDisabled();
  await expect(page.getByRole('menuitem', { name: 'Move down' })).toBeEnabled();
  await page.keyboard.press('Escape');

  // Running is last: move it up once with the mouse...
  await menus.nth(2).click();
  await expect(page.getByRole('menuitem', { name: 'Move down' })).toBeDisabled();
  await saved(page, () => page.getByRole('menuitem', { name: 'Move up' }).click());
  await expect(exerciseNames(page)).toHaveText([
    'Reorder Bench',
    'Reorder Running',
    'Reorder Squat',
  ]);

  // ...and once more with the keyboard only: open the menu, arrow from Edit
  // to Move up, activate it.
  await menus.nth(1).focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('menu')).toBeVisible();
  await page.keyboard.press('ArrowDown');
  await expect(page.getByRole('menuitem', { name: 'Move up' })).toBeFocused();
  await saved(page, () => page.keyboard.press('Enter'));
  await expect(exerciseNames(page)).toHaveText([
    'Reorder Running',
    'Reorder Bench',
    'Reorder Squat',
  ]);

  // The order is saved: it is still there after a reload.
  await page.reload();
  await expect(exerciseNames(page)).toHaveText([
    'Reorder Running',
    'Reorder Bench',
    'Reorder Squat',
  ]);

  // Pairing still works on the moved rows: Squat pairs with Bench above it.
  await menus.nth(2).click();
  await page.getByRole('menuitem', { name: 'Pair with previous' }).click();
  await expect(page.getByText('Superset A1')).toBeVisible();
  await expect(page.getByText('Superset A2')).toBeVisible();

  // Running moves down past the whole pair, not in between its members.
  await menus.nth(0).click();
  await saved(page, () => page.getByRole('menuitem', { name: 'Move down' }).click());
  await expect(exerciseNames(page)).toHaveText([
    'Reorder Bench',
    'Reorder Squat',
    'Reorder Running',
  ]);

  // Moving the second member of the pair down takes the first one along.
  await menus.nth(1).click();
  await saved(page, () => page.getByRole('menuitem', { name: 'Move down' }).click());
  await expect(exerciseNames(page)).toHaveText([
    'Reorder Running',
    'Reorder Bench',
    'Reorder Squat',
  ]);

  await page.reload();
  await expect(exerciseNames(page)).toHaveText([
    'Reorder Running',
    'Reorder Bench',
    'Reorder Squat',
  ]);
  const rows = page.locator('li:has(button[aria-label="Exercise actions"])');
  await expect(rows.nth(1)).toContainText('Superset A1');
  await expect(rows.nth(2)).toContainText('Superset A2');

  // The next session follows the saved order.
  const sessionRes = await page.request.post('/api/sessions', { data: { workoutId } });
  expect(sessionRes.ok()).toBeTruthy();
  const session = await sessionRes.json();
  await page.goto(`/session/${session.id}`);
  await expect(page.getByText(/Exercise 1\/3 · Reorder Running/)).toBeVisible();
});
