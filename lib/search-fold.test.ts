import { describe, expect, it } from 'vitest';
import { foldForSearch, matchesSearch } from './search-fold';

describe('foldForSearch', () => {
  it('lowercases with the locale and drops combining marks', () => {
    expect(foldForSearch('İp atlama', 'tr')).toBe('ip atlama');
    expect(foldForSearch('İp atlama', 'en')).toBe('ip atlama');
    expect(foldForSearch('Dambıl ile kürek çekme', 'tr')).toBe('dambil ile kurek cekme');
  });

  it('folds the dotless i so Turkish lowercasing still matches English names', () => {
    expect(foldForSearch('Incline Bench Press', 'tr')).toBe('incline bench press');
    expect(foldForSearch('Incline Bench Press', 'en')).toBe('incline bench press');
  });

  it('folds accents and umlauts in other languages', () => {
    expect(foldForSearch('Développé couché', 'fr')).toBe('developpe couche');
    expect(foldForSearch('Bankdrücken', 'de')).toBe('bankdrucken');
    expect(foldForSearch('Martwy ciąg', 'pl')).toBe('martwy ciag');
  });

  it('keeps letters that are not accented forms', () => {
    // Polish "ł" and German "ß" have no decomposition and stay as they are.
    expect(foldForSearch('Wiosłowanie', 'pl')).toBe('wiosłowanie');
    expect(foldForSearch('Fuß', 'de')).toBe('fuß');
    expect(foldForSearch('Жим лёжа', 'ru')).toBe('жим лежа');
  });

  it('falls back to plain lowercasing for an invalid locale tag', () => {
    expect(foldForSearch('ABC', 'not a locale!')).toBe('abc');
  });
});

describe('matchesSearch', () => {
  it('matches across dotted and dotless i in Turkish', () => {
    expect(matchesSearch('Incline Bench Press', 'incline', 'tr')).toBe(true);
    expect(matchesSearch('İp atlama', 'ip atlama', 'tr')).toBe(true);
    expect(matchesSearch('İp atlama', 'İP', 'tr')).toBe(true);
  });

  it('is accent-insensitive and trims the query', () => {
    expect(matchesSearch('Développé couché', '  developpe ', 'fr')).toBe(true);
    expect(matchesSearch('Bankdrücken', 'drück', 'de')).toBe(true);
  });

  it('matches everything on an empty query and nothing on an unrelated one', () => {
    expect(matchesSearch('Squat', '   ', 'en')).toBe(true);
    expect(matchesSearch('Squat', 'curl', 'en')).toBe(false);
  });
});
