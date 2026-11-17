'use client';

import { useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Dumbbell, Loader2, MessageSquarePlus, Send } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import { aiErrorMessage, type AiErrorFields } from '@/lib/ai-error-message';
import { parseStreamError } from '@/lib/llm/error-codes';

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface ConversationSummary {
  id: string;
  title: string;
  updatedAt: string;
}

interface Props {
  initialConversations: ConversationSummary[];
  initialActiveId: string | null;
  initialMessages: ChatMessage[];
  // Live session attached from the session runner (issue #111), or null for a
  // normal chat. Sent with each message so the coach sees the workout so far.
  sessionId?: string | null;
  hasApiKey: boolean;
  providerLabel: string;
  apiKeyEnvVar: string;
}

export function ChatClient({
  initialConversations,
  initialActiveId,
  initialMessages,
  sessionId = null,
  hasApiKey,
  providerLabel,
  apiKeyEnvVar,
}: Props) {
  const t = useTranslations('coach.chat');
  const common = useTranslations('common');
  const [conversations, setConversations] = useState(initialConversations);
  const [activeId, setActiveId] = useState<string | null>(initialActiveId);
  const [messages, setMessages] = useState<ChatMessage[]>(initialMessages);
  const [input, setInput] = useState('');
  const [streaming, setStreaming] = useState(false);
  const threadRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    threadRef.current?.scrollTo({ top: threadRef.current.scrollHeight });
  }, [messages]);

  function appendToAssistant(chunk: string) {
    setMessages((prev) => {
      const copy = [...prev];
      const last = copy[copy.length - 1];
      if (last && last.role === 'assistant') {
        copy[copy.length - 1] = { ...last, content: last.content + chunk };
      }
      return copy;
    });
  }

  function replaceAssistant(content: string) {
    setMessages((prev) => {
      const copy = [...prev];
      const last = copy[copy.length - 1];
      if (last && last.role === 'assistant') copy[copy.length - 1] = { ...last, content };
      return copy;
    });
  }

  async function send() {
    const text = input.trim();
    if (!text || streaming) return;

    setInput('');
    setStreaming(true);
    setMessages((prev) => [
      ...prev,
      { role: 'user', content: text },
      { role: 'assistant', content: '' },
    ]);

    try {
      const res = await fetch('/api/coach/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          conversationId: activeId ?? undefined,
          message: text,
          sessionId: sessionId ?? undefined,
        }),
      });

      // Read before the status check: when the provider refuses the call the
      // conversation and the user message already exist, and the next message
      // must continue that conversation instead of starting another one.
      const newId = res.headers.get('X-Conversation-Id');
      if (newId && newId !== activeId) {
        setActiveId(newId);
        if (!conversations.some((c) => c.id === newId)) {
          setConversations((prev) => [
            { id: newId, title: text.slice(0, 60), updatedAt: new Date().toISOString() },
            ...prev,
          ]);
        }
      }

      if (!res.ok || !res.body) {
        const j = (await res.json().catch(() => ({}))) as { error?: string } & AiErrorFields;
        // A provider failure carries a stable code: show its translation.
        throw new Error(aiErrorMessage(common, j) ?? j.error ?? `Error ${res.status}`);
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let received = '';
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value, { stream: true });
        received += chunk;
        appendToAssistant(chunk);
      }

      // A provider failure after the first chunk arrives as a trailing
      // "[error:<code>] <English text>" marker: swap it for the translation.
      const failure = parseStreamError(received);
      const localized = failure ? aiErrorMessage(common, failure) : null;
      if (failure && localized) {
        toast.error(localized);
        replaceAssistant(`${failure.text}\n\n[error] ${localized}`);
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Chat failed.';
      toast.error(msg);
      appendToAssistant(`\n\n[error] ${msg}`);
    } finally {
      setStreaming(false);
    }
  }

  async function openConversation(id: string) {
    if (streaming) return;
    setActiveId(id);
    try {
      const res = await fetch(`/api/coach/chat/${id}`);
      if (!res.ok) throw new Error(`Error ${res.status}`);
      const j = (await res.json()) as {
        messages: { role: 'USER' | 'ASSISTANT'; content: string }[];
      };
      setMessages(
        j.messages.map((m) => ({
          role: m.role === 'ASSISTANT' ? 'assistant' : 'user',
          content: m.content,
        })),
      );
    } catch {
      toast.error('Could not load that conversation.');
    }
  }

  function newConversation() {
    if (streaming) return;
    setActiveId(null);
    setMessages([]);
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void send();
    }
  }

  return (
    <div className="flex flex-col gap-4">
      {!hasApiKey && (
        <div className="rounded-md border border-amber-500/40 bg-amber-500/5 p-3 text-sm">
          <p className="font-medium text-amber-900 dark:text-amber-100">
            {providerLabel} key missing
          </p>
          <p className="text-xs text-muted-foreground">
            {t('apiKey', { variable: apiKeyEnvVar })}
          </p>
        </div>
      )}

      {sessionId && (
        <div className="flex items-center gap-2 rounded-md border border-primary/30 bg-primary/5 p-3 text-sm">
          <Dumbbell className="size-4 shrink-0 text-primary" />
          <p className="text-xs text-muted-foreground">
            <span className="font-medium text-foreground">{t('liveSession')}</span>{' '}
            {t('liveSessionDescription')}
          </p>
        </div>
      )}

      <div className="flex items-center gap-2 overflow-x-auto pb-1">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={newConversation}
          className="shrink-0"
        >
          <MessageSquarePlus className="size-4" />
          <span className="ml-1.5">{t('new')}</span>
        </Button>
        {conversations.map((c) => (
          <button
            key={c.id}
            type="button"
            onClick={() => openConversation(c.id)}
            className={cn(
              'shrink-0 rounded-full border px-3 py-1.5 text-xs transition-colors',
              c.id === activeId
                ? 'border-primary/40 bg-primary/10 text-foreground'
                : 'border-border text-muted-foreground hover:bg-accent/40',
            )}
          >
            {c.title}
          </button>
        ))}
      </div>

      {/* The chat has no write path. Say so in the UI as well as in the
          system prompt, so a trainee who asks for a program change does not
          leave believing it was applied. */}
      <p className="text-xs text-muted-foreground">{t('advisory')}</p>

      <div
        ref={threadRef}
        className="flex min-h-[40vh] flex-col gap-3 overflow-y-auto rounded-lg border p-3"
      >
        {messages.length === 0 ? (
          <p className="m-auto max-w-sm text-center text-sm text-muted-foreground">
            {sessionId
              ? t('emptySession')
              : t('empty')}
          </p>
        ) : (
          messages.map((m, i) => (
            <div
              key={i}
              className={cn(
                'max-w-[85%] rounded-lg px-3 py-2 text-sm',
                m.role === 'user'
                  ? 'self-end bg-primary text-primary-foreground'
                  : 'self-start bg-muted',
              )}
            >
              {m.role === 'assistant' ? (
                m.content === '' && streaming ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <article className="prose prose-sm dark:prose-invert max-w-none">
                    <ReactMarkdown>{m.content}</ReactMarkdown>
                  </article>
                )
              ) : (
                <span className="whitespace-pre-wrap">{m.content}</span>
              )}
            </div>
          ))
        )}
      </div>

      <div className="flex items-end gap-2">
        <Textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={onKeyDown}
          rows={2}
          placeholder={t('placeholder')}
          aria-label={t('placeholder')}
          disabled={!hasApiKey || streaming}
          className="resize-none"
        />
        <Button
          type="button"
          onClick={send}
          disabled={!hasApiKey || streaming || input.trim() === ''}
          className="min-h-tap"
          aria-label={t('send')}
        >
          {streaming ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <Send className="size-4" />
          )}
        </Button>
      </div>
    </div>
  );
}
