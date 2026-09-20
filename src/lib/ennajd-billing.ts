// Centre Ennajd — Proration Engine (from-scratch rebuild).
//
// Two billing engines live here:
//
//  RULE A (session-based proration) — every combo except 2Bac Small groups.
//      fixedCount = 4 × unique scheduled days of the combo's STANDARD
//      (non-one_off) sessions.  perSession = effectivePrice ÷ fixedCount.
//      A month's invoice = perSession × the sessions remaining after the
//      student's earliest PRESENT attendance THAT MONTH, capped at
//      fixedCount (a 5th weekly occurrence is free).
//
//  RULE B (rolling cycle) — EVERY 2Bac + Small combo (both s.x and s.m,
//      every subject).  A fixed full-price charge on the enrollment date,
//      then the same day-of-month forever.  Attendance never touches it.
//
// The wallet: over-payment is carried forward as `advanceBalance` and
// re-distributed by `applyCreditWaterfall` (dueDate-ascending gap filling).
//
// Pure layer — zero React/Zustand, no hidden `new Date()` in the engine:
// every `asOf` / `asOfKey` is passed in by the caller.

import { getEnrolledStudentsForCombo, getSessionKind } from "@/lib/ennajd-taxonomy";
import type { EnrollmentCombo } from "@/lib/ennajd-taxonomy";
import type {
  AttendanceRecord,
  GroupType,
  Level,
  Payment,
  PriceEntry,
  Session,
  Student,
  Subject,
  SubjectEnrollment,
  Track,
} from "@/types/ennajd";

export type PaymentRule = "A" | "B";

// ---------------------------------------------------------------------------//
// Calendar helpers (local-calendar fields — never UTC, no TZ day-shift bugs)
// ---------------------------------------------------------------------------//

function daysInMonth(year: number, monthIndex0: number): number {
  return new Date(year, monthIndex0 + 1, 0).getDate();
}

