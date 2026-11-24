'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { MAX_SESSION_DURATION_MIN, toLocalInputs, type TimingInputs } from '@/lib/session-edit';

interface Props {
  // Prefix of the field ids, so two forms on one page never share a label.
  idPrefix: string;
  value: TimingInputs;
  onChange: (value: TimingInputs) => void;
  disabled?: boolean;
}

// The date, start time and duration of a session (issue #389), shared by the
// history editor and the "Log a past workout" dialog. The fields hold the
// lifter's wall-clock values, in the browser's zone; the caller turns them
// into an instant (parseTimingInputs in lib/session-edit).
export function SessionTimingFields({ idPrefix, value, onChange, disabled = false }: Props) {
  const t = useTranslations('history.edit');
  // "Today" in the browser's zone, known only after mount: the server renders
  // this component too, in its own zone.
  const [today, setToday] = useState<string | undefined>(undefined);
  useEffect(() => {
    setToday(toLocalInputs(new Date()).date);
  }, []);

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
      <div className="col-span-2 space-y-1.5 sm:col-span-1">
        <Label htmlFor={`${idPrefix}-date`}>{t('date')}</Label>
        <Input
          id={`${idPrefix}-date`}
          type="date"
          value={value.date}
          max={today}
          disabled={disabled}
          onChange={(event) => onChange({ ...value, date: event.target.value })}
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor={`${idPrefix}-time`}>{t('startTime')}</Label>
        <Input
          id={`${idPrefix}-time`}
          type="time"
          value={value.time}
          disabled={disabled}
          onChange={(event) => onChange({ ...value, time: event.target.value })}
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor={`${idPrefix}-duration`}>{t('duration')}</Label>
        <Input
          id={`${idPrefix}-duration`}
          type="number"
          inputMode="numeric"
          min={1}
          max={MAX_SESSION_DURATION_MIN}
          step={1}
          value={value.duration}
          disabled={disabled}
          onChange={(event) => onChange({ ...value, duration: event.target.value })}
        />
      </div>
    </div>
  );
}
