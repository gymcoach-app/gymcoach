'use client';

import { useLocale, useTranslations } from 'next-intl';
import { useState } from 'react';
import { Check, Languages } from 'lucide-react';
import { toast } from 'sonner';
import { localeLabels, locales, type Locale } from '@/i18n/config';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';

// Message key under common.language for each locale's translated name.
const localeMessageKeys = {
  en: 'english',
  fr: 'french',
  ru: 'russian',
  de: 'german',
  es: 'spanish',
  pt: 'portuguese',
  it: 'italian',
  nl: 'dutch',
  pl: 'polish',
  tr: 'turkish',
} as const satisfies Record<Locale, string>;

export function LanguageSelector({ showLabel = false }: { showLabel?: boolean }) {
  const locale = useLocale();
  const t = useTranslations('common.language');
  // Explicit pending state: the trigger stays disabled for the whole request.
  // A transition around a fire-and-forget promise would end in the same tick.
  const [isPending, setIsPending] = useState(false);

  function changeLocale(nextLocale: Locale) {
    if (nextLocale === locale || isPending) return;
    void applyLocale(nextLocale);
  }

  async function applyLocale(nextLocale: Locale) {
    setIsPending(true);
    try {
      const response = await fetch('/api/locale', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ locale: nextLocale }),
      });
      if (!response.ok) throw new Error('Could not update locale.');

      if ('caches' in window) {
        const cacheNames = await window.caches.keys();
        await Promise.all(
          cacheNames
            .filter((name) => name === 'start-url' || name.startsWith('pages'))
            .map((name) => window.caches.delete(name)),
        );
      }

      window.location.reload();
    } catch {
      setIsPending(false);
      toast.error(t('error'));
    }
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size={showLabel ? 'sm' : 'icon'}
          disabled={isPending}
          aria-label={t('change')}
        >
          <Languages className={cn('size-4', showLabel && 'mr-2')} />
          {showLabel && localeLabels[locale]}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {locales.map((item) => (
          <DropdownMenuItem key={item} onSelect={() => changeLocale(item)}>
            <Check className={cn('mr-2 size-4', item !== locale && 'invisible')} />
            {t(localeMessageKeys[item])}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
