'use client';

import { useRef, useState } from 'react';
import { useFormatter, useLocale, useTranslations } from 'next-intl';
import { FileUp, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { formatCardioSet } from '@/lib/cardio';
import { FIT_MAX_BATCH } from '@/lib/schemas/import';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useExerciseName } from '@/components/shared/use-exercise-name';
import { cn } from '@/lib/utils';

// Client-side mirror of the server cap (the server re-enforces it).
const MAX_FILE_BYTES = 5 * 1024 * 1024;

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

// Read a binary file (FIT, issue #249) as base64 so it can ride the JSON import
// payload. Uses arrayBuffer() with a FileReader fallback for jsdom.
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

interface LineError {
  line: number;
  reason: string;
}

interface Preview {
  sessions: number;
  sets: number;
  newExercises: string[];
  existingSessionDates: string[];
  duplicatesSkipped: number;
  // Cardio sets to import (issue #134) vs rows that still cannot be
  // represented (no usable duration) and are skipped with a notice.
  cardioSets: number;
  cardioSkipped: number;
  errorCount: number;
  errors: LineError[];
}

// TCX preview/confirm payload (issue #152): one activity = one session, so
// the shape is a single summary instead of the CSV counts.
interface TcxPreview {
  sport: string;
  exerciseName: string;
  startedAt: string;
  durationSec: number;
  distanceM: number | null;
  avgHr: number | null;
  maxHr: number | null;
  duplicateSessions: string[];
}

// FIT batch preview (issue #253): one entry per uploaded file. A file that
// failed to parse comes back ok:false with an error instead of a summary.
interface FitBatchActivity extends Partial<TcxPreview> {
  index: number;
  ok: boolean;
  error?: string;
}
interface FitBatchPreview {
  activities: FitBatchActivity[];
  importable: number;
  skipped: number;
}

type ImportFormat = 'STRONG' | 'HEVY' | 'GYMCOACH' | 'TCX' | 'GPX' | 'FIT';

// Copy and endpoint per supported source app. Strong keeps its unit toggle
// (its export follows the app's unit setting); Hevy always exports kg, so the
// toggle is hidden for it. TCX (issue #152) and GPX (issue #204) are both
// single-activity cardio files - they share the preview/confirm UI.
// `source` names where the history comes from in the intro sentence.
const FORMAT_META: Record<
  ImportFormat,
  {
    label: string;
    source: string;
    endpoint: string;
    exportHint: 'strong' | 'hevy' | 'gymcoach' | 'tcx' | 'gpx' | 'fit';
    hasUnitToggle: boolean;
    accept: string;
    fileKind: string;
  }
> = {
  STRONG: {
    label: 'Strong',
    source: 'the Strong app',
    endpoint: '/api/import/strong',
    exportHint: 'strong',
    hasUnitToggle: true,
    accept: '.csv,text/csv',
    fileKind: 'CSV',
  },
  HEVY: {
    label: 'Hevy',
    source: 'the Hevy app',
    endpoint: '/api/import/hevy',
    exportHint: 'hevy',
    hasUnitToggle: false,
    accept: '.csv,text/csv',
    fileKind: 'CSV',
  },
  GYMCOACH: {
    label: 'GymCoach',
    source: 'a GymCoach history CSV',
    endpoint: '/api/import/gymcoach',
    exportHint: 'gymcoach',
    hasUnitToggle: false,
    accept: '.csv,text/csv',
    fileKind: 'CSV',
  },
  TCX: {
    label: 'TCX file',
    source: 'a TCX file',
    endpoint: '/api/import/tcx',
    exportHint: 'tcx',
    hasUnitToggle: false,
    accept: '.tcx,application/vnd.garmin.tcx+xml,application/xml,text/xml',
    fileKind: 'TCX',
  },
  GPX: {
    label: 'GPX file',
    source: 'a GPX file',
    endpoint: '/api/import/gpx',
    exportHint: 'gpx',
    hasUnitToggle: false,
    accept: '.gpx,application/gpx+xml,application/xml,text/xml',
    fileKind: 'GPX',
  },
  FIT: {
    label: 'FIT file',
    source: 'a FIT file',
    endpoint: '/api/import/fit',
    exportHint: 'fit',
    hasUnitToggle: false,
    accept: '.fit,application/vnd.ant.fit,application/octet-stream',
    fileKind: 'FIT',
  },
};

