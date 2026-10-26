import { createTranslator } from 'next-intl';
import { describe, expect, it } from 'vitest';
import { isLocale, locales } from '@/i18n/config';
import englishMessages from '@/messages/en';
import frenchMessages from '@/messages/fr';
import russianMessages from '@/messages/ru';
import germanMessages from '@/messages/de';
import spanishMessages from '@/messages/es';
import portugueseMessages from '@/messages/pt';
import italianMessages from '@/messages/it';

function messageKeys(value: unknown, prefix = ''): string[] {
  if (typeof value === 'string') return [prefix];
  if (!value || typeof value !== 'object') return [];

  return Object.entries(value).flatMap(([key, child]) =>
    messageKeys(child, prefix ? `${prefix}.${key}` : key),
  );
}

describe('i18n configuration', () => {
  it('recognizes only supported locales', () => {
    expect(locales).toEqual(['en', 'fr', 'ru', 'de', 'es', 'pt', 'it']);
    expect(isLocale('en')).toBe(true);
    expect(isLocale('fr')).toBe(true);
    expect(isLocale('ru')).toBe(true);
    expect(isLocale('de')).toBe(true);
    expect(isLocale('es')).toBe(true);
    expect(isLocale('pt')).toBe(true);
    expect(isLocale('it')).toBe(true);
    expect(isLocale(undefined)).toBe(false);
  });

  it('keeps every locale dictionary structurally complete', () => {
    expect(messageKeys(russianMessages).sort()).toEqual(messageKeys(englishMessages).sort());
    expect(messageKeys(frenchMessages).sort()).toEqual(messageKeys(englishMessages).sort());
    expect(messageKeys(germanMessages).sort()).toEqual(messageKeys(englishMessages).sort());
    expect(messageKeys(spanishMessages).sort()).toEqual(messageKeys(englishMessages).sort());
    expect(messageKeys(portugueseMessages).sort()).toEqual(messageKeys(englishMessages).sort());
    expect(messageKeys(italianMessages).sort()).toEqual(messageKeys(englishMessages).sort());
  });

  it('uses Russian plural categories', () => {
    const t = createTranslator({ locale: 'ru', messages: russianMessages });

    expect(t('common.counts.sets', { count: 1 })).toBe('1 подход');
    expect(t('common.counts.sets', { count: 3 })).toBe('3 подхода');
    expect(t('common.counts.sets', { count: 12 })).toBe('12 подходов');
    expect(t('navigation.settings')).toBe('Настройки');
    expect(t('progress.measurements.sites.armLeft')).toBe('Плечо (левое)');
    expect(t('progress.dashboard.frequency', { count: 3 })).toBe('3 раза/нед.');
  });

  it('uses French plural categories', () => {
    const t = createTranslator({ locale: 'fr', messages: frenchMessages });

    expect(t('common.counts.sets', { count: 1 })).toBe('1 série');
    expect(t('common.counts.sets', { count: 3 })).toBe('3 séries');
    expect(t('navigation.settings')).toBe('Réglages');
    expect(t('progress.measurements.sites.armLeft')).toBe('Bras (gauche)');
    expect(t('progress.dashboard.frequency', { count: 3 })).toBe('3x/semaine');
  });
});
