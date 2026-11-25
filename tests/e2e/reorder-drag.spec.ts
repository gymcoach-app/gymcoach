import { test, expect, type Locator, type Page } from '@playwright/test';

// Drag-and-drop reordering in the program editor (issue #557, step 2): every
// exercise row has a grip. With a mouse, the last exercise is dragged to the
// top in one drop, Escape aborts a drag, the order survives a reload, and a
// superset pair is neither split nor dropped into. With a finger, the grip
// drags and the rest of the row still scrolls the page. That the next
// session follows the saved order is covered by reorder-exercises.spec.ts
// (same endpoint). Setup data is seeded through the authenticated API (the
// browser context shares cookies with page.request).

const NAMES = ['Drag Bench', 'Drag Squat', 'Drag Running'] as const;

async function register(page: Page, ip: string) {
  // Fresh user; each test has its own X-Forwarded-For, so it keeps its own
  // register rate-limit bucket.
  const res = await page.request.post('/api/auth/register', {
    headers: { 'x-forwarded-for': ip },
    data: {
      displayName: 'Drag E2E',
      email: `e2e-drag-${Date.now()}-${ip.replace(/\./g, '-')}@test.dev`,
      password: 'supersecret',
    },
  });
  expect(res.ok()).toBeTruthy();
}

// Three exercises in one workout; `pairLastTwo` makes the last two a superset.
async function seedWorkout(page: Page, pairLastTwo = false): Promise<{ programId: string }> {
  const programRes = await page.request.post('/api/programs', {
    data: { name: 'Drag Program', phase: 'Base' },
  });
  expect(programRes.ok()).toBeTruthy();
  const program = await programRes.json();

  const workoutRes = await page.request.post(`/api/programs/${program.id}/workouts`, {
    data: { name: 'Full body' },
  });
  expect(workoutRes.ok()).toBeTruthy();
  const workout = await workoutRes.json();

  for (const [index, name] of NAMES.entries()) {
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
        ...(pairLastTwo && index > 0 ? { supersetGroup: 1 } : {}),
      },
    });
    expect(peRes.ok()).toBeTruthy();
  }
  return { programId: program.id };
}

function rows(page: Page): Locator {
  return page.locator('li:has(button[aria-label="Exercise actions"])');
}

// The exercise names of the workout card, top to bottom.
function exerciseNames(page: Page): Locator {
  return rows(page).locator('p:first-of-type');
}

function grip(page: Page, name: string): Locator {
  return page.getByRole('button', { name: `Reorder ${name}` });
}

async function centerOf(locator: Locator): Promise<{ x: number; y: number }> {
  const box = await locator.boundingBox();
  if (!box) throw new Error('Element is not visible');
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

// The viewport y of a point `fraction` of the way down the row at `index`.
async function rowY(page: Page, index: number, fraction: number): Promise<number> {
  const box = await rows(page).nth(index).boundingBox();
  if (!box) throw new Error('Row is not visible');
  return box.y + box.height * fraction;
}

function orderSaves(page: Page): { count: () => number } {
  let count = 0;
  page.on('request', (req) => {
    if (req.method() === 'PUT' && /\/api\/workouts\/[^/]+\/order$/.test(req.url())) count += 1;
  });
  return { count: () => count };
}

// Resolves once the order endpoint has answered the drop made by `action`.
async function saved(page: Page, action: () => Promise<void>) {
  const response = page.waitForResponse(
    (res) => res.request().method() === 'PUT' && /\/api\/workouts\/[^/]+\/order$/.test(res.url()),
  );
  await action();
  expect((await response).ok()).toBeTruthy();
}

// Resolves once React has hydrated the exercise rows. The grips are in the
// server-rendered HTML, so they are visible, and can be pressed, before their
// handlers exist; a press that early would start nothing. React marks the
// DOM nodes it has taken over with a `__reactProps$...` key.
async function hydrated(page: Page) {
  await expect
    .poll(() =>
      page
        .locator('[data-drag-handle]')
        .first()
        .evaluate((el) => Object.keys(el).some((key) => key.startsWith('__reactProps'))),
    )
    .toBe(true);
}

// Opens the program editor, or reloads it, and waits until it can be used.
async function openEditor(page: Page, programId: string | null) {
  if (programId) await page.goto(`/programs/${programId}`);
  else await page.reload();
  await expect(exerciseNames(page)).toHaveCount(NAMES.length);
  await hydrated(page);
}

// Puts the whole exercise list in the middle of the viewport, so every row
// can be reached by the pointer and the page has no reason to autoscroll.
async function centerList(page: Page) {
  await rows(page)
    .nth(1)
    .evaluate((el) => el.scrollIntoView({ block: 'center' }));
}

// Scrolls so that the top of the exercise list is 40px below the sticky app
// header, and returns where things are. With the whole list in view, clear
// of the header and of the bottom edge, a drag has no reason to autoscroll
// (the page only scrolls to reveal a hidden end of the list), so the scroll
// position can be compared exactly before and after one.
async function placeListBelowHeader(page: Page) {
  return page.evaluate(() => {
    const headerBottom = () => {
      let bottom = 0;
      document.querySelectorAll('header').forEach((header) => {
        const position = window.getComputedStyle(header).position;
        if (position === 'sticky' || position === 'fixed') {
          bottom = Math.max(bottom, header.getBoundingClientRect().bottom);
        }
      });
      return bottom;
    };
    const list = document.querySelector('li[data-reorder-id]')!.parentElement!;
    window.scrollBy(0, Math.round(list.getBoundingClientRect().top - (headerBottom() + 40)));
    const rect = list.getBoundingClientRect();
    return {
      headerBottom: headerBottom(),
      listTop: rect.top,
      listBottom: rect.bottom,
      viewportHeight: window.innerHeight,
    };
  });
}

// Resolves once the page has stopped scrolling (a touch swipe ends in a fling).
async function scrollSettled(page: Page) {
  let last = Number.NaN;
  await expect
    .poll(
      async () => {
        const now = await page.evaluate(() => window.scrollY);
        const still = now === last;
        last = now;
        return still;
      },
      { intervals: [150] },
    )
    .toBe(true);
}

// Presses the grip of `name` with the mouse and carries it to the point
// `fraction` of the way down the row at `rowIndex`. The mouse stays down.
async function mouseDragTo(page: Page, name: string, rowIndex: number, fraction: number) {
  // A grip starts nothing while the previous order is still being saved.
  await expect(grip(page, name)).not.toHaveAttribute('aria-disabled', 'true');
  await centerList(page);
  const from = await centerOf(grip(page, name));
  const targetY = await rowY(page, rowIndex, fraction);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x, targetY, { steps: 10 });
}

