import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import englishMessages from '@/messages/en';
import chineseMessages from '@/messages/zh-CN';
import { PhotosCard } from '@/components/progress/photos-card';
import { ConditioningCard } from '@/components/progress/conditioning-card';
import { ImportSection } from '@/components/settings/import-section';
import { SetInput } from '@/components/session/set-input';
import type { Exercise, ProgramExercise } from '@/lib/prisma-client';
import { toast } from 'sonner';

const originalScrollIntoView = Object.getOwnPropertyDescriptor(
  HTMLElement.prototype,
  'scrollIntoView',
);

// Exercise real locale providers instead of the global English-only hook mock.
vi.unmock('next-intl');
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('recharts', () => ({
  ResponsiveContainer: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  BarChart: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  CartesianGrid: () => null,
  XAxis: () => null,
  YAxis: () => null,
  Bar: () => null,
  ReferenceLine: ({ label }: { label: { value: string } }) => <span>{label.value}</span>,
  // jsdom has no chart geometry. Invoke the real component's tooltip callbacks
  // with the same shape Recharts supplies, so translated tooltip copy is tested.
  Tooltip: ({
    formatter,
    labelFormatter,
  }: {
    formatter: (value: number, name: string) => [string, string];
    labelFormatter: (label: string, payload: unknown[]) => string;
  }) => (
    <div>
      <span>{formatter(45, 'minutes').join(': ')}</span>
      <span>{labelFormatter('06/08', [{ payload: { distanceKm: 5.5, sessions: 1 } }])}</span>
    </div>
  ),
}));

function localized(locale: 'en' | 'zh-CN', children: ReactNode) {
  return render(
    <NextIntlClientProvider
      locale={locale}
      messages={locale === 'en' ? englishMessages : chineseMessages}
      timeZone="UTC"
      onError={(error) => {
        throw error;
      }}
    >
      {children}
    </NextIntlClientProvider>,
  );
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
  if (originalScrollIntoView) {
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', originalScrollIntoView);
  } else {
    Reflect.deleteProperty(HTMLElement.prototype, 'scrollIntoView');
  }
});

