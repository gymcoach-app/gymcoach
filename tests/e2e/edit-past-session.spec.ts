import { test, expect } from '@playwright/test';

// Log a past workout and edit it (issue #389): from the history, a lifter
// logs a workout on a past date, enters a set in the history editor, then
// corrects the weight and the date. The session is finished from the start
// (never the session in progress), its set is dated inside it, and the
// history shows the corrected values.

const MINUTE = 60 * 1000;

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

// A date `days` ago as the value of a date field, in the zone of this
// process, which is also the browser's.
function dateFieldValue(days: number): string {
  const date = new Date();
  date.setDate(date.getDate() - days);
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function localInstant(dateValue: string, hours: number, minutes: number): number {
  const [year, month, day] = dateValue.split('-').map(Number) as [number, number, number];
  return new Date(year, month - 1, day, hours, minutes).getTime();
}

interface SessionBody {
  startedAt: string;
  finishedAt: string | null;
  freestyle: boolean;
  sets: { setNumber: number; weight: number; reps: number; completedAt: string }[];
}

test('history: log a past workout, enter a set, then correct its weight and date', async ({
  page,
}) => {
  const registerRes = await page.request.post('/api/auth/register', {
    headers: { 'x-forwarded-for': '10.111.3.89' },
    data: {
      displayName: 'Past Workout E2E',
      email: `e2e-past-workout-${Date.now()}@test.dev`,
      password: 'supersecret',
    },
  });
  expect(registerRes.ok()).toBeTruthy();
  const exerciseRes = await page.request.post('/api/exercises', {
    data: {
      name: 'E2E Backfill Press',
      muscleGroup: 'CHEST',
      category: 'COMPOUND',
      equipmentType: 'BARBELL',
    },
  });
  expect(exerciseRes.ok()).toBeTruthy();

  // A future date is refused by the server, whatever the form allows.
  const futureRes = await page.request.post('/api/sessions/past', {
    data: { startedAt: new Date(Date.now() + 24 * 60 * MINUTE).toISOString(), durationMin: 60 },
  });
  expect(futureRes.status()).toBe(400);

  // Log a freestyle workout ten days ago, 18:30 for 45 minutes.
  const firstDate = dateFieldValue(10);
  await page.goto('/history');
  await page.getByRole('button', { name: 'Log a past workout' }).click();
  await page.getByLabel('Date', { exact: true }).fill(firstDate);
  await page.getByLabel('Start time').fill('18:30');
  await page.getByLabel('Duration (min)').fill('45');
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.waitForURL((url) => /^\/history\/[^/]+\/edit$/.test(url.pathname));
  const sessionId = new URL(page.url()).pathname.split('/')[2] as string;

  const readSession = async () =>
    (await (await page.request.get(`/api/sessions/${sessionId}`)).json()) as SessionBody;
  const firstStart = localInstant(firstDate, 18, 30);
  const createdSession = await readSession();
  expect(new Date(createdSession.startedAt).getTime()).toBe(firstStart);
  expect(new Date(createdSession.finishedAt as string).getTime()).toBe(firstStart + 45 * MINUTE);
  expect(createdSession.freestyle).toBe(true);

  // It is finished: the home page offers no session to resume.
  const openSessions = (await (await page.request.get('/api/sessions')).json()) as {
    finishedAt: string | null;
  }[];
  expect(openSessions.filter((session) => session.finishedAt === null)).toHaveLength(0);

  // Enter a set: pick the exercise, type the weight, confirm.
  await page.getByRole('button', { name: 'Add an exercise' }).click();
  await page.getByLabel('Search exercises').fill('Backfill');
  await page.getByRole('button', { name: 'E2E Backfill Press' }).click();
  await page.getByRole('button', { name: 'Set 1 weight in KG' }).click();
  await page.getByRole('spinbutton').fill('80');
  await page.getByLabel('Apply value').click();
  const added = page.waitForResponse(
    (res) =>
      res.url().endsWith(`/api/sessions/${sessionId}/sets`) && res.request().method() === 'POST',
  );
  await page.getByRole('button', { name: 'Confirm set 1' }).click();
  expect((await added).status()).toBe(201);

  let body = await readSession();
  expect(body.sets.map((set) => [set.setNumber, set.weight])).toEqual([[1, 80]]);
  // Dated inside the session, not at the time it was typed.
  const firstCompletedAt = new Date(body.sets[0]!.completedAt).getTime();
  expect(firstCompletedAt).toBeGreaterThanOrEqual(firstStart);
  expect(firstCompletedAt).toBeLessThanOrEqual(firstStart + 45 * MINUTE);

  // Correct the weight of the logged set: 80 was a typo for 85.
  const corrected = page.waitForResponse(
    (res) => /\/api\/sets\/[^/]+$/.test(res.url()) && res.request().method() === 'PATCH',
  );
  await page.getByTestId('amend-set-row-1').getByRole('button', { name: 'Set 1 weight in KG' }).click();
  await page.getByRole('spinbutton').fill('85');
  await page.getByLabel('Apply value').click();
  expect((await corrected).status()).toBe(200);

  // Move the session two days earlier; its set follows.
  const secondDate = dateFieldValue(12);
  await page.getByLabel('Date', { exact: true }).fill(secondDate);
  const moved = page.waitForResponse(
    (res) => res.url().endsWith(`/api/sessions/${sessionId}`) && res.request().method() === 'PATCH',
  );
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  expect((await moved).status()).toBe(200);

  const secondStart = localInstant(secondDate, 18, 30);
  body = await readSession();
  expect(new Date(body.startedAt).getTime()).toBe(secondStart);
  expect(new Date(body.finishedAt as string).getTime()).toBe(secondStart + 45 * MINUTE);
  expect(body.sets.map((set) => set.weight)).toEqual([85]);
  expect(new Date(body.sets[0]!.completedAt).getTime()).toBe(
    firstCompletedAt + (secondStart - firstStart),
  );

  // The history shows the corrected session, and offers to edit it again.
  await page.getByRole('button', { name: 'Done' }).click();
  await page.waitForURL((url) => url.pathname === `/history/${sessionId}`);
  await expect(page.getByRole('heading', { name: 'E2E Backfill Press' })).toBeVisible();
  await expect(page.getByRole('cell', { name: '85 kg' })).toBeVisible();
  await expect(page.getByText('45 min')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Edit', exact: true })).toBeVisible();
});
