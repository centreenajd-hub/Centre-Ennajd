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
  getEffectivePriceFor,
  getMonth2Carryover,
  roundMAD,
} from "@/lib/ennajd-billing";
import type {
  AttendanceRecord,
  Payment,
  PriceEntry,
  Session,
  Student,
  Subject,
} from "@/types/ennajd";

export interface PaymentCell {
  amountDue: number;
  /** MAD actually covered (sum of amountPaid). */
  amountPaid: number;
  /** True only when the whole month reads as settled/green in the report:
   *  every installment is EXPLICITLY settled, or the cell displays the
   *  prepaid Month-2 carryover credit (money already collected in Month 1). */
  isPaid: boolean;
  /** True when at least one installment is fully or partially counted as paid. */
  isPartiallyPaid: boolean;
  /** MAD of pre-paid/advance credit sitting on this month (amountPaid when
   *  the month is not fully covered, 0 otherwise). Shown as a neutral chip —
   *  credit never makes the month green (only the settlement flag does). */
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
  prices: PriceEntry[],
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
    // The student's OWN monthly price (customPrice wins) — the carryover
    // credit is computed at it, never at a hardcoded number.
    const studentPrice =
      enrollment !== undefined
        ? getEffectivePriceFor(student, enrollment, prices)
        : undefined;
    const enrolledAt =
      enrollment !== undefined
        ? new Date(enrollment.enrolledAt ?? student.createdAt)
        : null;
    const anchor =
      enrolledAt !== null
        ? (earliestValidAttendanceDate(
            student.id,
            subject,
            studentAttendance,
            sessions,
            asOfKey,
          ) ?? enrolledAt)
        : null;
    const ctx =
      anchor !== null && enrollment !== undefined
        ? buildDeliveredDatesContext(
            sessions,
            studentAttendance,
            {
              level: student.level,
              subject,
              track: enrollment.track,
              groupType: enrollment.groupType,
            },
            anchor,
          )
        : null;

    const expectedByMonth = new Map<string, number | null>();
    if (anchor !== null && ctx !== null && basePrice !== undefined) {
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
      // A month is GREEN only when every installment is EXPLICITLY settled —
      // wallet credit covering it (amountPaid >= amountDue) keeps it red:
      // the "Green Month 2" rule. Nothing-owed is `remaining <= 0`.
      const isPaid = monthPayments.every((p) => p.isPaid);
      const isPartiallyPaid = !isPaid && amountPaid > 0;
      const isHalfMonth = monthPayments.some((p) => p.isHalfMonth);
      // Only a genuine customPrice (or a stale row) moves the amount off the
      // base-price expectation — a prorated join month matches and stays unflagged.
      const expected = expectedByMonth.get(month.key);
      const isDiscounted =
        basePrice !== undefined && expected !== null && expected !== undefined
          ? amountDue !== expected
          : false;

      // THE MONTH-2 CARRYOVER DISPLAY — the month right after a PARTIAL
      // billing-start month carries a prepaid credit, the unpaid remainder
      // of the first monthly price: `monthlyPrice − month_1_due` (e.g.
      // 350 − 262 = 88). That money was already collected in Month 1, so
      // BEFORE settlement the cell shows the CREDIT in green instead of the
      // outstanding due. The row's own `amountDue` (262) is untouched — it
      // stays the outstanding balance the Impayés / dashboard surfaces
      // collect. Settling the row (its explicit `isPaid`) clears the
      // override and the cell falls back to its settled due (262, green).
      const carryover =
        anchor !== null && ctx !== null && studentPrice !== undefined
          ? getMonth2Carryover(anchor, month.key, ctx, studentPrice)
          : null;
      const displayCarryoverCredit = carryover !== null && !isPaid;
      const carryoverCredit = carryover?.carryoverCredit ?? 0;

      if (displayCarryoverCredit) {
        cellsByMonth.set(month.key, {
          amountDue: carryoverCredit,
          amountPaid: carryoverCredit,
          // Green: the displayed credit is already in the center's hands.
          isPaid: true,
          isPartiallyPaid: false,
          advanceCredit: 0,
          remaining: 0,
          isHalfMonth,
          isDiscounted,
        });
        // The month contributes exactly the prepaid credit it displayed.
        totalsByMonth.set(
          month.key,
          (totalsByMonth.get(month.key) ?? 0) + carryoverCredit,
        );
      } else {
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
    }

    return { student, cellsByMonth };
  });

  return { months, rows, totalsByMonth };
}