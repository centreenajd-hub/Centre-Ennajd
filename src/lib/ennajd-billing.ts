// Centre Ennajd payment engine — Session-Based Pricing for Rule A
// (standard classes: monthly fee ÷ fixed sessions × sessions the student
// will actually attend that month) and Rule B (2Bac s.x Small groups,
// rolling join-date cycle). Pure data/functions, zero React/Zustand —
// mirrors the "Shield" pattern of ennajd-taxonomy.ts.
// All functions take explicit Date params (enrolledAt/asOf), no hidden `new Date()`.
//
// BUSINESS RULES (strict implementation):
// 1. Session-Based Pricing (Rule A):
//      fixedCount   = 4 × scheduledDaysOfWeek.length   (1x/week → 4, 2x/week → 8)
//      perSession   = monthlyFee ÷ fixedCount
//      month amount = perSession × sessions the student will attend that month
//    A month with a 5th occurrence bills it FREE (billable capped at fixedCount).
//    monthlyFee is pulled dynamically via PriceEntry/customPrice.
// 2. Standard vs Extra: ONLY standard/fixed sessions (kind !== "one_off")
//    count. Extra "حصة إضافية" (one_off) is 100% free, excluded from the count.
// 3. Attendance vs Billing: a scheduled standard class = CONSUMED SESSION
//    even if absent. Attendance is tracking only.
// 4. Join month: only sessions STRICTLY AFTER enrolledAt → month-end count
//    (the enrollment-date session itself is not billable — billing starts
//    with the next scheduled session). When the student joins with ≤1
//    billable session left, that single session is FREE (no installment
//    emitted for the join month).
// 5. Months before enrollment / months with zero scheduled occurrences (gap
//    months) / combos with no timetable: NO installment ("–").
// 6. Reste guard: dueDate <= today only, future auto-generated sessions excluded.

import { getSessionKind } from "@/lib/ennajd-taxonomy";
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

/** Subjects that carry the rolling Rule B cycle for 2Bac s.x Small — unified per the old small-group app screenshots. */
const SMALL_GROUP_RULE_B_SUBJECTS: Subject[] = ["Math", "PC", "SVT"];

/** One generated installment with an ABSOLUTE amount (MAD). */
export interface SessionInstallment {
  monthKey: string; // "YYYY-MM"
  dueDate: string; // "YYYY-MM-DD"
  amount: number; // MAD, absolute
}

/**
 * Rule B (rolling, no calendar alignment) — unified for ALL 2Bac s.x
 * Small groups (Math/PC/SVT) per the old small-group app screenshots.
 * PROCHAINE ÉCHÉANCE = DATE DE LA PREMIÈRE SÉANCE + n mois.
 * Every other combo remains on Rule A (session-based pricing).
 */
export function getPaymentRuleFor(
  level: Level,
  subject: Subject,
  groupType: GroupType | null,
  track?: Track | null,
): PaymentRule {
  if (level !== "2Bac" || groupType !== "Small") return "A";
  if (!SMALL_GROUP_RULE_B_SUBJECTS.includes(subject)) return "A";
  if (track !== undefined && track !== null && track !== "s.x") return "A";
  return "B";
}

function daysInMonth(year: number, monthIndex0: number): number {
  return new Date(year, monthIndex0 + 1, 0).getDate();
}

