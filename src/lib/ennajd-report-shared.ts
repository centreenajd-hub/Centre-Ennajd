// Shared pure helpers for the Report Generator — sorting, pagination
// chunking, and academic-year month windows. Zero React/Zustand, mirrors
// the "Shield" pattern of ennajd-taxonomy.ts / ennajd-billing.ts.

import type { Student } from "@/types/ennajd";

/** Every payments page is capped at this many student rows before a page break. */
export const REPORT_ROWS_PER_PAGE = 31;

/**
 * Attendance pages are portrait A4 with one name column, 10 session check
 * boxes and a payment column (~26 data rows + 6 blank addition rows on the
 * final page), so rows stay clear of the bottom margin.
 */
export const ATTENDANCE_ROWS_PER_PAGE = 26;

/** Sorts students by last name, then first name — shared by every report matrix. */
export function sortStudentsAlphabetically(students: Student[]): Student[] {
  return [...students].sort((a, b) => {
    const nameA = `${a.lastName} ${a.firstName}`.toLowerCase();
    const nameB = `${b.lastName} ${b.firstName}`.toLowerCase();
    return nameA.localeCompare(nameB);
  });
}

/** Splits an array into fixed-size chunks, last chunk may be smaller. */
export function chunkRows<T>(rows: T[], size: number): T[][] {
  if (rows.length === 0) return [];
  const chunks: T[][] = [];
  for (let i = 0; i < rows.length; i += size) {
    chunks.push(rows.slice(i, i + size));
  }
  return chunks;
}

export interface AcademicMonth {
  key: string; // "YYYY-MM"
  monthIndex0: number; // 0-11 calendar month index
  year: number;
}

/**
 * Builds the 12-month Sept→Aug academic-year window containing `monthKey`
 * ("YYYY-MM"). Used to drive the Payments matrix columns regardless of
 * which month the user picked for Attendance.
 */
export function getAcademicYearMonths(monthKey: string): AcademicMonth[] {
  const [year, month] = monthKey.split("-").map(Number); // month is 1-12
  const startYear = month >= 9 ? year : year - 1;
  const months: AcademicMonth[] = [];
  for (let i = 0; i < 12; i++) {
    const monthIndex0 = (8 + i) % 12; // September = index 8
    const y = monthIndex0 >= 8 ? startYear : startYear + 1;
    months.push({
      key: `${y}-${String(monthIndex0 + 1).padStart(2, "0")}`,
      monthIndex0,
      year: y,
    });
  }
  return months;
}

/** Short localized "MMM YY" label for an academic month, e.g. "sept. 24". */
export function formatAcademicMonthLabel(month: AcademicMonth, locale: string): string {
  const date = new Date(month.year, month.monthIndex0, 1);
  return date.toLocaleDateString(locale, { month: "short", year: "2-digit" });
}