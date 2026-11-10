import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SaveAsWorkoutButton } from './save-as-workout-button';

const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock('sonner', () => ({ toast }));
const push = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ push }) }));

const programs = [
  { id: 'p-other', name: 'Other program' },
  { id: 'p-source', name: 'Source program' },
];

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

function open(props: Partial<Parameters<typeof SaveAsWorkoutButton>[0]> = {}) {
  render(
    <SaveAsWorkoutButton
      sessionId="s1"
      programs={programs}
      defaultProgramId="p-source"
      defaultName="Push day"
      effortScale="RIR"
      {...props}
    />,
  );
  fireEvent.click(screen.getByRole('button', { name: 'Save as a workout' }));
}

describe('SaveAsWorkoutButton (issue #394)', () => {
  it("names the trainee's effort scale in the description", () => {
    open({ effortScale: 'RPE' });
    expect(screen.getByText(/rep range and average RPE\./)).toBeInTheDocument();
    expect(screen.queryByText(/average RIR/)).not.toBeInTheDocument();
  });

  it('keeps naming RIR on the RIR scale', () => {
    open();
    expect(screen.getByText(/rep range and average RIR\./)).toBeInTheDocument();
  });

  it("saves into the session's own program and opens it", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('{}', { status: 201 }));
    vi.stubGlobal('fetch', fetchMock);
    open();

    fireEvent.change(screen.getByLabelText('Workout name'), { target: { value: ' Improvised ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(push).toHaveBeenCalledWith('/programs/p-source'));
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/sessions/s1/save-as-workout');
    expect(JSON.parse(init.body as string)).toEqual({
      programId: 'p-source',
      name: 'Improvised',
      dayOfWeek: null,
    });
    expect(toast.success).toHaveBeenCalledWith('Workout saved.');
  });

  it('falls back to the first program when the source one is gone', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('{}', { status: 201 }));
    vi.stubGlobal('fetch', fetchMock);
    open({ defaultProgramId: 'deleted' });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(push).toHaveBeenCalledWith('/programs/p-other'));
  });

  it('shows the error toast when the save fails, offline included', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('offline')));
    open();
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Could not save the workout.'));
    expect(push).not.toHaveBeenCalled();
  });

  it('asks for a program first when the trainee has none', () => {
    open({ programs: [], defaultProgramId: null });
    expect(
      screen.getByText('Create a program first to save this session into it.'),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Save' })).toBeNull();
  });

  it('cannot save with an empty name', () => {
    open();
    fireEvent.change(screen.getByLabelText('Workout name'), { target: { value: '  ' } });
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
  });
});
