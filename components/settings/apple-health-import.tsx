'use client';

import { useEffect, useRef, useState } from 'react';
import { useFormatter, useTranslations } from 'next-intl';
import { FileUp, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { Switch } from '@/components/ui/switch';
import { useExerciseName } from '@/components/shared/use-exercise-name';
import {
  dedupeAppleHealthWorkouts,
  type AppleHealthBodyMass,
  type AppleHealthWorkout,
} from '@/lib/import/apple-health';
import {
  APPLE_HEALTH_MAX_INFLATED_GB,
  APPLE_HEALTH_MAX_ZIP_ENTRIES,
  AppleHealthFileError,
  readAppleHealthFile,
} from '@/lib/import/apple-health-file';
import {
  APPLE_HEALTH_MAX_BODY_MASS_PER_REQUEST,
  APPLE_HEALTH_MAX_WORKOUTS_PER_REQUEST,
} from '@/lib/schemas/import';

// What the file held, after the browser-side scan.
interface Scan {
  // Without the duplicates inside the file itself.
  workouts: AppleHealthWorkout[];
  // Workouts left out because the file holds the same effort twice.
  fileDuplicates: number;
  bodyMass: AppleHealthBodyMass[];
  skippedStrength: number;
  skippedInvalid: number;
}

// The server's dry-run answer, summed over every batch.
interface PreviewTotals {
  importable: number;
  duplicates: number;
  conflicts: number;
  byExercise: Array<{ exerciseName: string; count: number }>;
  bodyMassImportable: number;
  bodyMassDuplicates: number;
}

interface PreviewResponse {
  workouts: {
    importable: number;
    duplicates: number;
    conflicts: number;
    byExercise: Array<{ exerciseName: string; count: number }>;
  };
  bodyMass: { importable: number; duplicates: number };
}

interface ConfirmResponse {
  createdSessions: number;
  createdExercises: number;
  skippedDuplicates: number;
  skippedConflicts: number;
  bodyMass: { created: number; duplicates: number };
}

type Status =
  | { kind: 'idle' }
  | { kind: 'reading'; read: number; total: number }
  | { kind: 'sending'; done: number; total: number }
  | { kind: 'waiting'; seconds: number };

interface Batch {
  workouts: AppleHealthWorkout[];
  bodyMass: AppleHealthBodyMass[];
}

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

// One request carries a slice of the workouts and a slice of the body weight
// entries, each within the server's per-request cap.
function toBatches(workouts: AppleHealthWorkout[], bodyMass: AppleHealthBodyMass[]): Batch[] {
  const w = chunk(workouts, APPLE_HEALTH_MAX_WORKOUTS_PER_REQUEST);
  const b = chunk(bodyMass, APPLE_HEALTH_MAX_BODY_MASS_PER_REQUEST);
  const out: Batch[] = [];
  for (let i = 0; i < Math.max(w.length, b.length); i++) {
    out.push({ workouts: w[i] ?? [], bodyMass: b[i] ?? [] });
  }
  return out;
}

// The import routes share one per-user rate bucket; a long history needs more
// requests than one window allows, so a 429 is waited out, not surfaced.
const MAX_RATE_LIMIT_WAITS = 30;
const MAX_WAIT_SEC = 60;

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

interface Props {
  // Injectable for tests (the rate-limit wait).
  sleep?: (ms: number) => Promise<void>;
}

// Apple Health import (issue #582). The export (export.zip or export.xml, up
// to hundreds of MB) is streamed and reduced on this device; only the workout
// and body weight summaries are posted, in batches, first as a dry run.
export function AppleHealthImport({ sleep = defaultSleep }: Props) {
  const t = useTranslations('settings.imports.appleHealth');
  const shared = useTranslations('settings.imports');
  const common = useTranslations('common');
  const intl = useFormatter();
  const exerciseName = useExerciseName();
  const fileRef = useRef<HTMLInputElement>(null);
  const alive = useRef(true);
  const [status, setStatus] = useState<Status>({ kind: 'idle' });
  const [scan, setScan] = useState<Scan | null>(null);
  const [preview, setPreview] = useState<PreviewTotals | null>(null);
  const [withBodyMass, setWithBodyMass] = useState(true);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const busy = status.kind !== 'idle';

  function reset() {
    setScan(null);
    setPreview(null);
    setStatus({ kind: 'idle' });
  }

  async function post<T>(mode: 'preview' | 'confirm', batch: Batch): Promise<T> {
    for (let waits = 0; ; waits++) {
      const res = await fetch('/api/import/apple-health', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode, workouts: batch.workouts, bodyMass: batch.bodyMass }),
      });
      const json = (await res.json().catch(() => null)) as
        | (T & { error?: string; retryAfterSec?: number })
        | null;
      if (res.status === 429 && waits < MAX_RATE_LIMIT_WAITS) {
        const seconds = Math.min(MAX_WAIT_SEC, Math.max(1, Number(json?.retryAfterSec) || 10));
        if (alive.current) setStatus({ kind: 'waiting', seconds });
        await sleep(seconds * 1000);
        continue;
      }
      if (!res.ok || !json) throw new Error(json?.error ?? `Error ${res.status}`);
      return json;
    }
  }

  // Send every batch in order. Returns null when the section was left meanwhile.
  async function sendAll<T>(mode: 'preview' | 'confirm', batches: Batch[]): Promise<T[] | null> {
    const results: T[] = [];
    for (let i = 0; i < batches.length; i++) {
      if (!alive.current) return null;
      setStatus({ kind: 'sending', done: i, total: batches.length });
      results.push(await post<T>(mode, batches[i]!));
    }
    return results;
  }

  async function onFilePicked(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setScan(null);
    setPreview(null);
    setStatus({ kind: 'reading', read: 0, total: file.size });
    try {
      let lastStep = -1;
      const result = await readAppleHealthFile(file, {
        onProgress: (read, total) => {
          // A state update per percent, not per 64 KB chunk.
          const step = total > 0 ? Math.floor((read / total) * 100) : 100;
          if (step === lastStep || !alive.current) return;
          lastStep = step;
          setStatus({ kind: 'reading', read, total });
        },
      });
      if (!alive.current) return;
      if (
        result.workouts.length === 0 &&
        result.bodyMass.length === 0 &&
        result.skippedStrength === 0
      ) {
        toast.error(t('nothingFound'));
        reset();
        return;
      }

      // Duplicates inside the file are removed here, over the whole scan: the
      // server only sees one batch at a time, so a pair cut by a batch
      // boundary would be previewed as importable and then skipped at confirm.
      const deduped = dedupeAppleHealthWorkouts(result.workouts);
      const responses = await sendAll<PreviewResponse>(
        'preview',
        toBatches(deduped.workouts, result.bodyMass),
      );
      if (!responses) return;
      const counts = new Map<string, number>();
      const totals: PreviewTotals = {
        importable: 0,
        duplicates: deduped.duplicates,
        conflicts: 0,
        byExercise: [],
        bodyMassImportable: 0,
        bodyMassDuplicates: 0,
      };
      for (const r of responses) {
        totals.importable += r.workouts.importable;
        totals.duplicates += r.workouts.duplicates;
        totals.conflicts += r.workouts.conflicts;
        totals.bodyMassImportable += r.bodyMass.importable;
        totals.bodyMassDuplicates += r.bodyMass.duplicates;
        for (const row of r.workouts.byExercise) {
          counts.set(row.exerciseName, (counts.get(row.exerciseName) ?? 0) + row.count);
        }
      }
      totals.byExercise = [...counts.entries()]
        .map(([name, count]) => ({ exerciseName: name, count }))
        .sort((a, b) => b.count - a.count || a.exerciseName.localeCompare(b.exerciseName));
      setScan({ ...result, workouts: deduped.workouts, fileDuplicates: deduped.duplicates });
      setPreview(totals);
      setWithBodyMass(true);
      setStatus({ kind: 'idle' });
    } catch (err) {
      if (!alive.current) return;
      if (err instanceof AppleHealthFileError) {
        if (err.code === 'no-export-xml') toast.error(t('noExportXml'));
        else if (err.code === 'too-large') {
          toast.error(t('tooLarge', { limit: APPLE_HEALTH_MAX_INFLATED_GB }));
        } else if (err.code === 'too-many-files') {
          toast.error(t('tooManyFiles', { limit: APPLE_HEALTH_MAX_ZIP_ENTRIES }));
        } else toast.error(t('unreadable'));
      } else {
        toast.error(err instanceof Error ? err.message : t('unreadable'));
      }
      reset();
    }
  }

  async function confirm() {
    if (!scan || !preview) return;
    const bodyMass = withBodyMass ? scan.bodyMass : [];
    try {
      const responses = await sendAll<ConfirmResponse>(
        'confirm',
        toBatches(scan.workouts, bodyMass),
      );
      if (!responses) return;
      let sessions = 0;
      let weights = 0;
      let skipped = scan.fileDuplicates;
      for (const r of responses) {
        sessions += r.createdSessions;
        weights += r.bodyMass.created;
        skipped += r.skippedDuplicates + r.skippedConflicts;
      }
      toast.success(t('done', { sessions, weights, skipped }));
      reset();
    } catch (err) {
      if (!alive.current) return;
      // Batches already imported stay; a second run skips them as duplicates.
      toast.error(err instanceof Error ? err.message : shared('importFailed'));
      setStatus({ kind: 'idle' });
    }
  }

  const megabytes = (bytes: number) =>
    intl.number(bytes / (1024 * 1024), { maximumFractionDigits: 1 });
  const nothingToImport =
    !preview || (preview.importable === 0 && !(withBodyMass && preview.bodyMassImportable > 0));

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
        accept=".zip,.xml,application/zip,application/x-zip-compressed,application/xml,text/xml"
        className="hidden"
        onChange={onFilePicked}
      />
      <p className="text-xs text-muted-foreground">{t('privacy')}</p>

      {busy && (
        <div className="space-y-2" role="status" data-testid="apple-health-progress">
          <p className="text-sm">
            {status.kind === 'reading' &&
              t('reading', { read: megabytes(status.read), total: megabytes(status.total) })}
            {status.kind === 'sending' &&
              t('sending', { done: status.done + 1, total: status.total })}
            {status.kind === 'waiting' && t('waiting', { seconds: status.seconds })}
          </p>
          {status.kind === 'reading' && (
            <Progress
              value={status.total > 0 ? (status.read / status.total) * 100 : 0}
              aria-label={t('reading', {
                read: megabytes(status.read),
                total: megabytes(status.total),
              })}
            />
          )}
        </div>
      )}

      {scan && preview && (
        <div className="rounded-md border p-3 text-sm" data-testid="import-preview">
          <p className="font-medium">{t('workouts', { count: preview.importable })}</p>
          <ul className="mt-2 list-disc space-y-1 pl-5">
            {preview.byExercise.map((row) => (
              <li key={row.exerciseName}>
                {t('byType', { name: exerciseName(row.exerciseName), count: row.count })}
              </li>
            ))}
            {preview.duplicates > 0 && <li>{t('duplicates', { count: preview.duplicates })}</li>}
            {scan.skippedStrength > 0 && (
              <li>{t('strengthSkipped', { count: scan.skippedStrength })}</li>
            )}
            {scan.skippedInvalid > 0 && (
              <li>{t('invalidSkipped', { count: scan.skippedInvalid })}</li>
            )}
            {preview.conflicts > 0 && (
              <li className="text-amber-700 dark:text-amber-400">
                {t('conflicts', { count: preview.conflicts })}
              </li>
            )}
            {preview.bodyMassDuplicates > 0 && (
              <li>{t('bodyMassDuplicates', { count: preview.bodyMassDuplicates })}</li>
            )}
          </ul>
          {preview.bodyMassImportable > 0 && (
            <label className="mt-3 flex items-center justify-between gap-3">
              <span>{t('bodyMass', { count: preview.bodyMassImportable })}</span>
              <Switch
                checked={withBodyMass}
                onCheckedChange={setWithBodyMass}
                disabled={busy}
              />
            </label>
          )}
          <div className="mt-3 flex gap-2">
            <Button
              size="sm"
              onClick={confirm}
              disabled={busy || nothingToImport}
              className="min-h-tap"
            >
              {busy ? <Loader2 className="size-4 animate-spin" /> : null}
              <span className={busy ? 'ml-2' : ''}>{shared('confirm')}</span>
            </Button>
            <Button size="sm" variant="ghost" onClick={reset} disabled={busy}>
              {common('actions.cancel')}
            </Button>
          </div>
        </div>
      )}
    </>
  );
}
