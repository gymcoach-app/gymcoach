'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Building2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { StartWorkoutButton } from '@/components/session/start-workout-button';

interface WorkoutOption {
  id: string;
  name: string;
  day: string | null;
  exerciseCount: number;
}

export function WorkoutStartList({
  workouts,
  gyms,
  activeGymId,
}: {
  workouts: WorkoutOption[];
  gyms: Array<{ id: string; name: string }>;
  activeGymId: string | null;
}) {
  const t = useTranslations('session');
  const common = useTranslations('common');
  const [gymId, setGymId] = useState(activeGymId ?? gyms[0]?.id ?? 'none');

  return (
    <>
      {gyms.length > 0 && (
        <div className="space-y-2 rounded-md border p-3">
          <Label className="flex items-center gap-2">
            <Building2 className="size-4" />
            {t('trainingGym')}
          </Label>
          <Select value={gymId} onValueChange={setGymId}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {gyms.map((gym) => (
                <SelectItem key={gym.id} value={gym.id}>
                  {gym.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground">{t('trainingGymDescription')}</p>
        </div>
      )}

      <ul className="flex flex-col gap-3">
        {workouts.map((workout) => (
          <li key={workout.id}>
            <Card>
              <CardHeader className="pb-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <CardTitle className="text-base">{workout.name}</CardTitle>
                    <CardDescription className="text-xs">
                      {common('counts.exercises', { count: workout.exerciseCount })}
                    </CardDescription>
                  </div>
                  {workout.day && <Badge variant="secondary">{workout.day}</Badge>}
                </div>
              </CardHeader>
              <CardContent className="pt-0">
                <StartWorkoutButton
                  workoutId={workout.id}
                  gymId={gymId === 'none' ? null : gymId}
                  disabled={workout.exerciseCount === 0}
                />
              </CardContent>
            </Card>
          </li>
        ))}
        {/* Freestyle (issue #388): train off-plan without a throwaway program. */}
        <li>
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">{t('freestyleSession')}</CardTitle>
              <CardDescription className="text-xs">{t('startEmptyDescription')}</CardDescription>
            </CardHeader>
            <CardContent className="pt-0">
              <StartWorkoutButton
                gymId={gymId === 'none' ? null : gymId}
                variant={workouts.length > 0 ? 'outline' : 'default'}
              />
            </CardContent>
          </Card>
        </li>
      </ul>
    </>
  );
}
