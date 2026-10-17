import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { toast } from 'sonner';
import {
  LiveEquipmentWeightEditor,
  parseDisplayWeightList,
  type LiveEquipmentOption,
} from './live-equipment-weight-editor';

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

const equipment: LiveEquipmentOption = {
  id: 'machine-1',
  name: 'Hack Squat',
  equipmentType: 'MACHINE',
  weightOptions: [20, 40, 60],
  exerciseLinks: [{ exerciseId: 'exercise-1' }],
};

const json = { 'Content-Type': 'application/json' };

// The item as the weights route returns it: the full saved row, with its links
// carrying the exercise, plus the exercises whose configs took the weights.
function serverItem(weightOptions: number[], name = equipment.name) {
  return {
    id: equipment.id,
    gymId: 'gym-1',
    name,
    equipmentType: equipment.equipmentType,
    weightOptions,
    exerciseLinks: [{ exercise: { id: 'exercise-1', name: 'Hack squat' } }],
  };
}

// The editor saves the weight list to the item's weights sub-resource (#380):
// one PUT, carrying nothing but the weights. By default the stub answers like
// the server: the saved item with the sent weights, and exercise-1 updated.
function stubEquipmentApi({
  saveStatus = 200,
  respond,
}: { saveStatus?: number; respond?: (weightOptions: number[]) => unknown } = {}) {
  const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
    const sent = JSON.parse(String(init?.body)).weightOptions as number[];
    const body = respond
      ? respond(sent)
      : { equipment: serverItem(sent), updatedExerciseIds: ['exercise-1'] };
    return new Response(JSON.stringify(body), { status: saveStatus, headers: json });
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function renderEditor(overrides: Partial<Parameters<typeof LiveEquipmentWeightEditor>[0]> = {}) {
  const onSaved = vi.fn();
  const onOpenChange = vi.fn();
  render(
    <LiveEquipmentWeightEditor
      open
      equipment={equipment}
      unit="KG"
      onOpenChange={onOpenChange}
      onSaved={onSaved}
      {...overrides}
    />,
  );
  const input = screen.getByLabelText('Available weights (KG)');
  const saveButton = screen.getByRole('button', { name: 'Save weights' });
  return { onSaved, onOpenChange, input, saveButton };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.mocked(toast.success).mockClear();
  vi.mocked(toast.error).mockClear();
});

describe('parseDisplayWeightList', () => {
  it('normalizes a discrete display-weight list', () => {
    expect(parseDisplayWeightList('20, 10; 20\n30.5 5', 'KG')).toEqual({
      ok: true,
      weightOptions: [5, 10, 20, 30.5],
    });
  });

  it('reads a comma between two digits as a decimal separator', () => {
    expect(parseDisplayWeightList('22,5 25; 27,5\n30', 'KG')).toEqual({
      ok: true,
      weightOptions: [22.5, 25, 27.5, 30],
    });
    // A comma followed by a space still separates two weights.
    expect(parseDisplayWeightList('22, 5', 'KG')).toEqual({ ok: true, weightOptions: [5, 22] });
  });

  it('names the first token it cannot read instead of dropping it', () => {
    expect(parseDisplayWeightList('20, junk, 30', 'KG')).toEqual({
      ok: false,
      problem: 'invalid',
      token: 'junk',
    });
    expect(parseDisplayWeightList('20 -5', 'KG')).toEqual({
      ok: false,
      problem: 'invalid',
      token: '-5',
    });
    // Commas glued between digits are decimals, so this is one unreadable
    // token, not the list 20, 40, 60 and not 20.4 either.
    expect(parseDisplayWeightList('20,40,60', 'KG')).toEqual({
      ok: false,
      problem: 'invalid',
      token: '20,40,60',
    });
  });

  it('refuses a number with a comma stuck to its front instead of guessing', () => {
    expect(parseDisplayWeightList(',5', 'KG')).toEqual({
      ok: false,
      problem: 'invalid',
      token: ',5',
    });
    // The typo for 22,5: reading it as 22 and 5 would save a 5 kg step.
    expect(parseDisplayWeightList('20 22 ,5 25', 'KG')).toEqual({
      ok: false,
      problem: 'invalid',
      token: ',5',
    });
    expect(parseDisplayWeightList('20,,5', 'KG')).toEqual({
      ok: false,
      problem: 'invalid',
      token: ',5',
    });
    // A comma on its own, or at the end of a number, is still a separator.
    expect(parseDisplayWeightList('20 , 40', 'KG')).toEqual({ ok: true, weightOptions: [20, 40] });
    expect(parseDisplayWeightList('20, 40,', 'KG')).toEqual({ ok: true, weightOptions: [20, 40] });
  });

  it('applies the server bounds in kg, whatever the display unit', () => {
    expect(parseDisplayWeightList('10 0', 'KG')).toEqual({
      ok: false,
      problem: 'outOfRange',
      token: '0',
    });
    expect(parseDisplayWeightList('0,05', 'KG')).toEqual({
      ok: false,
      problem: 'outOfRange',
      token: '0,05',
    });
    expect(parseDisplayWeightList('5000 5001', 'KG')).toEqual({
      ok: false,
      problem: 'outOfRange',
      token: '5001',
    });
    // 11100 lb is about 5035 kg.
    expect(parseDisplayWeightList('45 11100', 'LB')).toEqual({
      ok: false,
      problem: 'outOfRange',
      token: '11100',
    });
    expect(parseDisplayWeightList('45', 'LB')).toEqual({ ok: true, weightOptions: [20.41] });
  });

  it('refuses an empty list and more than 200 weights', () => {
    expect(parseDisplayWeightList('  ;\n ', 'KG')).toEqual({ ok: false, problem: 'empty' });
    const many = Array.from({ length: 201 }, (_, index) => index + 1).join(' ');
    expect(parseDisplayWeightList(many, 'KG')).toEqual({ ok: false, problem: 'tooMany' });
    const limit = Array.from({ length: 200 }, (_, index) => index + 1).join(' ');
    expect(parseDisplayWeightList(limit, 'KG')).toMatchObject({ ok: true });
  });
});