test('a lifter can drag an exercise to a new place with the mouse', async ({ page }) => {
  await register(page, '10.111.3.2');
  const { programId } = await seedWorkout(page);
  const saves = orderSaves(page);

  await openEditor(page, programId);
  await expect(exerciseNames(page)).toHaveText([...NAMES]);
  for (const name of NAMES) await expect(grip(page, name)).toBeVisible();

  // Running is last: drag it above Bench. A line shows where it will land.
  await mouseDragTo(page, 'Drag Running', 0, 0.2);
  await expect(page.locator('[data-drop-indicator]')).toBeVisible();
  // Nothing is saved, and nothing moves in the list, before the release.
  await expect(exerciseNames(page)).toHaveText([...NAMES]);
  expect(saves.count()).toBe(0);
  await saved(page, () => page.mouse.up());
  await expect(page.locator('[data-drop-indicator]')).toHaveCount(0);
  await expect(exerciseNames(page)).toHaveText(['Drag Running', 'Drag Bench', 'Drag Squat']);

  // Escape aborts a drag: nothing moves and nothing is saved.
  await mouseDragTo(page, 'Drag Squat', 0, 0.2);
  await expect(page.locator('[data-drop-indicator]')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('[data-drop-indicator]')).toHaveCount(0);
  await page.mouse.up();
  await expect(exerciseNames(page)).toHaveText(['Drag Running', 'Drag Bench', 'Drag Squat']);

  // A drop back onto its own place saves nothing either.
  await mouseDragTo(page, 'Drag Bench', 1, 0.8);
  await expect(page.locator('[data-drop-indicator]')).toHaveCount(0);
  await page.mouse.up();
  await expect(exerciseNames(page)).toHaveText(['Drag Running', 'Drag Bench', 'Drag Squat']);
  expect(saves.count()).toBe(1);

  // The order is saved: it is still there after a reload, and the menu
  // still offers the moves.
  await openEditor(page, null);
  await expect(exerciseNames(page)).toHaveText(['Drag Running', 'Drag Bench', 'Drag Squat']);
  await page.getByRole('button', { name: 'Exercise actions' }).nth(0).click();
  await expect(page.getByRole('menuitem', { name: 'Move down' })).toBeEnabled();
});

