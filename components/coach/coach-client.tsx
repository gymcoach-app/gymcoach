'use client';

import { useState } from 'react';
import { useFormatter, useTranslations } from 'next-intl';
import { AlertTriangle, Loader2, MessageCircle, Sparkles } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { extractAdjustments, type Adjustment } from '@/lib/coach-adjustments';
import { CoachAdjustments } from './coach-adjustments';

interface DebriefItem {
  id: string;
  weekStart: string;
  weekEnd: string;
  response: string;
  appliedAt: string | null;
  createdAt: string;
}

export interface ProgramExerciseDefaults {
  targetRepsMin: number;
  targetRepsMax: number;
  targetSets: number;
  targetRIR: number;
  restSec: number;
}

interface Props {
  initialHistory: DebriefItem[];
  hasApiKey: boolean;
  providerLabel: string;
  apiKeyEnvVar: string;
  programDefaults: Record<string, ProgramExerciseDefaults>;
}

export function CoachClient({
  initialHistory,
  hasApiKey,
  providerLabel,
  apiKeyEnvVar,
  programDefaults,
}: Props) {
  const t = useTranslations('coach');
  const format = useFormatter();
  const formatDate = (iso: string) =>
    format.dateTime(new Date(iso), { day: '2-digit', month: 'long', year: 'numeric' });
  const [history, setHistory] = useState(initialHistory);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeId, setActiveId] = useState<string | null>(
    initialHistory[0]?.id ?? null,
  );

  async function requestDebrief() {
    setPending(true);
    setError(null);
    try {
      const res = await fetch('/api/coach', { method: 'POST' });
      if (res.status === 429) {
        throw new Error(t('client.tooManyDebriefs'));
      }
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(j.error ?? `Error ${res.status}`);
      }
      const j = (await res.json()) as { id: string; response: string; createdAt: string };
      const newItem: DebriefItem = {
        id: j.id,
        weekStart: new Date().toISOString(),
        weekEnd: new Date().toISOString(),
        response: j.response,
        appliedAt: null,
        createdAt: j.createdAt,
      };
      setHistory((h) => [newItem, ...h]);
      setActiveId(newItem.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : t('client.unknownError'));
    } finally {
      setPending(false);
    }
  }

  const active = history.find((h) => h.id === activeId) ?? history[0];

  return (
    <div className="flex flex-col gap-6">
      {!hasApiKey && (
        <Card className="border-amber-500/40 bg-amber-500/5">
          <CardContent className="flex items-start gap-3 py-4 text-sm">
            <AlertTriangle className="size-5 shrink-0 text-amber-600" />
            <div>
              <p className="font-medium text-amber-900 dark:text-amber-100">
                {t('client.keyMissing', { provider: providerLabel })}
              </p>
              <p className="text-xs text-muted-foreground">
                {t('client.keySetup', { variable: apiKeyEnvVar })}
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardContent className="flex flex-col gap-3 py-4">
          <Button
            onClick={requestDebrief}
            disabled={pending || !hasApiKey}
            className="min-h-tap"
          >
            {pending ? (
              <>
                <Loader2 className="size-5 animate-spin" />
                <span className="ml-2">{t('client.generating')}</span>
              </>
            ) : (
              <>
                <Sparkles className="size-5" />
                <span className="ml-2">{t('client.request')}</span>
              </>
            )}
          </Button>
          {error && (
            <p className="text-sm text-rose-600">{error}</p>
          )}
        </CardContent>
      </Card>

      {active ? (
        <ActiveDebrief
          active={active}
          programDefaults={programDefaults}
          onApplied={(appliedAt) => {
            setHistory((h) =>
              h.map((item) => (item.id === active.id ? { ...item, appliedAt } : item)),
            );
          }}
        />
      ) : (
        <Card>
          <CardContent className="flex items-center gap-3 py-8 text-sm text-muted-foreground">
            <MessageCircle className="size-5" />
            <span>{t('client.empty')}</span>
          </CardContent>
        </Card>
      )}

      {history.length > 1 && (
        <div>
          <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            {t('context.history')}
          </h3>
          <ul className="flex flex-col gap-2">
            {history.map((h) => {
              const isActive = h.id === active?.id;
              return (
                <li key={h.id}>
                  <button
                    type="button"
                    onClick={() => setActiveId(h.id)}
                    className={`block w-full rounded-md border p-3 text-left text-sm transition-colors ${
                      isActive
                        ? 'border-primary/40 bg-primary/5'
                        : 'border-border hover:bg-accent/40'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-medium">
                        {formatDate(h.createdAt)}
                      </span>
                      {h.appliedAt && (
                        <Badge variant="secondary" className="text-xs">
                          {t('client.applied')}
                        </Badge>
                      )}
                    </div>
                    <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">
                      {firstNonEmptyLine(h.response)}
                    </p>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}

function ActiveDebrief({
  active,
  programDefaults,
  onApplied,
}: {
  active: DebriefItem;
  programDefaults: Record<string, ProgramExerciseDefaults>;
  onApplied: (appliedAt: string) => void;
}) {
  const t = useTranslations('coach');
  const format = useFormatter();
  const formatDate = (iso: string) =>
    format.dateTime(new Date(iso), { day: '2-digit', month: 'long', year: 'numeric' });
  const { cleaned, adjustments, parseErrors } = extractAdjustments(active.response);
  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <h2 className="text-base font-semibold">
                {t('client.debriefFrom', { date: formatDate(active.createdAt) })}
              </h2>
              <p className="text-xs text-muted-foreground">
                {t('client.weekOf', { date: formatDate(active.weekStart) })}
              </p>
            </div>
            {active.appliedAt && (
              <Badge variant="secondary" className="shrink-0">
                {t('client.applied')}
              </Badge>
            )}
          </div>
        </CardHeader>
        <CardContent>
          <article className="prose prose-sm dark:prose-invert max-w-none">
            <ReactMarkdown>{cleaned}</ReactMarkdown>
          </article>
          {parseErrors.length > 0 && (
            <p className="mt-3 text-xs text-amber-600">
              Adjustments block ignored: {parseErrors[0]}
            </p>
          )}
        </CardContent>
      </Card>

      {adjustments.length > 0 && (
        <CoachAdjustments
          debriefId={active.id}
          initialAdjustments={adjustments as Adjustment[]}
          programDefaults={programDefaults}
          alreadyApplied={!!active.appliedAt}
          onApplied={onApplied}
        />
      )}
    </div>
  );
}

function firstNonEmptyLine(text: string): string {
  for (const line of text.split('\n')) {
    const trimmed = line.replace(/^[#>*-]+\s*/, '').trim();
    if (trimmed) return trimmed;
  }
  return text.slice(0, 120);
}
