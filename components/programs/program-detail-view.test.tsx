// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ProgramDetailView, type ProgramFull } from './program-detail-view';

const push = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ push, refresh: vi.fn() }) }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
// Display names are localized at render time; a copy must keep the STORED
// name (i18n/training-names.ts), so the hook here returns a visibly
// different label.
vi.mock('@/components/shared/use-training-name', () => ({
  useTrainingName: () => (name: string) => `Shown ${name}`,
}));

function program(name: string): ProgramFull {
  const now = new Date('2026-10-01T00:00:00Z');
  return {
    id: 'p1',
    userId: 'u1',
    name,
    description: null,
    phase: 'Base',
    isActive: false,
    startDate: now,
    endDate: null,
    createdAt: now,
    updatedAt: now,
    workouts: [],
  };
}

const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockResolvedValue(new Response(JSON.stringify({ id: 'p2' }), { status: 201 }));
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

function sentName(): string {
  const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
  return (JSON.parse(String(init.body)) as { name: string }).name;
}

describe('ProgramDetailView duplicate (issue #394)', () => {
  it('names the copy from the stored name, not its display translation', async () => {
    render(<ProgramDetailView program={program('Upper')} catalog={[]} />);
    fireEvent.click(screen.getByRole('button', { name: 'Duplicate' }));
    await waitFor(() => expect(push).toHaveBeenCalledWith('/programs/p2'));
    expect(sentName()).toBe('Upper (copy)');
  });

  it('keeps a long name within the 120-character limit', async () => {
    render(<ProgramDetailView program={program('x'.repeat(118))} catalog={[]} />);
    fireEvent.click(screen.getByRole('button', { name: 'Duplicate' }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(sentName()).toHaveLength(120);
    expect(sentName().endsWith(' (copy)')).toBe(true);
  });
});