describe('LiveEquipmentWeightEditor', () => {
  it("saves the weight list to the item's weights sub-resource in one request", async () => {
    const user = userEvent.setup();
    const fetchMock = stubEquipmentApi();
    const { onSaved, onOpenChange, input, saveButton } = renderEditor();

    await user.clear(input);
    await user.type(input, '40, 20, 30, 20');
    await user.click(saveButton);

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('/api/gym-equipment/machine-1/weights');
    expect(init?.method).toBe('PUT');
    expect(JSON.parse(String(init?.body))).toEqual({ weightOptions: [20, 30, 40] });
    expect(onSaved).toHaveBeenCalledWith({ ...equipment, weightOptions: [20, 30, 40] }, [
      'exercise-1',
    ]);
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('saves decimal-comma weights as decimals', async () => {
    const user = userEvent.setup();
    const fetchMock = stubEquipmentApi();
    const { onSaved, input, saveButton } = renderEditor();

    await user.clear(input);
    await user.type(input, '22,5 25 27,5');
    await user.click(saveButton);

    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(JSON.parse(String(fetchMock.mock.calls[0]![1]?.body)).weightOptions).toEqual([
      22.5, 25, 27.5,
    ]);
  });

  it('sends nothing but the weights, so a stale name or type cannot be written back', async () => {
    const user = userEvent.setup();
    const fetchMock = stubEquipmentApi();
    const { onSaved, saveButton } = renderEditor();

    await user.click(saveButton);

    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    const body = JSON.parse(String(fetchMock.mock.calls[0]![1]?.body));
    expect(Object.keys(body)).toEqual(['weightOptions']);
  });

  it('adopts the item and the exercise updates the server reports, as a reload would show', async () => {
    const user = userEvent.setup();
    // Renamed since the page loaded, and exercise-1 has no gym config, so the
    // server updated no exercise.
    stubEquipmentApi({
      respond: (sent) => ({ equipment: serverItem(sent, 'Hack Squat v2'), updatedExerciseIds: [] }),
    });
    const { onSaved, input, saveButton } = renderEditor();

    await user.clear(input);
    await user.type(input, '25 50');
    await user.click(saveButton);

    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(onSaved).toHaveBeenCalledWith(
      { ...equipment, name: 'Hack Squat v2', weightOptions: [25, 50] },
      [],
    );
  });

  it('falls back to no exercise updates when the response cannot be read', async () => {
    const user = userEvent.setup();
    stubEquipmentApi({ respond: () => ({ unexpected: true }) });
    const { onSaved, input, saveButton } = renderEditor();

    await user.clear(input);
    await user.type(input, '25 50');
    await user.click(saveButton);

    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(onSaved).toHaveBeenCalledWith({ ...equipment, weightOptions: [25, 50] }, []);
    expect(toast.success).toHaveBeenCalled();
  });

  it('encodes the equipment id in the request path', async () => {
    const user = userEvent.setup();
    const fetchMock = stubEquipmentApi();
    const { onSaved, saveButton } = renderEditor({
      equipment: { ...equipment, id: 'machine/1 ?x' },
    });

    await user.click(saveButton);

    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      '/api/gym-equipment/machine%2F1%20%3Fx/weights',
    ]);
  });

  it('blocks the save and names the token it cannot read', async () => {
    const fetchMock = stubEquipmentApi();
    const { input, saveButton } = renderEditor();

    fireEvent.change(input, { target: { value: '20 4o 60' } });
    expect(screen.getByText('“4o” is not a valid weight.')).toBeInTheDocument();
    expect(saveButton).toBeDisabled();
    expect(input).toHaveAttribute('aria-invalid', 'true');

    fireEvent.change(input, { target: { value: '20 6000' } });
    expect(
      screen.getByText('“6000” is outside the allowed range (0.1 to 5000 kg).'),
    ).toBeInTheDocument();
    expect(saveButton).toBeDisabled();

    fireEvent.click(saveButton);
    expect(fetchMock).not.toHaveBeenCalled();

    fireEvent.change(input, { target: { value: '20 40 60' } });
    expect(saveButton).toBeEnabled();
    expect(input).toHaveAttribute('aria-invalid', 'false');
  });

  it('previews the list exactly as it will be saved', () => {
    stubEquipmentApi();
    const { input } = renderEditor();

    expect(screen.getByText('Will save: 20; 40; 60 kg')).toBeInTheDocument();

    // Glued digits are one decimal number, which the preview makes visible.
    fireEvent.change(input, { target: { value: '20,40' } });
    expect(screen.getByText('Will save: 20.4 kg')).toBeInTheDocument();

    // Sorted and de-duplicated, as the save sends it.
    fireEvent.change(input, { target: { value: '60 20; 20 22,5' } });
    expect(screen.getByText('Will save: 20; 22.5; 60 kg')).toBeInTheDocument();

    // The preview changes on every keystroke, so it must not sit in a live region.
    expect(screen.getByText('Will save: 20; 22.5; 60 kg').closest('[aria-live]')).toBeNull();

    fireEvent.change(input, { target: { value: '20 ,5' } });
    expect(screen.queryByText(/Will save/)).not.toBeInTheDocument();
    const problem = screen.getByText('“,5” is not a valid weight.');
    expect(problem).toBeInTheDocument();
    // A problem is announced.
    expect(problem.closest('[aria-live="polite"]')).not.toBeNull();
  });

  it('previews in the display unit', () => {
    stubEquipmentApi();
    render(
      <LiveEquipmentWeightEditor
        open
        equipment={{ ...equipment, weightOptions: [20.41, 45.36] }}
        unit="LB"
        onOpenChange={vi.fn()}
        onSaved={vi.fn()}
      />,
    );

    // Stored in kg (20.41 and 45.36), shown back in the unit the lifter types in.
    expect(screen.getByText('Will save: 45; 100 lb')).toBeInTheDocument();
  });

  it('opens quietly on equipment that has no weights yet', () => {
    const fetchMock = stubEquipmentApi();
    const { input, saveButton } = renderEditor({ equipment: { ...equipment, weightOptions: [] } });

    // Nothing typed yet: no error, but nothing to save either.
    expect(input).toHaveValue('');
    expect(screen.queryByText('Enter at least one weight.')).not.toBeInTheDocument();
    expect(input).toHaveAttribute('aria-invalid', 'false');
    expect(saveButton).toBeDisabled();
    fireEvent.click(saveButton);
    expect(fetchMock).not.toHaveBeenCalled();

    // Once the field was edited, an empty list is reported.
    fireEvent.change(input, { target: { value: '20' } });
    expect(saveButton).toBeEnabled();
    fireEvent.change(input, { target: { value: '' } });
    expect(screen.getByText('Enter at least one weight.')).toBeInTheDocument();
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(saveButton).toBeDisabled();
  });

  it('cannot save an empty list', () => {
    const fetchMock = stubEquipmentApi();
    const { input, saveButton } = renderEditor();

    fireEvent.change(input, { target: { value: '   ' } });
    expect(screen.getByText('Enter at least one weight.')).toBeInTheDocument();
    expect(saveButton).toBeDisabled();
    fireEvent.click(saveButton);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([
    { label: 'the save is refused', saveStatus: 500 },
    { label: 'the equipment is gone', saveStatus: 404 },
  ])('keeps the dialog and the typed text when $label', async ({ saveStatus }) => {
    const user = userEvent.setup();
    const fetchMock = stubEquipmentApi({ saveStatus });
    const { onSaved, onOpenChange, input, saveButton } = renderEditor();

    await user.clear(input);
    await user.type(input, '25 50 75');
    await user.click(saveButton);

    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith('Could not update equipment weights.'),
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(onSaved).not.toHaveBeenCalled();
    expect(onOpenChange).not.toHaveBeenCalled();
    expect(toast.success).not.toHaveBeenCalled();
    expect(input).toHaveValue('25 50 75');
    await waitFor(() => expect(saveButton).toBeEnabled());
  });
});
