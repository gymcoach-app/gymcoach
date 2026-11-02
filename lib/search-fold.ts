// Folds text for a case- and accent-insensitive substring search.
//
// Lowercasing uses the active locale, so Turkish "İ" becomes "i" rather than
// "i" plus a combining dot. NFD normalisation then splits accented letters
// and the combining marks are dropped, so "Kürek" matches "kurek" and
// "İp atlama" matches "ip atlama". The dotless "ı" is folded to "i" as well:
// in Turkish, "Incline" lowercases to "ıncline", and a user typing "incline"
// must still find both the English and the Turkish names.
export function foldForSearch(text: string, locale?: string): string {
  let lower: string;
  try {
    lower = text.toLocaleLowerCase(locale);
  } catch {
    lower = text.toLowerCase();
  }
  return lower
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/ı/g, 'i');
}

// True when `candidate` contains `query` once both are folded. An empty
// query matches everything.
export function matchesSearch(candidate: string, query: string, locale?: string): boolean {
  const needle = foldForSearch(query.trim(), locale);
  if (!needle) return true;
  return foldForSearch(candidate, locale).includes(needle);
}