function startOfMonth(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

function normalizeDateOnly(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

/**
 * Calendar-month arithmetic that clamps to the last valid day of the target
 * month (e.g. Jan 31 + 1 month → Feb 28/29, not an overflow into March).
 */
export function addMonthsClamped(date: Date, months: number): Date {
  const day = date.getDate();
  const targetMonthIndex = date.getMonth() + months;
  const target = new Date(date.getFullYear(), targetMonthIndex, 1);
  const lastDay = daysInMonth(target.getFullYear(), target.getMonth());
  target.setDate(Math.min(day, lastDay));
  return target;
}

/** Parses a "YYYY-MM-DD" key into a local-calendar Date (or null when malformed). */
function parseDateKey(key: string): Date | null {
  const [y, m, d] = key.split("-");
  const year = Number(y);
  const monthIndex0 = Number(m) - 1;
  const day = Number(d);
  if (!Number.isFinite(year) || !Number.isFinite(monthIndex0) || !Number.isFinite(day)) {
    return null;
  }
  return new Date(year, monthIndex0, day);
}

/**
 * The reactive billing ANCHOR: the earliest non-future PRESENT attendance
 * date the given student has for the given subject. Billing for the join
 * month starts ON this date (inclusive) — even when it predates the
 * registration date, because a delivered session proves the cycle actually
 * started then.
 *
 * A record matches when its `studentId` + `date` are present, its `status`
 * is `"present"` (auto-absence marks NEVER anchor billing — a delivered
 * session is proven only by attendance), its `sessionId` resolves to a
 * Session of this `subject`, and `date <= asOfKey` (future-dated marks —
 * e.g. a pre-marked upcoming class — never anchor billing). Returns `null`
 * when the student has no valid PRESENT attendance yet, in which case the
 * caller falls back to the enrollment date.
 *
 * Pure — no React/Zustand, no hidden date().
 */
export function earliestValidAttendanceDate(
  studentId: string,
  subject: Subject,
  attendanceRecords: AttendanceRecord[],
  sessions: Session[],
  asOfKey: string,
): Date | null {
  const subjectSessionIds = new Set(
    sessions.filter((s) => s.subject === subject).map((s) => s.id),
  );
  let earliest: Date | null = null;
  for (const record of attendanceRecords) {
    if (record.studentId !== studentId) continue;
    if (record.status !== "present") continue; // absence never anchors billing
    if (!record.date || record.date > asOfKey) continue; // ignore future marks
    if (!subjectSessionIds.has(record.sessionId)) continue;
    const parsed = parseDateKey(record.date);
    if (!parsed) continue;
    if (earliest === null || parsed < earliest) earliest = parsed;
  }
  return earliest;
}

// ---- Standard vs Extra helper ----
// ONLY standard/fixed schedule counts for billing. Extra "حصة إضافية" (one_off) is 100% free.
function isStandardSession(s: Session): boolean {
  return getSessionKind(s) !== "one_off";
}

/**
 * Which STANDARD scheduled days a given Level/Subject/Track/GroupType combo has.
 * Attendance records are IGNORED for the TIMETABLE (Rule 3) — a scheduled class counts as
 * CONSUMED SESSION regardless of individual absence. Extra sessions are excluded 100% (Rule 2).
 * When no standard Session exists for the combo, `hasSession` is false and
 * `scheduledDaysOfWeek` is empty → the session-based engine emits NO installment
 * (a subject with no timetable is not billable).
 *
 * The attendance ANCHOR (earliest valid attendance date, enrollment fallback)
 * is resolved separately by the caller via `earliestValidAttendanceDate()` and
 * passed to the schedule generator as the billing start date — this context
 * only describes the recurring timetable.
 */
export interface DeliveredDatesContext {
  hasSession: boolean;
  scheduledDaysOfWeek: number[]; // unique dayOfWeek values for standard sessions of this combo
  fallbackDayOfWeek: number; // enrolledAt's day-of-week; unused by the session-based engine
  /** "YYYY-MM" months where this combo has ZERO standard scheduled occurrences
   *  (gap months). A recurring weekly slot lands on every weekday of every
   *  calendar month, so this set is empty for a normal timetable. No installment
   *  is emitted for a gap month. */
  gapMonthKeys: ReadonlySet<string>;
}

export function buildDeliveredDatesContext(
  sessions: Session[],
  _attendanceRecords: AttendanceRecord[], // timetable-only here; the anchor is resolved by the caller
  combo: EnrollmentCombo,
  _enrolledAt: Date,
): DeliveredDatesContext {
  const matchingStandard = sessions.filter(
    (s) =>
      isStandardSession(s) &&
      s.level === combo.level &&
      s.subject === combo.subject &&
      s.track === combo.track &&
      s.groupType === combo.groupType,
  );

  return {
    hasSession: matchingStandard.length > 0,
    scheduledDaysOfWeek: [...new Set(matchingStandard.map((s) => s.dayOfWeek))],
    fallbackDayOfWeek: 0,
    // Rule 5 — gap months: months where the combo has zero STANDARD
    // scheduled occurrences. A recurring weekly slot covers every calendar
    // month, so only dated (one_off) standard sessions can produce real
    // gaps here; the set stays empty for a normal recurring timetable.
    gapMonthKeys: new Set(
      matchingStandard
        .filter((s) => getSessionKind(s) === "one_off" && s.date)
        .map((s) => s.date!.slice(0, 7)),
    ),
  };
}

/**
 * Counts STANDARD scheduled occurrences within an inclusive date range.
 * Extra sessions never counted (Rule 2). Attendance never consulted (Rule 3).
 */
function countOccurrencesInRange(ctx: DeliveredDatesContext, from: Date, to: Date): number {
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

/**
 * The fixed number of billable sessions per month for a combo:
 * 4 × (scheduled days per week). 1 day/week → 4, 2 days/week → 8.
 * Zero when the combo has no timetable → not billable.
 */
export function getFixedSessionCount(ctx: DeliveredDatesContext): number {
  return 4 * ctx.scheduledDaysOfWeek.length;
}

/**
 * How many sessions a student will be billed for in the calendar month
 * containing `monthDate` — the count of STANDARD scheduled occurrences in
 * the billable window, capped at `fixedCount` (the 5th occurrence in a
 * month is free).
 *
 * `anchor` is the billing start date: the earliest VALID (PRESENT) ATTENDANCE
 * date when the student has one, otherwise the enrollment date (both are
 * resolved by the caller). The anchor session itself IS billable — the
 * join-month window is `[anchor, monthEnd]` INCLUSIVE.
 *
 * Returns `null` when NO installment should be emitted for that month:
 *  - the combo has no timetable (fixedCount === 0),
 *  - the month is entirely before the anchor month,
 *  - the month has zero scheduled occurrences (gap month),
 *  - the join month has ≤1 billable session left (single session = free).
 */
function computeMonthBillable(
  anchor: Date,
  monthDate: Date,
  ctx: DeliveredDatesContext,
): number | null {
  const fixedCount = getFixedSessionCount(ctx);
  if (fixedCount === 0) return null;

  const monthStart = startOfMonth(monthDate);
  const monthEnd = new Date(
    monthStart.getFullYear(),
    monthStart.getMonth(),
    daysInMonth(monthStart.getFullYear(), monthStart.getMonth()),
  );

  // Months entirely before the anchor are never billed.
  if (monthEnd < normalizeDateOnly(anchor)) return null;

  // Explicit gap month (term break / timetable added mid-year) → no installment.
  if (ctx.gapMonthKeys.has(formatMonthKey(monthDate))) return null;

  const isJoinMonth =
    monthDate.getFullYear() === anchor.getFullYear() &&
    monthDate.getMonth() === anchor.getMonth();

  // Join month: occurrences from the ANCHOR INCLUSIVE (the anchor session
  // itself is billable). Other months count the full calendar month.
  const count = isJoinMonth
    ? countOccurrencesInRange(ctx, anchor, monthEnd)
    : countOccurrencesInRange(ctx, monthStart, monthEnd);

  // A month with zero scheduled occurrences is a gap month too.
  if (count === 0) return null;

  const billable = Math.min(count, fixedCount);

  // Join month with a single remaining session → that session is free.
  if (isJoinMonth && billable <= 1) return null;

  return billable;
}

/**
 * Expected installment amount (MAD) for one calendar month, using the
 * session-based formula: perSession × billable sessions. The join month
 * counts the sessions from `anchor` INCLUSIVE (the anchor session is
 * billable). Returns `null` when no installment should exist for that month
 * (see computeMonthBillable).
 *
 * `anchor` is the billing start date — earliest valid PRESENT attendance
 * date, or the enrollment date when the student has no attendance yet
 * (resolved by the caller via `earliestValidAttendanceDate`).
 *
 * `price` is the monthly fee for this student+subject (already resolved with
 * customPrice by the caller). Pure — used both by the generator and by
 * `buildPaymentMatrix` / `reconcilePaymentAmounts` to detect stale or
 * discounted rows.
 */
export function computeExpectedMonthAmount(
  anchor: Date,
  monthKey: string, // "YYYY-MM"
  ctx: DeliveredDatesContext,
  price: number,
): number | null {
  const [yearStr, monthStr] = monthKey.split("-");
  const year = Number(yearStr);
  const monthIndex0 = Number(monthStr) - 1;
  if (!Number.isFinite(year) || !Number.isFinite(monthIndex0)) return null;

  const billable = computeMonthBillable(anchor, new Date(year, monthIndex0, 1), ctx);
  if (billable === null) return null;

  const fixedCount = getFixedSessionCount(ctx);
  return Math.round((price / fixedCount) * billable);
}

/**
 * The dueDate the engine would emit for a given month: the anchor itself
 * for the join month (the anchor session is billable), the 1st of the month
 * for every later month. Mirrors `generateSessionBasedSchedule`'s dueDate
 * logic so the reconcile pass can re-date a surviving row onto exactly the
 * date the generator would have used. Returns `null` for a malformed
 * monthKey (the caller treats that month as non-billable anyway).
 */
export function computeExpectedMonthDueDate(
  anchor: Date,
  monthKey: string, // "YYYY-MM"
): string | null {
  const [yearStr, monthStr] = monthKey.split("-");
  const year = Number(yearStr);
  const monthIndex0 = Number(monthStr) - 1;
  if (!Number.isFinite(year) || !Number.isFinite(monthIndex0)) return null;

  const isJoinMonth =
    year === anchor.getFullYear() && monthIndex0 === anchor.getMonth();
  return isJoinMonth
    ? formatDateKey(anchor)
    : formatDateKey(new Date(year, monthIndex0, 1));
}

/**
 * Rule A schedule — session-based pricing. For every month from the join
 * month through `asOf`, emits one installment whose amount is
 * perSession × (sessions the student will attend that month):
 *
 *  - join month: occurrences in [anchor, month-end] — the anchor session
 *    IS billable,
 *  - other months: occurrences in the full month,
 *  - billable capped at fixedCount (a 5th weekly occurrence is free),
 *  - join month with ≤1 session left → free (no installment),
 *  - gap months / pre-anchor months / no timetable → no installment.
 *
 * `anchor` is the billing start date — the earliest valid ATTENDANCE date
 * when one exists, otherwise the enrollment date (both inclusive).
 *
 * Due date: the anchor itself for the join month, the 1st of the month
 * for every later month.
 */
export function generateSessionBasedSchedule(
  anchor: Date,
  asOf: Date,
  ctx: DeliveredDatesContext,
  price: number,
): SessionInstallment[] {
  if (!ctx.hasSession || ctx.scheduledDaysOfWeek.length === 0) return [];
  if (anchor > asOf) return [];

  const fixedCount = getFixedSessionCount(ctx);
  const perSession = price / fixedCount;

  const results: SessionInstallment[] = [];
  const asOfMonth = startOfMonth(asOf);
  let cursor = startOfMonth(anchor);
  while (cursor <= asOfMonth) {
    const billable = computeMonthBillable(anchor, cursor, ctx);
    if (billable !== null) {
      const isJoinMonth =
        cursor.getFullYear() === anchor.getFullYear() &&
        cursor.getMonth() === anchor.getMonth();
      const dueDate = isJoinMonth ? anchor : cursor;
      results.push({
        monthKey: formatMonthKey(cursor),
        dueDate: formatDateKey(dueDate),
        amount: Math.round(perSession * billable),
      });
    }
    cursor = addMonthsClamped(cursor, 1);
  }
  return results;
}

/**
 * Rule B schedule (2Bac s.x Small Math/PC/SVT only): no calendar alignment
 * at all — a full-price charge on the join date, then every month on that
 * same day-of-month, forever.
 */
export function generateRuleBSchedule(
  enrolledAt: Date,
  asOf: Date,
  price: number,
): SessionInstallment[] {
  if (enrolledAt > asOf) return [];

  const results: SessionInstallment[] = [];
  let i = 0;
  let cursor = enrolledAt;
  while (cursor <= asOf) {
    results.push({
      monthKey: formatMonthKey(cursor),
      dueDate: formatDateKey(cursor),
      amount: Math.round(price),
    });
    i += 1;
    cursor = addMonthsClamped(enrolledAt, i);
  }
  return results;
}

export function generateScheduleFor(
  rule: PaymentRule,
  enrolledAt: Date,
  asOf: Date,
  ctx: DeliveredDatesContext,
  price: number,
): SessionInstallment[] {
  return rule === "B"
    ? generateRuleBSchedule(enrolledAt, asOf, price)
    : generateSessionBasedSchedule(enrolledAt, asOf, ctx, price);
}

/** "YYYY-MM-DD" using local calendar fields (not UTC — avoids TZ day-shift bugs). */
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

// ---------------------------------------------------------------------------//
// Ledger reconciliation — self-heal stale Rule A amounts after a price or
// timetable change. Rule B rows and customPrice rows are never touched.
// ---------------------------------------------------------------------------//

export interface ReconcilePatch {
  id: string;
  amountDue: number;
  /** The engine's dueDate for this month — the anchor itself for the join
   *  month, the 1st otherwise. A re-anchor moves the surviving row onto this
   *  date (the surplus row occupying it is reported for deletion). */
  dueDate: string;
  /** The group's CONSOLIDATED amountPaid — both duplicates of a month can
   *  carry waterfall credit, so collapsing must pool it onto the keeper or
   *  the credit would vanish. Overpayment above amountDue stays on the row. */
  amountPaid: number;
  /** Recomputed isPaid: true only when the consolidated amountPaid covers
   *  the NEW amountDue. */
  isPaid: boolean;
}

/**
 * Authoritative Rule A reconciliation — the self-heal the daily sync
 * actually applies. For every Rule A row it recomputes what the engine
 * would charge today for that (student, subject, month) and classifies it:
 *
 *  - `update`  — the row is still billable but its amount drifted (price
 *                change, timetable edit, engine migration): patch
 *                `amountDue`, keep `amountPaid`, recompute `isPaid`.
 *  - `delete`  — the engine would emit NO installment for that month at
 *                all: the enrollment/price/timetable is gone, the month is
 *                a gap month, or it predates enrollment. Such rows are
 *                stale leftovers and are removed from the ledger.
 *  - untouched — the amount already matches.
 *
 * Rule B rows are never classified. `reconcilePaymentAmounts` below is the
 * update-only subset of this (kept for `regeneratePaymentLedger`-adjacent
 * paths); this one additionally reports the rows that must go away, which
 * is what stops old full-price months from lingering on the board forever.
 *
 * Expected amounts are computed from the ATTENDANCE ANCHOR
 * (`earliestValidAttendanceDate`, enrollment fallback) — the same anchor
 * the generator uses — so the daily self-heal never reverts a reactive
 * re-anchoring. Pass the live `attendanceRecords` + `asOfKey`; the defaults
 * (no attendance) reproduce the legacy enrollment-date anchor.
 *
 * Pure — no React/Zustand.
 */
export interface ReconcileLedgerResult {
  update: ReconcilePatch[];
  delete: string[];
}

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

  // INVARIANT: exactly ONE Rule A row per (student, subject, month). The
  // generator's dedupe key used to be `dueDate`, so a moved anchor minted a
  // SECOND row for the same month and this pass patched each one
  // independently — the report matrix then summed two identical charges
  // (438 = 219 + 219). Grouping by calendar month lets one reconcile pass
  // collapse the whole group onto a single survivor.
  const groups: Array<{
    studentId: string;
    subject: Subject;
    month: string;
    rows: Payment[];
  }> = [];
  const groupIndex = new Map<string, number>();
  for (const payment of payments) {
    if (payment.rule !== "A") continue;
    const key = `${payment.studentId}__${payment.subject}__${payment.month}`;
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

  for (const group of groups) {
    const student = studentsById.get(group.studentId);
    // Student gone (or the rows are orphans) → not billable anymore.
    if (!student) {
      del.push(...group.rows.map((p) => p.id));
      continue;
    }

    const enrollment = student.enrollments.find((e) => e.subject === group.subject);
    // Enrollment dropped → the combo no longer exists → rows are stale.
    if (!enrollment) {
      del.push(...group.rows.map((p) => p.id));
      continue;
    }

    const price = getEffectivePriceFor(student, enrollment, prices);
    // Price removed entirely (and no customPrice) → nothing to charge.
    if (price === undefined) {
      del.push(...group.rows.map((p) => p.id));
      continue;
    }

    const enrolledAt = new Date(enrollment.enrolledAt ?? student.createdAt);
    const anchor =
      asOfKey !== undefined
        ? earliestValidAttendanceDate(
            group.studentId,
            group.subject,
            attendanceRecords,
            sessions,
            asOfKey,
          ) ?? enrolledAt
        : enrolledAt;
    const ctx = buildDeliveredDatesContext(
      sessions,
      attendanceRecords,
      {
        level: student.level,
        subject: enrollment.subject,
        track: enrollment.track,
        groupType: enrollment.groupType,
      },
      anchor,
    );

    const expected = computeExpectedMonthAmount(anchor, group.month, ctx, price);
    if (expected === null) {
      // No timetable / gap month / pre-enrollment month / lone session →
      // the engine emits NO installment for this month, so the whole group
      // is stale and must go.
      del.push(...group.rows.map((p) => p.id));
      continue;
    }

    // Keep ONE representative (the most-settled row, same rule as
    // `dedupePayments`); every other row of the month is surplus and is
    // deleted so the ledger stays exactly one row per month.
    const keeper = group.rows.reduce((best, p) =>
      isMoreSettledPayment(p, best) ? p : best,
    );
    for (const p of group.rows) {
      if (p.id !== keeper.id) del.push(p.id);
    }

    // Paid credit across the WHOLE group is consolidated onto the keeper —
    // both duplicates can carry waterfall credit, and collapsing without
    // pooling it would silently lose payment progress.
    const consolidatedPaid = group.rows.reduce(
      (sum, p) => sum + (p.amountPaid ?? 0),
      0,
    );
    const expectedDueDate =
      computeExpectedMonthDueDate(anchor, group.month) ?? keeper.dueDate;

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
 * Recomputes the expected `amountDue` of every Rule A installment and
 * reports the ones that drifted (price change, timetable edit, engine
 * migration). `isPaid` is recomputed strictly from `amountPaid` — a row
 * stays paid only when the paid amount covers the new expected amount.
 * Rule B rows and rows whose expected amount is null (no timetable / gap
 * month) are left untouched. Expected amounts use the same ATTENDANCE
 * ANCHOR as the generator (defaults reproduce the legacy enrollment anchor).
 * Pure — the store layer applies the patches.
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

  // Month-grouped, keeper-only: a (student, subject, month) that carries
  // more than one row (a moved anchor's leftover) is patched on ONE
  // representative only — the most-settled row, same pick as
  // `reconcileRuleALedger`. The surplus rows are never patched here; they
  // are wiped by the collapse/delete paths (`reconcileRuleALedger`,
  // `dedupePayments`), so double-patching them would inflate the ledger
  // until that happens.
  const groups: Array<{
    studentId: string;
    subject: Subject;
    month: string;
    rows: Payment[];
  }> = [];
  const groupIndex = new Map<string, number>();
  for (const payment of payments) {
    if (payment.rule !== "A") continue;
    const key = `${payment.studentId}__${payment.subject}__${payment.month}`;
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

  for (const group of groups) {
    const student = studentsById.get(group.studentId);
    if (!student) continue;
    const enrollment = student.enrollments.find((e) => e.subject === group.subject);
    if (!enrollment) continue;

    const price = getEffectivePriceFor(
      student,
      enrollment,
      prices,
    );
    if (price === undefined) continue;

    const enrolledAt = new Date(enrollment.enrolledAt ?? student.createdAt);
    const anchor =
      asOfKey !== undefined
        ? earliestValidAttendanceDate(
            group.studentId,
            group.subject,
            attendanceRecords,
            sessions,
            asOfKey,
          ) ?? enrolledAt
        : enrolledAt;
    const ctx = buildDeliveredDatesContext(
      sessions,
      attendanceRecords,
      {
        level: student.level,
        subject: enrollment.subject,
        track: enrollment.track,
        groupType: enrollment.groupType,
      },
      anchor,
    );

    const expected = computeExpectedMonthAmount(anchor, group.month, ctx, price);
    if (expected === null) continue;

    const keeper = group.rows.reduce((best, p) =>
      isMoreSettledPayment(p, best) ? p : best,
    );
    const expectedDueDate =
      computeExpectedMonthDueDate(anchor, group.month) ?? keeper.dueDate;
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
// Reactive ledger recalculation — the attendance-anchored diff a single
// markAttendance triggers. Rebuilds ONE student+subject's Rule A
// installments from the attendance anchor and redistributes that subject's
// already-paid credit earliest-first (the same waterfall a fresh full sync
// uses), so a re-anchor both pulls credit back (shortfall) and pushes it
// forward (surplus) across the following months.
// ---------------------------------------------------------------------------//

/** State slices the reactive recalc needs — the store passes them in. */
export interface RecalculateLedgerContext {
  payments: Payment[];
  sessions: Session[];
  attendanceRecords: AttendanceRecord[];
  prices: PriceEntry[];
  /** Generate installments through this date (syncPayments-style: now + 1 month). */
  asOf: Date;
  /** "YYYY-MM-DD" — the reference for ignoring future-dated attendance. */
  asOfKey: string;
  /** ISO timestamp stamped on every emitted/updated row. */
  updatedAt: string;
}

export interface RecalculateResult {
  /** Existing Rule A row ids whose month is no longer billable — the
   *  sessions they billed no longer exist, so they are deleted. Their paid
   *  credit is returned to the pool and re-distributed by the waterfall. */
  toDelete: string[];
  /** New + changed installments, upsertable by id. Rows are only shipped
   *  when they genuinely differ from what is already on the ledger. */
  toUpsert: Payment[];
  /** Credit the rebuilt installments could not absorb — the caller adds it
   *  to the student's `advanceBalance`. */
  remainingCredit: number;
}

/**
 * Rebuilds one student+subject's Rule A ledger against the current state,
 * anchored on the earliest valid attendance date (enrollment fallback).
 *
 * The rebuilt schedule comes from the exact same path a fresh full sync
 * uses (`generateSessionBasedSchedule` over the resolved anchor + price),
 * and the paid credit accumulated on the subject's existing installments
 * is pooled and re-run through `applyCreditWaterfall` — so:
 *
 *  - a month whose charge GREW pulls credit back from the following months,
 *  - a month whose charge SHRANK pushes surplus forward,
 *  - a month that stopped being billable (e.g. the join month drops to a
 *    single session → free) is deleted and its credit re-distributed,
 *  - a settled installment only moves when its amount actually changes.
 *
 * Idempotent: the same attendance set yields the same installments and the
 * same credit distribution. Rule B (2Bac s.x Small Math/PC/SVT) is never
 * touched — its fixed rolling engine ignores attendance. Pure — no
 * React/Zustand.
 */
export function recalculateStudentSubjectLedger(
  student: Student,
  subject: Subject,
  ctx: RecalculateLedgerContext,
): RecalculateResult {
  const existing = ctx.payments.filter(
    (p) => p.studentId === student.id && p.subject === subject && p.rule === "A",
  );
  const creditOf = (rows: Payment[]) => rows.reduce((sum, p) => sum + (p.amountPaid ?? 0), 0);

  const enrollment = student.enrollments.find((e) => e.subject === subject);
  // No enrollment left → the subject isn't billed; its rows are stale.
  if (!enrollment) {
    return {
      toDelete: existing.map((p) => p.id),
      toUpsert: [],
      remainingCredit: creditOf(existing),
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
  // Price removed entirely → nothing to charge.
  if (price === undefined) {
    return {
      toDelete: existing.map((p) => p.id),
      toUpsert: [],
      remainingCredit: creditOf(existing),
    };
  }

  // The anchor: earliest valid PRESENT attendance date, else the enrollment
  // date. Absence records never anchor billing.
  const enrolledAt = new Date(enrollment.enrolledAt ?? student.createdAt);
  const anchor =
    earliestValidAttendanceDate(
      student.id,
      subject,
      ctx.attendanceRecords,
      ctx.sessions,
      ctx.asOfKey,
    ) ?? enrolledAt;

  const comboCtx = buildDeliveredDatesContext(
    ctx.sessions,
    ctx.attendanceRecords,
    {
      level: student.level,
      subject,
      track: enrollment.track,
      groupType: enrollment.groupType,
    },
    anchor,
  );

  const schedule = generateSessionBasedSchedule(anchor, ctx.asOf, comboCtx, price);

  // Pool the credit already applied to this subject's installments — the
  // rebuild redistributes it earliest-first over the new schedule.
  const creditPool = creditOf(existing);

  // One representative row per calendar month (the most-settled one, same
  // rule as `dedupePayments`) — its id is reused for the rebuilt row. A
  // re-anchor moves the join-month dueDate, which makes the daily sync's
  // `studentId__subject__dueDate` dedupe mint a surplus row for the same
  // month; those are reported for deletion below so the ledger stays
  // exactly one row per month.
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

  // Re-distribute the pooled credit across the rebuilt installments,
  // dueDate ascending — exactly the waterfall a fresh sync would run.
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

  // Delete every row that is no longer the month's representative: months
  // that stopped being billable, plus surplus duplicates of a billable
  // month.
  const reusedIds = new Set(finalRows.map((p) => p.id));
  const toDelete = existing.filter((p) => !reusedIds.has(p.id)).map((p) => p.id);

  return { toDelete, toUpsert, remainingCredit: remaining };
}


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

// ---------------------------------------------------------------------------//
// Partial-payment helpers
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

// ---------------------------------------------------------------------------//
// Advance-credit waterfall (simple dueDate-ascending gap filling)
// ---------------------------------------------------------------------------//

export interface CreditWaterfallResult {
  /** New payment objects reflecting the credit applied (only installment rows that changed).
   *  Unchanged installments are omitted — the caller merges by id. */
  updated: Payment[];
  /** Credit that could not be absorbed by any installment (dueDate-ascending).
   *  This leftover must be stored as `advanceBalance` on the student. */
  remaining: number;
  /** True when at least one installment was fully or partially changed. */
  anyChanged: boolean;
}

/**
 * Distributes `credit` (MAD) across installments in `dueDate`-ascending
 * order, applying to each installment's remaining gap (`amountDue - amountPaid`).
 *
 * With the session-based engine the installment amounts are already exact,
 * so plain gap-filling is all that's needed: no proration tiers, no
 * current/future month split.
 *
 * - `subject === null` means cross-subject (any subject for that student) —
 *   used by the creation-time `applyInitialTuitionPayment` waterfall.
 * - Only installments that genuinely have a remaining gap (not fully paid)
 *   are credited. Once credit is exhausted or all gaps are filled, the
 *   function returns the leftover as `remaining` for the caller to stash in
 *   `advanceBalance`.
 * - Returns a minimal `updated` array (changed rows only) so callers can
 *   merge by `id` without rewriting the whole ledger.
 *
 * Pure — no React/Zustand, no hidden date().
 */
export function applyCreditWaterfall(
  payments: Payment[],
  studentId: string,
  subject: Subject | null,
  credit: number,
  _asOfKey: string,
  updatedAt: string,
): CreditWaterfallResult {
  const emptyResult: CreditWaterfallResult = {
    updated: [],
    remaining: Math.max(0, Math.round(credit)),
    anyChanged: false,
  };

  if (!Number.isFinite(credit) || credit <= 0) {
    return emptyResult;
  }

  // Walk every installment for this student that isn't already fully paid,
  // in dueDate-ascending order — due AND future. Cross-subject mode scans
  // all subjects; per-subject mode filters to one.
  const eligible = payments.filter(
    (p) =>
      p.studentId === studentId &&
      (subject === null || p.subject === subject) &&
      !isPaymentFullyPaid(p),
  );
  eligible.sort((a, b) => a.dueDate.localeCompare(b.dueDate));

  const updated: Payment[] = [];
  let remaining = Math.max(0, Math.round(credit));

  for (const payment of eligible) {
    if (remaining <= 0) break;

    const currentPaid = payment.amountPaid ?? 0;
    const gap = Math.max(0, payment.amountDue - currentPaid);
    if (gap <= 0) continue;

    const apply = Math.min(gap, remaining);
    if (apply <= 0) continue;

    const amountPaid = currentPaid + apply;
    const isPaid = amountPaid >= payment.amountDue;
    updated.push({ ...payment, amountPaid, isPaid, updatedAt });
    remaining -= apply;
  }

  return {
    updated,
    remaining: Math.max(0, remaining),
    anyChanged: updated.length > 0,
  };
}

/**
 * One student's due position for a single subject, relative to an explicit
 * "as of" date key. "Due" uses the app-wide outstanding definition (same as
 * `hasOutstandingBalance`): unpaid AND dueDate <= asOf — future installments
 * never count (Reste guard). Single pass over the payments list.
 */
export interface StudentSubjectDueBalance {
  /** Unpaid installments that are due (dueDate <= asOfKey), dueDate ascending. */
  dueUnpaid: Payment[];
  /** Sum of remaining amounts for dueUnpaid (MAD) — true outstanding. */
  dueTotal: number;
  /** dueDate of the earliest due installment, or null when none is due. */
  earliestDueDate: string | null;
  /** True when at least one due installment is strictly past its due date. */
  isOverdue: boolean;
  /** Earliest unpaid future installment (dueDate > asOfKey), or null. */
  nextUpcoming: Payment | null;
  /** Latest paid installment that is due (dueDate <= asOfKey), or null. */
  lastPaidDue: Payment | null;
  /** False when no payment row exists for this student+subject yet
   *  (e.g. no price defined → syncPayments generated nothing). */
  hasInstallments: boolean;
  /** Sum of amountPaid across dueUnpaid */
  amountPaid: number;
  /** Alias for dueTotal — total remaining to pay */
  remaining: number;
  /** True when any due installment has 0 < amountPaid < amountDue */
  isPartiallyPaid: boolean;
}

/**
 * Per-subject due position for a single student. Accepts an optional
 * `advanceBalance` to net off cross-subject credit that has been carried
 * forward — the `remaining` field reflects the true net amount owed for
 * this subject after advance credit is applied.
 */
export function getDueBalanceForStudentSubject(
  payments: Payment[],
  studentId: string,
  subject: Subject,
  asOfKey: string,
  advanceBalance = 0,
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

    const remaining = getPaymentRemaining(payment);
    const partiallyPaid = isPaymentPartiallyPaid(payment);

    // Paid includes both isPaid flag and fully-covered by amountPaid
    if (payment.isPaid || remaining === 0) {
      if (
        payment.dueDate <= asOfKey &&
        (lastPaidDue === null || payment.dueDate > lastPaidDue.dueDate)
      ) {
        lastPaidDue = payment;
      }
      continue;
    }

    // Reste guard: strictly dueDate <= asOfKey only — future never counts
    if (payment.dueDate <= asOfKey) {
      dueUnpaid.push(payment);
      dueTotal += remaining;
      amountPaid += payment.amountPaid ?? 0;
      if (partiallyPaid) isPartiallyPaid = true;
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
 * Reste guard helper for StudentTable: recomputes balance strictly
 * where dueDate <= todayKey, ignoring all future auto-generated sessions.
 */
export function getResteForPayments(payments: Payment[], todayKey: string): number {
  let reste = 0;
  for (const p of payments) {
    if (!p.isPaid && p.dueDate <= todayKey) {
      reste += getPaymentRemaining(p);
    }
  }
  return reste;
}

// ---------------------------------------------------------------------------//
// Overdue worklist aggregation (Payments page)
// ---------------------------------------------------------------------------//

/**
 * ONE aggregated worklist row per student + subject: every currently-due
 * unpaid installment of that subject collapsed together, so the Payments
 * page shows exactly one row per student+subject and تسوية settles the
 * whole visible subject debt at once. Mirrors the "due" semantics of
 * `getDueBalanceForStudentSubject` (unpaid AND dueDate <= todayKey,
 * remaining-aware) in a single pass, grouped by `studentId__subject`.
 */
export interface SubjectOverdueRow {
  studentId: string;
  subject: Subject;
  /** Due + unpaid installments, dueDate ascending. */
  installments: Payment[];
  /** Σ remaining across the row's installments (MAD, partial-aware). */
  totalRemaining: number;
  /** Partial credit accumulated so far across the row's installments. */
  totalAmountPaid: number;
  /** Earliest unpaid dueDate — shown in the Échéance column. */
  earliestDueDate: string;
  /** Latest unpaid dueDate — the current cycle (receipt month). */
  latestDueDate: string;
  /** True when any installment is strictly past its due date (< todayKey). */
  isOverdue: boolean;
  /** True when any installment has 0 < amountPaid < amountDue. */
  isPartiallyPaid: boolean;
  /** True when any installment is a half-month charge. */
  isHalfMonth: boolean;
  /** The earliest future installment with a remaining gap (dueDate > todayKey).
   *  Tracks how much surplus has been pre-paid forward via advanceBalance. */
  nextDueDate: string | null;
  /** Remaining gap on that next-due installment (MAD). 0 when fully pre-paid. */
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

    // --- Due & unpaid (dueDate <= todayKey, not fully paid) ---
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

    // --- Future installment with a remaining gap (dueDate > todayKey) ---
    // Tracks how much surplus has been pre-paid forward via advanceBalance.
    if (!isPaymentFullyPaid(payment) && payment.dueDate > todayKey) {
      if (!row) {
        // No due installments yet — seed a row so the next-due shows even
        // before anything is past due.
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
      } else if (
        row.nextDueDate === null ||
        payment.dueDate < row.nextDueDate
      ) {
        row.nextDueDate = payment.dueDate;
        row.nextDueRemaining = getPaymentRemaining(payment);
      }
    }
  }

  // dueDate ascending within each row (earliest first for settle/partial credit).
  for (const row of rows.values()) {
    row.installments.sort((a, b) => a.dueDate.localeCompare(b.dueDate));
  }

  return rows;
}

// ---------------------------------------------------------------------------//
// Settled worklist aggregation (Payments page — "Payés / أدوا الواجب" panel)
// ---------------------------------------------------------------------------//

/**
 * ONE aggregated row per student + subject that HAS generated installments
 * and NOTHING due today: every installment is either fully paid (isPaid flag
 * or amountPaid covering amountDue) or a strictly-future one (dueDate >
 * todayKey, Reste guard). Combos with no installments at all (e.g. missing
 * price) never appear here. Single O(payments) pass, mirroring
 * `aggregateOverdueInstallments`.
 */
export interface SubjectSettledRow {
  studentId: string;
  subject: Subject;
  /** Sum of amountDue across the due-paid installments (MAD covered today). */
  totalCovered: number;
  /** Id of the latest fully-paid installment with dueDate <= todayKey — the mark-unpaid target. */
  latestSettledPaymentId: string | null;
  /** dueDate of that latest settled installment, or null. */
  latestSettledDueDate: string | null;
  /** dueDate of the earliest unpaid future installment, or null. */
  nextUpcomingDueDate: string | null;
  /** Remaining (MAD) of that earliest future installment — 0 when absent. */
  nextUpcomingRemaining: number;
}

export function aggregateSettledInstallments(
  payments: Payment[],
  todayKey: string,
): Map<string /* `${studentId}__${subject}` */, SubjectSettledRow> {
  const rows = new Map<string, SubjectSettledRow>();
  // Sticky guard: once ANY due-unpaid installment is seen for a combo, the
  // combo is unsettled today — no later paid-due row can resurrect it.
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
      // App-wide "fully paid" definition: isPaid flag OR amountPaid covering
      // amountDue — a flag-settled row keeps amountPaid = 0, so the flag must
      // take precedence (same as isPaymentFullyPaid everywhere else).
      if (isPaymentFullyPaid(payment)) {
        // Due & fully covered — counts toward "Payés".
        row.totalCovered += payment.amountDue;
        if (
          row.latestSettledDueDate === null ||
          payment.dueDate > row.latestSettledDueDate
        ) {
          row.latestSettledDueDate = payment.dueDate;
          row.latestSettledPaymentId = payment.id;
        }
      } else {
        // Due & still unpaid/partial → the combo is NOT settled today.
        unsettledKeys.add(key);
        rows.delete(key);
      }
    } else if (getPaymentRemaining(payment) > 0) {
      // Strictly-future unpaid installment — candidate for "next due".
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
// Ledger de-duplication (defensive self-heal)
// ---------------------------------------------------------------------------//

/**
 * Logical identity of an installment: the CALENDAR MONTH it bills. Keying on
 * `month` (not `dueDate`) is what makes the hydration self-heal wipe
 * pre-existing DB duplicates — a re-dated duplicate of the same month shares
 * the month even when its dueDate moved. Rule B rows keep the same key: a
 * rolling cycle emits exactly one charge per calendar month too.
 */
function paymentLogicalKey(payment: Payment): string {
  return `${payment.studentId}__${payment.subject}__${payment.month}`;
}

/**
 * Which of two same-key rows to keep. Prefers the row that reflects the most
 * payment progress so a settled/partial duplicate is never discarded in favor
 * of a pristine one: settled flag first, then largest amountPaid, then most
 * recent updatedAt.
 */
export function isMoreSettledPayment(a: Payment, b: Payment): boolean {
  if (a.isPaid !== b.isPaid) return a.isPaid;
  const aPaid = a.amountPaid ?? 0;
  const bPaid = b.amountPaid ?? 0;
  if (aPaid !== bPaid) return aPaid > bPaid;
  return a.updatedAt > b.updatedAt;
}

export interface PaymentDedupeResult {
  /** One row per logical key, in first-seen order (same reference when clean). */
  kept: Payment[];
  /** Ids of the surplus duplicate rows — safe to delete from Firestore. */
  duplicateIds: string[];
}

/**
 * Collapses a ledger to exactly one row per `studentId__subject__month`.
 * Duplicates slip in when the schedule generator runs before the payments
 * listener has hydrated (empty local ledger → whole schedule regenerated with
 * fresh ids), or when a re-anchor re-dates the join month onto a dueDate a
 * leftover row still occupies. Pure defensive pass: rows are
 * identical-by-design (same key = same installment), so surplus rows are
 * reported for deletion. Returns the original array reference untouched when
 * the ledger is already clean, so `replaceIfChanged` can short-circuit.
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

  const kept: Payment[] = [];
  const keptIds = new Set<string>();
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
// Registration fee (رسوم التسجيل — one-time 100 DH, fully separate from
// the Rule A/B installment engine: never flows into any installment total)
// ---------------------------------------------------------------------------//

/** Default one-time registration fee in MAD — editable per student. */
export const REGISTRATION_FEE_DEFAULT = 100;

/**
 * A student owes the registration fee when enrolled in at least ONE
 * non-Small (Rule A standard) class. Small-group-only students (2Bac s.x)
 * are exempt.
 */
export function isRegistrationFeeApplicable(student: Student): boolean {
  return student.enrollments.some((e) => e.groupType !== "Small");
}

/**
 * Remaining registration fee (MAD). Students with NO stored fee field are
 * legacy = implicitly PAID → 0. Otherwise max(0, due − paid) — partial aware.
 */
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

/**
 * Every currently-owing student collapsed to ONE row each (name-sorted),
 * with the Σ remaining for the panel header badge. Pure — callers memoize.
 */
export function aggregateRegistrationFeeDebtors(
  students: Student[],
): RegistrationFeeDebtors {
  const debtors = students.filter(isRegistrationFeeUnpaid);
  const nameOf = (s: Student) => s.firstName + " " + s.lastName;
  debtors.sort((a, b) => nameOf(a).localeCompare(nameOf(b)));
  const rows: RegistrationFeeRow[] = debtors.map((student) => {
    // Non-null: isRegistrationFeeUnpaid guarantees the fee field exists.
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

/**
 * Pure helper — computes the total tuition (MAD) for a set of enrollments
 * WITHOUT requiring a persisted student.id (used at creation time, before
 * the student doc exists). Mirrors `getEffectivePrice` + `getBasePrice`:
 * `customPrice ?? base price` per enrollment. Returns 0 when no price is
 * defined for any enrollment (the caller disables the Paid input in that case).
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
