import { createTranslator } from 'next-intl';
import { parse, TYPE, type MessageFormatElement } from '@formatjs/icu-messageformat-parser';
import { describe, expect, it } from 'vitest';
import { isLocale, locales, localeLabels } from '@/i18n/config';
import { loadMessages } from '@/i18n/messages';
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
import chineseMessages from '@/messages/zh-CN';

function messageKeys(value: unknown, prefix = ''): string[] {
  if (typeof value === 'string') return [prefix];
  if (!value || typeof value !== 'object') return [];

  return Object.entries(value).flatMap(([key, child]) =>
    messageKeys(child, prefix ? `${prefix}.${key}` : key),
  );
}

function messageEntries(value: Record<string, unknown>, prefix = ''): [string, string][] {
  return Object.entries(value).flatMap(([key, child]) => {
    const path = prefix ? `${prefix}.${key}` : key;
    return typeof child === 'string'
      ? [[path, child] as [string, string]]
      : messageEntries(child as Record<string, unknown>, path);
  });
}

function messageContract(elements: MessageFormatElement[]) {
  const argumentsUsed = new Set<string>();
  const branches = new Set<string>();
  function visit(nodes: MessageFormatElement[]) {
    for (const node of nodes) {
      if (node.type === TYPE.literal || node.type === TYPE.pound) continue;
      argumentsUsed.add(`${node.type}:${node.value}`);
      if (node.type === TYPE.tag) visit(node.children);
      if (node.type !== TYPE.select && node.type !== TYPE.plural) continue;
      if (node.type === TYPE.plural) {
        branches.add(`${node.value}:${node.pluralType}:offset=${node.offset}`);
      }
      for (const [selector, option] of Object.entries(node.options)) {
        // Chinese does not need English plural categories, but exact numeric
        // branches and every select option carry application-specific meaning.
        if (node.type === TYPE.select || selector.startsWith('=') || selector === 'other') {
          branches.add(`${node.type}:${node.value}:${selector}`);
        }
        visit(option.value);
      }
    }
  }
  visit(elements);
  return { argumentsUsed: [...argumentsUsed].sort(), branches: [...branches].sort() };
}

type MessageValues = Record<string, string | number | Date>;

function messageScenarios(elements: MessageFormatElement[], locale: string): MessageValues[] {
  let scenarios: MessageValues[] = [{}];
  for (const node of elements) {
    if (node.type === TYPE.literal || node.type === TYPE.pound) continue;
    if (node.type === TYPE.tag) throw new Error('Add rich-text coverage for the new message tag');
    let choices: MessageValues[];
    if (node.type === TYPE.select || node.type === TYPE.plural) {
      choices = Object.entries(node.options).flatMap(([selector, option]) => {
        let value: string | number = selector === 'other' ? 'sample' : selector;
        if (node.type === TYPE.plural) {
          const rules = new Intl.PluralRules(locale, { type: node.pluralType });
          const count = selector.startsWith('=')
            ? Number(selector.slice(1))
            : [0, 1, 2, 3, 5, 11, 21, 100, 1.5].find(
                (candidate) =>
                  !(`=${candidate}` in node.options) &&
                  rules.select(candidate - node.offset) === selector,
              );
          if (count === undefined) throw new Error(`Unreachable ${locale} plural: ${selector}`);
          value = count;
        }
        return messageScenarios(option.value, locale).map((nested) => ({
          ...nested,
          [node.value]: value,
        }));
      });
    } else {
      choices = [
        {
          [node.value]:
            node.type === TYPE.date || node.type === TYPE.time
              ? new Date('2026-10-31T12:00:00Z')
              : node.type === TYPE.number
                ? 3
                : `sample-${node.value}`,
        },
      ];
    }
    scenarios = scenarios.flatMap((current) =>
      choices.map((choice) => ({ ...current, ...choice })),
    );
  }
  return scenarios;
}

