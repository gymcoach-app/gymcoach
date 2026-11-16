'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useFormatter, useTranslations } from 'next-intl';
import { HeartPulse, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { formatDuration } from '@/lib/cardio';
import { NO_HEART_RATE_MESSAGE } from '@/lib/import/watch-file-errors';
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

// Client-side mirror of the server cap (the server re-enforces it).
const MAX_FILE_BYTES = 5 * 1024 * 1024;

type WatchFormat = 'fit' | 'tcx' | 'gpx';

// The format follows the file extension; anything else is refused before a
// byte is read.
export function watchFormatOf(fileName: string): WatchFormat | null {
  const match = /\.(fit|tcx|gpx)$/.exec(fileName.toLowerCase());
  return match ? (match[1] as WatchFormat) : null;
}

// File.text() with a FileReader fallback (jsdom and older browsers).
async function readFileText(file: File): Promise<string> {
  if (typeof file.text === 'function') return file.text();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ''));
    reader.onerror = () => reject(reader.error);
    reader.readAsText(file);
  });
}

// FIT is binary: it rides the JSON payload base64-encoded, as in the import.
async function readFileBase64(file: File): Promise<string> {
  const buf =
    typeof file.arrayBuffer === 'function'
      ? await file.arrayBuffer()
      : await new Promise<ArrayBuffer>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result as ArrayBuffer);
          reader.onerror = () => reject(reader.error);
          reader.readAsArrayBuffer(file);
        });
  const b = new Uint8Array(buf);
  let binary = '';
  for (let i = 0; i < b.length; i++) binary += String.fromCharCode(b[i]!);
  return btoa(binary);
}

interface Preview {
  avgHr: number | null;
  maxHr: number | null;
  startedAt: string;
  durationSec: number;
  offsetMinutes: number;
  farFromSession: boolean;
  replaces: boolean;
}

interface Props {
  sessionId: string;
  // The zone the session page formats its dates in (the calendar's zone).
  timeZone?: string;
}

