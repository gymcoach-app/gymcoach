import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { CoachAdjustments } from './coach-adjustments';
import { EffortScaleProvider } from '@/components/shared/effort-scale-provider';

afterEach(() => {
  vi.unstubAllGlobals();
});

function renderAdjustments(scale: 'RIR' | 'RPE') {
  const fetchMock = vi.fn(async () =>
    Response.json({ appliedAt: '2026-11-10T10:00:00.000Z', applied: [], skipped: [] }),
  );
  vi.stubGlobal('fetch', fetchMock);
  render(
    <EffortScaleProvider scale={scale}>
      <CoachAdjustments
        debriefId="debrief-1"
        initialAdjustments={[
          { exerciseName: 'Bench Press', summary: 'Push a little harder', suggestedRIR: 3 },
        ]}
        programDefaults={{}}
        alreadyApplied={false}
        onApplied={vi.fn()}
      />
    </EffortScaleProvider>,
  );
  return fetchMock;
}

async function appliedRir(fetchMock: ReturnType<typeof vi.fn>): Promise<unknown> {
  fireEvent.click(screen.getByRole('button', { name: 'Apply 1 adjustment' }));
  await waitFor(() => expect(fetchMock).toHaveBeenCalled());
  const init = fetchMock.mock.calls[0]![1] as RequestInit;
  const body = JSON.parse(String(init.body)) as { adjustments: { suggestedRIR: unknown }[] };
  return body.adjustments[0]!.suggestedRIR;
}

describe('CoachAdjustments effort target', () => {
  it('shows the suggestion as RPE and applies the RIR behind the RPE typed', async () => {
    const fetchMock = renderAdjustments('RPE');
    const field = screen.getByLabelText('RPE') as HTMLInputElement;
    expect(field.value).toBe('7');
    fireEvent.change(field, { target: { value: '8' } });
    expect(await appliedRir(fetchMock)).toBe(2);
  });

  it('applies the untouched suggestion as its stored RIR on the RPE scale', async () => {
    const fetchMock = renderAdjustments('RPE');
    expect(await appliedRir(fetchMock)).toBe(3);
  });

  it('does not send a fractional RIR the apply route would refuse', async () => {
    const fetchMock = renderAdjustments('RIR');
    const field = screen.getByLabelText('RIR') as HTMLInputElement;
    fireEvent.focus(field);
    fireEvent.change(field, { target: { value: '2.5' } });
    expect(field).toHaveAttribute('aria-invalid', 'true');
    // Nothing fractional leaves the field: the suggestion keeps its whole RIR.
    expect(await appliedRir(fetchMock)).toBe(3);
  });

  it('clears the suggested effort when the field is emptied', async () => {
    const fetchMock = renderAdjustments('RPE');
    fireEvent.change(screen.getByLabelText('RPE'), { target: { value: '' } });
    expect(await appliedRir(fetchMock)).toBeNull();
  });

  it('keeps the RIR field and value as they were on the RIR scale', async () => {
    const fetchMock = renderAdjustments('RIR');
    const field = screen.getByLabelText('RIR') as HTMLInputElement;
    expect(field.value).toBe('3');
    fireEvent.change(field, { target: { value: '1' } });
    expect(await appliedRir(fetchMock)).toBe(1);
  });
});
