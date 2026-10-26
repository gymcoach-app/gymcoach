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

/** True when the locale writes 1.5 as "1,5". */
export function usesDecimalComma(locale: string): boolean {
  try {
    const decimal = new Intl.NumberFormat(locale)
      .formatToParts(1.5)
      .find((part) => part.type === 'decimal');
    return decimal?.value === ',';
  } catch {
    return false;
  }
}

/** Parses typed plates into a cleaned, descending list; invalid entries are dropped. */
export function parsePlateList(raw: string, locale: string): number[] {
  const decimalComma = usesDecimalComma(locale);
  const values: number[] = [];

  for (const entry of raw.split(/;|,\s+|\s+/)) {
    if (!entry) continue;
    const commas = entry.split(',').length - 1;
    if (decimalComma && commas === 1) {
      values.push(parseFloat(entry.replace(',', '.')));
    } else {
      for (const part of entry.split(',')) values.push(parseFloat(part));
    }
  }

  return values.filter((n) => Number.isFinite(n) && n > 0).sort((a, b) => b - a);
}

/** Writes plates back with the locale's decimal mark, in a form parsePlateList reads back. */
export function formatPlateList(plates: number[], locale: string): string {
  const decimalComma = usesDecimalComma(locale);
  return plates.map((n) => (decimalComma ? String(n).replace('.', ',') : String(n))).join(', ');
}
