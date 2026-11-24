'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { CalendarPlus } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { SessionTimingFields } from '@/components/history/session-timing-fields';
import { parseTimingInputs, toLocalInputs, type TimingInputs } from '@/lib/session-edit';

interface Props {
  // The trainee's workouts, already display-named ("Program - Workout").
  workouts: { id: string; name: string }[];
  // The trainee's gyms. With more than one, the dialog asks which one the
  // workout took place in, the active gym first; otherwise the server uses
  // the active gym, as for a live session.
  gyms: { id: string; name: string }[];
  activeGymId: string | null;
}

const FREESTYLE = 'freestyle';
const DEFAULT_DURATION_MIN = 60;

// "Log a past workout" (issue #389): pick when it happened and which workout
// it was, then enter the sets in the history editor. The session is created
// finished, so it never becomes or disturbs the session in progress.
export function LogPastWorkoutButton({ workouts, gyms, activeGymId }: Props) {
  const t = useTranslations('history.logPast');
  const edit = useTranslations('history.edit');
  const session = useTranslations('session');
  const common = useTranslations('common');
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [workoutId, setWorkoutId] = useState(FREESTYLE);
  const [timing, setTiming] = useState<TimingInputs>({ date: '', time: '', duration: '' });
  const [creating, setCreating] = useState(false);
  // `creating` disables the button on the next render; the ref closes the gap
  // for a second tap that arrives before that render, which would otherwise
  // create the workout twice.
  const inFlight = useRef(false);
  const chooseGym = gyms.length > 1;
  const [gymId, setGymId] = useState(
    activeGymId && gyms.some((gym) => gym.id === activeGymId) ? activeGymId : (gyms[0]?.id ?? ''),
  );

  function openDialog() {
    // Seeded when the dialog opens, in the browser's zone: a workout that
    // ended just now.
    const start = new Date(Date.now() - DEFAULT_DURATION_MIN * 60 * 1000);
    setTiming({ ...toLocalInputs(start), duration: String(DEFAULT_DURATION_MIN) });
    setOpen(true);
  }

  async function handleCreate() {
    if (inFlight.current) return;
    const parsed = parseTimingInputs(timing, new Date());
    if (!parsed.ok) {
      toast.error(edit(parsed.reason === 'future' ? 'future' : 'invalidTiming'));
      return;
    }
    inFlight.current = true;
    setCreating(true);
    try {
      const res = await fetch('/api/sessions/past', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          workoutId: workoutId === FREESTYLE ? null : workoutId,
          ...(chooseGym && gymId ? { gymId } : {}),
          startedAt: parsed.startedAt.toISOString(),
          durationMin: parsed.durationMin,
        }),
      }).catch(() => null);
      if (!res?.ok) {
        toast.error(t('error'));
        return;
      }
      const created = (await res.json()) as { id: string };
      setOpen(false);
      router.push(`/history/${created.id}/edit`);
    } finally {
      inFlight.current = false;
      setCreating(false);
    }
  }

  return (
    <>
      <Button variant="outline" size="sm" onClick={openDialog}>
        <CalendarPlus className="size-4" />
        <span className="ml-1">{t('button')}</span>
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('title')}</DialogTitle>
            <DialogDescription>{t('description')}</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <SessionTimingFields
              idPrefix="log-past"
              value={timing}
              onChange={setTiming}
              disabled={creating}
            />
            <div className="space-y-1.5">
              <Label htmlFor="log-past-workout">{t('workout')}</Label>
              <Select value={workoutId} onValueChange={setWorkoutId} disabled={creating}>
                <SelectTrigger id="log-past-workout">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={FREESTYLE}>{t('freestyle')}</SelectItem>
                  {workouts.map((workout) => (
                    <SelectItem key={workout.id} value={workout.id}>
                      {workout.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {chooseGym && (
              <div className="space-y-1.5">
                <Label htmlFor="log-past-gym">{session('trainingGym')}</Label>
                <Select value={gymId} onValueChange={setGymId} disabled={creating}>
                  <SelectTrigger id="log-past-gym">
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
              </div>
            )}
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setOpen(false)}
              disabled={creating}
            >
              {common('actions.cancel')}
            </Button>
            <Button type="button" onClick={handleCreate} disabled={creating}>
              {creating ? t('creating') : t('create')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