function startOfMonth(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

function normalizeDateOnly(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

/** Parses a "YYYY-MM-DD" key into a local-calendar Date (or null when malformed). */
function parseDateKey(key: string): Date | null {
  const [y, m, d] = key.split("-");
  const year = Number(y);
  const monthIndex0 = Number(m) - 1;
  const day = Number(d);
  if (
    !Number.isFinite(year) ||
    !Number.isFinite(monthIndex0) ||
    !Number.isFinite(day)
  ) {
    return null;
  }
  return new Date(year, monthIndex0, day);
}

/** "YYYY-MM-DD" using local calendar fields. */
export function formatDateKey(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/** "YYYY-MM" using local calendar fields. */
export function formatMonthKey(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  return `${y}-${m}`;
}

/**
 * Calendar-month arithmetic clamped to the last valid day of the target
 * month (Jan 31 + 1 month → Feb 28/29, never an overflow into March).
 */
export function addMonthsClamped(date: Date, months: number): Date {
  const day = date.getDate();
  const targetMonthIndex = date.getMonth() + months;
  const target = new Date(date.getFullYear(), targetMonthIndex, 1);
  const lastDay = daysInMonth(target.getFullYear(), target.getMonth());
  target.setDate(Math.min(day, lastDay));
  return target;
}

// ---------------------------------------------------------------------------//
// Rule routing — Rule 5 (broadened): EVERY 2Bac Small group (both tracks,
// every subject) stays on the untouched rolling Rule B engine.
// ---------------------------------------------------------------------------//

/**
 * "B" for every `level === "2Bac" && groupType === "Small"` combo — both
 * tracks (s.x and s.m) and every subject. Everything else is Rule A
 * (session-based proration). `subject`/`track` are accepted for API
 * compatibility but no longer narrow the exclusion.
 */
export function getPaymentRuleFor(
  level: Level,
  _subject: Subject,
  groupType: GroupType | null,
  _track?: Track | null,
): PaymentRule {
  if (level === "2Bac" && groupType === "Small") return "B";
  return "A";
}

// ---------------------------------------------------------------------------//
// Price resolution — customPrice wins outright
// ---------------------------------------------------------------------------//

/**
 * The student's actual/agreed monthly price for an enrollment:
 * `enrollment.customPrice` wins outright (a Takhfid price stands even when
 * the base PriceEntry row is missing); otherwise the matching base price.
 * `undefined` only when NEITHER exists (not billable).
 */
export function getEffectivePriceFor(
  student: Student,
  enrollment: SubjectEnrollment,
  prices: PriceEntry[],
): number | undefined {
  if (enrollment.customPrice !== undefined) return enrollment.customPrice;
  return prices.find(
    (p) =>
      p.level === student.level &&
      p.subject === enrollment.subject &&
      p.track === enrollment.track &&
      p.groupType === enrollment.groupType,
  )?.price;
}

/**
 * Pure helper — total tuition (MAD) for a set of enrollments WITHOUT a
 * persisted student.id (used at creation time, before the doc exists).
 * Mirrors `customPrice ?? base price` per enrollment. Returns 0 when no
 * price resolves for an enrollment.
 */
export function computeTuitionTotal(
  enrollments: SubjectEnrollment[],
  level: Level,
  prices: PriceEntry[],
): number {
  let total = 0;
  for (const enrollment of enrollments) {
    if (enrollment.customPrice !== undefined) {
      total += enrollment.customPrice;
      continue;
    }
    const base = prices.find(
      (p) =>
        p.level === level &&
        p.subject === enrollment.subject &&
        p.track === enrollment.track &&
        p.groupType === enrollment.groupType,
    )?.price;
    if (base !== undefined) total += base;
  }
  return total;
}

// ---------------------------------------------------------------------------//
// The timetable context (Rule 2: only STANDARD sessions count — one_off
// "حصة إضافية" sessions are 100% free and excluded from billing)
// ---------------------------------------------------------------------------//

function isStandardSession(s: Session): boolean {
  return getSessionKind(s) !== "one_off";
}

function matchesCombo(s: Session, combo: EnrollmentCombo): boolean {
  return (
    s.level === combo.level &&
    s.subject === combo.subject &&
    s.track === combo.track &&
    s.groupType === combo.groupType
  );
}

/**
 * The STANDARD scheduled days of a combo: `4 ×` this is the fixed number of
 * billable sessions per month (1 day/week → 4, 2 days/week → 8). Zero when
 * the combo has no standard timetable → not billable.
 */
export function getStandardSessionCount(
  sessions: Session[],
  combo: EnrollmentCombo,
): number {
  const days = new Set(
    sessions
      .filter((s) => isStandardSession(s) && matchesCombo(s, combo))
      .map((s) => s.dayOfWeek),
  );
  return 4 * days.size;
}

export interface DeliveredDatesContext {
  hasSession: boolean;
  /** Unique dayOfWeek values of the combo's STANDARD sessions. */
  scheduledDaysOfWeek: number[];
  /** Kept for API compatibility — unused by the session-based engine. */
  fallbackDayOfWeek: number;
  /** "YYYY-MM" months where the combo has ZERO standard scheduled
   *  occurrences (gap months) → no installment is emitted. Empty for a
   *  normal recurring timetable. */
  gapMonthKeys: ReadonlySet<string>;
}

/**
 * Describes the combo's recurring timetable. Attendance records are IGNORED
 * for the timetable (a scheduled class counts as consumed regardless of
 * absence); the per-month attendance anchor is resolved separately by
 * `earliestMonthAttendance` / `earliestValidAttendanceDate`.
 */
export function buildDeliveredDatesContext(
  sessions: Session[],
  _attendanceRecords: AttendanceRecord[],
  combo: EnrollmentCombo,
  _enrolledAt: Date,
): DeliveredDatesContext {
  const matchingStandard = sessions.filter(
    (s) => isStandardSession(s) && matchesCombo(s, combo),
  );

  return {
    hasSession: matchingStandard.length > 0,
    scheduledDaysOfWeek: [...new Set(matchingStandard.map((s) => s.dayOfWeek))],
    fallbackDayOfWeek: 0,
    gapMonthKeys: new Set(
      matchingStandard
        .filter((s) => getSessionKind(s) === "one_off" && s.date)
        .map((s) => s.date!.slice(0, 7)),
    ),
  };
}

/** fixedCount = 4 × scheduledDaysOfWeek.length (the engine's billable cap). */
export function getFixedSessionCount(ctx: DeliveredDatesContext): number {
  return 4 * ctx.scheduledDaysOfWeek.length;
}

/** Counts STANDARD scheduled occurrences in an inclusive [from, to] range. */
function countOccurrencesInRange(
  ctx: DeliveredDatesContext,
  from: Date,
  to: Date,
): number {
  const start = normalizeDateOnly(from);
  const end = normalizeDateOnly(to);
  if (start > end) return 0;
  const days = ctx.scheduledDaysOfWeek;
  if (days.length === 0) return 0;
  let count = 0;
  const cursor = new Date(start);
  while (cursor <= end) {
    if (days.includes(cursor.getDay())) count++;
    cursor.setDate(cursor.getDate() + 1);
  }
  return count;
}

// ---------------------------------------------------------------------------//
// The group session anchor (Rule B — one shared due day-of-month per group)
// ---------------------------------------------------------------------------//

/**
 * The GROUP billing anchor for Rule B (2Bac Small groups): every member of a
 * combo shares ONE due day-of-month, derived from the group's own first
 * session rather than each student's enrollment date.
 *
 * Fallback chain: earliest dated `one_off` session of the combo → earliest
 * attendance date for any of the combo's sessions → earliest enrollment
 * date among the combo's members. `null` only when none of these resolve
 * (a brand-new group with no dated sessions/attendance yet) — the caller
 * then falls back to the student's own `enrolledAt`.
 */
export function earliestGroupSessionDate(
  combo: EnrollmentCombo,
  sessions: Session[],
  attendanceRecords: AttendanceRecord[],
  students: Student[],
): Date | null {
  let earliest: Date | null = null;
  const comboSessionIds = new Set<string>();

  for (const session of sessions) {
    if (!matchesCombo(session, combo)) continue;
    comboSessionIds.add(session.id);
    // 1. Earliest dated one_off session of the combo.
    if (getSessionKind(session) === "one_off" && session.date) {
      const parsed = parseDateKey(session.date);
      if (parsed && (earliest === null || parsed < earliest)) earliest = parsed;
    }
  }
  if (earliest !== null) return earliest;

  // 2. Earliest attendance date for any of the combo's sessions.
  for (const record of attendanceRecords) {
    if (!record.date || !comboSessionIds.has(record.sessionId)) continue;
    const parsed = parseDateKey(record.date);
    if (parsed && (earliest === null || parsed < earliest)) earliest = parsed;
  }
  if (earliest !== null) return earliest;

  // 3. Earliest enrollment date among the group's members.
  for (const member of getEnrolledStudentsForCombo(students, combo)) {
    const enrollment = member.enrollments.find((e) => e.subject === combo.subject);
    const iso = enrollment?.enrolledAt ?? member.createdAt;
    const parsed = parseDateKey(iso.slice(0, 10));
    if (parsed && (earliest === null || parsed < earliest)) earliest = parsed;
  }
  return earliest;
}

// ---------------------------------------------------------------------------//
// The attendance anchors
// ---------------------------------------------------------------------------//

/**
 * Whether an attendance record counts as a billing anchor: the student's own
 * record, status `present` (an auto-absence NEVER anchors billing — a
 * delivered session is proven only by attendance), non-future
 * (`date <= asOfKey`), and resolving to a Session of this subject.
 */
function isAnchorRecord(
  record: AttendanceRecord,
  studentId: string,
  subjectSessionIds: Set<string>,
  asOfKey: string,
): boolean {
  return (
    record.studentId === studentId &&
    record.status === "present" &&
    !!record.date &&
    record.date <= asOfKey &&
    subjectSessionIds.has(record.sessionId)
  );
}

function subjectSessionIdsOf(sessions: Session[], subject: Subject): Set<string> {
  return new Set(sessions.filter((s) => s.subject === subject).map((s) => s.id));
}

/**
 * PER-MONTH anchor (Rule 2, literal): the earliest PRESENT, non-future
 * attendance date the student has in this subject WITHIN `monthKey`.
 * `null` when the month has no mark yet — the caller anchors that month on
 * the 1st (→ full month), which keeps future/generated months billable so
 * wallet surplus has somewhere to land.
 */
export function earliestMonthAttendance(
  studentId: string,
  subject: Subject,
  monthKey: string,
  attendanceRecords: AttendanceRecord[],
  sessions: Session[],
  asOfKey: string,
): Date | null {
  const subjectSessionIds = subjectSessionIdsOf(sessions, subject);
  let earliest: Date | null = null;
  for (const record of attendanceRecords) {
    if (!isAnchorRecord(record, studentId, subjectSessionIds, asOfKey)) continue;
    if (record.date!.slice(0, 7) !== monthKey) continue;
    const parsed = parseDateKey(record.date!);
    if (!parsed) continue;
    if (earliest === null || parsed < earliest) earliest = parsed;
  }
  return earliest;
}

/**
 * GLOBAL anchor — the earliest PRESENT, non-future attendance date across
 * every month. Used to decide where billing STARTS: months entirely before
 * the student's first attendance get no invoice. Falls back to the
 * enrollment date when the student has no attendance yet.
 *
 * Signature kept intact for the report consumers.
 */
export function earliestValidAttendanceDate(
  studentId: string,
  subject: Subject,
  attendanceRecords: AttendanceRecord[],
  sessions: Session[],
  asOfKey: string,
): Date | null {
  const subjectSessionIds = subjectSessionIdsOf(sessions, subject);
  let earliest: Date | null = null;
  for (const record of attendanceRecords) {
    if (!isAnchorRecord(record, studentId, subjectSessionIds, asOfKey)) continue;
    const parsed = parseDateKey(record.date!);
    if (!parsed) continue;
    if (earliest === null || parsed < earliest) earliest = parsed;
  }
  return earliest;
}

/**
 * Resolves the billing START: the earliest valid attendance date, else the
 * enrollment date. Attendance proves the cycle actually started, so a mark
 * that predates registration still moves billing forward.
 */
function resolveBillingStart(
  studentId: string,
  subject: Subject,
  enrolledAt: Date,
  attendanceRecords: AttendanceRecord[],
  sessions: Session[],
  asOfKey: string,
): Date {
  return (
    earliestValidAttendanceDate(
      studentId,
      subject,
      attendanceRecords,
      sessions,
      asOfKey,
    ) ?? normalizeDateOnly(enrolledAt)
  );
}

// ---------------------------------------------------------------------------//
// Month invoice — the proration core
// ---------------------------------------------------------------------------//

/** Last calendar day of the month containing `monthDate`. */
function endOfMonth(monthDate: Date): Date {
  const start = startOfMonth(monthDate);
  return new Date(
    start.getFullYear(),
    start.getMonth(),
    daysInMonth(start.getFullYear(), start.getMonth()),
  );
}

/**
 * One month's invoice (MAD) under Rule A:
 *
 *      billable = occurrences of the combo's STANDARD sessions in
 *                  [monthAnchor, monthEnd], capped at fixedCount
 *      amount    = round(effectivePrice ÷ fixedCount × billable)
 *
 * The month ANCHOR is PER-MONTH (Rule 2): the month's own earliest PRESENT
 * attendance when it has one (billing starts with that session, inclusive),
 * otherwise the 1st of the month (→ full month). The first month the
 * student is billed is the one containing their global billing start
 * (`billingStart` = first attendance, enrollment fallback).
 *
 * Returns `null` ⇒ NO invoice for that month:
 *   - no timetable (fixedCount === 0),
 *   - the month is entirely before the billing start,
 *   - a gap month (zero scheduled occurrences),
 *   - the billing-start month leaves ≤ 1 billable session (a lone remaining
 *     session is FREE — no installment is emitted).
 */
export function computeMonthInvoice(
  billingStart: Date,
  monthKey: string,
  ctx: DeliveredDatesContext,
  price: number,
): number | null {
  const fixedCount = getFixedSessionCount(ctx);
  if (fixedCount === 0) return null;

  const [yearStr, monthStr] = monthKey.split("-");
  const year = Number(yearStr);
  const monthIndex0 = Number(monthStr) - 1;
  if (!Number.isFinite(year) || !Number.isFinite(monthIndex0)) return null;

  const monthDate = new Date(year, monthIndex0, 1);
  const monthEnd = endOfMonth(monthDate);
  const start = normalizeDateOnly(billingStart);

  // Months entirely before the billing start are never billed.
  if (monthEnd < start) return null;

  if (ctx.gapMonthKeys.has(monthKey)) return null;

  const isStartMonth =
    monthDate.getFullYear() === start.getFullYear() &&
    monthDate.getMonth() === start.getMonth();

  // PER-MONTH anchor: the start month bills from the billing start itself
  // (the earliest attendance that month, inclusive); every other month
  // anchors on the 1st → full month.
  const from = isStartMonth ? start : monthDate;
  const count = countOccurrencesInRange(ctx, from, monthEnd);
  if (count === 0) return null;

  const billable = Math.min(count, fixedCount);
  // A lone remaining session in the start month is free.
  if (isStartMonth && billable <= 1) return null;

  return Math.round((price / fixedCount) * billable);
}

/**
 * Expected installment amount for a month — thin alias of
 * `computeMonthInvoice` kept for the report consumers (same signature).
 */
export function computeExpectedMonthAmount(
  billingStart: Date,
  monthKey: string,
  ctx: DeliveredDatesContext,
  price: number,
): number | null {
  return computeMonthInvoice(billingStart, monthKey, ctx, price);
}

/**
 * The dueDate the engine emits for a month: the billing start itself for
 * the start month, the 1st of the month otherwise. Mirrors the generator so
 * the reconcile pass can re-date a surviving row onto exactly the date the
 * generator would have used.
 */
export function computeExpectedMonthDueDate(
  billingStart: Date,
  monthKey: string,
): string | null {
  const [yearStr, monthStr] = monthKey.split("-");
  const year = Number(yearStr);
  const monthIndex0 = Number(monthStr) - 1;
  if (!Number.isFinite(year) || !Number.isFinite(monthIndex0)) return null;

  const start = normalizeDateOnly(billingStart);
  const isStartMonth =
    year === start.getFullYear() && monthIndex0 === start.getMonth();
  return isStartMonth
    ? formatDateKey(start)
    : formatDateKey(new Date(year, monthIndex0, 1));
}

/** One generated installment with an ABSOLUTE amount (MAD). */
export interface SessionInstallment {
  monthKey: string; // "YYYY-MM"
  dueDate: string; // "YYYY-MM-DD"
  amount: number; // MAD, absolute
}

/**
 * Rule A schedule — one installment per billable month from the billing
 * start through `asOf`, each prorated by `computeMonthInvoice`. Due on the
 * billing start for the start month, the 1st for every later month.
 */
export function generateSessionBasedSchedule(
  billingStart: Date,
  asOf: Date,
  ctx: DeliveredDatesContext,
  price: number,
): SessionInstallment[] {
  if (!ctx.hasSession || ctx.scheduledDaysOfWeek.length === 0) return [];
  const start = normalizeDateOnly(billingStart);
  if (start > asOf) return [];

  const results: SessionInstallment[] = [];
  const asOfMonth = startOfMonth(asOf);
  let cursor = startOfMonth(start);
  while (cursor <= asOfMonth) {
    const monthKey = formatMonthKey(cursor);
    const amount = computeMonthInvoice(start, monthKey, ctx, price);
    if (amount !== null) {
      const due = computeExpectedMonthDueDate(start, monthKey)!;
      results.push({ monthKey, dueDate: due, amount });
    }
    cursor = addMonthsClamped(cursor, 1);
  }
  return results;
}

/**
 * Rule B schedule (EVERY 2Bac Small combo): no calendar alignment — a
 * full-price charge on the join date, then the same day-of-month forever.
 * Attendance is irrelevant.
 */
export function generateRuleBSchedule(
  enrolledAt: Date,
  asOf: Date,
  price: number,
): SessionInstallment[] {
  const start = normalizeDateOnly(enrolledAt);
  if (start > asOf) return [];

  const results: SessionInstallment[] = [];
  let i = 0;
  let cursor = start;
  while (cursor <= asOf) {
    results.push({
      monthKey: formatMonthKey(cursor),
      dueDate: formatDateKey(cursor),
      amount: Math.round(price),
    });
    i += 1;
    cursor = addMonthsClamped(start, i);
  }
  return results;
}

export function generateScheduleFor(
  rule: PaymentRule,
  billingStart: Date,
  asOf: Date,
  ctx: DeliveredDatesContext,
  price: number,
): SessionInstallment[] {
  return rule === "B"
    ? generateRuleBSchedule(billingStart, asOf, price)
    : generateSessionBasedSchedule(billingStart, asOf, ctx, price);
}

// ---------------------------------------------------------------------------//
// Payment row helpers
// ---------------------------------------------------------------------------//

export function getPaymentRemaining(payment: Payment): number {
  const paid = payment.amountPaid ?? 0;
  return Math.max(0, payment.amountDue - paid);
}

export function isPaymentPartiallyPaid(payment: Payment): boolean {
  const paid = payment.amountPaid ?? 0;
  return paid > 0 && paid < payment.amountDue && !payment.isPaid;
}

export function isPaymentFullyPaid(payment: Payment): boolean {
  return payment.isPaid || (payment.amountPaid ?? 0) >= payment.amountDue;
}

/**
 * Which of two same-month rows to keep: the one reflecting the most payment
 * progress (settled flag, then amountPaid, then recency) so a settled or
 * partial duplicate is never discarded in favor of a pristine one.
 */
export function isMoreSettledPayment(a: Payment, b: Payment): boolean {
  if (a.isPaid !== b.isPaid) return a.isPaid;
  const aPaid = a.amountPaid ?? 0;
  const bPaid = b.amountPaid ?? 0;
  if (aPaid !== bPaid) return aPaid > bPaid;
  return a.updatedAt > b.updatedAt;
}

/** Logical installment identity: the CALENDAR MONTH it bills. */
function paymentLogicalKey(payment: Payment): string {
  return `${payment.studentId}__${payment.subject}__${payment.month}`;
}

// ---------------------------------------------------------------------------//
// Advance-credit waterfall (wallet surplus → dueDate-ascending gap filling)
// ---------------------------------------------------------------------------//

export interface CreditWaterfallResult {
  /** Changed rows only — the caller merges by id. */
  updated: Payment[];
  /** Credit no installment could absorb → parked in `advanceBalance`. */
  remaining: number;
  anyChanged: boolean;
}

/**
 * Distributes `credit` (MAD) across the student's not-fully-paid installments
 * in dueDate-ascending order, using the explicit 3-branch waterfall per row:
 *
 * 1. FULLY PAID — `wallet >= monthDueAmount`: the wallet covers the month's
 *    whole remaining gap; the row is settled and the wallet is debited.
 * 2. PARTIALLY PAID — `0 < wallet < monthDueAmount`: the wallet is fully
 *    absorbed as partial credit on this month (the GREEN advance-credit
 *    chip); the row stays unpaid and the wallet hits 0. Any further surplus
 *    would only park in `advance_balance` — there is none left here.
 * 3. UNPAID — `wallet === 0`: nothing left to give; the row is untouched.
 *
 * `monthDueAmount` is the row's dynamic remaining gap (`amountDue` −
 * `amountPaid`), where `amountDue` itself comes from `computeMonthInvoice`
 * (student-specific price + attendance) — never a hardcoded number.
 *
 * - `subject === null` → cross-subject (creation-time waterfall);
 *   otherwise only that subject's installments are credited.
 * - Credit never lands on a fully-paid installment, and stops when it runs
 *   out. Unabsorbed surplus is returned as `remaining` for `advanceBalance`.
 */
export function applyCreditWaterfall(
  payments: Payment[],
  studentId: string,
  subject: Subject | null,
  credit: number,
  _asOfKey: string,
  updatedAt: string,
): CreditWaterfallResult {
  if (!Number.isFinite(credit) || credit <= 0) {
    return { updated: [], remaining: 0, anyChanged: false };
  }

  const eligible = payments
    .filter(
      (p) =>
        p.studentId === studentId &&
        (subject === null || p.subject === subject) &&
        !isPaymentFullyPaid(p),
    )
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate));

  const updated: Payment[] = [];
  let remainingWallet = Math.max(0, Math.round(credit));

  for (const payment of eligible) {
    // Branch 3 — UNPAID: the wallet is exhausted, no further row can be
    // credited. Later rows stay exactly as they were.
    if (remainingWallet === 0) break;

    // The dynamic amount this month still owes — the engine's
    // `computeMonthInvoice`-derived `amountDue` minus already-paid credit.
    const monthDueAmount = Math.max(
      0,
      payment.amountDue - (payment.amountPaid ?? 0),
    );
    if (monthDueAmount === 0) continue;

    if (remainingWallet >= monthDueAmount) {
      // Branch 1 — FULLY PAID: the wallet absorbs the month entirely.
      updated.push({
        ...payment,
        amountPaid: payment.amountDue,
        isPaid: true,
        updatedAt,
      });
      remainingWallet -= monthDueAmount;
    } else {
      // Branch 2 — PARTIALLY PAID: the wallet lands as partial credit and
      // is fully absorbed; any surplus beyond this parks in
      // `advance_balance` at the caller (nothing remains here).
      updated.push({
        ...payment,
        amountPaid: (payment.amountPaid ?? 0) + remainingWallet,
        isPaid: false,
        updatedAt,
      });
      remainingWallet = 0;
    }
  }

  return {
    updated,
    remaining: Math.max(0, remainingWallet),
    anyChanged: updated.length > 0,
  };
}

// ---------------------------------------------------------------------------//
// Ledger de-duplication — exactly ONE invoice per (student, subject, month)
// ---------------------------------------------------------------------------//

export interface PaymentDedupeResult {
  /** One row per logical key, first-seen order (same reference when clean). */
  kept: Payment[];
  /** Ids of the surplus duplicates — safe to delete. */
  duplicateIds: string[];
}

/**
 * Collapses a ledger to exactly one row per `studentId__subject__month`
 * (the No-Loop-Bug invariant). Keying on the CALENDAR MONTH (not dueDate)
 * is what wipes a re-dated duplicate of the same month. Returns the input
 * reference untouched when the ledger is already clean.
 */
export function dedupePayments(payments: Payment[]): PaymentDedupeResult {
  const bestByKey = new Map<string, Payment>();
  const order: string[] = [];
  for (const payment of payments) {
    const key = paymentLogicalKey(payment);
    const current = bestByKey.get(key);
    if (!current) {
      bestByKey.set(key, payment);
      order.push(key);
    } else if (isMoreSettledPayment(payment, current)) {
      bestByKey.set(key, payment);
    }
  }

  if (bestByKey.size === payments.length) {
    return { kept: payments, duplicateIds: [] };
  }

  const keptIds = new Set<string>();
  const kept: Payment[] = [];
  for (const key of order) {
    const best = bestByKey.get(key)!;
    kept.push(best);
    keptIds.add(best.id);
  }

  const duplicateIds = payments
    .filter((payment) => !keptIds.has(payment.id))
    .map((payment) => payment.id);

  return { kept, duplicateIds };
}

// ---------------------------------------------------------------------------//
// Ledger reconciliation — self-heal stale Rule A amounts (price/timetable
// edits, engine migration). Rule B rows are NEVER touched.
// ---------------------------------------------------------------------------//

export interface ReconcilePatch {
  id: string;
  amountDue: number;
  /** The engine's dueDate for this month — a re-anchor re-dates the row. */
  dueDate: string;
  /** The month's CONSOLIDATED paid credit — pooling duplicates keeps credit. */
  amountPaid: number;
  isPaid: boolean;
}

export interface ReconcileLedgerResult {
  update: ReconcilePatch[];
  delete: string[];
}

/** Groups Rule A rows by (student, subject, month) — the collapse unit. */
function groupRuleAPaymentsByMonth(payments: Payment[]): Array<{
  studentId: string;
  subject: Subject;
  month: string;
  rows: Payment[];
}> {
  const groups: Array<{
    studentId: string;
    subject: Subject;
    month: string;
    rows: Payment[];
  }> = [];
  const groupIndex = new Map<string, number>();
  for (const payment of payments) {
    if (payment.rule !== "A") continue;
    const key = paymentLogicalKey(payment);
    const idx = groupIndex.get(key);
    if (idx === undefined) {
      groupIndex.set(key, groups.length);
      groups.push({
        studentId: payment.studentId,
        subject: payment.subject,
        month: payment.month,
        rows: [payment],
      });
    } else {
      groups[idx].rows.push(payment);
    }
  }
  return groups;
}

/** Resolves the engine inputs for one student+subject, or null when the
 *  combo is no longer billable (no enrollment / no price). `asOfKey`
 *  undefined reproduces the legacy enrollment-date anchor (no attendance). */
function resolveEngineInputs(
  student: Student,
  subject: Subject,
  sessions: Session[],
  prices: PriceEntry[],
  attendanceRecords: AttendanceRecord[],
  asOfKey?: string,
): { enrollment: SubjectEnrollment; price: number; ctx: DeliveredDatesContext; billingStart: Date } | null {
  const enrollment = student.enrollments.find((e) => e.subject === subject);
  if (!enrollment) return null;
  const price = getEffectivePriceFor(student, enrollment, prices);
  if (price === undefined) return null;
  const enrolledAt = new Date(enrollment.enrolledAt ?? student.createdAt);
  const billingStart =
    asOfKey !== undefined
      ? resolveBillingStart(
          student.id,
          subject,
          enrolledAt,
          attendanceRecords,
          sessions,
          asOfKey,
        )
      : normalizeDateOnly(enrolledAt);
  const ctx = buildDeliveredDatesContext(
    sessions,
    attendanceRecords,
    {
      level: student.level,
      subject,
      track: enrollment.track,
      groupType: enrollment.groupType,
    },
    billingStart,
  );
  return { enrollment, price, ctx, billingStart };
}

/**
 * Authoritative Rule A self-heal. For every Rule A month-group it recomputes
 * what the engine charges today and classifies it:
 *
 *  - `update`  — still billable but amount/dueDate/paid drifted,
 *  - `delete`  — the engine emits NO installment for that month at all
 *                (enrollment/price/timetable gone, gap month, pre-start
 *                month, lone-session month), or the row is a surplus
 *                duplicate of a billable month.
 *
 * Paid credit is consolidated onto the keeper so collapsing duplicates
 * never loses payment progress. Rule B rows are never classified.
 */
export function reconcileRuleALedger(
  payments: Payment[],
  students: Student[],
  sessions: Session[],
  prices: PriceEntry[],
  attendanceRecords: AttendanceRecord[] = [],
  asOfKey?: string,
): ReconcileLedgerResult {
  const studentsById = new Map(students.map((s) => [s.id, s]));
  const update: ReconcilePatch[] = [];
  const del: string[] = [];

  for (const group of groupRuleAPaymentsByMonth(payments)) {
    const student = studentsById.get(group.studentId);
    if (!student) {
      del.push(...group.rows.map((p) => p.id));
      continue;
    }

    const inputs = resolveEngineInputs(
      student,
      group.subject,
      sessions,
      prices,
      attendanceRecords,
      asOfKey,
    );
    if (inputs === null) {
      // No enrollment / no price → the whole group is stale.
      del.push(...group.rows.map((p) => p.id));
      continue;
    }

    const expected = computeExpectedMonthAmount(
      inputs.billingStart,
      group.month,
      inputs.ctx,
      inputs.price,
    );
    if (expected === null) {
      del.push(...group.rows.map((p) => p.id));
      continue;
    }

    const keeper = group.rows.reduce((best, p) =>
      isMoreSettledPayment(p, best) ? p : best,
    );
    for (const p of group.rows) {
      if (p.id !== keeper.id) del.push(p.id);
    }

    const consolidatedPaid = group.rows.reduce(
      (sum, p) => sum + (p.amountPaid ?? 0),
      0,
    );
    const expectedDueDate =
      computeExpectedMonthDueDate(inputs.billingStart, group.month) ??
      keeper.dueDate;

    if (
      expected !== keeper.amountDue ||
      expectedDueDate !== keeper.dueDate ||
      consolidatedPaid !== (keeper.amountPaid ?? 0)
    ) {
      update.push({
        id: keeper.id,
        amountDue: expected,
        dueDate: expectedDueDate,
        amountPaid: consolidatedPaid,
        isPaid: consolidatedPaid >= expected,
      });
    }
  }

  return { update, delete: del };
}

/**
 * Update-only subset of `reconcileRuleALedger` — patches Rule A rows whose
 * amountDue/dueDate drifted, keeping amountPaid and recomputing isPaid.
 * Months the engine no longer bills (expected === null) are left untouched
 * here; `reconcileRuleALedger` / `dedupePayments` delete them.
 */
export function reconcilePaymentAmounts(
  payments: Payment[],
  students: Student[],
  sessions: Session[],
  prices: PriceEntry[],
  attendanceRecords: AttendanceRecord[] = [],
  asOfKey?: string,
): ReconcilePatch[] {
  const studentsById = new Map(students.map((s) => [s.id, s]));
  const patches: ReconcilePatch[] = [];

  for (const group of groupRuleAPaymentsByMonth(payments)) {
    const student = studentsById.get(group.studentId);
    if (!student) continue;
    const inputs = resolveEngineInputs(
      student,
      group.subject,
      sessions,
      prices,
      attendanceRecords,
      asOfKey,
    );
    if (inputs === null) continue;
    // `asOfKey === undefined` → the legacy enrollment-date anchor (no
    // attendance), so the expectation matches the pre-reactive engine.

    const expected = computeExpectedMonthAmount(
      inputs.billingStart,
      group.month,
      inputs.ctx,
      inputs.price,
    );
    if (expected === null) continue;

    const keeper = group.rows.reduce((best, p) =>
      isMoreSettledPayment(p, best) ? p : best,
    );
    const expectedDueDate =
      computeExpectedMonthDueDate(inputs.billingStart, group.month) ??
      keeper.dueDate;
    const keeperPaid = keeper.amountPaid ?? 0;

    if (expected === keeper.amountDue && expectedDueDate === keeper.dueDate) {
      continue;
    }

    patches.push({
      id: keeper.id,
      amountDue: expected,
      dueDate: expectedDueDate,
      amountPaid: keeperPaid,
      isPaid: keeperPaid >= expected,
    });
  }

  return patches;
}

// ---------------------------------------------------------------------------//
// Reactive ledger recalculation — the attendance-anchored rebuild a single
// markAttendance triggers.
// ---------------------------------------------------------------------------//

/** State slices the reactive recalc needs — the store passes them in. */
export interface RecalculateLedgerContext {
  payments: Payment[];
  sessions: Session[];
  attendanceRecords: AttendanceRecord[];
  prices: PriceEntry[];
  /** Generate installments through this date (now + 1 month — surplus needs
   *  a landing row). */
  asOf: Date;
  /** "YYYY-MM-DD" — reference for ignoring future-dated attendance. */
  asOfKey: string;
  /** ISO timestamp stamped on every emitted/updated row. */
  updatedAt: string;
}

export interface RecalculateResult {
  /** Existing Rule A row ids whose month is no longer billable — deleted;
   *  their paid credit returns to the pool and is re-distributed. */
  toDelete: string[];
  /** New + changed installments, already carrying their waterfall credit,
   *  upsertable by id. */
  toUpsert: Payment[];
  /** Credit the rebuilt installments could not absorb → `advanceBalance`. */
  remainingCredit: number;
}

/**
 * Rebuilds ONE student+subject's Rule A ledger against the current state,
 * anchored per-month on the earliest PRESENT attendance of each month
 * (enrollment fallback), and redistributes the subject's paid credit PLUS
 * the student's carried `advanceBalance` earliest-first across the rebuilt
 * months (the wallet waterfall).
 *
 * Structural No-Loop-Bug: the invoice key is `(studentId, subject, month)`;
 * the rebuild reuses an existing row's id for that month and emits at most
 * one row per key, so a re-mark can never mint a second invoice.
 *
 * Rule B (every 2Bac Small combo) short-circuits to a no-op — its rolling
 * engine ignores attendance entirely. Pure — no React/Zustand.
 */
export function recalculateStudentSubjectLedger(
  student: Student,
  subject: Subject,
  ctx: RecalculateLedgerContext,
): RecalculateResult {
  const existing = ctx.payments.filter(
    (p) => p.studentId === student.id && p.subject === subject && p.rule === "A",
  );
  const creditOf = (rows: Payment[]) =>
    rows.reduce((sum, p) => sum + (p.amountPaid ?? 0), 0);

  const enrollment = student.enrollments.find((e) => e.subject === subject);
  // No enrollment left → the subject isn't billed; its rows are stale and
  // its paid credit is released to the wallet.
  if (!enrollment) {
    return {
      toDelete: existing.map((p) => p.id),
      toUpsert: [],
      remainingCredit: creditOf(existing) + (student.advanceBalance ?? 0),
    };
  }

  // Rule B keeps its fixed rolling engine regardless of attendance marks.
  if (
    getPaymentRuleFor(
      student.level,
      subject,
      enrollment.groupType,
      enrollment.track,
    ) === "B"
  ) {
    return { toDelete: [], toUpsert: [], remainingCredit: 0 };
  }

  const price = getEffectivePriceFor(student, enrollment, ctx.prices);
  // Price gone entirely (and no customPrice) → nothing to charge.
  if (price === undefined) {
    return {
      toDelete: existing.map((p) => p.id),
      toUpsert: [],
      remainingCredit: creditOf(existing) + (student.advanceBalance ?? 0),
    };
  }

  const enrolledAt = new Date(enrollment.enrolledAt ?? student.createdAt);
  const billingStart = resolveBillingStart(
    student.id,
    subject,
    enrolledAt,
    ctx.attendanceRecords,
    ctx.sessions,
    ctx.asOfKey,
  );
  const comboCtx = buildDeliveredDatesContext(
    ctx.sessions,
    ctx.attendanceRecords,
    {
      level: student.level,
      subject,
      track: enrollment.track,
      groupType: enrollment.groupType,
    },
    billingStart,
  );

  const schedule = generateSessionBasedSchedule(
    billingStart,
    ctx.asOf,
    comboCtx,
    price,
  );

  // Wallet + the subject's own paid credit — pooled, then re-distributed
  // earliest-first over the rebuilt months.
  const creditPool = creditOf(existing) + (student.advanceBalance ?? 0);

  // One representative row per calendar month (the most-settled one) — its
  // id is REUSED for the rebuilt row, so a re-mark never mints a duplicate.
  const priorByMonth = new Map<string, Payment>();
  for (const p of existing) {
    const current = priorByMonth.get(p.month);
    if (!current || isMoreSettledPayment(p, current)) priorByMonth.set(p.month, p);
  }

  const rebuilt: Payment[] = schedule.map((installment) => {
    const prior = priorByMonth.get(installment.monthKey);
    return {
      id: prior?.id ?? crypto.randomUUID(),
      studentId: student.id,
      subject,
      dueDate: installment.dueDate,
      month: installment.monthKey,
      isPaid: false,
      amountDue: installment.amount,
      amountPaid: 0,
      isHalfMonth: false,
      rule: "A",
      updatedAt: ctx.updatedAt,
    };
  });

  const { updated, remaining } = applyCreditWaterfall(
    rebuilt,
    student.id,
    subject,
    creditPool,
    ctx.asOfKey,
    ctx.updatedAt,
  );
  const creditedById = new Map(updated.map((p) => [p.id, p]));
  const finalRows = rebuilt.map((p) => creditedById.get(p.id) ?? p);

  // Ship only rows that genuinely differ from the current ledger.
  const priorById = new Map(existing.map((p) => [p.id, p]));
  const toUpsert = finalRows.filter((p) => {
    const prior = priorById.get(p.id);
    return (
      !prior ||
      prior.amountDue !== p.amountDue ||
      prior.dueDate !== p.dueDate ||
      prior.amountPaid !== p.amountPaid ||
      prior.isPaid !== p.isPaid
    );
  });

  // Delete every row that is no longer the month's representative.
  const reusedIds = new Set(finalRows.map((p) => p.id));
  const toDelete = existing
    .filter((p) => !reusedIds.has(p.id))
    .map((p) => p.id);

  return { toDelete, toUpsert, remainingCredit: remaining };
}

// ---------------------------------------------------------------------------//
// Per-subject due position (Reste guard: dueDate <= asOf only)
// ---------------------------------------------------------------------------//

export interface StudentSubjectDueBalance {
  dueUnpaid: Payment[];
  dueTotal: number;
  earliestDueDate: string | null;
  isOverdue: boolean;
  nextUpcoming: Payment | null;
  lastPaidDue: Payment | null;
  hasInstallments: boolean;
  amountPaid: number;
  remaining: number;
  isPartiallyPaid: boolean;
}

/**
 * One student's due position for a single subject relative to `asOfKey`.
 * "Due" = unpaid AND dueDate <= asOf — a future installment NEVER counts
 * (Reste guard). `advanceBalance` is accepted for API compatibility.
 */
export function getDueBalanceForStudentSubject(
  payments: Payment[],
  studentId: string,
  subject: Subject,
  asOfKey: string,
  _advanceBalance = 0,
): StudentSubjectDueBalance {
  const dueUnpaid: Payment[] = [];
  let dueTotal = 0;
  let amountPaid = 0;
  let earliestDueDate: string | null = null;
  let isOverdue = false;
  let nextUpcoming: Payment | null = null;
  let lastPaidDue: Payment | null = null;
  let hasInstallments = false;
  let isPartiallyPaid = false;

  for (const payment of payments) {
    if (payment.studentId !== studentId || payment.subject !== subject) continue;
    hasInstallments = true;

    if (isPaymentFullyPaid(payment)) {
      if (
        payment.dueDate <= asOfKey &&
        (lastPaidDue === null || payment.dueDate > lastPaidDue.dueDate)
      ) {
        lastPaidDue = payment;
      }
      continue;
    }

    // Reste guard: only strictly-due installments count as outstanding.
    if (payment.dueDate <= asOfKey) {
      dueUnpaid.push(payment);
      dueTotal += getPaymentRemaining(payment);
      amountPaid += payment.amountPaid ?? 0;
      if (isPaymentPartiallyPaid(payment)) isPartiallyPaid = true;
      if (earliestDueDate === null || payment.dueDate < earliestDueDate) {
        earliestDueDate = payment.dueDate;
      }
      if (payment.dueDate < asOfKey) isOverdue = true;
    } else if (nextUpcoming === null || payment.dueDate < nextUpcoming.dueDate) {
      nextUpcoming = payment;
    }
  }

  dueUnpaid.sort((a, b) => a.dueDate.localeCompare(b.dueDate));

  return {
    dueUnpaid,
    dueTotal,
    earliestDueDate,
    isOverdue,
    nextUpcoming,
    lastPaidDue,
    hasInstallments,
    amountPaid,
    remaining: dueTotal,
    isPartiallyPaid,
  };
}

/**
 * Reste guard helper: the student's outstanding balance across every
 * installment whose dueDate <= todayKey. Future auto-generated months
 * never count.
 */
export function getResteForPayments(payments: Payment[], todayKey: string): number {
  let reste = 0;
  for (const p of payments) {
    if (!isPaymentFullyPaid(p) && p.dueDate <= todayKey) {
      reste += getPaymentRemaining(p);
    }
  }
  return reste;
}

// ---------------------------------------------------------------------------//
// Overdue worklist aggregation (Payments page — "Impayés")
// ---------------------------------------------------------------------------//

/**
 * ONE aggregated row per student + subject: every currently-due unpaid
 * installment of that subject collapsed together, so the Payments page
 * shows exactly one row per student+subject and تسوية settles the whole
 * visible subject debt at once.
 */
export interface SubjectOverdueRow {
  studentId: string;
  subject: Subject;
  installments: Payment[];
  totalRemaining: number;
  totalAmountPaid: number;
  earliestDueDate: string;
  latestDueDate: string;
  isOverdue: boolean;
  isPartiallyPaid: boolean;
  isHalfMonth: boolean;
  /** Earliest future installment with a remaining gap (surplus pre-paid
   *  forward via advanceBalance). */
  nextDueDate: string | null;
  nextDueRemaining: number;
}

export function aggregateOverdueInstallments(
  payments: Payment[],
  todayKey: string,
): Map<string /* `${studentId}__${subject}` */, SubjectOverdueRow> {
  const rows = new Map<string, SubjectOverdueRow>();

  for (const payment of payments) {
    const key = `${payment.studentId}__${payment.subject}`;
    let row = rows.get(key);

    if (!isPaymentFullyPaid(payment) && payment.dueDate <= todayKey) {
      if (!row) {
        row = {
          studentId: payment.studentId,
          subject: payment.subject,
          installments: [],
          totalRemaining: 0,
          totalAmountPaid: 0,
          earliestDueDate: payment.dueDate,
          latestDueDate: payment.dueDate,
          isOverdue: false,
          isPartiallyPaid: false,
          isHalfMonth: false,
          nextDueDate: null,
          nextDueRemaining: 0,
        };
        rows.set(key, row);
      }

      row.installments.push(payment);
      row.totalRemaining += getPaymentRemaining(payment);
      row.totalAmountPaid += payment.amountPaid ?? 0;
      if (payment.dueDate < row.earliestDueDate) row.earliestDueDate = payment.dueDate;
      if (payment.dueDate > row.latestDueDate) row.latestDueDate = payment.dueDate;
      if (payment.dueDate < todayKey) row.isOverdue = true;
      if (isPaymentPartiallyPaid(payment)) row.isPartiallyPaid = true;
      if (payment.isHalfMonth) row.isHalfMonth = true;
    }

    if (!isPaymentFullyPaid(payment) && payment.dueDate > todayKey) {
      if (!row) {
        row = {
          studentId: payment.studentId,
          subject: payment.subject,
          installments: [],
          totalRemaining: 0,
          totalAmountPaid: 0,
          earliestDueDate: payment.dueDate,
          latestDueDate: payment.dueDate,
          isOverdue: false,
          isPartiallyPaid: false,
          isHalfMonth: false,
          nextDueDate: payment.dueDate,
          nextDueRemaining: getPaymentRemaining(payment),
        };
        rows.set(key, row);
      } else if (row.nextDueDate === null || payment.dueDate < row.nextDueDate) {
        row.nextDueDate = payment.dueDate;
        row.nextDueRemaining = getPaymentRemaining(payment);
      }
    }
  }

  for (const row of rows.values()) {
    row.installments.sort((a, b) => a.dueDate.localeCompare(b.dueDate));
  }

  return rows;
}

// ---------------------------------------------------------------------------//
// Settled worklist aggregation (Payments page — "Payés / أدوا الواجب")
// ---------------------------------------------------------------------------//

/**
 * ONE aggregated row per student + subject that HAS installments and
 * NOTHING due today: every installment is fully paid (dueDate <= todayKey)
 * or strictly future (Reste guard). Combos with no installments at all
 * (e.g. missing price) never appear.
 */
export interface SubjectSettledRow {
  studentId: string;
  subject: Subject;
  totalCovered: number;
  latestSettledPaymentId: string | null;
  latestSettledDueDate: string | null;
  nextUpcomingDueDate: string | null;
  nextUpcomingRemaining: number;
}

export function aggregateSettledInstallments(
  payments: Payment[],
  todayKey: string,
): Map<string /* `${studentId}__${subject}` */, SubjectSettledRow> {
  const rows = new Map<string, SubjectSettledRow>();
  // Sticky guard: once ANY due-unpaid installment is seen, the combo is
  // unsettled today — no later paid-due row can resurrect it.
  const unsettledKeys = new Set<string>();

  for (const payment of payments) {
    const key = `${payment.studentId}__${payment.subject}`;
    if (unsettledKeys.has(key)) continue;
    let row = rows.get(key);
    if (!row) {
      row = {
        studentId: payment.studentId,
        subject: payment.subject,
        totalCovered: 0,
        latestSettledPaymentId: null,
        latestSettledDueDate: null,
        nextUpcomingDueDate: null,
        nextUpcomingRemaining: 0,
      };
      rows.set(key, row);
    }

    if (payment.dueDate <= todayKey) {
      if (isPaymentFullyPaid(payment)) {
        row.totalCovered += payment.amountDue;
        if (
          row.latestSettledDueDate === null ||
          payment.dueDate > row.latestSettledDueDate
        ) {
          row.latestSettledDueDate = payment.dueDate;
          row.latestSettledPaymentId = payment.id;
        }
      } else {
        unsettledKeys.add(key);
        rows.delete(key);
      }
    } else if (getPaymentRemaining(payment) > 0) {
      if (
        row.nextUpcomingDueDate === null ||
        payment.dueDate < row.nextUpcomingDueDate
      ) {
        row.nextUpcomingDueDate = payment.dueDate;
        row.nextUpcomingRemaining = getPaymentRemaining(payment);
      }
    }
  }

  return rows;
}

// ---------------------------------------------------------------------------//
// Registration fee (رسوم التسجيل — one-time 100 DH, fully separate from the
// Rule A/B installment engine: never flows into any installment total)
// ---------------------------------------------------------------------------//

/** Default one-time registration fee in MAD — editable per student. */
export const REGISTRATION_FEE_DEFAULT = 100;

/**
 * A student owes the registration fee when enrolled in at least ONE
 * non-Small (Rule A standard) class. Small-group-only students are exempt.
 */
export function isRegistrationFeeApplicable(student: Student): boolean {
  return student.enrollments.some((e) => e.groupType !== "Small");
}

/** Remaining fee (MAD). No stored fee field = legacy = implicitly PAID → 0. */
export function getRegistrationFeeRemaining(student: Student): number {
  const fee = student.registrationFee;
  if (!fee) return 0;
  return Math.max(0, fee.amountDue - fee.amountPaid);
}

/** True when the fee applies AND is not fully paid — drives every red surface. */
export function isRegistrationFeeUnpaid(student: Student): boolean {
  return (
    isRegistrationFeeApplicable(student) && getRegistrationFeeRemaining(student) > 0
  );
}

/** One aggregated row per debtor student, sorted A→Z by name. */
export interface RegistrationFeeRow {
  studentId: string;
  amountDue: number;
  amountPaid: number;
  remaining: number;
  note?: string;
}

export interface RegistrationFeeDebtors {
  rows: RegistrationFeeRow[];
  count: number;
  totalRemaining: number;
}

/** Every currently-owing student collapsed to ONE row each, name-sorted. */
export function aggregateRegistrationFeeDebtors(
  students: Student[],
): RegistrationFeeDebtors {
  const debtors = students.filter(isRegistrationFeeUnpaid);
  const nameOf = (s: Student) => s.firstName + " " + s.lastName;
  debtors.sort((a, b) => nameOf(a).localeCompare(nameOf(b)));
  const rows: RegistrationFeeRow[] = debtors.map((student) => {
    const fee = student.registrationFee!;
    return {
      studentId: student.id,
      amountDue: fee.amountDue,
      amountPaid: fee.amountPaid,
      remaining: Math.max(0, fee.amountDue - fee.amountPaid),
      note: fee.note,
    };
  });
  return {
    rows,
    count: rows.length,
    totalRemaining: rows.reduce((sum, row) => sum + row.remaining, 0),
  };
}