// "Attach a watch file" (issue #562): reads the heart rate of a FIT, TCX or
// GPX recording, shows what was read, then stores it on this session. No
// session, set or exercise is created.
export function AttachWatchFileButton({ sessionId, timeZone }: Props) {
  const t = useTranslations('history.watchFile');
  const common = useTranslations('common');
  const format = useFormatter();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [payload, setPayload] = useState<{ format: WatchFormat; file: string } | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  // Guards against a slow preview of a previous pick landing after a new one.
  const pick = useRef(0);

  function reset() {
    pick.current += 1;
    setPayload(null);
    setPreview(null);
    setBusy(false);
  }

  function handleOpenChange(next: boolean) {
    if (!next) reset();
    setOpen(next);
  }

  async function send(body: { format: WatchFormat; file: string }, mode: 'preview' | 'confirm') {
    const res = await fetch(`/api/sessions/${sessionId}/watch-file`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...body, mode }),
    }).catch(() => null);
    const json = (await res?.json().catch(() => null)) as (Preview & { error?: string }) | null;
    if (!res?.ok || !json) {
      return { ok: false as const, noHeartRate: json?.error === NO_HEART_RATE_MESSAGE };
    }
    return { ok: true as const, data: json };
  }

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const current = ++pick.current;
    setPayload(null);
    setPreview(null);
    const fileFormat = watchFormatOf(file.name);
    if (!fileFormat) {
      e.target.value = '';
      toast.error(t('unsupported'));
      return;
    }
    if (file.size > MAX_FILE_BYTES) {
      e.target.value = '';
      toast.error(t('tooLarge'));
      return;
    }
    setBusy(true);
    try {
      const body = {
        format: fileFormat,
        file: fileFormat === 'fit' ? await readFileBase64(file) : await readFileText(file),
      };
      const result = await send(body, 'preview');
      if (current !== pick.current) return;
      if (!result.ok) {
        e.target.value = '';
        toast.error(result.noHeartRate ? t('noHeartRate') : t('readError'));
        return;
      }
      setPayload(body);
      setPreview(result.data);
    } catch {
      if (current === pick.current) toast.error(t('readError'));
    } finally {
      if (current === pick.current) setBusy(false);
    }
  }

  async function handleConfirm() {
    if (!payload || busy) return;
    const current = pick.current;
    setBusy(true);
    try {
      const result = await send(payload, 'confirm');
      if (current !== pick.current) return;
      if (!result.ok) {
        toast.error(result.noHeartRate ? t('noHeartRate') : t('error'));
        return;
      }
      toast.success(t('attached'));
      handleOpenChange(false);
      router.refresh();
    } finally {
      if (current === pick.current) setBusy(false);
    }
  }

  const bpm = (value: number | null) => (value != null ? t('bpm', { value }) : '-');

  return (
    <>
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
        <HeartPulse className="size-4" />
        <span className="ml-1">{t('button')}</span>
      </Button>
      <Dialog open={open} onOpenChange={handleOpenChange}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('title')}</DialogTitle>
            <DialogDescription>{t('description')}</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="attach-watch-file-input">{t('fileLabel')}</Label>
              <Input
                id="attach-watch-file-input"
                type="file"
                accept=".fit,.tcx,.gpx"
                disabled={busy}
                onChange={handleFile}
              />
            </div>
            {busy && !preview && (
              <p className="flex items-center gap-2 text-sm text-muted-foreground" role="status">
                <Loader2 className="size-4 animate-spin" />
                {t('reading')}
              </p>
            )}
            {preview && (
              <div className="space-y-3" data-testid="watch-file-preview">
                <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
                  <div>
                    <dt className="text-xs text-muted-foreground">{t('avgHr')}</dt>
                    <dd className="font-medium">{bpm(preview.avgHr)}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted-foreground">{t('maxHr')}</dt>
                    <dd className="font-medium">{bpm(preview.maxHr)}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted-foreground">{t('recordingStart')}</dt>
                    <dd className="font-medium">
                      {format.dateTime(new Date(preview.startedAt), {
                        day: '2-digit',
                        month: 'short',
                        year: 'numeric',
                        hour: '2-digit',
                        minute: '2-digit',
                        ...(timeZone ? { timeZone } : {}),
                      })}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted-foreground">{t('duration')}</dt>
                    <dd className="font-medium">{formatDuration(preview.durationSec)}</dd>
                  </div>
                </dl>
                {preview.farFromSession && (
                  <p
                    role="alert"
                    className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm"
                  >
                    {t('farFromSession')}
                  </p>
                )}
                {preview.replaces && (
                  <p className="text-sm text-muted-foreground">{t('replaces')}</p>
                )}
              </div>
            )}
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => handleOpenChange(false)}
              disabled={busy && preview != null}
            >
              {common('actions.cancel')}
            </Button>
            {preview && (
              <Button type="button" onClick={handleConfirm} disabled={busy}>
                {busy ? t('attaching') : t('attach')}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

// "Remove" on the session's heart rate block: clears the attached heart rate
// and nothing else.
export function RemoveWatchFileButton({ sessionId }: { sessionId: string }) {
  const t = useTranslations('history.watchFile');
  const router = useRouter();
  const [pending, setPending] = useState(false);

  async function handleRemove() {
    setPending(true);
    try {
      const res = await fetch(`/api/sessions/${sessionId}/watch-file`, {
        method: 'DELETE',
      }).catch(() => null);
      if (!res?.ok) {
        toast.error(t('removeError'));
        return;
      }
      toast.success(t('removed'));
      router.refresh();
    } finally {
      setPending(false);
    }
  }

  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      className="-mr-2 text-muted-foreground"
      onClick={handleRemove}
      disabled={pending}
    >
      {pending ? t('removing') : t('remove')}
    </Button>
  );
}