// CSV import from another tracker (issues #100/#113): pick the source app and
// the export file, dry-run preview (counts + per-line errors, nothing
// written), then explicitly confirm.
export function ImportSection() {
  const locale = useLocale();
  const t = useTranslations('settings.imports');
  const common = useTranslations('common');
  const intl = useFormatter();
  const exerciseName = useExerciseName();
  const fileRef = useRef<HTMLInputElement>(null);
  const [format, setFormat] = useState<ImportFormat>('STRONG');
  const [unit, setUnit] = useState<'KG' | 'LB'>('KG');
  const [fileName, setFileName] = useState<string | null>(null);
  const [csvText, setCsvText] = useState<string | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [tcxPreview, setTcxPreview] = useState<TcxPreview | null>(null);
  // FIT supports a multi-file batch (issue #253): the base64 payloads and the
  // aggregated per-file preview live here, separate from the single-file states.
  const [fitPayloads, setFitPayloads] = useState<string[] | null>(null);
  const [fitBatch, setFitBatch] = useState<FitBatchPreview | null>(null);
  const [busy, setBusy] = useState(false);

  const meta = FORMAT_META[format];
  const isTcx = format === 'TCX';
  const isGpx = format === 'GPX';
  const isFit = format === 'FIT';
  // TCX, GPX and FIT are all single-activity cardio imports: same summary
  // shape, same preview/confirm UI. FIT is the only binary one (read as base64).
  const isCardioActivity = isTcx || isGpx || isFit;

  function pickFile() {
    fileRef.current?.click();
  }

  function resetPreviews() {
    setCsvText(null);
    setFileName(null);
    setPreview(null);
    setTcxPreview(null);
    setFitPayloads(null);
    setFitBatch(null);
  }

  function switchFormat(next: ImportFormat) {
    if (busy) return;
    setFormat(next);
    // A pending preview was produced by the other parser; drop it.
    resetPreviews();
  }

  async function onFilePicked(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    e.target.value = '';
    if (files.length === 0) return;
    if (files.some((f) => f.size > MAX_FILE_BYTES)) {
      toast.error(t('fileTooLarge'));
      return;
    }

    // FIT (issue #253) is binary AND supports a multi-file batch.
    if (isFit) {
      if (files.length > FIT_MAX_BATCH) {
        toast.error(t('fitLimit', { count: FIT_MAX_BATCH }));
        return;
      }
      const payloads = await Promise.all(files.map(readFileBase64));
      setFileName(files.map((f) => f.name).join(', '));
      setFitPayloads(payloads);
      setPreview(null);
      setTcxPreview(null);
      await requestFitPreview(payloads);
      return;
    }

    // Every other format is single-file text.
    const file = files[0]!;
    const text = await readFileText(file);
    setFileName(file.name);
    setCsvText(text);
    setPreview(null);
    setTcxPreview(null);
    await requestPreview(text);
  }

  async function callFitBatch(payloads: string[], mode: 'preview' | 'confirm') {
    const res = await fetch('/api/import/fit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fits: payloads, mode }),
    });
    const json = (await res.json().catch(() => null)) as
      | (FitBatchPreview & {
          createdSessions?: number;
          createdSets?: number;
          createdExercises?: number;
          skipped?: number;
          error?: string;
        })
      | null;
    if (!res.ok) throw new Error(json?.error ?? `Error ${res.status}`);
    return json;
  }

  async function requestFitPreview(payloads: string[]) {
    setBusy(true);
    try {
      const json = await callFitBatch(payloads, 'preview');
      if (json) setFitBatch(json);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('previewFailed'));
      setFitPayloads(null);
      setFileName(null);
    } finally {
      setBusy(false);
    }
  }

  async function confirmFitBatch() {
    if (!fitPayloads) return;
    setBusy(true);
    try {
      const json = await callFitBatch(fitPayloads, 'confirm');
      const sessions = json?.createdSessions ?? 0;
      const newEx = json?.createdExercises ?? 0;
      const skipped = json?.skipped ?? 0;
      toast.success(t('fitImportDone', { sessions, exercises: newEx, skipped }));
      resetPreviews();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('importFailed'));
    } finally {
      setBusy(false);
    }
  }

  async function callApi(fileText: string, mode: 'preview' | 'confirm') {
    const res = await fetch(meta.endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      // Each route's Zod schema defines its exact body: TCX carries the file as
      // xml, GPX as gpx; the CSV routes as csv (unit only where the app exports
      // both).
      body: JSON.stringify(
        isTcx
          ? { xml: fileText, mode }
          : isGpx
            ? { gpx: fileText, mode }
            : meta.hasUnitToggle
              ? { csv: fileText, unit, mode }
              : { csv: fileText, mode },
      ),
    });
    const json = (await res.json().catch(() => null)) as
      | (Preview &
          TcxPreview & {
            createdSessions?: number;
            createdSets?: number;
            createdExercises?: number;
            error?: string;
          })
      | null;
    if (!res.ok) {
      throw new Error(json?.error ?? `Error ${res.status}`);
    }
    return json;
  }

  async function requestPreview(fileText: string) {
    setBusy(true);
    try {
      const json = await callApi(fileText, 'preview');
      // TCX/GPX are single-activity cardio (FIT has its own batch path).
      if (json && (isTcx || isGpx)) setTcxPreview(json);
      else if (json) setPreview(json);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('previewFailed'));
      setCsvText(null);
      setFileName(null);
    } finally {
      setBusy(false);
    }
  }

  async function confirmImport() {
    if (!csvText) return;
    setBusy(true);
    try {
      const json = await callApi(csvText, 'confirm');
      toast.success(
        t('importDone', {
          sessions: json?.createdSessions ?? 0,
          sets: json?.createdSets ?? 0,
          exercises: json?.createdExercises ?? 0,
        }),
      );
      setCsvText(null);
      setFileName(null);
      setPreview(null);
      setTcxPreview(null);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('importFailed'));
    } finally {
      setBusy(false);
    }
  }

  function cancel() {
    resetPreviews();
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <h2 className="text-base font-semibold">
          {isCardioActivity
            ? t('cardioTitle', { kind: meta.fileKind })
            : t('appTitle', { app: meta.label })}
        </h2>
        <p className="text-xs text-muted-foreground">
          {isCardioActivity
            ? t('cardioDescription', { hint: t(`exportHints.${meta.exportHint}`) })
            : t('appDescription', { app: meta.label, hint: t(`exportHints.${meta.exportHint}`) })}
        </p>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <div className={cn('flex items-end gap-2', locale === 'zh-CN' && 'flex-wrap')}>
          <div className="space-y-1">
            <Label htmlFor="import-format">{t('source')}</Label>
            <Select value={format} onValueChange={(v) => switchFormat(v as ImportFormat)}>
              <SelectTrigger id="import-format" className="h-9 w-28">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="STRONG">Strong</SelectItem>
                <SelectItem value="HEVY">Hevy</SelectItem>
                <SelectItem value="GYMCOACH">GymCoach CSV</SelectItem>
                <SelectItem value="TCX">{t('file', { format: 'TCX' })}</SelectItem>
                <SelectItem value="GPX">{t('file', { format: 'GPX' })}</SelectItem>
                <SelectItem value="FIT">{t('file', { format: 'FIT' })}</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {meta.hasUnitToggle && (
            <div className="space-y-1">
              <Label htmlFor="strong-unit">{t('strongUnit')}</Label>
              <Select value={unit} onValueChange={(v) => setUnit(v as 'KG' | 'LB')}>
                <SelectTrigger id="strong-unit" className="h-9 w-28">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="KG">kg</SelectItem>
                  <SelectItem value="LB">lb</SelectItem>
                </SelectContent>
              </Select>
            </div>
          )}
          <Button variant="outline" onClick={pickFile} disabled={busy} className="min-h-tap">
            {busy ? <Loader2 className="size-4 animate-spin" /> : <FileUp className="size-4" />}
            <span className="ml-2">
              {isFit
                ? t('chooseFitFiles')
                : isCardioActivity
                  ? t('chooseFile', { kind: meta.fileKind })
                  : t('chooseFile', { kind: `${meta.label} ${meta.fileKind}` })}
            </span>
          </Button>
        </div>
        <input
          ref={fileRef}
          type="file"
          accept={meta.accept}
          // FIT supports importing a batch of activities at once (issue #253).
          multiple={isFit}
          className="hidden"
          onChange={onFilePicked}
        />

        {fitBatch && (
          <div className="rounded-md border p-3 text-sm" data-testid="import-preview">
            <p className="font-medium">
              {t('activitiesSummary', {
                count: fitBatch.importable,
                skipped: fitBatch.skipped,
              })}
            </p>
            <ul className="mt-2 max-h-64 list-disc space-y-1 overflow-y-auto pl-5">
              {fitBatch.activities.map((a) =>
                a.ok ? (
                  <li key={a.index}>
                    {a.sport} on{' '}
                    {intl.dateTime(new Date(a.startedAt!), {
                      day: '2-digit',
                      month: 'long',
                      year: 'numeric',
                      hour: '2-digit',
                      minute: '2-digit',
                    })}{' '}
                    · {formatCardioSet(a.durationSec!, a.distanceM ?? null)}
                    {a.avgHr != null ? ` · avg HR ${a.avgHr} bpm` : ''}
                    {a.maxHr != null ? ` · max HR ${a.maxHr} bpm` : ''} logged as{' '}
                    {exerciseName(a.exerciseName ?? '')}
                    {a.duplicateSessions && a.duplicateSessions.length > 0 ? (
                      <span className="text-amber-700 dark:text-amber-400">
                        {' '}
                        ({t('possibleDuplicate')})
                      </span>
                    ) : null}
                  </li>
                ) : (
                  <li key={a.index} className="text-amber-700 dark:text-amber-400">
                    {t('fileSkipped', { index: a.index + 1, error: a.error ?? '' })}
                  </li>
                ),
              )}
            </ul>
            <div className="mt-3 flex gap-2">
              <Button
                size="sm"
                onClick={confirmFitBatch}
                disabled={busy || fitBatch.importable === 0}
                className="min-h-tap"
              >
                {busy ? <Loader2 className="size-4 animate-spin" /> : null}
                <span className={busy ? 'ml-2' : ''}>
                  {t('importSessions', { count: fitBatch.importable })}
                </span>
              </Button>
              <Button size="sm" variant="ghost" onClick={cancel} disabled={busy}>
                {common('actions.cancel')}
              </Button>
            </div>
          </div>
        )}

        {tcxPreview && (
          <div className="rounded-md border p-3 text-sm" data-testid="import-preview">
            <p className="font-medium">{t('previewOf', { file: fileName ?? '' })}</p>
            <ul className="mt-2 list-disc space-y-1 pl-5">
              <li>
                {t('cardioSession', {
                  sport: tcxPreview.sport,
                  date: intl.dateTime(new Date(tcxPreview.startedAt), {
                    day: '2-digit',
                    month: 'long',
                    year: 'numeric',
                    hour: '2-digit',
                    minute: '2-digit',
                  }),
                })}
              </li>
              <li>
                {formatCardioSet(tcxPreview.durationSec, tcxPreview.distanceM)}
                {tcxPreview.avgHr != null ? ` · avg HR ${tcxPreview.avgHr} bpm` : ''}
                {tcxPreview.maxHr != null ? ` · max HR ${tcxPreview.maxHr} bpm` : ''}{' '}
                {t('loggedAs', { name: exerciseName(tcxPreview.exerciseName) })}
              </li>
              {tcxPreview.duplicateSessions.length > 0 && (
                <li className="text-amber-700 dark:text-amber-400">{t('duplicateWarning')}</li>
              )}
            </ul>
            <div className="mt-3 flex gap-2">
              <Button size="sm" onClick={confirmImport} disabled={busy} className="min-h-tap">
                {busy ? <Loader2 className="size-4 animate-spin" /> : null}
                <span className={busy ? 'ml-2' : ''}>{t('confirm')}</span>
              </Button>
              <Button size="sm" variant="ghost" onClick={cancel} disabled={busy}>
                {common('actions.cancel')}
              </Button>
            </div>
          </div>
        )}

        {preview && (
          <div className="rounded-md border p-3 text-sm" data-testid="import-preview">
            <p className="font-medium">{t('previewOf', { file: fileName ?? '' })}</p>
            <ul className="mt-2 list-disc space-y-1 pl-5">
              <li>{t('strengthSummary', { sessions: preview.sessions, sets: preview.sets })}</li>
              {preview.newExercises.length > 0 && (
                <li>
                  {t('newExercises', {
                    count: preview.newExercises.length,
                    names: preview.newExercises.map(exerciseName).join(', '),
                  })}
                </li>
              )}
              {preview.duplicatesSkipped > 0 && (
                <li>{t('duplicatesSkipped', { count: preview.duplicatesSkipped })}</li>
              )}
              {preview.cardioSets > 0 && (
                <li>{t('cardioIncluded', { count: preview.cardioSets })}</li>
              )}
              {preview.cardioSkipped > 0 && (
                <li>{t('cardioSkipped', { count: preview.cardioSkipped })}</li>
              )}
              {preview.existingSessionDates.length > 0 && (
                <li className="text-amber-700 dark:text-amber-400">
                  {t('existingDates', { dates: preview.existingSessionDates.join(', ') })}
                </li>
              )}
            </ul>

            {preview.errorCount > 0 && (
              <div className="mt-2">
                <p className="font-medium text-rose-600">
                  {t('unreadable', { count: preview.errorCount })}
                </p>
                <ul className="mt-1 max-h-40 list-disc overflow-y-auto pl-5 text-xs text-muted-foreground">
                  {preview.errors.map((e) => (
                    <li key={`${e.line}-${e.reason}`}>
                      {t('lineError', { line: e.line, reason: e.reason })}
                    </li>
                  ))}
                  {preview.errorCount > preview.errors.length && (
                    <li>
                      {t('moreErrors', { count: preview.errorCount - preview.errors.length })}
                    </li>
                  )}
                </ul>
              </div>
            )}

            <div className="mt-3 flex gap-2">
              <Button
                size="sm"
                onClick={confirmImport}
                disabled={busy || preview.sets === 0}
                className="min-h-tap"
              >
                {busy ? <Loader2 className="size-4 animate-spin" /> : null}
                <span className={busy ? 'ml-2' : ''}>{t('confirm')}</span>
              </Button>
              <Button size="sm" variant="ghost" onClick={cancel} disabled={busy}>
                {common('actions.cancel')}
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
