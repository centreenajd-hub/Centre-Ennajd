// Lightweight fuzzy matching for the global attendance search — no external
// dependency. Subsequence scoring with bonuses for prefix and consecutive
// character matches, so "yhya" ranks above a random subsequence match.

import { normalizeText } from "@/lib/text-normalize";
import type { Student } from "@/types/ennajd";

/**
 * Scores how well `query` matches `target` as a fuzzy subsequence.
 * Returns -1 when `query` isn't a subsequence of `target` at all.
 * Higher is better; empty query always matches with score 0.
 */
export function fuzzyScore(query: string, target: string): number {
  const q = normalizeText(query);
  const t = normalizeText(target);
  if (q.length === 0) return 0;
  if (t.length === 0) return -1;

  // Strong bonus for a direct substring match (covers the common case of
  // typing a contiguous chunk of the name).
  const substringIndex = t.indexOf(q);
  if (substringIndex !== -1) {
    const prefixBonus = substringIndex === 0 ? 50 : 0;
    return 100 + prefixBonus - substringIndex;
  }

  let score = 0;
  let qIndex = 0;
  let lastMatchIndex = -1;
  let consecutiveRun = 0;

  for (let tIndex = 0; tIndex < t.length && qIndex < q.length; tIndex++) {
    if (t[tIndex] !== q[qIndex]) continue;

    if (lastMatchIndex === tIndex - 1) {
      consecutiveRun += 1;
      score += 4 * consecutiveRun; // reward consecutive runs increasingly
    } else {
      consecutiveRun = 0;
      score += 1;
    }
    if (tIndex === 0) score += 5; // bonus for matching at the very start

    lastMatchIndex = tIndex;
    qIndex += 1;
  }

  if (qIndex < q.length) return -1; // not every query char was found in order

  return score;
}

/**
 * Ranks students against a free-text query by trying both
 * "firstName lastName" and "lastName firstName" orderings and keeping the
 * best score, so staff can type either name first. Non-matches are
 * excluded; results are sorted best-first and capped to `limit`.
 */
export function rankStudentsByQuery(
  students: Student[],
  query: string,
  limit = 8,
): Student[] {
  const trimmed = query.trim();
  if (!trimmed) return [];

  const scored = students
    .map((student) => {
      const forward = `${student.firstName} ${student.lastName}`;
      const backward = `${student.lastName} ${student.firstName}`;
      const score = Math.max(fuzzyScore(trimmed, forward), fuzzyScore(trimmed, backward));
      return { student, score };
    })
    .filter((entry) => entry.score >= 0)
    .sort((a, b) => b.score - a.score);

  return scored.slice(0, limit).map((entry) => entry.student);
}

/**
 * Returns the set of character indices in `target` (original, un-normalized
 * string) that took part in the fuzzy match against `query` — used purely
 * for highlighting suggestion text. Falls back to an empty set whenever
 * normalization changes the string length (rare), since index alignment
 * can no longer be trusted.
 */
export function matchedIndices(query: string, target: string): Set<number> {
  const q = normalizeText(query);
  const t = normalizeText(target);
  const result = new Set<number>();
  if (q.length === 0 || t.length === 0 || t.length !== target.length) return result;

  const substringIndex = t.indexOf(q);
  if (substringIndex !== -1) {
    for (let i = substringIndex; i < substringIndex + q.length; i++) result.add(i);
    return result;
  }

  let qIndex = 0;
  for (let tIndex = 0; tIndex < t.length && qIndex < q.length; tIndex++) {
    if (t[tIndex] === q[qIndex]) {
      result.add(tIndex);
      qIndex += 1;
    }
  }
  if (qIndex < q.length) return new Set();
  return result;
}
