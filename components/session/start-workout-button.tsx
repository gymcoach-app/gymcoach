'use client';

import { useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Play } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';

// Without a `workoutId` the button starts a freestyle session (issue #388):
// no workout, exercises picked from the catalog while training.
export function StartWorkoutButton({
  workoutId,
  gymId,
  disabled,
  variant = 'default',
}: {
  workoutId?: string;
  gymId?: string | null;
  disabled?: boolean;
  variant?: 'default' | 'outline';
}) {
  const t = useTranslations('session');
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  function handleStart() {
    startTransition(async () => {
      const res = await fetch('/api/sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workoutId, gymId }),
      });
      if (!res.ok) {
        toast.error(t('startError'));
        return;
      }
      const session = (await res.json()) as { id: string };
      router.push(`/session/${session.id}`);
      router.refresh();
    });
  }

  return (
    <Button
      onClick={handleStart}
      disabled={disabled || isPending}
      variant={variant}
      className="min-h-tap w-full text-base"
    >
      <Play className="size-5" />
      <span className="ml-2">{isPending ? t('starting') : workoutId ? t('startThis') : t('startEmpty')}</span>
    </Button>
  );
}
