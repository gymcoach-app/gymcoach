import { describe, it, expect } from 'vitest';
import { formatPlateList, parsePlateList, parseWeightList, usesDecimalComma } from './plate-list';

describe('usesDecimalComma', () => {
  it('knows which supported locales write a decimal comma', () => {
    for (const locale of ['fr', 'de', 'es', 'pt', 'it', 'ru', 'nl']) {
      expect(usesDecimalComma(locale)).toBe(true);
    }
    expect(usesDecimalComma('en')).toBe(false);
  });

  it('treats an unknown locale tag as dot-decimal instead of throwing', () => {
    expect(usesDecimalComma('not a locale')).toBe(false);
  });
});

describe('parsePlateList in a comma-decimal locale (fr)', () => {
  it('reads "2,5" as one 2.5 plate, never 2 and 5', () => {
    expect(parsePlateList('2,5', 'fr')).toEqual([2.5]);
  });

  it('separates entries on a comma followed by a space', () => {
    expect(parsePlateList('25, 20, 2,5, 1,25', 'fr')).toEqual([25, 20, 2.5, 1.25]);
  });

  it('still reads an unspaced list with several commas as a list', () => {
    expect(parsePlateList('25,20,15', 'fr')).toEqual([25, 20, 15]);
  });

  it('reads a single unspaced comma as a decimal, the one ambiguous case', () => {
    // "25,20" is 25.2 here; a space ("25, 20") or a third number makes it a list.
    expect(parsePlateList('25,20', 'fr')).toEqual([25.2]);
    expect(parsePlateList('25, 20', 'fr')).toEqual([25, 20]);
  });

  it('accepts semicolons, plain spaces and a dot decimal', () => {
    expect(parsePlateList('25;20 2.5;1,25', 'fr')).toEqual([25, 20, 2.5, 1.25]);
  });

  it('drops junk and a trailing separator', () => {
    expect(parsePlateList('2,5, junk, 25,', 'fr')).toEqual([25, 2.5]);
  });

  it('reads a decimal with an unspaced comma at either end as one plate', () => {
    expect(parsePlateList('2,5,', 'fr')).toEqual([2.5]);
    expect(parsePlateList(',2,5', 'fr')).toEqual([2.5]);
    expect(parsePlateList('25, 20, 2,5,', 'fr')).toEqual([25, 20, 2.5]);
    expect(parsePlateList('1,25,', 'fr')).toEqual([1.25]);
  });

  it('still reads an unspaced list with a trailing comma as a list', () => {
    expect(parsePlateList('25,20,15,', 'fr')).toEqual([25, 20, 15]);
  });
});

describe('parsePlateList in a dot-decimal locale (en)', () => {
  it('parses the existing input exactly as before', () => {
    expect(parsePlateList('25, 20, 2.5', 'en')).toEqual([25, 20, 2.5]);
    expect(parsePlateList('25,20,15', 'en')).toEqual([25, 20, 15]);
    expect(parsePlateList('2.5, 45, junk, 25,', 'en')).toEqual([45, 25, 2.5]);
  });

  it('keeps reading every comma as a separator', () => {
    expect(parsePlateList('2,5', 'en')).toEqual([5, 2]);
  });
});

describe('formatPlateList', () => {
  it('writes the locale decimal mark and reads back to the same list', () => {
    const plates = [25, 20, 2.5, 1.25];
    expect(formatPlateList(plates, 'fr')).toBe('25, 20, 2,5, 1,25');
    expect(parsePlateList(formatPlateList(plates, 'fr'), 'fr')).toEqual(plates);
    expect(formatPlateList(plates, 'en')).toBe('25, 20, 2.5, 1.25');
    expect(parsePlateList(formatPlateList(plates, 'en'), 'en')).toEqual(plates);
  });
});

describe('parseWeightList', () => {
  it('returns an ascending list without duplicates, rounded to two decimals', () => {
    expect(parseWeightList('15, 10, 12,5, 10, 2,555', 'fr')).toEqual([2.56, 10, 12.5, 15]);
    expect(parseWeightList('15, 10, 12.5, 10', 'en')).toEqual([10, 12.5, 15]);
  });

  it('reads "2,5" as one weight in a comma-decimal locale only', () => {
    expect(parseWeightList('2,5', 'fr')).toEqual([2.5]);
    expect(parseWeightList('2,5', 'en')).toEqual([2, 5]);
  });
});
