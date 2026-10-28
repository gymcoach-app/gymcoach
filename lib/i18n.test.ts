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
import dutchMessages from '@/messages/nl';
import polishMessages from '@/messages/pl';
import turkishMessages from '@/messages/tr';

function messageKeys(value: unknown, prefix = ''): string[] {
  if (typeof value === 'string') return [prefix];
  if (!value || typeof value !== 'object') return [];

  return Object.entries(value).flatMap(([key, child]) =>
    messageKeys(child, prefix ? `${prefix}.${key}` : key),
  );
}

describe('i18n configuration', () => {
  it('recognizes only supported locales', () => {
    expect(locales).toEqual(['en', 'fr', 'ru', 'de', 'es', 'pt', 'it', 'nl', 'pl', 'tr']);
    expect(isLocale('en')).toBe(true);
    expect(isLocale('fr')).toBe(true);
    expect(isLocale('ru')).toBe(true);
    expect(isLocale('de')).toBe(true);
    expect(isLocale('es')).toBe(true);
    expect(isLocale('pt')).toBe(true);
    expect(isLocale('it')).toBe(true);
    expect(isLocale('nl')).toBe(true);
    expect(isLocale('pl')).toBe(true);
    expect(isLocale('tr')).toBe(true);
    expect(isLocale(undefined)).toBe(false);
  });

  it('keeps every locale dictionary structurally complete', () => {
    expect(messageKeys(russianMessages).sort()).toEqual(messageKeys(englishMessages).sort());
    expect(messageKeys(frenchMessages).sort()).toEqual(messageKeys(englishMessages).sort());
    expect(messageKeys(germanMessages).sort()).toEqual(messageKeys(englishMessages).sort());
    expect(messageKeys(spanishMessages).sort()).toEqual(messageKeys(englishMessages).sort());
    expect(messageKeys(portugueseMessages).sort()).toEqual(messageKeys(englishMessages).sort());
    expect(messageKeys(italianMessages).sort()).toEqual(messageKeys(englishMessages).sort());
    expect(messageKeys(dutchMessages).sort()).toEqual(messageKeys(englishMessages).sort());
    expect(messageKeys(polishMessages).sort()).toEqual(messageKeys(englishMessages).sort());
    expect(messageKeys(turkishMessages).sort()).toEqual(messageKeys(englishMessages).sort());
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

  it('uses Polish plural categories', () => {
    const t = createTranslator({ locale: 'pl', messages: polishMessages });

    expect(t('common.counts.sets', { count: 1 })).toBe('1 seria');
    expect(t('common.counts.sets', { count: 3 })).toBe('3 serie');
    expect(t('common.counts.sets', { count: 5 })).toBe('5 serii');
    expect(t('common.counts.sets', { count: 22 })).toBe('22 serie');
    expect(t('common.counts.sets', { count: 12 })).toBe('12 serii');
    expect(t('navigation.settings')).toBe('Ustawienia');
  });

  it('keeps the noun singular after a number in Turkish', () => {
    const t = createTranslator({ locale: 'tr', messages: turkishMessages });

    expect(t('common.counts.sets', { count: 1 })).toBe('1 set');
    expect(t('common.counts.sets', { count: 3 })).toBe('3 set');
    expect(t('common.counts.exercises', { count: 0 })).toBe('Egzersiz yok');
    expect(t('navigation.settings')).toBe('Ayarlar');
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
