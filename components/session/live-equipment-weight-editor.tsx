'use client';

import { useEffect, useMemo, useState } from 'react';
import { Loader2, Save } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { toast } from 'sonner';
import type { EquipmentType, WeightUnit } from '@/lib/prisma-client';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { formatWeight, fromDisplayWeight, roundWeight, toDisplayWeight } from '@/lib/units';

export interface LiveEquipmentOption {
  id: string;
  name: string;
  equipmentType: EquipmentType;
  weightOptions: number[];
  exerciseLinks: { exerciseId: string }[];
}

interface Props {
  open: boolean;
  equipment: LiveEquipmentOption;
  unit: WeightUnit;
  onOpenChange: (open: boolean) => void;
  onSaved: (equipment: LiveEquipmentOption) => void;
}

// Same bounds as gymWeightListSchema (lib/schemas/gym), which the save goes
// through: each weight between 0.1 and 5000 kg, at most 200 of them.
const MIN_WEIGHT_KG = 0.1;
const MAX_WEIGHT_KG = 5000;
const MAX_WEIGHTS = 200;

export type WeightListResult =
  | { ok: true; weightOptions: number[] }
  | { ok: false; problem: 'empty' }
  | { ok: false; problem: 'tooMany' }
  | { ok: false; problem: 'invalid'; token: string }
  | { ok: false; problem: 'outOfRange'; token: string };

export function LiveEquipmentWeightEditor({ open, equipment, unit, onOpenChange, onSaved }: Props) {
  const t = useTranslations('session.editableSets.weightEditor');
  const locale = useLocale();
  const [value, setValue] = useState('');
  // Whether the lifter has typed since the dialog opened. Equipment with no
  // weights yet opens on an empty field: that is a starting point, not an error.
  const [edited, setEdited] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setEdited(false);
    setValue(
      equipment.weightOptions
        .map((weight) => roundWeight(toDisplayWeight(weight, unit), 2))
        .join('; '),
    );
  }, [equipment.id, equipment.weightOptions, open, unit]);

  const parsed = useMemo(() => parseDisplayWeightList(value, unit), [value, unit]);
  const problem = parsed.ok
    ? null
    : parsed.problem === 'empty'
      ? edited
        ? t('empty')
        : null
      : parsed.problem === 'tooMany'
        ? t('tooManyWeights')
        : parsed.problem === 'invalid'
          ? t('invalidWeight', { token: parsed.token })
          : t('outOfRange', { token: parsed.token });
  // The list exactly as it will be saved, back in the display unit, so a
  // reading the lifter did not intend (20,40 is 20.4) is visible before saving.
  const preview = parsed.ok
    ? t('preview', {
        weights: parsed.weightOptions
          .map((weight) =>
            formatWeight(weight, unit, { decimals: 2, group: false, locale, withUnit: false }),
          )
          .join('; '),
        unit: unit.toLowerCase(),
      })
    : null;

  async function save() {
    if (saving || !parsed.ok) return;
    const weightOptions = parsed.weightOptions;

    setSaving(true);
    try {
      // The item's weights are a sub-resource, so this save carries nothing
      // else: name, type and every exercise's availability stay as the server
      // holds them, and no re-read is needed to protect them (#380).
      const url = '/api/gym-equipment/' + encodeURIComponent(equipment.id) + '/weights';
      const response = await fetch(url, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ weightOptions }),
      });
      if (!response.ok) throw new Error('save failed');
      onSaved({ ...equipment, weightOptions });
      onOpenChange(false);
      toast.success(t('saved'));
    } catch {
      toast.error(t('saveError'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogTitle>{t('title', { name: equipment.name })}</DialogTitle>
        <DialogDescription>{t('description')}</DialogDescription>
        <div className="space-y-2">
          <Label htmlFor="live-equipment-weights">{t('weights', { unit })}</Label>
          <Input
            id="live-equipment-weights"
            value={value}
            onChange={(event) => {
              setEdited(true);
              setValue(event.target.value);
            }}
            // A list needs separators, which the numeric keypads do not offer.
            inputMode="text"
            autoComplete="off"
            placeholder={t('placeholder')}
            disabled={saving}
            aria-invalid={problem != null}
            aria-describedby="live-equipment-weights-help live-equipment-weights-status"
          />
          <p id="live-equipment-weights-help" className="text-xs text-muted-foreground">
            {t('help')}
          </p>
          {/* Only a problem is announced: the preview changes on every keystroke. */}
          <div id="live-equipment-weights-status" className="min-h-5 text-sm">
            <p aria-live="polite" className="text-destructive">
              {problem}
            </p>
            {problem == null && preview ? <p className="text-muted-foreground">{preview}</p> : null}
          </div>
        </div>
        <Button type="button" onClick={save} disabled={saving || !parsed.ok} className="w-full">
          {saving ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
          <span className="ml-2">{t('save')}</span>
        </Button>
      </DialogContent>
    </Dialog>
  );
}

// Reads a typed list of weights in the display unit and returns it in kg, or
// the first thing that stops it from being saved. Nothing is dropped silently.
//
// Weights are separated by whitespace, a semicolon or a new line. A comma
// directly between two digits is a decimal separator (22,5 is 22.5, the
// natural form in French and Russian); any other comma separates two weights,
// so "20, 40, 60" still reads as three. A comma stuck to the front of a number
// (",5", or the "22 ,5" typo for 22,5) is refused: guessing would save 5.
export function parseDisplayWeightList(raw: string, unit: WeightUnit): WeightListResult {
  const tokens = raw
    .split(/[\s;]+/)
    .flatMap((chunk) => chunk.split(/,(?!\d)/))
    .filter((token) => token !== '');
  if (tokens.length === 0) return { ok: false, problem: 'empty' };

  const weightOptions = new Set<number>();
  for (const token of tokens) {
    if (!/^\d+(?:[.,]\d+)?$/.test(token)) return { ok: false, problem: 'invalid', token };
    const kg = roundWeight(fromDisplayWeight(Number(token.replace(',', '.')), unit), 2);
    if (kg < MIN_WEIGHT_KG || kg > MAX_WEIGHT_KG) {
      return { ok: false, problem: 'outOfRange', token };
    }
    weightOptions.add(kg);
  }
  if (weightOptions.size > MAX_WEIGHTS) return { ok: false, problem: 'tooMany' };
  return { ok: true, weightOptions: [...weightOptions].sort((a, b) => a - b) };
}
