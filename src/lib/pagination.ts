/**
 * Windowed page numbers around the current page, with "..." gaps, so the
 * pager stays compact even with hundreds of pages.
 */
export function getPageNumbers(
  current: number,
  total: number,
): (number | "ellipsis")[] {
  const pages = new Set<number>([1, total, current, current - 1, current + 1]);
  const sorted = [...pages]
    .filter((p) => p >= 1 && p <= total)
    .sort((a, b) => a - b);
  const result: (number | "ellipsis")[] = [];
  for (let i = 0; i < sorted.length; i++) {
    if (i > 0 && sorted[i] - sorted[i - 1] > 1) result.push("ellipsis");
    result.push(sorted[i]);
  }
  return result;
}