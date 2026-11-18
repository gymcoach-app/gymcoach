'use client';

import { useEffect, useRef, useState } from 'react';
import { useFormatter, useTranslations } from 'next-intl';
import { FileUp, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { useExerciseName } from '@/components/shared/use-exercise-name';
import { createImportQueue, ImportCancelledError } from '@/lib/import/import-queue';
import { StravaArchiveError } from '@/lib/import/strava-archive';
import {
  runStravaConfirm,
  runStravaPreview,
  type StravaPreview,
  type StravaProgress,
} from '@/lib/import/strava-import';

type Pass = 'preview' | 'confirm';

type Status =
  | { kind: 'idle' }
  | { kind: 'running'; pass: Pass; read: number; total: number; activities: number }
  | { kind: 'waiting'; pass: Pass; seconds: number };

interface Props {
  // Injectable for tests (the rate-limit wait).
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
}

// Strava archive import (issue #582). The zip of "Download your data" is
// unzipped on this device; its activity files go through the FIT, GPX and TCX
// import routes, first as a dry run that ends in one combined preview, then
// for real once confirmed. See lib/import/strava-import.ts.
export function StravaImport({ sleep }: Props) {
  const t = useTranslations('settings.imports.strava');
  const shared = useTranslations('settings.imports');
  const common = useTranslations('common');
  const intl = useFormatter();
  const exerciseName = useExerciseName();
  const fileRef = useRef<HTMLInputElement>(null);
  const alive = useRef(true);
  const abort = useRef<AbortController | null>(null);
  const [status, setStatus] = useState<Status>({ kind: 'idle' });
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<StravaPreview | null>(null);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      // Leaving the section stops the queue: nothing keeps posting unseen.
      abort.current?.abort();
    };
  }, []);

  const busy = status.kind !== 'idle';

  function reset() {
    setFile(null);
    setPreview(null);
    setStatus({ kind: 'idle' });
  }

  // One pass over the archive with its own abort signal and request queue.
  function startPass(pass: Pass, archive: File) {
    const controller = new AbortController();
    abort.current = controller;
    let last = '';
    const onProgress = (p: StravaProgress) => {
      // A state update per percent or per activity, not per 64 KB chunk.
      const step = `${p.totalBytes > 0 ? Math.floor((p.bytesRead / p.totalBytes) * 100) : 100}:${p.activities}`;
      if (step === last || !alive.current || controller.signal.aborted) return;
      last = step;
      setStatus({
        kind: 'running',
        pass,
        read: p.bytesRead,
        total: p.totalBytes,
        activities: p.activities,
      });
    };
    setStatus({ kind: 'running', pass, read: 0, total: archive.size, activities: 0 });
    const queue = createImportQueue({
      signal: controller.signal,
      sleep,
      onWait: (seconds) => {
        if (alive.current) setStatus({ kind: 'waiting', pass, seconds });
      },
    });
    return { queue, signal: controller.signal, onProgress };
  }

  function reportFailure(err: unknown) {
    if (err instanceof StravaArchiveError) {
      toast.error(
        err.code === 'not-zip'
          ? t('notZip')
          : err.code === 'not-strava'
            ? t('notStrava')
            : t('unreadable'),
      );
    } else {
      toast.error(err instanceof Error ? err.message : shared('importFailed'));
    }
  }

  async function onFilePicked(e: React.ChangeEvent<HTMLInputElement>) {
    const picked = e.target.files?.[0];
    e.target.value = '';
    if (!picked) return;
    setPreview(null);
    setFile(picked);
    try {
      const result = await runStravaPreview(picked, startPass('preview', picked));
      if (!alive.current) return;
      setPreview(result);
      setStatus({ kind: 'idle' });
    } catch (err) {
      if (!alive.current) return;
      if (err instanceof ImportCancelledError) toast.info(t('cancelled'));
      else reportFailure(err);
      reset();
    }
  }

  async function confirm() {
    if (!file || !preview) return;
    try {
      const result = await runStravaConfirm(file, preview.keep, startPass('confirm', file));
      if (!alive.current) return;
      toast.success(t('done', { sessions: result.createdSessions, skipped: result.skipped }));
      reset();
    } catch (err) {
      if (!alive.current) return;
      // Files already imported stay; a second run skips them as duplicates.
      if (err instanceof ImportCancelledError) toast.info(t('cancelledAfterStart'));
      else reportFailure(err);
      reset();
    }
  }

  const megabytes = (bytes: number) =>
    intl.number(bytes / (1024 * 1024), { maximumFractionDigits: 1 });

  return (
    <>
      <div>
        <Button
          variant="outline"
          onClick={() => fileRef.current?.click()}
          disabled={busy}
          className="min-h-tap"
        >
          {busy ? <Loader2 className="size-4 animate-spin" /> : <FileUp className="size-4" />}
          <span className="ml-2">{t('chooseFile')}</span>
        </Button>
      </div>
      <input
        ref={fileRef}
        type="file"
        accept=".zip,application/zip,application/x-zip-compressed"
        className="hidden"
        onChange={onFilePicked}
      />
      <p className="text-xs text-muted-foreground">{t('privacy')}</p>

      {busy && (
        <div className="space-y-2" data-testid="strava-progress">
          <p className="text-sm" role="status">
            {status.kind === 'waiting'
              ? t('waiting', { seconds: status.seconds })
              : t(status.pass === 'preview' ? 'checking' : 'importing', {
                  read: megabytes(status.read),
                  total: megabytes(status.total),
                  count: status.activities,
                })}
          </p>
          {status.kind === 'running' && (
            <Progress
              value={status.total > 0 ? (status.read / status.total) * 100 : 0}
              aria-label={t(status.pass === 'preview' ? 'checking' : 'importing', {
                read: megabytes(status.read),
                total: megabytes(status.total),
                count: status.activities,
              })}
            />
          )}
          <Button
            size="sm"
            variant="ghost"
            onClick={() => abort.current?.abort()}
            className="min-h-tap"
          >
            {common('actions.cancel')}
          </Button>
        </div>
      )}

      {preview && !busy && (
        <div className="rounded-md border p-3 text-sm" data-testid="import-preview">
          <p className="font-medium">{t('activities', { count: preview.importable })}</p>
          <ul className="mt-2 list-disc space-y-1 pl-5">
            {preview.byExercise.map((row) => (
              <li key={row.exerciseName}>
                {t('byType', { name: exerciseName(row.exerciseName), count: row.count })}
              </li>
            ))}
            {preview.duplicates > 0 && <li>{t('duplicates', { count: preview.duplicates })}</li>}
            {(preview.withoutFile ?? 0) > 0 && (
              <li>{t('withoutFile', { count: preview.withoutFile ?? 0 })}</li>
            )}
            {preview.unsupported > 0 && (
              <li>{t('unsupported', { count: preview.unsupported })}</li>
            )}
            {preview.tooLarge > 0 && <li>{t('tooLarge', { count: preview.tooLarge })}</li>}
            {preview.unreadable > 0 && (
              <li className="text-amber-700 dark:text-amber-400">
                {t('unreadableFiles', { count: preview.unreadable })}
              </li>
            )}
          </ul>
          {preview.problems.length > 0 && (
            <details className="mt-2 text-xs text-muted-foreground">
              <summary className="cursor-pointer">{t('skippedFiles')}</summary>
              <ul className="mt-1 max-h-40 list-disc overflow-y-auto pl-5">
                {preview.problems.map((p) => {
                  const base = p.path.slice(p.path.lastIndexOf('/') + 1);
                  return <li key={p.path}>{p.name ? `${p.name} (${base})` : base}</li>;
                })}
              </ul>
            </details>
          )}
          <div className="mt-3 flex gap-2">
            <Button
              size="sm"
              onClick={confirm}
              disabled={preview.importable === 0}
              className="min-h-tap"
            >
              {shared('importSessions', { count: preview.importable })}
            </Button>
            <Button size="sm" variant="ghost" onClick={reset}>
              {common('actions.cancel')}
            </Button>
          </div>
        </div>
      )}
    </>
  );
}
