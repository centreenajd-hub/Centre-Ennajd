// Shared text normalization for name search/matching across the app —
// strips diacritics, lowercases, and trims so search is accent/case-insensitive.

export function normalizeText(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}
