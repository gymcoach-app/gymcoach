'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Loader2, Save, User } from 'lucide-react';
import { toast } from 'sonner';
import type { EffortScale, Sex, TrainingGoal, WeightUnit } from '@/lib/prisma-client';
import { EFFORT_SCALES } from '@/lib/effort';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

export interface ProfileData {
  displayName: string | null;
  bodyweight: number | null;
  sex: Sex | null;
  heightCm: number | null;
  goal: TrainingGoal | null;
  weeklyFrequency: number | null;
  unit: WeightUnit;
  effortScale: EffortScale;
}

interface Props {
  initial: ProfileData;
}

const SEX_OPTIONS: Sex[] = ['MALE', 'FEMALE', 'OTHER'];
const GOAL_OPTIONS: TrainingGoal[] = [
  'HYPERTROPHY',
  'STRENGTH',
  'FAT_LOSS',
  'RECOMP',
  'GENERAL_FITNESS',
];
const UNIT_OPTIONS: WeightUnit[] = ['KG', 'LB'];

function numOrEmpty(n: number | null): string {
  return n != null ? String(n) : '';
}

export function ProfileSection({ initial }: Props) {
  const t = useTranslations('settings.profile');
  const common = useTranslations('common');
  const [displayName, setDisplayName] = useState(initial.displayName ?? '');
  const [bodyweight, setBodyweight] = useState(numOrEmpty(initial.bodyweight));
  const [heightCm, setHeightCm] = useState(numOrEmpty(initial.heightCm));
  const [weeklyFrequency, setWeeklyFrequency] = useState(
    numOrEmpty(initial.weeklyFrequency),
  );
  const [sex, setSex] = useState<Sex | undefined>(initial.sex ?? undefined);
  const [goal, setGoal] = useState<TrainingGoal | undefined>(
    initial.goal ?? undefined,
  );
  const [unit, setUnit] = useState<WeightUnit>(initial.unit);
  const [effortScale, setEffortScale] = useState<EffortScale>(initial.effortScale);
  const [pending, setPending] = useState(false);

  function rangeOk(value: string, min: number, max: number): boolean {
    if (value === '') return true;
    const n = Number(value);
    return Number.isFinite(n) && n >= min && n <= max;
  }

  const isValid =
    rangeOk(bodyweight, 20, 300) &&
    rangeOk(heightCm, 100, 250) &&
    rangeOk(weeklyFrequency, 1, 14);

  async function save() {
    if (!isValid) {
      toast.error(t('fixFields'));
      return;
    }
    setPending(true);
    try {
      const body: Record<string, unknown> = {
        displayName: displayName.trim() === '' ? null : displayName.trim(),
        bodyweight: bodyweight === '' ? null : Number(bodyweight),
        heightCm: heightCm === '' ? null : Number(heightCm),
        weeklyFrequency: weeklyFrequency === '' ? null : Number(weeklyFrequency),
      };
      if (sex) body.sex = sex;
      if (goal) body.goal = goal;
      body.unit = unit;
      body.effortScale = effortScale;

      const res = await fetch('/api/profile', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(j.error ?? `Error ${res.status}`);
      }
      toast.success(t('saved'));
    } catch {
      toast.error(t('saveError'));
    } finally {
      setPending(false);
    }
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center gap-2">
          <User className="size-5" />
          <h2 className="text-base font-semibold">{t('title')}</h2>
        </div>
        <p className="text-xs text-muted-foreground">
          {t('description')}
        </p>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="space-y-1.5">
          <Label htmlFor="displayName" className="text-sm">
            {t('displayName')}
          </Label>
          <Input
            id="displayName"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            placeholder={t('namePlaceholder')}
            maxLength={80}
            className="max-w-xs"
          />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <Label htmlFor="bodyweight" className="text-sm">
              {t('bodyweightLabel')}
            </Label>
            <Input
              id="bodyweight"
              type="number"
              inputMode="decimal"
              step="0.1"
              value={bodyweight}
              onChange={(e) => setBodyweight(e.target.value)}
              placeholder="e.g. 75"
            />
            {!rangeOk(bodyweight, 20, 300) && (
              <p className="text-xs text-rose-600">{t('bodyweightRange')}</p>
            )}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="heightCm" className="text-sm">
              {t('heightLabel')}
            </Label>
            <Input
              id="heightCm"
              type="number"
              inputMode="numeric"
              step="1"
              value={heightCm}
              onChange={(e) => setHeightCm(e.target.value)}
              placeholder="e.g. 178"
            />
            {!rangeOk(heightCm, 100, 250) && (
              <p className="text-xs text-rose-600">{t('heightRange')}</p>
            )}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <Label className="text-sm">{t('sex')}</Label>
            <Select value={sex} onValueChange={(v) => setSex(v as Sex)}>
              <SelectTrigger>
                <SelectValue placeholder={t('notSet')} />
              </SelectTrigger>
              <SelectContent>
                {SEX_OPTIONS.map((option) => (
                  <SelectItem key={option} value={option}>
                    {option === 'MALE' ? t('male') : option === 'FEMALE' ? t('female') : t('other')}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="weeklyFrequency" className="text-sm">
              {t('weeklyFrequencyLabel')}
            </Label>
            <Input
              id="weeklyFrequency"
              type="number"
              inputMode="numeric"
              step="1"
              value={weeklyFrequency}
              onChange={(e) => setWeeklyFrequency(e.target.value)}
              placeholder="e.g. 3"
            />
            {!rangeOk(weeklyFrequency, 1, 14) && (
              <p className="text-xs text-rose-600">{t('weeklyFrequencyRange')}</p>
            )}
          </div>
        </div>

        <div className="space-y-1.5">
          <Label className="text-sm">{t('goal')}</Label>
          <Select value={goal} onValueChange={(v) => setGoal(v as TrainingGoal)}>
            <SelectTrigger className="max-w-xs">
              <SelectValue placeholder={t('notSet')} />
            </SelectTrigger>
            <SelectContent>
              {GOAL_OPTIONS.map((option) => (
                <SelectItem key={option} value={option}>
                  {option === 'HYPERTROPHY'
                    ? t('hypertrophy')
                    : option === 'STRENGTH'
                      ? t('strength')
                      : option === 'FAT_LOSS'
                        ? t('fatLoss')
                        : option === 'RECOMP'
                          ? t('recomp')
                          : t('generalFitness')}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1.5">
          <Label className="text-sm">{t('unit')}</Label>
          <Select value={unit} onValueChange={(v) => setUnit(v as WeightUnit)}>
            <SelectTrigger className="max-w-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {UNIT_OPTIONS.map((option) => (
                <SelectItem key={option} value={option}>
                  {option === 'KG' ? t('kilograms') : t('pounds')}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground">
            {t('unitDescription')}
          </p>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="effortScale" className="text-sm">
            {t('effortScale')}
          </Label>
          <Select value={effortScale} onValueChange={(v) => setEffortScale(v as EffortScale)}>
            <SelectTrigger id="effortScale" className="max-w-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {EFFORT_SCALES.map((option) => (
                <SelectItem key={option} value={option}>
                  {option === 'RPE' ? t('effortRpe') : t('effortRir')}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground">{t('effortScaleDescription')}</p>
        </div>

        <div>
          <Button
            type="button"
            onClick={save}
            disabled={pending || !isValid}
            className="min-h-tap"
          >
            {pending ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Save className="size-4" />
            )}
            <span className="ml-2">{common('actions.save')}</span>
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
