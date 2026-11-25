// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { scrubCredentialsFromAddressBar, withoutCredentialParams } from './credential-url';

describe('withoutCredentialParams', () => {
  it('removes the form fields and keeps the rest of the URL', () => {
    expect(
      withoutCredentialParams(
        'https://gym.example/signup?displayName=A&email=a%40b.c&password=hunter22&lang=fr#top',
      ),
    ).toBe('/signup?lang=fr#top');
    expect(withoutCredentialParams('https://gym.example/login?password=x')).toBe('/login');
  });

  it('returns null when there is nothing to remove', () => {
    expect(withoutCredentialParams('https://gym.example/login')).toBeNull();
    expect(withoutCredentialParams('https://gym.example/history?month=2026-03')).toBeNull();
  });
});

describe('scrubCredentialsFromAddressBar', () => {
  afterEach(() => {
    window.history.replaceState(null, '', '/');
  });

  it('rewrites the current entry in place, keeping its state', () => {
    window.history.replaceState({ kept: true }, '', '/login?email=a%40b.c&password=hunter22');
    const entries = window.history.length;

    scrubCredentialsFromAddressBar();

    expect(window.location.pathname + window.location.search).toBe('/login');
    expect(window.location.href).not.toContain('hunter22');
    expect(window.history.state).toEqual({ kept: true });
    expect(window.history.length).toBe(entries);
  });

  it('leaves a URL without form fields untouched', () => {
    window.history.replaceState({ n: 1 }, '', '/login?lang=fr');
    scrubCredentialsFromAddressBar();
    expect(window.location.search).toBe('?lang=fr');
    expect(window.history.state).toEqual({ n: 1 });
  });
});
