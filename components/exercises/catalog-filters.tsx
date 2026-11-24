'use client';

import { useId } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import type { MuscleGroup } from '@/lib/prisma-client';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { BODY_OUTLINE_PATHS, BODY_VIEWBOX, REGION_PATHS } from '@/components/progress/body-paths';
import { muscleGroupMessageKeys } from '@/i18n/enum-keys';
import { isInventoryEmpty, type GymInventory } from '@/lib/exercise-filters';
import { MUSCLE_REGIONS, type BodyView } from '@/lib/muscle-map';
import { cn } from '@/lib/utils';

const VIEWS: readonly BodyView[] = ['front', 'back'];

// Muscle filter of the catalog (issue #402). Two controls drive the same
// selection:
// - the body silhouettes, for a pointer or a finger. They are hidden from the
//   accessibility tree and take no keyboard focus;
// - the muscle list, a group of toggle buttons with a pressed state, which is
//   the keyboard and screen-reader path and the only way to reach a group
//   that has no region on the figure (OTHER, where cardio lives). The list
//   is described by the sentence that says so.
// Only the groups the catalog holds are offered; the regions of the others
// are drawn but inert.
export function MuscleFilter({
  groups,
  selected,
  onToggle,
}: {
  groups: readonly MuscleGroup[];
  selected: ReadonlySet<MuscleGroup>;
  onToggle: (group: MuscleGroup) => void;
}) {
  const t = useTranslations('exercises');
  const mapT = useTranslations('progress.muscleMap');
  const otherHintId = useId();
  const offered = new Set(groups);
  const offersOther = offered.has('OTHER');

  function groupName(group: MuscleGroup): string {
    return t(`muscleGroups.${muscleGroupMessageKeys[group]}`);
  }

  function renderView(view: BodyView) {
    return (
      <svg viewBox={BODY_VIEWBOX} aria-hidden="true" className="h-auto w-full">
        {BODY_OUTLINE_PATHS.map((d) => (
          <path key={d} d={d} className="fill-muted/40" />
        ))}
        {(Object.keys(MUSCLE_REGIONS) as MuscleGroup[]).flatMap((group) => {
          const mapping = MUSCLE_REGIONS[group];
          if (!mapping || mapping.view !== view) return [];
          const active = offered.has(group);
          const isSelected = selected.has(group);
          return mapping.regionIds.map((regionId) => (
            <path
              key={regionId}
              d={REGION_PATHS[view][regionId]}
              data-region={regionId}
              data-muscle={group}
              data-selected={isSelected || undefined}
              strokeWidth={2}
              className={cn(
                'stroke-background',
                !active && 'pointer-events-none fill-muted',
                active && !isSelected && 'cursor-pointer fill-muted-foreground/40 hover:fill-primary/50',
                active && isSelected && 'cursor-pointer fill-primary',
              )}
              onClick={active ? () => onToggle(group) : undefined}
            >
              <title>{groupName(group)}</title>
            </path>
          ));
        })}
      </svg>
    );
  }

  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
      <div className="flex shrink-0 justify-center gap-2">
        {VIEWS.map((view) => (
          <figure key={view} className="flex w-[140px] flex-col items-center sm:w-[130px]">
            {renderView(view)}
            <figcaption className="text-xs text-muted-foreground" aria-hidden="true">
              {mapT(view)}
            </figcaption>
          </figure>
        ))}
      </div>
      <div className="flex min-w-0 flex-col gap-2">
        <p className="text-xs text-muted-foreground">
          {/* The figure is not exposed to assistive technology, so neither is
              the sentence about tapping it. */}
          <span aria-hidden="true">{t('filters.muscleHint')}</span>
          {offersOther && <span id={otherHintId}> {t('filters.otherHint')}</span>}
        </p>
        <div
          role="group"
          aria-label={t('filters.muscleListLabel')}
          aria-describedby={offersOther ? otherHintId : undefined}
          className="flex flex-wrap gap-2"
        >
          {groups.map((group) => {
            const pressed = selected.has(group);
            return (
              <Button
                key={group}
                type="button"
                size="sm"
                variant={pressed ? 'default' : 'outline'}
                aria-pressed={pressed}
                onClick={() => onToggle(group)}
                // 44px: the list packs up to sixteen targets, so it uses the
                // WCAG target size instead of the 64px `tap` token.
                className="min-h-11"
              >
                {groupName(group)}
              </Button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// "Only what my gym has" (issue #402). The rule itself lives in
// lib/exercise-filters.ts; this control states all of it in the note under
// the switch (what is hidden, what always stays), so a shorter list, above
// all with an empty inventory, never comes without its reason.
export function GymFilter({
  gyms,
  enabled,
  onEnabledChange,
  gym,
  onGymChange,
}: {
  gyms: readonly GymInventory[];
  enabled: boolean;
  onEnabledChange: (enabled: boolean) => void;
  // The gym the filter reads; null only when no gym is saved.
  gym: GymInventory | null;
  onGymChange: (gymId: string) => void;
}) {
  const t = useTranslations('exercises.filters');
  const switchId = useId();
  const selectId = useId();
  const noteId = useId();

  if (!gym) {
    return (
      <p className="text-sm text-muted-foreground">
        {t('noGym')}{' '}
        <Link href="/settings" className="font-medium text-primary underline-offset-4 hover:underline">
          {t('manageGyms')}
        </Link>
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex min-h-11 items-center gap-3">
        <Switch
          id={switchId}
          checked={enabled}
          onCheckedChange={onEnabledChange}
          aria-describedby={enabled ? noteId : undefined}
        />
        <label htmlFor={switchId} className="text-sm font-medium">
          {t('gymOnly')}
        </label>
      </div>
      {enabled && gyms.length > 1 && (
        <div className="flex flex-col gap-1">
          <label htmlFor={selectId} className="text-xs text-muted-foreground">
            {t('gymSelect')}
          </label>
          <Select value={gym.id} onValueChange={onGymChange}>
            <SelectTrigger id={selectId} className="h-11 sm:max-w-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {gyms.map((option) => (
                <SelectItem key={option.id} value={option.id}>
                  {option.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}
      {enabled && (
        <p id={noteId} className="text-xs text-muted-foreground">
          {t(isInventoryEmpty(gym) ? 'gymEmpty' : 'gymRule', { gym: gym.name })}{' '}
          <Link
            href="/settings"
            className="font-medium text-primary underline-offset-4 hover:underline"
          >
            {t('manageGyms')}
          </Link>
        </p>
      )}
    </div>
  );
}
