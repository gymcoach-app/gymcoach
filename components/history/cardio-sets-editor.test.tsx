import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CardioSetsEditor, type CardioEditorSet } from './cardio-sets-editor';
import { DistanceUnitProvider } from '@/components/shared/distance-unit-provider';
import type { DistanceUnit } from '@/lib/cardio';

const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock('sonner', () => ({ toast }));

const run: CardioEditorSet = {
  id: 'run-1',
  setNumber: 1,
  durationSec: 1500,
  distanceM: 5000,
  avgHr: 150,
  maxHr: null,
};

afterEach(() => {
  vi.clearAllMocks();
});

function renderEditor(
  sets: CardioEditorSet[] = [run],
  unit: DistanceUnit = 'km',
  disabled = false,
) {
  const handlers = {
    onAdd: vi.fn().mockResolvedValue(true),
    onSave: vi.fn().mockResolvedValue(true),
    onDelete: vi.fn().mockResolvedValue(true),
  };
  render(
    <DistanceUnitProvider unit={unit}>
      <CardioSetsEditor sets={sets} disabled={disabled} {...handlers} />
    </DistanceUnitProvider>,
  );
  return handlers;
}

describe('CardioSetsEditor (issue #389)', () => {
  it('shows the stored cardio fields of a set', () => {
    renderEditor();
    expect(screen.getByLabelText('Set 1 duration (mm:ss)')).toHaveValue('25:00');
    expect(screen.getByLabelText('Set 1 distance (km)')).toHaveValue('5');
    expect(screen.getByLabelText('Set 1 average heart rate')).toHaveValue('150');
    expect(screen.getByLabelText('Set 1 peak heart rate')).toHaveValue('');
    // Nothing to save until a field changes.
    expect(screen.getByRole('button', { name: 'Save set 1' })).toBeDisabled();
  });

  it('saves an edited set with seconds, meters and heart rates', async () => {
    const { onSave } = renderEditor();
    fireEvent.change(screen.getByLabelText('Set 1 duration (mm:ss)'), {
      target: { value: '27:30' },
    });
    fireEvent.change(screen.getByLabelText('Set 1 distance (km)'), { target: { value: '5,2' } });
    fireEvent.change(screen.getByLabelText('Set 1 peak heart rate'), { target: { value: '171' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save set 1' }));

    await waitFor(() =>
      expect(onSave).toHaveBeenCalledWith(run, {
        durationSec: 1650,
        distanceM: 5200,
        avgHr: 150,
        maxHr: 171,
      }),
    );
  });

  it('keeps the stored meters when a miles user saves without touching the distance', async () => {
    const { onSave } = renderEditor([run], 'mi');
    // 5000 m reads 3.11 mi; converting that back would store 5005 m.
    expect(screen.getByLabelText('Set 1 distance (mi)')).toHaveValue('3.11');
    fireEvent.change(screen.getByLabelText('Set 1 duration (mm:ss)'), {
      target: { value: '26:00' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save set 1' }));

    await waitFor(() =>
      expect(onSave).toHaveBeenCalledWith(run, expect.objectContaining({ distanceM: 5000 })),
    );
  });

  it('refuses invalid values with a message and sends nothing', () => {
    const { onSave, onAdd } = renderEditor();
    fireEvent.change(screen.getByLabelText('Set 1 average heart rate'), { target: { value: '20' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save set 1' }));
    fireEvent.change(screen.getByLabelText('Set 2 duration (mm:ss)'), { target: { value: 'abc' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add set 2' }));

    expect(onSave).not.toHaveBeenCalled();
    expect(onAdd).not.toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalledTimes(2);
    expect(toast.error).toHaveBeenCalledWith('Enter a valid duration, for example 25:00.');
  });

  it('adds a set after the last one and clears the row once it is stored', async () => {
    const { onAdd } = renderEditor();
    const add = screen.getByRole('button', { name: 'Add set 2' });
    expect(add).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Set 2 duration (mm:ss)'), { target: { value: '12' } });
    fireEvent.click(add);

    await waitFor(() =>
      expect(onAdd).toHaveBeenCalledWith({
        durationSec: 720,
        distanceM: null,
        avgHr: null,
        maxHr: null,
      }),
    );
    await waitFor(() => expect(screen.getByLabelText('Set 2 duration (mm:ss)')).toHaveValue(''));
  });

  it('keeps what was typed when the server refuses the new set', async () => {
    const { onAdd } = renderEditor([]);
    onAdd.mockResolvedValue(false);
    fireEvent.change(screen.getByLabelText('Set 1 duration (mm:ss)'), { target: { value: '30:00' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add set 1' }));

    await waitFor(() => expect(onAdd).toHaveBeenCalled());
    await waitFor(() => expect(screen.getByRole('button', { name: 'Add set 1' })).toBeEnabled());
    expect(screen.getByLabelText('Set 1 duration (mm:ss)')).toHaveValue('30:00');
  });

  it('changes nothing while the caller has it disabled', () => {
    const { onAdd, onDelete } = renderEditor([run], 'km', true);
    expect(screen.getByLabelText('Set 1 duration (mm:ss)')).toBeDisabled();
    expect(screen.getByLabelText('Set 2 duration (mm:ss)')).toBeDisabled();
    const remove = screen.getByRole('button', { name: 'Delete set 1' });
    expect(remove).toBeDisabled();
    fireEvent.click(remove);
    expect(screen.getByRole('button', { name: 'Add set 2' })).toBeDisabled();
    expect(onDelete).not.toHaveBeenCalled();
    expect(onAdd).not.toHaveBeenCalled();
  });

  it('deletes a set', async () => {
    const { onDelete } = renderEditor();
    fireEvent.click(screen.getByRole('button', { name: 'Delete set 1' }));
    await waitFor(() => expect(onDelete).toHaveBeenCalledWith(run));
  });
});
