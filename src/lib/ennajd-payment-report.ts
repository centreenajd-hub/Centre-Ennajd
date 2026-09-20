// Payments matrix builder for the Report Generator — pivots a resolved
// session's Payment rows into a student × academic-month grid, with a
// Total-paid footer row and a visual "discounted" flag. Reads already-
// frozen `amountDue`/`isHalfMonth` values as-is (never recomputes pricing)
// — Takhfid (custom pricing) is therefore automatically correct.

import { sortStudentsAlphabetically, type AcademicMonth } from "@/lib/ennajd-report-shared";
import {
  buildDeliveredDatesContext,
  computeExpectedMonthAmount,
  earliestValidAttendanceDate,
  roundMAD,
} from "@/lib/ennajd-billing";
import type {
  AttendanceRecord,
  Payment,
  Session,
  Student,
  Subject,
} from "@/types/ennajd";

export interface PaymentCell {
  amountDue: number;
  /** MAD actually covered (sum of amountPaid). */
  amountPaid: number;
  /** True only when the whole month is fully paid (no partial remaining). */
  isPaid: boolean;
  /** True when at least one installment is fully or partially counted as paid. */
  isPartiallyPaid: boolean;
  /** MAD of pre-paid/advance credit sitting on this month (amountPaid when
   *  the month is not fully covered, 0 otherwise) — the green chip value. */
  advanceCredit: number;
  /** MAD still owed for this month (amountDue - amountPaid). */
  remaining: number;
  isHalfMonth: boolean;
  isDiscounted: boolean;
}

export interface PaymentMatrixRow {
  student: Student;
  cellsByMonth: Map<string, PaymentCell | null>;
}

export interface PaymentMatrix {
  months: AcademicMonth[];
  rows: PaymentMatrixRow[];
  totalsByMonth: Map<string, number>;
}

/**
 * Builds the payments matrix for one resolved session's roster.
 * `basePrice` is the level+subject+groupType base price for this exact
 * session (all students in this roster share the same group type, since
 * the roster is pinned to a single Session) — used only to flag
 * custom-discounted (Takhfid) installments, never to recompute amounts.
 *
 * The `isDiscounted` flag compares each month's frozen `amountDue` against
 * the amount the session-based engine EXPECTS for that month at the BASE
 * price (`computeExpectedMonthAmount`). Legitimately prorated months (a
 * mid-month join) match their expected amount and carry no flag; the flag
 * appears only when a real `customPrice` moved the amount off the base
 * expectation.
 */
export function buildPaymentMatrix(
  students: Student[],
  payments: Payment[],
  subject: Subject,
  months: AcademicMonth[],
  basePrice: number | undefined,
  sessions: Session[],
  attendanceRecords: AttendanceRecord[],
  asOfKey: string,
): PaymentMatrix {
  const sortedStudents = sortStudentsAlphabetically(students);

  const totalsByMonth = new Map<string, number>();
  for (const month of months) totalsByMonth.set(month.key, 0);

  const subjectSessionIds = new Set(
    sessions.filter((s) => s.subject === subject).map((s) => s.id),
  );

  const rows: PaymentMatrixRow[] = sortedStudents.map((student) => {
    const cellsByMonth = new Map<string, PaymentCell | null>();
    const studentPayments = payments.filter(
      (p) => p.studentId === student.id && p.subject === subject,
    );
    const studentAttendance = attendanceRecords.filter(
      (r) => r.studentId === student.id && subjectSessionIds.has(r.sessionId),
    );

    // Expected amounts are derived from the student's own anchor (earliest
    // PRESENT attendance date, enrollment fallback) + the combo's timetable,
    // so a mid-month join is recognized as full-price or prorated rather than
    // "discounted". The anchor mirrors the billing engine exactly.
    const enrollment = student.enrollments.find((e) => e.subject === subject);
    const expectedByMonth = new Map<string, number | null>();
    if (enrollment && basePrice !== undefined) {
      const enrolledAt = new Date(enrollment.enrolledAt ?? student.createdAt);
      const anchor =
        earliestValidAttendanceDate(
          student.id,
          subject,
          studentAttendance,
          sessions,
          asOfKey,
        ) ?? enrolledAt;
      const ctx = buildDeliveredDatesContext(
        sessions,
        studentAttendance,
        {
          level: student.level,
          subject,
          track: enrollment.track,
          groupType: enrollment.groupType,
        },
        anchor,
      );
      for (const month of months) {
        expectedByMonth.set(
          month.key,
          computeExpectedMonthAmount(anchor, month.key, ctx, basePrice),
        );
      }
    }

    for (const month of months) {
      const monthPayments = studentPayments.filter((p) => p.month === month.key);
      if (monthPayments.length === 0) {
        cellsByMonth.set(month.key, null);
        continue;
      }

      // Integer contract: the report NEVER shows a fraction. Every figure a
      // parent sees passes through roundMAD, so a stray fractional price can
      // never leak into the "Rapport de paiements".
      const amountDue = roundMAD(
        monthPayments.reduce((sum, p) => sum + p.amountDue, 0),
      );
      const amountPaid = roundMAD(
        monthPayments.reduce((sum, p) => sum + (p.amountPaid ?? 0), 0),
      );
      const remaining = Math.max(0, roundMAD(amountDue - amountPaid));
      // A month is "fully paid" only when every installment is covered —
      // an amountPaid that doesn't reach amountDue keeps it unpaid.
      const isPaid = monthPayments.every(
        (p) => p.isPaid || (p.amountPaid ?? 0) >= p.amountDue,
      );
      const isPartiallyPaid = !isPaid && amountPaid > 0;
      const isHalfMonth = monthPayments.some((p) => p.isHalfMonth);
      // Only a genuine customPrice (or a stale row) moves the amount off the
      // base-price expectation — a prorated join month matches and stays unflagged.
      const expected = expectedByMonth.get(month.key);
      const isDiscounted =
        basePrice !== undefined && expected !== null && expected !== undefined
          ? amountDue !== expected
          : false;

      cellsByMonth.set(month.key, {
        amountDue,
        amountPaid,
        isPaid,
        isPartiallyPaid,
        advanceCredit: isPartiallyPaid ? amountPaid : 0,
        remaining,
        isHalfMonth,
        isDiscounted,
      });

      if (isPaid) {
        totalsByMonth.set(month.key, (totalsByMonth.get(month.key) ?? 0) + amountDue);
      } else if (isPartiallyPaid) {
        // Partial months contribute only what was actually covered, never
        // their full amount — keeps the Total-paid footer row truthful.
        totalsByMonth.set(month.key, (totalsByMonth.get(month.key) ?? 0) + amountPaid);
      }
    }

    return { student, cellsByMonth };
  });

  return { months, rows, totalsByMonth };
}