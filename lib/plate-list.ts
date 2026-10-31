// Reading and writing the plate list typed in Settings (issue #514).
//
// The list used to be split on every comma, so in a comma-decimal locale a
// user typing "2,5" for a 2.5 kg plate saved two plates, 2 and 5. The rules:
//
// - Entries are separated by ";", whitespace, or a comma followed by
//   whitespace ("25, 20").
// - In a locale whose decimal mark is a comma (fr, de, es, pt, it, ru), an
//   entry with exactly one comma is a decimal ("2,5", "1,25"). An entry with
//   more commas is a list ("25,20,15"), so the old unspaced form still works.
// - In other locales (en) every comma separates, as before.
// - A "." decimal is read in every locale.
// - Commas at either end of an entry are separators, so "2,5," is still 2.5.
//
// The gym equipment editor reads its weight lists (dumbbells, plates, bars,
// machine stacks) with the same rules through parseWeightList.

const decimalCommaByLocale = new Map<string, boolean>();

/** True when the locale writes 1.5 as "1,5". */
export function usesDecimalComma(locale: string): boolean {
  const cached = decimalCommaByLocale.get(locale);
  if (cached !== undefined) return cached;
  let decimalComma = false;
  try {
    const decimal = new Intl.NumberFormat(locale)
      .formatToParts(1.5)
      .find((part) => part.type === 'decimal');
    decimalComma = decimal?.value === ',';
  } catch {
    decimalComma = false;
  }
  decimalCommaByLocale.set(locale, decimalComma);
  return decimalComma;
}

/** Parses typed plates into a cleaned, descending list; invalid entries are dropped. */
export function parsePlateList(raw: string, locale: string): number[] {
  return parseWeights(raw, locale).sort((a, b) => b - a);
}

/**
 * Parses a typed weight list into an ascending list without duplicates,
 * rounded to two decimals; invalid entries are dropped.
 */
export function parseWeightList(raw: string, locale: string): number[] {
  const rounded = parseWeights(raw, locale).map((n) => Math.round(n * 100) / 100);
  return [...new Set(rounded)].sort((a, b) => a - b);
}

function parseWeights(raw: string, locale: string): number[] {
  const decimalComma = usesDecimalComma(locale);
  const values: number[] = [];

  for (const rawEntry of raw.split(/;|,\s+|\s+/)) {
    const entry = rawEntry.replace(/^,+|,+$/g, '');
    if (!entry) continue;
    const commas = entry.split(',').length - 1;
    if (decimalComma && commas === 1) {
      values.push(parseFloat(entry.replace(',', '.')));
    } else {
      for (const part of entry.split(',')) values.push(parseFloat(part));
    }
  }

  return values.filter((n) => Number.isFinite(n) && n > 0);
}

/**
 * Writes plates (or any weight list) back with the locale's decimal mark, in a
 * form the parsers read back.
 */
export function formatPlateList(plates: number[], locale: string): string {
  const decimalComma = usesDecimalComma(locale);
  return plates.map((n) => (decimalComma ? String(n).replace('.', ',') : String(n))).join(', ');
}
