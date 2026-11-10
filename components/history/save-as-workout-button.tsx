'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { ListPlus } from 'lucide-react';
import { toast } from 'sonner';
import type { EffortScale } from '@/lib/prisma-client';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

interface Props {
  sessionId: string;
  // The trainee's programs, already display-named.
  programs: { id: string; name: string }[];
  // The program the session came from, preselected when it still exists.
  defaultProgramId: string | null;
  defaultName: string;
  // The user's effort scale (issue #390), named in the dialog description.
  effortScale: EffortScale;
}

// "Save as a workout" (issue #394): turns a finished session into a workout
// of one of the trainee's programs, then opens that program.
export function SaveAsWorkoutButton({
  sessionId,
  programs,
  defaultProgramId,
  defaultName,
  effortScale,
}: Props) {
  const t = useTranslations('history.saveAsWorkout');
  const common = useTranslations('common');
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const initialProgram =
    defaultProgramId && programs.some((p) => p.id === defaultProgramId)
      ? defaultProgramId
      : (programs[0]?.id ?? '');
  const [programId, setProgramId] = useState(initialProgram);
  const [name, setName] = useState(defaultName);
  const [saving, setSaving] = useState(false);

  const canSave = programId !== '' && name.trim() !== '' && !saving;

  async function handleSave() {
    if (!canSave) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/sessions/${sessionId}/save-as-workout`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ programId, name: name.trim(), dayOfWeek: null }),
      }).catch(() => null);
      if (!res?.ok) {
        toast.error(t('error'));
        return;
      }
      toast.success(t('saved'));
      setOpen(false);
      router.push(`/programs/${programId}`);
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
        <ListPlus className="size-4" />
        <span className="ml-1">{t('button')}</span>
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('title')}</DialogTitle>
            <DialogDescription>{t('description', { scale: effortScale })}</DialogDescription>
          </DialogHeader>
          {programs.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t('noPrograms')}</p>
          ) : (
            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="save-as-workout-program">{t('program')}</Label>
                <Select value={programId} onValueChange={setProgramId}>
                  <SelectTrigger id="save-as-workout-program">
                    <SelectValue placeholder={t('programPlaceholder')} />
                  </SelectTrigger>
                  <SelectContent>
                    {programs.map((p) => (
                      <SelectItem key={p.id} value={p.id}>
                        {p.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="save-as-workout-name">{t('name')}</Label>
                <Input
                  id="save-as-workout-name"
                  value={name}
                  maxLength={120}
                  onChange={(e) => setName(e.target.value)}
                />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setOpen(false)}
              disabled={saving}
            >
              {common('actions.cancel')}
            </Button>
            {programs.length > 0 && (
              <Button type="button" onClick={handleSave} disabled={!canSave}>
                {saving ? t('saving') : t('save')}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