test('a superset is dragged as one block and cannot be dropped into', async ({ page }) => {
  await register(page, '10.111.3.3');
  const { programId } = await seedWorkout(page, true);
  const saves = orderSaves(page);

  await openEditor(page, programId);
  await expect(exerciseNames(page)).toHaveText([...NAMES]);
  await expect(rows(page).nth(1)).toContainText('Superset A1');
  await expect(rows(page).nth(2)).toContainText('Superset A2');

  // Bench is released over the second member of the pair: it lands after
  // the whole pair, not between its members.
  await mouseDragTo(page, 'Drag Bench', 2, 0.3);
  await expect(page.locator('[data-drop-indicator]')).toBeVisible();
  await saved(page, () => page.mouse.up());
  await expect(exerciseNames(page)).toHaveText(['Drag Squat', 'Drag Running', 'Drag Bench']);
  await expect(rows(page).nth(0)).toContainText('Superset A1');
  await expect(rows(page).nth(1)).toContainText('Superset A2');

  // Dragged up onto the second member again, it stays where it is: the only
  // places are before and after the pair.
  await mouseDragTo(page, 'Drag Bench', 1, 0.3);
  await expect(page.locator('[data-drop-indicator]')).toHaveCount(0);
  await page.mouse.up();
  await expect(exerciseNames(page)).toHaveText(['Drag Squat', 'Drag Running', 'Drag Bench']);
  expect(saves.count()).toBe(1);

  // Dragging the second member of the pair takes the first one along.
  await mouseDragTo(page, 'Drag Running', 2, 0.8);
  await saved(page, () => page.mouse.up());
  await expect(exerciseNames(page)).toHaveText([...NAMES]);
  expect(saves.count()).toBe(2);

  await openEditor(page, null);
  await expect(exerciseNames(page)).toHaveText([...NAMES]);
  await expect(rows(page).nth(1)).toContainText('Superset A1');
  await expect(rows(page).nth(2)).toContainText('Superset A2');
});

test.describe('on a touch screen', () => {
  test.use({ hasTouch: true, viewport: { width: 390, height: 740 } });

  test('the grip drags and the rest of the row scrolls the page', async ({ page }) => {
    await register(page, '10.111.3.4');
    const { programId } = await seedWorkout(page);
    const saves = orderSaves(page);

    await openEditor(page, programId);
    await expect(exerciseNames(page)).toHaveText([...NAMES]);

    // Only the grip opts out of touch scrolling.
    const touchAction = (locator: Locator) =>
      locator.evaluate((el) => window.getComputedStyle(el).touchAction);
    expect(await touchAction(grip(page, 'Drag Running'))).toBe('none');
    expect(await touchAction(rows(page).nth(2))).toBe('auto');
    expect(await touchAction(exerciseNames(page).nth(2))).toBe('auto');

    // Real touch input, through the browser's own gesture handling.
    const cdp = await page.context().newCDPSession(page);
    const touch = (type: 'touchStart' | 'touchMove' | 'touchEnd', x?: number, y?: number) =>
      cdp.send('Input.dispatchTouchEvent', {
        type,
        touchPoints: x == null || y == null ? [] : [{ x: Math.round(x), y: Math.round(y), id: 1 }],
      });
    async function swipe(from: { x: number; y: number }, toY: number) {
      await touch('touchStart', from.x, from.y);
      const steps = 12;
      for (let step = 1; step <= steps; step += 1) {
        await touch('touchMove', from.x, from.y + ((toY - from.y) * step) / steps);
      }
    }

    // A finger on the exercise name scrolls the page and drags nothing. The
    // page is given room below the list, so the swipe can scroll it however
    // short the editor happens to be on this screen.
    await page.addStyleTag({ content: 'main { padding-bottom: 100vh !important; }' });
    await centerList(page);
    await scrollSettled(page);
    const before = await page.evaluate(() => window.scrollY);
    const name = await centerOf(exerciseNames(page).nth(1));
    await swipe(name, name.y - 120);
    await touch('touchEnd');
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(before);
    await scrollSettled(page);
    await expect(page.locator('[data-drop-indicator]')).toHaveCount(0);
    await expect(exerciseNames(page)).toHaveText([...NAMES]);
    expect(saves.count()).toBe(0);

    // A finger on the grip drags the row and leaves the page where it is.
    await expect(grip(page, 'Drag Running')).not.toHaveAttribute('aria-disabled', 'true');
    // The list is placed fully in view first: nothing of it is hidden, so
    // any change of the scroll position during the drag would be the page
    // panning under the finger.
    const placed = await placeListBelowHeader(page);
    expect(placed.listTop).toBeGreaterThanOrEqual(placed.headerBottom + 16);
    expect(placed.listBottom).toBeLessThanOrEqual(placed.viewportHeight - 16);
    await scrollSettled(page);
    const scrollBefore = await page.evaluate(() => window.scrollY);
    const from = await centerOf(grip(page, 'Drag Running'));
    await swipe(from, await rowY(page, 0, 0.2));
    await expect(page.locator('[data-drop-indicator]')).toBeVisible();
    expect(await page.evaluate(() => window.scrollY)).toBe(scrollBefore);
    await saved(page, () => touch('touchEnd').then(() => undefined));
    await expect(exerciseNames(page)).toHaveText(['Drag Running', 'Drag Bench', 'Drag Squat']);

    await openEditor(page, null);
    await expect(exerciseNames(page)).toHaveText(['Drag Running', 'Drag Bench', 'Drag Squat']);
    expect(saves.count()).toBe(1);
  });
});
