import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { getLlmProvider, resolveProviderId } from './index';

// resolveProviderId() and getLlmProvider() select the AI provider from the
// LLM_PROVIDER env var. We save/restore the var around every test so this
// suite never leaks state into the others.
describe('lib/llm provider resolution', () => {
  let originalValue: string | undefined;

  beforeEach(() => {
    originalValue = process.env.LLM_PROVIDER;
  });

  afterEach(() => {
    if (originalValue === undefined) {
      delete process.env.LLM_PROVIDER;
    } else {
      process.env.LLM_PROVIDER = originalValue;
    }
  });

  describe('resolveProviderId', () => {
    it('defaults to anthropic when LLM_PROVIDER is unset', () => {
      delete process.env.LLM_PROVIDER;
      expect(resolveProviderId()).toBe('anthropic');
    });

    it('resolves the exact known values', () => {
      process.env.LLM_PROVIDER = 'anthropic';
      expect(resolveProviderId()).toBe('anthropic');
      process.env.LLM_PROVIDER = 'openrouter';
      expect(resolveProviderId()).toBe('openrouter');
      process.env.LLM_PROVIDER = 'llmtr';
      expect(resolveProviderId()).toBe('llmtr');
      process.env.LLM_PROVIDER = 'codex-lb';
      expect(resolveProviderId()).toBe('codex-lb');
      process.env.LLM_PROVIDER = 'demo';
      expect(resolveProviderId()).toBe('demo');
    });

    it('is case-insensitive', () => {
      process.env.LLM_PROVIDER = 'Demo';
      expect(resolveProviderId()).toBe('demo');
      process.env.LLM_PROVIDER = 'OPENROUTER';
      expect(resolveProviderId()).toBe('openrouter');
      process.env.LLM_PROVIDER = 'LLMTR';
      expect(resolveProviderId()).toBe('llmtr');
      process.env.LLM_PROVIDER = 'CODEX_LB';
      expect(resolveProviderId()).toBe('codex-lb');
      process.env.LLM_PROVIDER = 'AnThRoPiC';
      expect(resolveProviderId()).toBe('anthropic');
    });

    it('trims surrounding whitespace', () => {
      process.env.LLM_PROVIDER = '  demo  ';
      expect(resolveProviderId()).toBe('demo');
      process.env.LLM_PROVIDER = '\topenrouter\n';
      expect(resolveProviderId()).toBe('openrouter');
      process.env.LLM_PROVIDER = '  llmtr  ';
      expect(resolveProviderId()).toBe('llmtr');
      process.env.LLM_PROVIDER = '  codexlb  ';
      expect(resolveProviderId()).toBe('codex-lb');
    });

    it('falls back to anthropic for an unknown value', () => {
      process.env.LLM_PROVIDER = 'foo';
      expect(resolveProviderId()).toBe('anthropic');
    });

    it('falls back to anthropic for an empty string', () => {
      process.env.LLM_PROVIDER = '';
      expect(resolveProviderId()).toBe('anthropic');
    });
  });

  describe('getLlmProvider', () => {
    it('returns a provider whose id matches the resolved id', () => {
      process.env.LLM_PROVIDER = 'anthropic';
      expect(getLlmProvider().id).toBe('anthropic');
      process.env.LLM_PROVIDER = 'openrouter';
      expect(getLlmProvider().id).toBe('openrouter');
      process.env.LLM_PROVIDER = 'llmtr';
      expect(getLlmProvider().id).toBe('llmtr');
      process.env.LLM_PROVIDER = 'codex-lb';
      expect(getLlmProvider().id).toBe('codex-lb');
      process.env.LLM_PROVIDER = 'demo';
      expect(getLlmProvider().id).toBe('demo');
    });

    it('returns the anthropic provider by default', () => {
      delete process.env.LLM_PROVIDER;
      expect(getLlmProvider().id).toBe('anthropic');
    });
  });
});
