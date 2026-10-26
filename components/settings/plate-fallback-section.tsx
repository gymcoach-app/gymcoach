'use client';

import { useEffect, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  DEFAULT_PREFERENCES,
  loadPreferences,
  savePreferences,
  type UserPreferences,
} from '@/lib/preferences';
import { formatPlateList, parsePlateList } from '@/lib/plate-list';

// Editor for the plate-calculator fallback inventory (issue #285). When a
// saved gym is active the calculator uses that gym's bars and plates; these
// per-unit localStorage prefs are what it falls back to with no active gym,
// and the only place an lb plate inventory lives (gyms store kg only). The
// settings UI for them was removed with the gym profiles (#274); this
// restores it.
export function PlateFallbackSection() {
  const t = useTranslations('settings');
  const [prefs, setPrefs] = useState<UserPreferences>(DEFAULT_PREFERENCES);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    setPrefs(loadPreferences());
    setHydrated(true);
  }, []);

  function update<K extends keyof UserPreferences>(key: K, value: UserPreferences[K]) {
    // Re-read before writing: other settings cards keep their own copy of the
    // prefs, so spreading this component's state could resurrect stale values
    // they changed since mount.
    const next = { ...loadPreferences(), [key]: value };
    savePreferences(next);
    setPrefs(next);
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <h2 className="text-base font-semibold">{t('plateCalculator')}</h2>
        <p className="text-xs text-muted-foreground">{t('plateCalculatorDescription')}</p>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <BarPlatesRow
          unitLabel="kg"
          barWeight={prefs.barWeightKg}
          plates={prefs.platesKg}
          onBarChange={(v) => update('barWeightKg', v)}
          onPlatesChange={(v) => update('platesKg', v)}
          disabled={!hydrated}
        />
        <BarPlatesRow
          unitLabel="lb"
          barWeight={prefs.barWeightLb}
          plates={prefs.platesLb}
          onBarChange={(v) => update('barWeightLb', v)}
          onPlatesChange={(v) => update('platesLb', v)}
          disabled={!hydrated}
        />
      </CardContent>
    </Card>
  );
}

function BarPlatesRow({
  unitLabel,
  barWeight,
  plates,
  onBarChange,
  onPlatesChange,
  disabled,
}: {
  unitLabel: string;
  barWeight: number;
  plates: number[];
  onBarChange: (v: number) => void;
  onPlatesChange: (v: number[]) => void;
  disabled?: boolean;
}) {
  const t = useTranslations('settings');
  const locale = useLocale();
  // Edit plates as text; commit a cleaned, descending list on blur. Empty or
  // invalid entries are dropped so the calculator stays sane. The text uses the
  // locale's decimal mark, so "2,5" is one plate in French (issue #514).
  const hintId = `plates-${unitLabel}-hint`;
  // The text is controlled and re-synced from the saved list, so the values
  // hydrated from localStorage after mount actually show up (the pre-#274
  // editor used defaultValue and silently displayed the defaults).
  const joinedPlates = formatPlateList(plates, locale);
  const [platesText, setPlatesText] = useState(joinedPlates);
  useEffect(() => {
    setPlatesText(joinedPlates);
  }, [joinedPlates]);

  function commitPlates(raw: string) {
    const parsed = parsePlateList(raw, locale);
    onPlatesChange(parsed);
    setPlatesText(formatPlateList(parsed, locale));
  }

  return (
    <div className="rounded-md border border-border/40 p-3">
      <p className="mb-2 text-sm font-medium">{t('equipment', { unit: unitLabel })}</p>
      <div className="flex flex-col gap-3">
        <div className="space-y-1">
          <Label
            htmlFor={`bar-${unitLabel}`}
            className="text-xs uppercase tracking-wide text-muted-foreground"
          >
            {t('barWeight', { unit: unitLabel })}
          </Label>
          <Input
            id={`bar-${unitLabel}`}
            type="number"
            inputMode="decimal"
            step="0.5"
            value={barWeight}
            disabled={disabled}
            onChange={(e) => onBarChange(parseFloat(e.target.value) || 0)}
          />
        </div>
        <div className="space-y-1">
          <Label
            htmlFor={`plates-${unitLabel}`}
            className="text-xs uppercase tracking-wide text-muted-foreground"
          >
            {t('platesPerSide', { unit: unitLabel })}
          </Label>
          <Input
            id={`plates-${unitLabel}`}
            type="text"
            inputMode="decimal"
            value={platesText}
            disabled={disabled}
            onChange={(e) => setPlatesText(e.target.value)}
            onBlur={(e) => commitPlates(e.target.value)}
            placeholder={t('platesPlaceholder')}
            aria-describedby={hintId}
          />
          <p id={hintId} className="text-xs text-muted-foreground">
            {t('platesHint')}
          </p>
        </div>
      </div>
    </div>
  );
}