describe.each(['en', 'zh-CN'] as const)('static application UI in %s', (locale) => {
  const zh = locale === 'zh-CN';

  it('localizes photo fields, empty state and missing-file feedback', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    localized(locale, <PhotosCard photos={[]} />);
    expect(
      screen.getByRole('heading', { name: zh ? '体型进度照片' : 'Progress photos' }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText(zh ? '照片' : 'Photo')).toHaveAttribute('type', 'file');
    expect(screen.getByLabelText(zh ? '日期' : 'Date')).toHaveAttribute('type', 'date');
    expect(screen.getByText(zh ? /只有你可以查看/ : /only visible to you/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: zh ? '上传' : 'Upload' }));
    expect(toast.error).toHaveBeenCalledWith(zh ? '请先选择照片。' : 'Choose a photo first.');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('localizes photo comparison and cancelled deletion without changing user notes or element IDs', async () => {
    const confirm = vi.fn().mockReturnValue(false);
    const fetchMock = vi.fn();
    vi.stubGlobal('confirm', confirm);
    vi.stubGlobal('fetch', fetchMock);
    const note = 'Original user note 原始备注';
    localized(
      locale,
      <PhotosCard
        photos={[
          { id: 'p2', takenAt: '2026-06-09T12:00:00Z', note },
          { id: 'p1', takenAt: '2026-06-08T12:00:00Z', note: null },
        ]}
      />,
    );
    expect(screen.getByLabelText(zh ? '之前' : 'Before')).toHaveAttribute(
      'id',
      'progress-photo-before',
    );
    expect(screen.getByLabelText(zh ? '之后' : 'After')).toHaveAttribute(
      'id',
      'progress-photo-after',
    );
    expect(
      screen.getAllByRole('img').some((image) => image.getAttribute('alt')?.includes(note)),
    ).toBe(true);
    await userEvent.click(
      screen.getAllByRole('button', { name: zh ? /^删除 .* 的照片$/ : /^Delete photo of / })[0]!,
    );
    expect(confirm).toHaveBeenCalledWith(
      zh
        ? expect.stringMatching(/^确定删除 .* 的照片吗？$/)
        : expect.stringMatching(/^Delete the photo of /),
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('localizes conditioning totals, tooltip duration, week and session count', () => {
    localized(
      locale,
      <ConditioningCard
        weeks={[
          {
            weekKey: '2026-W23',
            weekStartIso: '2026-06-01T00:00:00Z',
            minutes: 90,
            distanceKm: 10,
            sessions: 2,
          },
          {
            weekKey: '2026-W24',
            weekStartIso: '2026-06-08T00:00:00Z',
            minutes: 45,
            distanceKm: 5.5,
            sessions: 1,
          },
        ]}
      />,
    );
    expect(
      screen.getByText(
        zh
          ? '本周：45 分钟 · 5.5 公里 · 1 次训练 · 最近 2 周合计：135 分钟，15.5 公里。'
          : 'This week: 45 min · 5.5 km · 1 session · 2-week total: 135 min, 15.5 km.',
      ),
    ).toBeInTheDocument();
    expect(screen.getByText(zh ? '45 分钟: 时长' : '45 min: Duration')).toBeInTheDocument();
    expect(
      screen.getByText(
        zh ? '06/08 所在周 · 5.5 km · 1 次训练' : 'Week of 06/08 · 5.5 km · 1 session',
      ),
    ).toBeInTheDocument();
  });

  it('localizes import instructions and all activity file options without calling the import API', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    localized(locale, <ImportSection />);
    expect(
      screen.getByText(
        zh ? /在 Strong 中导出 CSV/ : /export it as CSV \(Settings, then Export data\)/,
      ),
    ).toBeInTheDocument();
    const user = userEvent.setup();
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
      configurable: true,
      value: vi.fn(),
    });
    screen.getByRole('combobox', { name: zh ? '来源应用' : 'Source app' }).focus();
    await user.keyboard('{ArrowDown}');
    for (const format of ['TCX', 'GPX', 'FIT']) {
      expect(
        screen.getByRole('option', { name: zh ? `${format} 文件` : `${format} file` }),
      ).toBeInTheDocument();
    }
    await user.click(screen.getByRole('option', { name: zh ? 'TCX 文件' : 'TCX file' }));
    expect(
      screen.getByText(zh ? /从运动手表平台/ : /export the activity as TCX/),
    ).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('omits optional conditioning distance and session text for an empty window', () => {
    localized(locale, <ConditioningCard weeks={[]} />);
    expect(
      screen.getByText(
        zh ? '本周：0 分钟 · 最近 0 周合计：0 分钟。' : 'This week: 0 min · 0-week total: 0 min.',
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText(/none/)).not.toBeInTheDocument();
  });

  it('localizes repetition controls and adjusts only the input until submission', async () => {
    const exercise: Exercise = {
      id: 'e',
      userId: 'u',
      name: 'Original Squat',
      muscleGroup: 'QUADS',
      category: 'COMPOUND',
      equipmentType: 'BARBELL',
      defaultRestSec: 120,
      notes: null,
      usesBodyweight: false,
      isFavorite: false,
      createdAt: new Date('2026-06-08'),
    };
    const programExercise: ProgramExercise & { exercise: Exercise } = {
      id: 'pe',
      workoutId: 'w',
      exerciseId: 'e',
      order: 0,
      targetSets: 3,
      targetRepsMin: 6,
      targetRepsMax: 10,
      targetRIR: 2,
      restSec: 120,
      tempo: null,
      notes: null,
      supersetGroup: null,
      autoregulationMode: 'PRESERVE_RIR',
      fatigueRate: null,
      loadAdjustmentPct: null,
      exercise,
    };
    const onSubmit = vi.fn();
    localized(
      locale,
      <SetInput
        programExercise={programExercise}
        existingSets={[]}
        lastPerformance={undefined}
        readiness={null}
        deloadActive={false}
        unit="KG"
        onSubmit={onSubmit}
      />,
    );
    const reps = screen.getByRole('button', { name: zh ? '增加 1 次' : '+1 rep' });
    const inputs = screen.getAllByRole('spinbutton');
    const before = inputs.map((input) => (input as HTMLInputElement).value);
    await userEvent.click(reps);
    expect(inputs.map((input) => (input as HTMLInputElement).value)).not.toEqual(before);
    expect(screen.getByRole('button', { name: zh ? '减少 1 次' : '-1 rep' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: zh ? '减少 1 次' : '-1 rep' }));
    expect(inputs.map((input) => (input as HTMLInputElement).value)).toEqual(before);
    expect(onSubmit).not.toHaveBeenCalled();
  });
});