describe('i18n configuration', () => {
  it.each(locales)(
    'loads the registered %s catalog and all newly combined language options',
    async (locale) => {
      const messages = await loadMessages(locale);
      expect(messageKeys(messages).sort()).toEqual(messageKeys(englishMessages).sort());
      const t = createTranslator({
        locale,
        messages,
        onError: (error) => {
          throw error;
        },
      });
      for (const key of ['chinese', 'dutch', 'polish', 'turkish'] as const) {
        expect(t(`common.language.${key}`)).toBe(messages.common.language[key]);
      }
    },
  );

  it('labels Simplified Chinese and rejects unsupported Chinese locale variants', () => {
    expect(localeLabels['zh-CN']).toBe('简体中文');
    expect(isLocale('zh')).toBe(false);
    expect(isLocale('zh-TW')).toBe(false);
  });
  it('renders the upstream debrief rate-limit message in Chinese', () => {
    const t = createTranslator({ locale: 'zh-CN', messages: chineseMessages });
    expect(t('coach.client.tooManyDebriefs')).toBe('请求训练总结过于频繁，请稍后重试。');
  });
  it('recognizes only supported locales', () => {
    expect(locales).toEqual(['en', 'fr', 'ru', 'de', 'es', 'pt', 'it', 'nl', 'pl', 'tr', 'zh-CN']);
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
    expect(isLocale('zh-CN')).toBe(true);
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
    expect(messageKeys(chineseMessages).sort()).toEqual(messageKeys(englishMessages).sort());
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

describe('Simplified Chinese message integration', () => {
  const chineseEntries = Object.fromEntries(messageEntries(chineseMessages));

  it.each(messageEntries(englishMessages))(
    'preserves the ICU contract and renders %s',
    (key, english) => {
      const chinese = chineseEntries[key];
      expect(chinese).toBeTypeOf('string');
      if (chinese === undefined) throw new Error(`Missing Chinese message: ${key}`);
      const englishContract = messageContract(parse(english));
      const chineseContract = messageContract(parse(chinese));
      expect(chineseContract.argumentsUsed).toEqual(englishContract.argumentsUsed);
      expect(chineseContract.branches).toEqual(expect.arrayContaining(englishContract.branches));

      for (const [locale, message] of [
        ['en', english],
        ['zh-CN', chinese],
      ] as const) {
        const t = createTranslator({
          locale,
          timeZone: 'UTC',
          messages: { message },
          onError: (error) => {
            throw error;
          },
        });
        for (const values of messageScenarios(parse(message), locale)) {
          expect(t('message', values)).toBeTypeOf('string');
        }
      }
    },
  );

  it('renders Chinese zero, exact-value and nested select branches without leaking sentinels', () => {
    const t = createTranslator({ locale: 'zh-CN', messages: chineseMessages });
    expect(t('common.counts.sets', { count: 0 })).toBe('暂无组数');
    expect(t('common.counts.sets', { count: 1 })).toBe('1 组');
    expect(t('common.counts.sets', { count: 5 })).toBe('5 组');
    expect(t('exercises.savedCount', { count: 0 })).toBe('尚未保存动作。');
    expect(t('programs.count', { count: 0 })).toBe('暂无训练计划');
    expect(t('session.exerciseCard.lastDone', { days: 0 })).toBe('今天完成过');
    expect(t('session.exerciseCard.lastDone', { days: 1 })).toBe('昨天完成过');
    expect(t('session.exerciseCard.lastDone', { days: 2 })).toBe('上次完成于 2 天前');
    expect(t('coach.context.deloadRecommended', { reasons: 'none' })).toBe('建议安排减量周。');
    expect(t('coach.context.deloadRecommended', { reasons: '训练状态较差' })).toBe(
      '建议安排减量周：训练状态较差。',
    );
    expect(t('settings.imports.fitImportDone', { sessions: 2, exercises: 0, skipped: 0 })).toBe(
      '已导入 2 次训练。',
    );
    expect(t('settings.imports.fitImportDone', { sessions: 2, exercises: 1, skipped: 3 })).toBe(
      '已导入 2 次训练，新建 1 个动作（跳过 3 个文件）。',
    );
  });
});

describe('new static UI messages in every locale', () => {
  const entries = messageEntries(englishMessages).filter(([key]) =>
    /^(progress\.photos\.|progress\.conditioning\.summary$|settings\.imports\.(file$|exportHints\.)|session\.input\.(decreaseReps|increaseReps)$)/.test(
      key,
    ),
  );

  it.each(locales)('preserves parameters and renders every new branch in %s', async (locale) => {
    const translations = Object.fromEntries(messageEntries(await loadMessages(locale)));
    expect(entries).toHaveLength(29);
    for (const [key, english] of entries) {
      const message = translations[key];
      if (message === undefined) throw new Error(`Missing ${locale} message: ${key}`);
      const expected = messageContract(parse(english));
      const actual = messageContract(parse(message));
      expect(actual.argumentsUsed, `${locale}:${key}`).toEqual(expected.argumentsUsed);
      expect(actual.branches, `${locale}:${key}`).toEqual(
        expect.arrayContaining(expected.branches),
      );
      const t = createTranslator({
        locale,
        timeZone: 'UTC',
        messages: { message },
        onError: (error) => {
          throw error;
        },
      });
      for (const values of messageScenarios(parse(message), locale)) {
        expect(t('message', values), `${locale}:${key}`).toBeTypeOf('string');
      }
    }
  });
});
