import { createTranslator } from 'next-intl';
import { describe, expect, it } from 'vitest';
import { locales, type Locale } from '@/i18n/config';
import { loadMessages } from '@/i18n/messages';
import englishMessages from '@/messages/en';
import { aiErrorMessage, type AiErrorTranslator } from './ai-error-message';
import {
  AI_ERROR_CODES_WITH_VARIABLE,
  AI_ERROR_MESSAGE_KEYS,
  type AiErrorCode,
} from './llm/error-codes';

const CODES = Object.keys(AI_ERROR_MESSAGE_KEYS) as AiErrorCode[];

function translator(messages: typeof englishMessages, locale: Locale): AiErrorTranslator {
  const t = createTranslator({
    locale,
    messages,
    namespace: 'common',
    onError: (error) => {
      throw error;
    },
  });
  return (key, values) => t(key, values);
}

const english = translator(englishMessages, 'en');

describe('aiErrorMessage', () => {
  it('translates a known code and fills in the variable name', () => {
    expect(aiErrorMessage(english, { code: 'ai_invalid_key', variable: 'OPENROUTER_API_KEY' })).toBe(
      'The AI provider rejected the API key. Check OPENROUTER_API_KEY in your .env and restart.',
    );
    expect(aiErrorMessage(english, { code: 'ai_quota' })).toBe(
      'The AI provider refused the request: rate limit reached or credits used up. ' +
        'Wait a moment and retry, or check the credits of your provider account.',
    );
    expect(aiErrorMessage(english, { code: 'ai_outage' })).toBe(
      'The AI provider is unavailable right now. Try again later.',
    );
  });

  it('returns null for a body without a known code, so the caller keeps its fallback', () => {
    expect(aiErrorMessage(english, {})).toBeNull();
    expect(aiErrorMessage(english, { code: 'nope' })).toBeNull();
    expect(aiErrorMessage(english, { code: 42 })).toBeNull();
    expect(aiErrorMessage(english, { code: 'toString' })).toBeNull();
  });

  it('refuses a variable that is not an environment variable name', () => {
    const generic = englishMessages.common.aiErrors.unknown;
    for (const variable of [undefined, '', 'sk-ant-api03-secret', 'a b', '<b>X</b>', 12]) {
      expect(aiErrorMessage(english, { code: 'ai_invalid_key', variable })).toBe(generic);
    }
  });

  it.each(locales)('renders every code in %s, with the variable where English has one', async (locale) => {
    const messages = (await loadMessages(locale)) as typeof englishMessages;
    const t = translator(messages, locale);
    const seen = new Set<string>();
    for (const code of CODES) {
      const text = aiErrorMessage(t, { code, variable: 'SOME_ENV_VAR' });
      expect(text, `${locale}:${code}`).toBeTruthy();
      expect(text!.includes('SOME_ENV_VAR'), `${locale}:${code}`).toBe(
        AI_ERROR_CODES_WITH_VARIABLE.has(code),
      );
      expect(text, `${locale}:${code}`).not.toMatch(/[\u2013\u2014{}]/);
      seen.add(text!);
    }
    // Eight classes, eight different sentences.
    expect(seen.size).toBe(CODES.length);
    if (locale !== 'en') {
      // A real translation, not the English text copied over.
      const raw = messages.common.aiErrors;
      for (const [key, value] of Object.entries(englishMessages.common.aiErrors)) {
        expect(raw[key as keyof typeof raw], `${locale}:${key}`).not.toBe(value);
      }
    }
  });
});
