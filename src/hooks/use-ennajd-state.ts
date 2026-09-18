// The single source of truth for Centre Ennajd ("The Shield" contract).
// Every future phase (Attendance, Payments, PDF exports) reads/writes state
// exclusively through this store.
//
// Persistence: this store no longer uses localStorage (`persist`). Instead,
// every write action also pushes the same record to Firestore (via
// `dbServices`), and `hydrate*` actions — called only by
// `useFirestoreSync()` — replace slices of state whenever Firestore's
// real-time listeners fire (initial load, remote changes, or the local
// offline queue flushing).

import { create } from "zustand";
import { toast } from "sonner";
import {
  applyCreditWaterfall,
  buildDeliveredDatesContext,
  dedupePayments,
  earliestValidAttendanceDate,
  formatDateKey,
  generateScheduleFor,
  getPaymentRuleFor,
  isMoreSettledPayment,
  isPaymentFullyPaid,
  getPaymentRemaining,
  recalculateStudentSubjectLedger,
  reconcileRuleALedger,
  REGISTRATION_FEE_DEFAULT,
  type DeliveredDatesContext,
} from "@/lib/ennajd-billing";
import {
  getEnrolledStudentsForSession,
  isOneOffSession,
  shouldAutoMarkAbsent,
  shouldAutoMarkAbsentOneOff,
} from "@/lib/ennajd-taxonomy";
import { translate as t, type DictKey } from "@/lib/i18n";
import {
  addSessionDoc,
  addStudentDoc,
  deleteMessageDoc,
  deletePaymentsBatchDoc,
  deleteSessionDoc,
  deleteStudentDoc,
  markAttendanceDoc,
  setPaymentPaidDoc,
  setPriceDoc,
  updatePaymentsBatchDoc,
  updateSessionDoc,
  updateStudentDoc,
  updateStudentAdvanceBalanceDoc,
  upsertAttendanceBatchDoc,
  upsertMessageDoc,
  upsertPaymentsBatchDoc,
} from "@/lib/dbServices";
import type {
  AttendanceRecord,
  AttendanceStatus,
  GroupType,
  Level,
  LevelMessage,
  Payment,
  PriceEntry,
  RegistrationFee,
  Session,
  Student,
  Subject,
  SubjectEnrollment,
  Track,
} from "@/types/ennajd";

/** Local "HH:mm" from a Date — used to stamp AttendanceRecord.timestamp. */
function formatTimeKey(date: Date): string {
  const h = String(date.getHours()).padStart(2, "0");
  const m = String(date.getMinutes()).padStart(2, "0");
  return `${h}:${m}`;
}

interface EnnajdState {
  students: Student[];
  sessions: Session[];
  prices: PriceEntry[];
  attendanceRecords: AttendanceRecord[];
  payments: Payment[];
  messages: LevelMessage[];
  lastPaymentsSyncDateKey: string | null;
  hasSyncedPayments: boolean;
  hasSyncedStudents: boolean;
  hasSyncedSessions: boolean;

  addStudent: (
    student: Omit<Student, "id" | "createdAt">,
  ) => Promise<Student | null>;
  updateStudent: (id: string, patch: Partial<Omit<Student, "id">>) => Promise<boolean>;
  deleteStudent: (id: string) => Promise<boolean>;

  addSession: (session: Omit<Session, "id">) => Promise<Session | null>;
  updateSession: (id: string, patch: Partial<Omit<Session, "id">>) => Promise<boolean>;
  deleteSession: (id: string) => Promise<boolean>;

  setPrice: (entry: Omit<PriceEntry, "id">) => Promise<boolean>;
  getBasePrice: (
    level: Level,
    subject: Subject,
    track: Track | null,
    groupType: GroupType | null,
  ) => number | undefined;
  getEffectivePrice: (studentId: string, subject: Subject) => number | undefined;

  markAttendance: (
    studentId: string,
    sessionId: string,
    date: string,
    status: AttendanceStatus,
    opts?: { isGuest?: boolean; isManualOverride?: boolean },
  ) => Promise<boolean>;
  getAttendanceFor: (sessionId: string, date: string) => AttendanceRecord[];
  runAutoAbsenceSweep: (now: Date) => Promise<void>;
  sweepExpiredOneOffSessions: (now: Date) => Promise<number>;

  syncPayments: (now: Date, opts?: { force?: boolean }) => Promise<void>;
  recalculatePaymentsForStudentSubject: (
    studentId: string,
    subject: Subject,
  ) => Promise<void>;
  setPaymentPaid: (paymentId: string, isPaid: boolean) => Promise<void>;
  recordPartialPayment: (
    studentId: string,
    subject: Subject,
    amount: number,
    asOf: Date,
  ) => Promise<void>;
  adjustStudentSubjectBalance: (
    studentId: string,
    subject: Subject,
    targetRemaining: number,
    asOf: Date,
  ) => Promise<void>;
  applyInitialTuitionPayment: (
    studentId: string,
    totalPaid: number,
    asOf: Date,
  ) => Promise<void>;
  regeneratePaymentLedger: () => Promise<boolean>;
  setSubjectPaymentNote: (
    studentId: string,
    subject: Subject,
    note?: string,
  ) => void;
  updateRegistrationFee: (
    studentId: string,
    patch: { amountDue?: number; amountPaid?: number; note?: string },
  ) => void;
  settleRegistrationFee: (studentId: string) => void;
  getOutstandingInstallment: (
    studentId: string,
    subject: Subject,
    asOf: Date,
  ) => Payment | undefined;
  hasOutstandingBalance: (studentId: string, subject: Subject, asOf: Date) => boolean;

  addMessage: (
    message: Omit<LevelMessage, "id" | "createdAt" | "updatedAt">,
  ) => Promise<LevelMessage | null>;
  updateMessage: (id: string, patch: Partial<Omit<LevelMessage, "id">>) => Promise<boolean>;
  deleteMessage: (id: string) => Promise<boolean>;

  hydrateStudents: (students: Student[]) => void;
  hydrateSessions: (sessions: Session[]) => void;
  hydratePrices: (prices: PriceEntry[]) => void;
  hydrateAttendance: (records: AttendanceRecord[]) => void;
  hydratePayments: (payments: Payment[]) => void;
  hydrateMessages: (messages: LevelMessage[]) => void;
}

function makeId(): string {
  return crypto.randomUUID();
}

/**
 * Extracts the meaningful technical detail of a persistence failure —
 * Supabase/PostgREST errors carry `code`/`message`/`details`, plain Errors
 * only a `message`. Used so a payment write failure shows the REAL reason
 * (unique-constraint violation, check constraint, RLS…) instead of a generic
 * "something went wrong".
 */
function summarizePersistenceError(err: unknown): string {
  if (err && typeof err === "object") {
    const e = err as { code?: string; message?: string; details?: string };
    const parts = [e.code, e.message, e.details].filter(
      (v): v is string => typeof v === "string" && v.length > 0,
    );
    if (parts.length > 0) return parts.join(" · ");
  }
  if (err instanceof Error) return err.message;
  return String(err);
}

/**
 * Logs a payment-write failure with its full technical detail and surfaces a
 * translated toast that includes that detail, so a Supabase rejection (unique
 * constraint, `check (amount_due > 0)`, RLS…) is visible instead of swallowed.
 */
function logPaymentWriteFailure(scope: string, err: unknown): void {
  console.error(`[ennajd] ${scope} failed:`, err);
  toast.error(t("paymentSaveFailed"), {
    description: t("paymentSaveFailedDetail").replace(
      "{details}",
      summarizePersistenceError(err),
    ),
  });
}

/**
 * The store write contract: snapshot → optimistic `set` → await the doc
 * write → revert + toast on failure. Every persistence write goes through
 * here so a Supabase rejection can never silently leave the local store
 * ahead of the database (the "session/attendance vanished on refresh" bug:
 * the optimistic row was discarded by the next realtime fetch while the
 * failed insert was swallowed). `revert` restores the snapshotted slice and
 * the translated toast tells the user the truth.
 *
 * Returns `true` when the write landed, `false` when it was rolled back —
 * form dialogs awaiting an action gate their "saved" toast + close on it, so
 * a rejected write keeps the dialog open instead of faking success.
 */
async function persist<T>(
  prev: T,
  revert: (prev: T) => void,
  work: Promise<void>,
  msg: DictKey,
): Promise<boolean> {
  try {
    await work;
    return true;
  } catch (err) {
    console.error("[ennajd] persistence write failed:", err);
    revert(prev);
    toast.error(t(msg));
    return false;
  }
}

/**
 * Pure helper — computes the total tuition (MAD) for a set of enrollments
 * WITHOUT requiring a persisted student.id (used at creation time, before the
 * student doc exists). Mirrors `getEffectivePrice` + `getBasePrice`:
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

/**
 * Throttle timestamps (ms epoch) for the two reactive-layer background jobs.
 * Module-level on purpose: both jobs are idempotent, shared across every
 * caller (Dashboard tick, Payments mount, ...), and never need to trigger a
 * re-render — so they don't belong inside the reactive state itself.
 */
let lastAutoAbsenceSweepMs: number | null = null;
let lastSyncPaymentsMs: number | null = null;
let lastExpiredSweepDateKey: string | null = null;

/**
 * Generates any missing installments for a single student across all their
 * enrollments, up to `asOf`. Returns the newly-created payment rows (empty
 * when the schedule already exists). The caller is expected to commit them
 * to the local store + Firestore. This is the shared generation engine used
 * by `syncPayments`, `recordPartialPayment`, and `applyInitialTuitionPayment`
 * so future installments always exist before credit is applied.
 */
function generateInstallmentsForStudent(
  student: Student,
  asOf: Date,
  asOfKey: string,
  existingKeys: Set<string>,
  updatedAt: string,
): Payment[] {
  const generated: Payment[] = [];
  const ctxCache = new Map<string, DeliveredDatesContext>();
  const state = useEnnajdState.getState();

  for (const enrollment of student.enrollments) {
    const rule = getPaymentRuleFor(
      student.level,
      enrollment.subject,
      enrollment.groupType,
      enrollment.track,
    );
    const enrolledAt = new Date(enrollment.enrolledAt ?? student.createdAt);
    // Rule A bills from the earliest ATTENDANCE date (enrollment fallback);
    // Rule B keeps its fixed rolling cycle anchored on the enrollment date.
    const anchor =
      rule === "B"
        ? enrolledAt
        : earliestValidAttendanceDate(
            student.id,
            enrollment.subject,
            state.attendanceRecords,
            state.sessions,
            asOfKey,
          ) ?? enrolledAt;
    const fullPrice = state.getEffectivePrice(student.id, enrollment.subject);
    if (fullPrice === undefined) continue;

    const ctxKey = `${student.level}__${enrollment.subject}__${enrollment.track}__${enrollment.groupType}__${anchor.getDay()}`;
    let ctx = ctxCache.get(ctxKey);
    if (!ctx) {
      ctx = buildDeliveredDatesContext(
        state.sessions,
        state.attendanceRecords,
        {
          level: student.level,
          subject: enrollment.subject,
          track: enrollment.track,
          groupType: enrollment.groupType,
        },
        anchor,
      );
      ctxCache.set(ctxKey, ctx);
    }

    // Session-based engine (Rule A) / rolling cycle (Rule B): the schedule
    // already carries ABSOLUTE amounts (perSession × billable sessions),
    // resolved from getEffectivePrice (which honors customPrice).
    const schedule = generateScheduleFor(rule, anchor, asOf, ctx, fullPrice);
    for (const installment of schedule) {
      // MONTH-keyed guard: a moved anchor re-dates the join month onto a new
      // dueDate, and a dueDate-keyed guard would then mint a SECOND row for
      // a month that already has one (the 438 = 219 + 219 leak). Keying on
      // rule + calendar month keeps exactly one row per month; the reconcile
      // pass then corrects that row's amount + dueDate in place.
      const key = `${student.id}__${enrollment.subject}__${rule}__${installment.monthKey}`;
      if (existingKeys.has(key)) continue;
      existingKeys.add(key);
      generated.push({
        id: makeId(),
        studentId: student.id,
        subject: enrollment.subject,
        dueDate: installment.dueDate,
        month: installment.monthKey,
        isPaid: false,
        amountDue: installment.amount,
        amountPaid: 0,
        isHalfMonth: false,
        rule,
        updatedAt,
      });
    }
  }

  return generated;
}

/**
 * Single-write credit waterfall — the shared commit path for
 * `recordPartialPayment` (per-subject) and `applyInitialTuitionPayment`
 * (cross-subject, `subject === null`).
 *
 * The race this exists to kill: the old paths did TWO sequential `payments`
 * writes — an upsert of the freshly-generated installments (amountPaid: 0),
 * then a per-id `updatePaymentsBatchDoc` applying the credit waterfall.
 * Supabase realtime echoes both asynchronously; when WRITE 1's echo lands
 * AFTER WRITE 2's optimistic `set`, the store is reverted to the
 * pre-waterfall snapshot (October flips back to 0/red) even though the DB
 * already holds the credited amount. Collapsing both into ONE upsert means
 * one echo — and since the store holds byte-identical content to what that
 * echo delivers, `stableFingerprint` / `replaceIfChanged` recognise it as a
 * no-op and keep the current reference.
 *
 * Nothing touches the DB until the FULLY-waterfalled final array is computed
 * in memory. `applyCreditWaterfall` runs over the LOCAL union of the previous
 * ledger + the caller-generated rows, and the credit patches are merged onto
 * the generated rows IN PLACE — never appended as copies, which would put two
 * rows sharing one id in a single batch and trip PostgREST's "cannot affect
 * row a second time". The final array is deduped by id via a Map so each id
 * ships exactly once.
 *
 * `remaining` (unabsorbed surplus) is computed UNCONDITIONALLY and always
 * parked in `advanceBalance` when positive. The old paths only parked it
 * inside their `anyChanged` branch (and `applyInitialTuitionPayment` early-
 * returned `if (!anyChanged) return`), so when every installment was already
 * fully paid the ENTIRE payment was silently lost.
 *
 * `advanceBalance` stays a deliberate second write — it targets the
 * `students` table (a different realtime channel), so its echo cannot clobber
 * the payments ledger. Optimistic throughout: the store is set first and
 * rolled back to the snapshotted slices on failure.
 */
async function commitWaterfallSingleWrite(args: {
  studentId: string;
  /** null = cross-subject (applyInitialTuitionPayment). */
  subject: Subject | null;
  credit: number;
  asOfKey: string;
  updatedAt: string;
  /** Pre-computed by the caller, NOT yet in the store. */
  generated: Payment[];
  previousPayments: Payment[];
  previousStudents: Student[];
  /** applyInitialTuitionPayment rethrows so its caller stays open. */
  rethrow?: boolean;
}): Promise<void> {
  const {
    studentId,
    subject,
    credit,
    asOfKey,
    updatedAt,
    generated,
    previousPayments,
    previousStudents,
    rethrow,
  } = args;

  // 1. Pure local union of the previous ledger + the freshly-generated rows.
  // No intermediate `set` → nothing for a late echo to clobber.
  const paymentsNow = [...previousPayments, ...generated];

  // 2. Run the waterfall over the union (dueDate-ascending gap-filling).
  const { updated, remaining } = applyCreditWaterfall(
    paymentsNow,
    studentId,
    subject,
    Math.round(credit),
    asOfKey,
    updatedAt,
  );

  // 3-4. Dedup-by-id final payload. Generated rows carry their credit patch
  // IN PLACE; existing changed rows follow. Belt-and-braces Map dedup guards
  // against a generated id ever colliding with an existing one.
  const patchById = new Map(updated.map((p) => [p.id, p]));
  const generatedIds = new Set(generated.map((p) => p.id));
  const finalRows = new Map<string, Payment>(
    [
      ...generated.map((p) => patchById.get(p.id) ?? p),
      ...updated.filter((p) => !generatedIds.has(p.id)),
    ].map((p) => [p.id, p]),
  );
  const rows = [...finalRows.values()];

  // 5. Nothing happened — no gaps, no generation, no surplus. No writes at
  // all, wallet intact.
  if (rows.length === 0 && remaining === 0) return;

  // 6. ONE optimistic `set`: patch the credited existing rows, append the
  // (possibly credited) generated rows, and park the surplus — computed
  // unconditionally, fixing the latent lost-credit bug.
  const prevBalance =
    previousStudents.find((s) => s.id === studentId)?.advanceBalance ?? 0;
  const nextBalance = prevBalance + remaining;
  const generatedRows = rows.filter((p) => generatedIds.has(p.id));
  useEnnajdState.setState((s) => ({
    payments: [
      ...s.payments.map((p) => patchById.get(p.id) ?? p),
      ...generatedRows,
    ],
    students:
      remaining > 0
        ? s.students.map((st) =>
            st.id === studentId
              ? { ...st, advanceBalance: nextBalance }
              : st,
          )
        : s.students,
  }));

  try {
    // 7. The ONLY payments write. Its echo can only re-deliver content the
    // store already holds.
    if (rows.length > 0) {
      await upsertPaymentsBatchDoc(rows);
    }
    // 8. Separate table → separate realtime channel; carries the correct
    // final balance, computed once.
    if (remaining > 0) {
      await updateStudentAdvanceBalanceDoc(studentId, nextBalance);
    }
  } catch (err) {
    // 9. Roll back both slices, warn, and rethrow when the caller asked.
    useEnnajdState.setState({
      payments: previousPayments,
      students: previousStudents,
    });
    toast.error(t("paymentSaveFailed"));
    if (rethrow) throw err;
  }
}

/**
 * Pure reactive-layer guard for `hydrate*` actions. `onSnapshot` fires on
 * every local Firestore write — including a mirrored echo of our own write —
 * and hands us freshly-mapped arrays. If the mapped contents are identical to
 * what we already hold, we keep the current reference so Zustand does not
 * re-render every subscribed component for a no-op snapshot.
 *
 * Returns the array to store when contents genuinely differ, otherwise
 * `undefined` to signal "keep the current slice as-is". Real remote changes
 * still replace the reference because their mapped contents differ.
 *
 * Element identity is checked by reference first (cheap) and only falls back
 * to a content fingerprint when references differ — necessary because
 * `snapshot.docs.map(d => d.data())` mints fresh objects every time, so a
 * pure reference compare would treat every echo as a change.
 */

/**
 * Normalized JSON fingerprint of a plain record: object keys are sorted
 * recursively and `undefined` properties are dropped (mirroring how
 * Firestore round-trips documents), so a local write and its echo — which
 * may differ in key order or in stripped `undefined` fields — hash to the
 * same string.
 */
function stableFingerprint(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value) ?? "null";
  }
  if (Array.isArray(value)) {
    return `[${value
      .map((item) => (item === undefined ? "null" : stableFingerprint(item)))
      .join(",")}]`;
  }
  const record = value as Record<string, unknown>;
  const entries: string[] = [];
  for (const key of Object.keys(record).sort()) {
    const entryValue = record[key];
    if (entryValue === undefined) continue; // JSON.stringify drops these too
    entries.push(`${JSON.stringify(key)}:${stableFingerprint(entryValue)}`);
  }
  return `{${entries.join(",")}}`;
}

function replaceIfChanged<T>(current: T[], next: T[]): T[] | undefined {
  if (current === next) return undefined;
  if (current.length !== next.length) return next;
  for (let i = 0; i < current.length; i++) {
    if (
      current[i] !== next[i] &&
      stableFingerprint(current[i]) !== stableFingerprint(next[i])
    ) {
      return next;
    }
  }
  return undefined; // identical contents → keep current reference
}

export const useEnnajdState = create<EnnajdState>()((set, get) => ({
  students: [],
  sessions: [],
  prices: [],
  attendanceRecords: [],
  payments: [],
  messages: [],
  lastPaymentsSyncDateKey: null,
  hasSyncedPayments: false,
  hasSyncedStudents: false,
  hasSyncedSessions: false,

  addStudent: async (student) => {
    const createdAt = new Date().toISOString();
    const newStudent: Student = {
      ...student,
      id: makeId(),
      createdAt,
      enrollments: student.enrollments.map((e) => ({
        ...e,
        enrolledAt: e.enrolledAt ?? createdAt,
      })),
    };
    const prevStudents = get().students;
    set((state) => ({ students: [...state.students, newStudent] }));
    // Awaited: callers (StudentFormSheet) distribute tuition right after this
    // returns, and payments.student_id is an FK to this row — the insert must
    // be confirmed before any child write. Returns null on failure so the
    // form stays open.
    const ok = await persist(
      prevStudents,
      (prev) => set({ students: prev }),
      addStudentDoc(newStudent),
      "studentSaveFailed",
    );
    return ok ? newStudent : null;
  },

  updateStudent: async (id, patch) => {
    let updated: Student | undefined;
    const prevStudents = get().students;
    set((state) => ({
      students: state.students.map((s) => {
        if (s.id !== id) return s;
        if (!patch.enrollments) {
          updated = { ...s, ...patch };
          return updated;
        }
        // Stamp enrolledAt = now only on genuinely new subjects; keep the
        // original enrolledAt (and thus billing history) for the rest.
        const now = new Date().toISOString();
        const stampedEnrollments: SubjectEnrollment[] = patch.enrollments.map(
          (e) => {
            const existing = s.enrollments.find((prev) => prev.subject === e.subject);
            return { ...e, enrolledAt: existing?.enrolledAt ?? e.enrolledAt ?? now };
          },
        );
        updated = { ...s, ...patch, enrollments: stampedEnrollments };
        return updated;
      }),
    }));
    if (updated) {
      return await persist(
        prevStudents,
        (prev) => set({ students: prev }),
        updateStudentDoc(id, updated),
        "studentSaveFailed",
      );
    }
    return false;
  },

  deleteStudent: async (id) => {
    const prevStudents = get().students;
    set((state) => ({
      students: state.students.filter((s) => s.id !== id),
    }));
    return await persist(
      prevStudents,
      (prev) => set({ students: prev }),
      deleteStudentDoc(id),
      "studentDeleteFailed",
    );
  },

  addSession: async (session) => {
    const newSession: Session = { ...session, id: makeId() };
    const prevSessions = get().sessions;
    set((state) => ({ sessions: [...state.sessions, newSession] }));
    // Awaited: attendance_records.session_id is an FK to this row, so the
    // insert must land before any attendance write against it. Returns null
    // on failure so the form stays open.
    const ok = await persist(
      prevSessions,
      (prev) => set({ sessions: prev }),
      addSessionDoc(newSession),
      "sessionSaveFailed",
    );
    return ok ? newSession : null;
  },

  updateSession: async (id, patch) => {
    const prevSessions = get().sessions;
    set((state) => ({
      sessions: state.sessions.map((s) =>
        s.id === id ? { ...s, ...patch } : s,
      ),
    }));
    return await persist(
      prevSessions,
      (prev) => set({ sessions: prev }),
      updateSessionDoc(id, patch),
      "sessionSaveFailed",
    );
  },

  deleteSession: async (id) => {
    const prevSessions = get().sessions;
    set((state) => ({
      sessions: state.sessions.filter((s) => s.id !== id),
    }));
    return await persist(
      prevSessions,
      (prev) => set({ sessions: prev }),
      deleteSessionDoc(id),
      "sessionDeleteFailed",
    );
  },

  setPrice: async (entry) => {
    let savedEntry: PriceEntry | undefined;
    const prevPrices = get().prices;
    set((state) => {
      const existing = state.prices.find(
        (p) =>
          p.level === entry.level &&
          p.subject === entry.subject &&
          p.track === entry.track &&
          p.groupType === entry.groupType,
      );
      if (existing) {
        savedEntry = { ...existing, price: entry.price };
        return {
          prices: state.prices.map((p) =>
            p.id === existing.id ? savedEntry! : p,
          ),
        };
      }
      savedEntry = { ...entry, id: makeId() };
      return {
        prices: [...state.prices, savedEntry],
      };
    });
    if (savedEntry) {
      return await persist(
        prevPrices,
        (prev) => set({ prices: prev }),
        setPriceDoc(savedEntry),
        "priceSaveFailed",
      );
    }
    return false;
  },

  getBasePrice: (level, subject, track, groupType) => {
    return get().prices.find(
      (p) =>
        p.level === level &&
        p.subject === subject &&
        p.track === track &&
        p.groupType === groupType,
    )?.price;
  },

  getEffectivePrice: (studentId, subject) => {
    const student = get().students.find((s) => s.id === studentId);
    if (!student) return undefined;
    const enrollment = student.enrollments.find(
      (e: SubjectEnrollment) => e.subject === subject,
    );
    if (!enrollment) return undefined;
    if (enrollment.customPrice !== undefined) return enrollment.customPrice;
    // Track and group type now live directly on the enrollment — no
    // session lookup needed anymore.
    return get().getBasePrice(student.level, subject, enrollment.track, enrollment.groupType);
  },

  markAttendance: async (studentId, sessionId, date, status, opts) => {
    let savedRecord: AttendanceRecord | undefined;
    // Snapshot BEFORE the optimistic set so a failed write can revert the
    // chip exactly (attendance stays snappy; failures self-heal).
    const prevAttendance = get().attendanceRecords;
    set((state) => {
      const existing = state.attendanceRecords.find(
        (r) =>
          r.studentId === studentId &&
          r.sessionId === sessionId &&
          r.date === date,
      );
      // The auto-absence path must never overwrite an existing record
      // (in particular, never overwrite a manual Present). Manual clicks
      // pass isManualOverride to explicitly allow replacing it.
      if (existing && !opts?.isManualOverride) {
        return state;
      }
      const now = new Date();
      const record: AttendanceRecord = {
        id: existing?.id ?? makeId(),
        studentId,
        sessionId,
        date,
        status,
        markedAt: now.toISOString(),
        timestamp: formatTimeKey(now),
        isGuest: opts?.isGuest ?? existing?.isGuest,
      };
      savedRecord = record;
      if (existing) {
        return {
          attendanceRecords: state.attendanceRecords.map((r) =>
            r.id === existing.id ? record : r,
          ),
        };
      }
      return {
        attendanceRecords: [...state.attendanceRecords, record],
      };
    });
    if (savedRecord) {
      const ok = await persist(
        prevAttendance,
        (prev) => set({ attendanceRecords: prev }),
        markAttendanceDoc(savedRecord),
        "attendanceSaveFailed",
      );
      // REACTIVE LEDGER: an attendance mark can move the billing anchor, so
      // re-derive this student+subject's installments once the write lands.
      // Deferred + failure-isolated: the chip write returns immediately and
      // a recalc failure never blocks the attendance action itself.
      if (ok) {
        const session = get().sessions.find((s) => s.id === sessionId);
        if (session) {
          queueMicrotask(() => {
            void get()
              .recalculatePaymentsForStudentSubject(studentId, session.subject)
              .catch((err) => {
                console.error("[ennajd] reactive ledger recalc failed:", err);
                toast.warning(t("ledgerRecalcFailed"));
              });
          });
        }
      }
      return ok;
    }
    return false;
  },

  getAttendanceFor: (sessionId, date) => {
    return get().attendanceRecords.filter(
      (r) => r.sessionId === sessionId && r.date === date,
    );
  },

  runAutoAbsenceSweep: async (now) => {
    // Throttle to once per minute to avoid unnecessary computations
    const nowMs = now.getTime();
    if (lastAutoAbsenceSweepMs !== null && nowMs - lastAutoAbsenceSweepMs < 60_000) {
      return;
    }
    lastAutoAbsenceSweepMs = nowMs;

    // Idempotent: markAttendance never overwrites an existing record,
    // so re-running this on every tick is safe and only fills gaps.
    const state = get();
    const todayKey = formatDateKey(now);
    const dueSessions = state.sessions.filter((session) =>
      isOneOffSession(session)
        ? shouldAutoMarkAbsentOneOff(session, now)
        : shouldAutoMarkAbsent(session, now),
    );
    if (dueSessions.length === 0) return;

    // One index shared by all due sessions: today's records keyed by
    // student+session, so each existence check is an O(1) lookup instead
    // of a full scan of the attendance array.
    const existingKeys = new Set(
      state.attendanceRecords
        .filter((r) => r.date === todayKey)
        .map((r) => `${r.studentId}__${r.sessionId}`),
    );

    const newRecords: AttendanceRecord[] = [];
    for (const session of dueSessions) {
      const enrolledStudentIds = getEnrolledStudentsForSession(
        state.students,
        session,
      ).map((student) => student.id);

      for (const studentId of enrolledStudentIds) {
        if (!existingKeys.has(`${studentId}__${session.id}`)) {
          newRecords.push({
            id: makeId(),
            studentId,
            sessionId: session.id,
            date: todayKey,
            status: "absent",
            markedAt: now.toISOString(),
            timestamp: formatTimeKey(now),
          });
        }
      }
    }

    if (newRecords.length > 0) {
      const prevAttendance = get().attendanceRecords;
      set((s) => ({
        attendanceRecords: [...s.attendanceRecords, ...newRecords],
      }));
      // One batched commit instead of N individual setDoc calls → one
      // snapshot echo instead of N. Awaited so an offline failure reverts
      // the local sweep instead of leaving it ahead of the DB.
      await persist(
        prevAttendance,
        (prev) => set({ attendanceRecords: prev }),
        upsertAttendanceBatchDoc(newRecords),
        "attendanceSaveFailed",
      );
    }
  },

  sweepExpiredOneOffSessions: async (now) => {
    const todayKey = formatDateKey(now);
    if (lastExpiredSweepDateKey === todayKey) return 0;
    lastExpiredSweepDateKey = todayKey;
    const state = get();
    const expired = state.sessions.filter(
      (s) => isOneOffSession(s) && s.date && s.date < todayKey,
    );
    if (expired.length === 0) return 0;
    const expiredIds = new Set(expired.map((s) => s.id));
    const prevSessions = get().sessions;
    set((cur) => ({
      sessions: cur.sessions.filter((s) => !expiredIds.has(s.id)),
    }));
    await persist(
      prevSessions,
      (prev) => set({ sessions: prev }),
      Promise.all(expired.map((s) => deleteSessionDoc(s.id))).then(() =>
        undefined,
      ),
      "sessionDeleteFailed",
    );
    return expired.length;
  },

  syncPayments: async (now, opts) => {
    // Guards run BEFORE the throttle is consumed, so an early bail (not yet
    // hydrated / no students) does not block a later deferred retry.

    // NEVER generate before the payments listener has hydrated at least once.
    // On a fresh page load the local `payments` array is empty (there is no
    // localStorage cache) while the Firestore snapshot that fills it arrives
    // asynchronously — later than the `runWhenIdle(syncPayments)` fired on
    // page mount. Treating that empty array as "no schedule generated yet"
    // rebuilt the whole schedule with fresh random ids on every load, which is
    // how one installment multiplied into ~70 identical rows. `hydratePayments`
    // re-invokes this once the real ledger lands, so bailing here loses nothing.
    if (!get().hasSyncedPayments) return;

    // Guard after a full console wipe: when students is empty there's nothing
    // to bill, and we must not re-create orphan payments that the badge would
    // then intentionally ignore via the studentsById guard.
    const state = get();
    if (state.students.length === 0) return;

    // `force` (the attendance/reactive path) bypasses BOTH throttles so a
    // re-anchor reacts immediately; every other caller keeps the
    // once-per-minute + once-per-calendar-day guards.
    const force = opts?.force === true;

    // Throttle to once per minute to avoid unnecessary computations
    const nowMs = now.getTime();
    if (!force && lastSyncPaymentsMs !== null && nowMs - lastSyncPaymentsMs < 60_000) {
      return;
    }
    lastSyncPaymentsMs = nowMs;

    // Throttled to once per calendar day: the full students × enrollments
    // scan below only ever produces new rows when a new day/month/
    // enrollment appears, so re-running it every 30s tick is wasted work.
    const todayKey = formatDateKey(now);
    if (!force && state.lastPaymentsSyncDateKey === todayKey) return;
    set({ lastPaymentsSyncDateKey: todayKey });

    // Snapshot BOTH slices before any optimistic update so a failed write
    // can revert generated installments AND advanceBalance changes together.
    const previousPayments = state.payments;
    const previousStudents = state.students;

    const existingKeys = new Set(
      state.payments.map((p) => `${p.studentId}__${p.subject}__${p.rule}__${p.month}`),
    );
    const newPayments: Payment[] = [];
    // Advance-credit patches on EXISTING ledger rows — persisted via per-id
    // UPDATE after the reconcile pass, so they never share an id with the
    // rows in `newPayments` inside the batch upsert.
    const creditPatches: Array<Pick<Payment, "id"> & Partial<Payment>> = [];
    const advanceBalanceUpdates: Array<{
      studentId: string;
      nextBalance: number;
    }> = [];

    for (const student of state.students) {
      const prevAdvanceBalance = student.advanceBalance ?? 0;

      // Reuse the shared generator so future installments always exist
      // before we try to consume advance credit on them.
      const generateThrough = new Date(now);
      generateThrough.setMonth(generateThrough.getMonth() + 1);
      const studentGenerated = generateInstallmentsForStudent(
        student,
        generateThrough,
        todayKey,
        existingKeys,
        now.toISOString(),
      );

      // CONSUME ADVANCE CREDIT: apply any existing advanceBalance to the
      // earliest non-fully-paid installments across all subjects, sorted by
      // dueDate ascending. Surplus that can't be absorbed by newly-generated
      // installments remains as advanceBalance for next sync.
      if (prevAdvanceBalance > 0) {
        const allStudentPayments = [
          ...state.payments.filter((p) => p.studentId === student.id),
          ...studentGenerated,
        ];
        const { updated, remaining } = applyCreditWaterfall(
          allStudentPayments,
          student.id,
          null,
          prevAdvanceBalance,
          todayKey,
          now.toISOString(),
        );

        if (updated.length > 0) {
          // Apply the credit IN PLACE, never by appending: a patched row is
          // either an EXISTING ledger row or one of the generated rows about
          // to be appended. Appending full copies duplicates ids, which both
          // breaks the one-row-per-month invariant (the red panel then sums
          // the stale and the credited copy) and puts two rows sharing a
          // primary key in the batch upsert — PostgREST rejects that with
          // "cannot affect row a second time", rolling back the WHOLE commit
          // and stranding the carryover in the wallet (Oct then re-shows its
          // full amount in red, ignoring the credit).
          const patchById = new Map(updated.map((p) => [p.id, p]));
          set((s) => ({
            payments: s.payments.map((p) => patchById.get(p.id) ?? p),
            students: s.students.map((s2) =>
              s2.id === student.id
                ? { ...s2, advanceBalance: remaining }
                : s2,
            ),
          }));
          // The generated rows ride along in newPayments — carry their patch
          // onto the copy that actually gets appended + upserted.
          for (let i = 0; i < studentGenerated.length; i++) {
            const patched = patchById.get(studentGenerated[i].id);
            if (patched) studentGenerated[i] = patched;
          }
          // Persist the credit on EXISTING rows via per-id UPDATE (same path
          // recordPartialPayment uses) — the batch upsert would duplicate
          // their ids. Generated rows are persisted through newPayments.
          const generatedIds = new Set(studentGenerated.map((p) => p.id));
          for (const u of updated) {
            if (!generatedIds.has(u.id)) creditPatches.push(u);
          }
          // Collect for persistence — the missing write that used to lose
          // carried-forward credit on refresh.
          advanceBalanceUpdates.push({
            studentId: student.id,
            nextBalance: remaining,
          });
        }
      }

      newPayments.push(...studentGenerated);
    }

    // SELF-HEAL: make the Rule A ledger AUTHORITATIVE. Beyond patching rows
    // whose amount drifted (price/timetable edits, engine migration), this
    // also deletes Rule A rows the engine would no longer emit at all — a
    // removed timetable/enrollment/price, a gap month, or a month predating
    // enrollment. Those stale rows are what kept showing an old full-price
    // month on the board after the rewrite. Rule B rows are never touched;
    // a patched row keeps its amountPaid and stays paid only when that paid
    // amount covers the NEW amountDue. Reads the CURRENT ledger so the
    // advance-credit patches applied in the loop above survive the rebuild.
    const currentPayments = get().payments;
    const reconcile = reconcileRuleALedger(
      currentPayments,
      get().students,
      get().sessions,
      get().prices,
      get().attendanceRecords,
      todayKey,
    );
    // Rebuilt rows for the DB upsert — kept OUT of `newPayments` so they
    // are never appended twice to the local ledger (they are applied
    // in place by the map below).
    const reconciledPayments: Payment[] = [];
    const deletedPaymentIds: string[] = reconcile.delete;

    if (reconcile.update.length > 0) {
      const reconcileById = new Map(reconcile.update.map((p) => [p.id, p]));
      for (const patch of reconcile.update) {
        const existing = currentPayments.find((p) => p.id === patch.id);
        if (!existing) continue;
        reconciledPayments.push({
          ...existing,
          amountDue: patch.amountDue,
          dueDate: patch.dueDate,
          amountPaid: patch.amountPaid,
          isPaid: patch.isPaid,
          updatedAt: now.toISOString(),
        });
      }
      set((s) => ({
        payments: s.payments.map((p) => {
          const patch = reconcileById.get(p.id);
          return patch
            ? {
                ...p,
                amountDue: patch.amountDue,
                dueDate: patch.dueDate,
                amountPaid: patch.amountPaid,
                isPaid: patch.isPaid,
                updatedAt: now.toISOString(),
              }
            : p;
        }),
      }));
    }
    if (deletedPaymentIds.length > 0) {
      const deletedSet = new Set(deletedPaymentIds);
      set((s) => ({
        payments: s.payments.filter((p) => !deletedSet.has(p.id)),
      }));
    }

    if (
      newPayments.length === 0 &&
      reconciledPayments.length === 0 &&
      deletedPaymentIds.length === 0 &&
      creditPatches.length === 0
    ) {
      return;
    }

    set((s) => ({ payments: [...s.payments, ...newPayments] }));
    // Generated installments + advanceBalance consumptions are ONE logical
    // change: commit both, or revert both slices together so the local store
    // never diverges from the DB.
    try {
      // DELETE BEFORE UPSERT: collapsing a month can RE-DATE the surviving
      // row onto a `due_date` a surplus row still occupies. Deleting the
      // surplus first keeps the unique(student_id, subject, due_date)
      // constraint satisfiable — upserting first would trip it and the
      // whole batch would roll back.
      if (deletedPaymentIds.length > 0) {
        await deletePaymentsBatchDoc(deletedPaymentIds);
      }
      const upsertRows = [...newPayments, ...reconciledPayments];
      if (upsertRows.length > 0) {
        await upsertPaymentsBatchDoc(upsertRows);
      }
      // Credit applied to existing rows by the advance-consumption pass —
      // patched per-id so it never collides with the upsert batch above.
      if (creditPatches.length > 0) {
        await updatePaymentsBatchDoc(creditPatches);
      }
      for (const { studentId, nextBalance } of advanceBalanceUpdates) {
        // The missing write that used to lose carried-forward credit on
        // refresh — the balance is only local until this lands.
        await updateStudentAdvanceBalanceDoc(studentId, nextBalance);
      }
    } catch (err) {
      logPaymentWriteFailure("syncPayments", err);
      set({ payments: previousPayments, students: previousStudents });
    }
  },

  /**
   * REACTIVE LEDGER — re-derives ONE student+subject's Rule A installments
   * from the attendance anchor (earliest valid attendance date, enrollment
   * fallback) and redistributes that subject's paid credit earliest-first
   * across the following months. Triggered (deferred) by every attendance
   * write, so the Payments page ledger follows attendance marks without a
   * reload. Rule B (2Bac s.x Small) is untouched.
   *
   * A forced `syncPayments` runs first — the attendance path's throttle
   * bypass — so the rest of the student's ledger is current (future
   * installments exist, advance credit consumed) before the targeted
   * rebuild. Both passes are idempotent, so repeated triggers are safe.
   * Failures revert + warn and never block the attendance write.
   */
  recalculatePaymentsForStudentSubject: async (studentId, subject) => {
    // Never run before the ledger has hydrated — an empty local `payments`
    // array would make the rebuild mint fresh ids for rows that still exist
    // remotely (the same dedupe hazard `syncPayments` guards against).
    if (!get().hasSyncedPayments) return;

    const student = get().students.find((s) => s.id === studentId);
    if (!student) return;

    const now = new Date();
    const asOfKey = formatDateKey(now);
    // Same horizon as `syncPayments` (now + 1 month) so the credit cascade
    // has future installments to land on.
    const asOf = new Date(now);
    asOf.setMonth(asOf.getMonth() + 1);

    // The attendance path's forced sync — bypasses the daily throttle,
    // leaving every other caller's guard untouched.
    await get().syncPayments(now, { force: true });

    // Re-read after the sync so the rebuild sees the current ledger.
    const state = get();
    const current = state.students.find((s) => s.id === studentId);
    if (!current) return;

    const result = recalculateStudentSubjectLedger(current, subject, {
      payments: state.payments,
      sessions: state.sessions,
      attendanceRecords: state.attendanceRecords,
      prices: state.prices,
      asOf,
      asOfKey,
      updatedAt: now.toISOString(),
    });

    if (
      result.toDelete.length === 0 &&
      result.toUpsert.length === 0 &&
      result.remainingCredit === 0
    ) {
      return;
    }

    const previousPayments = state.payments;
    const previousStudents = state.students;
    const upsertById = new Map(result.toUpsert.map((p) => [p.id, p]));
    const deleteSet = new Set(result.toDelete);
    let nextAdvanceBalance: number | undefined;

    // Apply the diff in place: drop non-billable months, patch changed rows,
    // append genuinely-new ones.
    set((s) => {
      const existingIds = new Set(s.payments.map((p) => p.id));
      const appended = result.toUpsert.filter((p) => !existingIds.has(p.id));
      return {
        payments: s.payments
          .filter((p) => !deleteSet.has(p.id))
          .map((p) => upsertById.get(p.id) ?? p)
          .concat(appended),
      };
    });

    // Credit the rebuilt installments could not absorb → carried forward.
    if (result.remainingCredit > 0) {
      const prevBalance =
        get().students.find((s) => s.id === studentId)?.advanceBalance ?? 0;
      nextAdvanceBalance = prevBalance + result.remainingCredit;
      set((s) => ({
        students: s.students.map((st) =>
          st.id === studentId
            ? { ...st, advanceBalance: nextAdvanceBalance as number }
            : st,
        ),
      }));
    }

    try {
      // DELETE BEFORE UPSERT: a re-anchor can move a row's dueDate onto a
      // date a stale row still occupies. Deleting first keeps the
      // unique(student_id, subject, due_date) constraint satisfiable —
      // upserting first would trip it and the whole batch would roll back.
      if (result.toDelete.length > 0) {
        await deletePaymentsBatchDoc(result.toDelete);
      }
      if (result.toUpsert.length > 0) {
        await upsertPaymentsBatchDoc(result.toUpsert);
      }
      if (nextAdvanceBalance !== undefined) {
        await updateStudentAdvanceBalanceDoc(studentId, nextAdvanceBalance);
      }
    } catch (err) {
      console.error("[ennajd] reactive ledger recalc write failed:", err);
      set({ payments: previousPayments, students: previousStudents });
      toast.warning(t("ledgerRecalcFailed"), {
        description: t("paymentSaveFailedDetail").replace(
          "{details}",
          summarizePersistenceError(err),
        ),
      });
      return;
    }

    // Confirm only when an installment actually moved.
    if (result.toDelete.length > 0 || result.toUpsert.length > 0) {
      const name = `${current.firstName} ${current.lastName}`;
      toast.success(t("ledgerRecalculated").replace("{student}", name));
    }
  },

  setPaymentPaid: async (paymentId, isPaid) => {
    const updatedAt = new Date().toISOString();
    const previous = get().payments;
    set((state) => ({
      payments: state.payments.map((p) =>
        p.id === paymentId ? { ...p, isPaid, updatedAt } : p,
      ),
    }));
    try {
      await setPaymentPaidDoc(paymentId, isPaid, updatedAt);
    } catch (err) {
      set({ payments: previous });
      toast.error(t("paymentSaveFailed"));
    }
  },

  recordPartialPayment: async (studentId, subject, amount, asOf) => {
    if (!(amount > 0)) return;
    const asOfKey = formatDateKey(asOf);
    const updatedAt = new Date().toISOString();
    const state = get();

    // Snapshot BOTH payments AND students (for advanceBalance revert) before
    // the optimistic update, per the rollback-on-failure contract.
    const previousPayments = state.payments;
    const previousStudents = state.students;
    const student = previousStudents.find((s) => s.id === studentId);
    if (!student) return;

    // Ensure future installments exist for THIS student+subject before
    // applying the waterfall, so surplus has somewhere to land. Generate
    // one extra month beyond asOf so a partial can reach a future invoice.
    const existingKeys = new Set(
      previousPayments
        .filter((p) => p.studentId === studentId && p.subject === subject)
        .map((p) => `${p.studentId}__${p.subject}__${p.rule}__${p.month}`),
    );
    // Generate one month ahead so the surplus can land on next month's bill.
    const generateThrough = new Date(asOf);
    generateThrough.setMonth(generateThrough.getMonth() + 2);
    const futureInstallments = generateInstallmentsForStudent(
      student,
      generateThrough,
      asOfKey,
      existingKeys,
      updatedAt,
    );
    // Filter to just the target subject (generateInstallmentsForStudent is
    // cross-subject for applyInitialTuitionPayment, but here we need per-subject).
    const filteredGenerated = futureInstallments.filter(
      (p) => p.subject === subject,
    );

    // Single-write waterfall: the credit is merged onto the final rows fully
    // in memory and committed in ONE upsert, so the realtime echo can only
    // ever re-deliver the waterfalled state — never a pre-credit snapshot
    // that flips a credited month back to red.
    await commitWaterfallSingleWrite({
      studentId,
      subject,
      credit: amount,
      asOfKey,
      updatedAt,
      generated: filteredGenerated,
      previousPayments,
      previousStudents,
    });
  },

/**
 * Pencil dialog action — lands the student+subject's DUE remaining exactly
 * on `targetRemaining`, without ever touching strictly-future auto-generated
 * installments (Reste guard: dueDate <= asOf only). The target is clamped to
 * [0, Σ amountDue of due installments].
 *
 * "Remaining" follows the app-wide semantics: an installment counts as owed
 * only when it is NOT fully paid (neither `isPaid` flag nor amountPaid
 * covering amountDue) — identical to getDueBalanceForStudentSubject /
 * aggregateOverdueInstallments, so the Impayés/Payés panels, bell and PDFs
 * all agree.
 *
 * Down (target < current): credit spread earliest-first across due unpaid
 * installments — the same waterfall as recordPartialPayment.
 * Up (target > current): covered due installments are un-settled LATEST-first
 * (flag first, then paid credit), optionally retaining partial credit, to
 * land exactly on the target. All patches ship in ONE batch commit.
 */
adjustStudentSubjectBalance: async (studentId, subject, targetRemaining, asOf) => {
  if (!Number.isFinite(targetRemaining) || targetRemaining < 0) return;
  const asOfKey = formatDateKey(asOf);
  const updatedAt = new Date().toISOString();

  const isSettled = (p: Payment) =>
    p.isPaid || (p.amountPaid ?? 0) >= p.amountDue;
  const remainingOf = (p: Payment) =>
    Math.max(0, p.amountDue - (p.amountPaid ?? 0));

  // Every installment due as of `asOf` (paid or not), dueDate ascending.
  const duePayments = get()
    .payments.filter(
      (p) => p.studentId === studentId && p.subject === subject && p.dueDate <= asOfKey,
    )
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate));

  const totalDueAmount = duePayments.reduce((sum, p) => sum + p.amountDue, 0);
  const currentRemaining = duePayments.reduce(
    (sum, p) => sum + (isSettled(p) ? 0 : remainingOf(p)),
    0,
  );
  const target = Math.min(Math.round(targetRemaining), totalDueAmount);

  if (target === currentRemaining) return;

  const nextPayments: Payment[] = [];
  const patches: Array<Pick<Payment, "id"> & Partial<Payment>> = [];

  const applyPatch = (payment: Payment, amountPaid: number, isPaid: boolean) => {
    nextPayments.push({ ...payment, amountPaid, isPaid, updatedAt });
    patches.push({ id: payment.id, amountPaid, isPaid, updatedAt });
  };

  if (target < currentRemaining) {
    // Credit waterfall, earliest-first (same spread as recordPartialPayment).
    let credit = currentRemaining - target;
    for (const payment of duePayments) {
      if (credit <= 0) break;
      if (isSettled(payment)) continue;
      const remaining = remainingOf(payment);
      if (remaining <= 0) continue;
      const apply = Math.min(remaining, credit);
      const amountPaid = (payment.amountPaid ?? 0) + apply;
      applyPatch(payment, amountPaid, amountPaid >= payment.amountDue);
      credit -= apply;
    }
  } else {
    // Undo walk, LATEST-first. A settled row can raise its remaining from 0
    // up to amountDue by converting to partial credit (isPaid → false +
    // amountPaid = amountDue − raise), exactly as the plan specifies. An
    // unsettled partial row can only shed its existing paid credit.
    let toRaise = target - currentRemaining;
    for (let i = duePayments.length - 1; i >= 0 && toRaise > 0; i--) {
      const payment = duePayments[i];
      const settled = isSettled(payment);
      const paid = payment.amountPaid ?? 0;
      const capacity = settled ? payment.amountDue : paid;
      if (capacity <= 0) continue;

      const raise = Math.min(capacity, toRaise);
      const nextPaid = settled ? payment.amountDue - raise : paid - raise;
      applyPatch(payment, nextPaid, false);
      toRaise -= raise;
    }
  }

  if (patches.length === 0) return;

  const nextById = new Map(nextPayments.map((p) => [p.id, p]));
  const previous = get().payments;
  set((state) => ({
    payments: state.payments.map((p) => nextById.get(p.id) ?? p),
  }));
  try {
    await updatePaymentsBatchDoc(patches);
  } catch (err) {
    set({ payments: previous });
    toast.error(t("paymentSaveFailed"));
  }
},

/**
 * Create-time tuition payment — called by `StudentFormSheet` right after a new
 * student is created. Distributes `totalPaid` across ALL of the student's
 * subjects in a single earliest-due-first waterfall (same ordering as
 * `recordPartialPayment`: dueDate then subject locale), only crediting
 * installments that are already due (dueDate <= asOfKey — the Reste guard),
 * never future auto-generated months.
 *
 * This is a cross-subject generalization of `recordPartialPayment`: instead
 * of filtering to one subject, it scans every subject of the student, so a
 * single credit can spill from a Math installment into a PC installment when
 * the first subject's due installments are exhausted. Surplus that can't be
 * absorbed by any installment is stored as `advanceBalance` on the student.
 *
 * Optimistic local update (snapshot + rollback on failure), then a single
 * `updatePaymentsBatchDoc` commit. On failure the caller (StudentFormSheet)
 * stays open; the error toast is fired here and the local snapshot reverted.
 */
  applyInitialTuitionPayment: async (studentId, totalPaid, asOf) => {
    const asOfKey = formatDateKey(asOf);
    const updatedAt = new Date().toISOString();

    if (!Number.isFinite(totalPaid) || totalPaid <= 0) return;

    // Snapshot BOTH payments AND students (for advanceBalance revert) before
    // the optimistic update, per the rollback-on-failure contract.
    const previousPayments = get().payments;
    const previousStudents = get().students;
    const student = previousStudents.find((s) => s.id === studentId);
    if (!student) return;

    // Ensure installments exist for this student before distributing credit.
    // `syncPayments` is throttled to once/day + once/min and may not have run
    // yet for the just-created student (the realtime echo is async). Generate
    // inline for this student only — `syncPayments`' `existingKeys` dedupe
    // means these rows are skipped on the next full sync, and `hydratePayments`
    // + `dedupePayments` collapse any realtime duplicates.
    const existingKeys = new Set(
      previousPayments
        .filter((p) => p.studentId === studentId)
        .map((p) => `${p.studentId}__${p.subject}__${p.rule}__${p.month}`),
    );
    const generateThrough = new Date(asOf);
    generateThrough.setMonth(generateThrough.getMonth() + 2);
    const generated = generateInstallmentsForStudent(
      student,
      generateThrough,
      asOfKey,
      existingKeys,
      updatedAt,
    );

    // Single-write cross-subject waterfall: the credit is merged onto the
    // final rows fully in memory and committed in ONE upsert, so the realtime
    // echo can only re-deliver the waterfalled state. The old early
    // `if (!anyChanged) return` is gone — the helper's own empty-payload guard
    // replaces it, and unabsorbed surplus now always reaches advanceBalance
    // instead of being silently dropped when every installment was paid.
    await commitWaterfallSingleWrite({
      studentId,
      subject: null, // cross-subject
      credit: totalPaid,
      asOfKey,
      updatedAt,
      generated,
      previousPayments,
      previousStudents,
      rethrow: true,
    });
  },

  /**
   * Manual "recalculate installments" action — deletes every Rule A row and
   * rebuilds it from scratch with the session-based engine, keeping Rule B
   * rows untouched. Used to settle old balances immediately after a price or
   * timetable change, without waiting for the daily `syncPayments` self-heal.
   *
   * Payment progress is preserved per (student, subject, month): the amount
   * already paid on the deleted rows of that month is carried onto the
   * rebuilt row (capped at the new amountDue), and `isPaid` is recomputed
   * strictly from that paid amount.
   *
   * Optimistic local update (snapshot + rollback on failure). Callers ask
   * the user to confirm first — the whole Rule A ledger is rewritten.
   */
  regeneratePaymentLedger: async () => {
    if (!get().hasSyncedPayments) return false;

    const previousPayments = get().payments;
    const previousStudents = get().students;

    // Keep every Rule B row; the Rule A rows are fully rebuilt.
    const keptPayments = previousPayments.filter((p) => p.rule !== "A");
    const deletedRuleA = previousPayments.filter((p) => p.rule === "A");

    // Paid progress per (student, subject, month), so a rebuilt row for the
    // same month keeps what was already paid on the deleted rows.
    const paidByMonth = new Map<string, number>();
    for (const p of deletedRuleA) {
      const key = `${p.studentId}__${p.subject}__${p.month}`;
      paidByMonth.set(key, (paidByMonth.get(key) ?? 0) + (p.amountPaid ?? 0));
    }

    const now = new Date();
    const updatedAt = now.toISOString();
    const todayKey = formatDateKey(now);
    const generateThrough = new Date(now);
    generateThrough.setMonth(generateThrough.getMonth() + 1);

    const existingKeys = new Set(
      keptPayments.map((p) => `${p.studentId}__${p.subject}__${p.rule}__${p.month}`),
    );
    const rebuilt: Payment[] = [];
    for (const student of get().students) {
      const generated = generateInstallmentsForStudent(
        student,
        generateThrough,
        todayKey,
        existingKeys,
        updatedAt,
      );
      for (const payment of generated) {
        // Only genuinely-missing rows are generated (existingKeys dedupes the
        // kept Rule B rows). Restore the prior payment progress for that month.
        const paidKey = `${payment.studentId}__${payment.subject}__${payment.month}`;
        const carriedPaid = Math.min(paidByMonth.get(paidKey) ?? 0, payment.amountDue);
        rebuilt.push(
          carriedPaid > 0
            ? { ...payment, amountPaid: carriedPaid, isPaid: carriedPaid >= payment.amountDue }
            : payment,
        );
      }
    }

    // Guard the DB constraints before writing:
    //  - unique(student_id, subject, due_date): the ledger keeps exactly ONE
    //    row per (rule, month) — a dueDate determines its month, so
    //    collapsing by rule + month also removes every dueDate collision.
    //    Keep the most settled row.
    //  - check (amount_due > 0): a zero/negative amount (free join month,
    //    zero price) must never be inserted.
    const deduped = new Map<string, Payment>();
    for (const payment of rebuilt) {
      if (payment.amountDue <= 0) continue;
      const key = `${payment.studentId}__${payment.subject}__${payment.rule}__${payment.month}`;
      const current = deduped.get(key);
      if (!current) {
        deduped.set(key, payment);
      } else {
        const keep = isMoreSettledPayment(payment, current) ? payment : current;
        deduped.set(key, keep);
      }
    }
    const rebuiltRows = [...deduped.values()];

    const nextPayments = [...keptPayments, ...rebuiltRows];
    set({ payments: nextPayments });

    try {
      // DELETE BEFORE UPSERT: the rebuilt rows reuse the natural key of the
      // deleted ones, so the Rule A rows must be gone before the inserts
      // land or the unique constraint rejects the batch.
      if (deletedRuleA.length > 0) {
        await deletePaymentsBatchDoc(deletedRuleA.map((p) => p.id));
      }
      if (rebuiltRows.length > 0) {
        await upsertPaymentsBatchDoc(rebuiltRows);
      }
      return true;
    } catch (err) {
      logPaymentWriteFailure("regeneratePaymentLedger", err);
      set({ payments: previousPayments, students: previousStudents });
      return false;
    }
  },

/**
 * Pencil dialog action — writes/clears the free-text `paymentNote` on the
 * student's enrollment for that subject, reusing `updateStudent`'s
 * enrolledAt-stamping logic so billing history is never disturbed.
 */
setSubjectPaymentNote: (studentId, subject, note) => {
  const student = get().students.find((s) => s.id === studentId);
  if (!student) return;
  const enrollment = student.enrollments.find((e) => e.subject === subject);
  if (!enrollment) return;

  const trimmed = note?.trim();
  const nextNote = trimmed ? trimmed : undefined;
  if ((enrollment.paymentNote ?? undefined) === nextNote) return;

  get().updateStudent(studentId, {
    enrollments: student.enrollments.map((e) =>
      e.subject === subject ? { ...e, paymentNote: nextNote } : e,
    ),
  });
},

/**
 * Registration fee (رسوم التسجيل) — one-time 100 DH, completely separate
 * from the Rule A/B installment engine (never flows into installment
 * totals). Merges the patch over the existing fee (or the legacy default
 * {due: 100, paid: 0} for students with no stored field), clamps paid to
 * [0, due], stamps settledAt on full payment (kept when re-settling,
 * cleared when dropping back to partial), and stamps updatedAt.
 *
 * The dialog always sends explicit amountDue + amountPaid, so a note-only
 * save on a legacy student can never accidentally flip them to unpaid —
 * the effective remaining is initialized to 0 (paid) in the dialog.
 */
updateRegistrationFee: (studentId, patch) => {
  const student = get().students.find((s) => s.id === studentId);
  if (!student) return;

  const existing: RegistrationFee =
    student.registrationFee ??
    ({ amountDue: REGISTRATION_FEE_DEFAULT, amountPaid: 0 } as RegistrationFee);
  const isLegacy = !student.registrationFee;

  const amountDue = Math.max(0, patch.amountDue ?? existing.amountDue);
  const amountPaid = Math.min(
    amountDue,
    Math.max(0, patch.amountPaid ?? existing.amountPaid),
  );
  // Note handling: an explicit patch.note always wins (empty string clears);
  // otherwise the existing note is preserved untouched — a partial-payment
  // save never wipes a saved note.
  const nextNote: string | undefined =
    patch.note !== undefined
      ? patch.note.trim() || undefined
      : existing.note;

  const next: RegistrationFee = {
    ...existing,
    amountDue,
    amountPaid,
    note: nextNote,
  };

  // settledAt transitions: set/kept when fully paid, cleared when partial.
  if (amountDue - amountPaid <= 0) {
    next.settledAt = existing.settledAt ?? new Date().toISOString();
  } else {
    next.settledAt = undefined;
  }
  next.updatedAt = new Date().toISOString();

  // No-op guard: single write only when something actually changed. A legacy
  // student (no stored fee) always counts as changed — materializing the
  // field is itself a write (e.g. marking a legacy non-payer via the dialog).
  if (
    !isLegacy &&
    existing.amountDue === next.amountDue &&
    existing.amountPaid === next.amountPaid &&
    (existing.note ?? undefined) === nextNote &&
    existing.settledAt === next.settledAt
  ) {
    return;
  }

  get().updateStudent(studentId, { registrationFee: next });
},

/**
 * One-click Settle (panel/wallet/bell rows): pays the fee in full —
 * `amountPaid = existing?.amountDue ?? 100`. Toast is handled by callers.
 */
settleRegistrationFee: (studentId) => {
  const student = get().students.find((s) => s.id === studentId);
  if (!student) return;
  get().updateRegistrationFee(studentId, {
    amountPaid: student.registrationFee?.amountDue ?? REGISTRATION_FEE_DEFAULT,
  });
},

getOutstandingInstallment: (studentId, subject, asOf) => {
  const asOfKey = formatDateKey(asOf);
    const candidates = get().payments.filter(
      (p) =>
        p.studentId === studentId &&
        p.subject === subject &&
        !p.isPaid &&
        p.dueDate <= asOfKey,
    );
    if (candidates.length === 0) return undefined;
    return candidates.reduce((earliest, p) =>
      p.dueDate < earliest.dueDate ? p : earliest,
    );
  },

  hasOutstandingBalance: (studentId, subject, asOf) => {
    return get().getOutstandingInstallment(studentId, subject, asOf) !== undefined;
  },

  addMessage: async (message) => {
    const now = new Date().toISOString();
    const newMessage: LevelMessage = {
      ...message,
      id: makeId(),
      createdAt: now,
      updatedAt: now,
    };
    const prevMessages = get().messages;
    set((state) => ({ messages: [...state.messages, newMessage] }));
    const ok = await persist(
      prevMessages,
      (prev) => set({ messages: prev }),
      upsertMessageDoc(newMessage),
      "messageSaveFailed",
    );
    return ok ? newMessage : null;
  },

  updateMessage: async (id, patch) => {
    let updated: LevelMessage | undefined;
    const prevMessages = get().messages;
    set((state) => ({
      messages: state.messages.map((m) => {
        if (m.id !== id) return m;
        updated = { ...m, ...patch, updatedAt: new Date().toISOString() };
        return updated;
      }),
    }));
    if (updated) {
      return await persist(
        prevMessages,
        (prev) => set({ messages: prev }),
        upsertMessageDoc(updated),
        "messageSaveFailed",
      );
    }
    return false;
  },

  deleteMessage: async (id) => {
    const prevMessages = get().messages;
    set((state) => ({
      messages: state.messages.filter((m) => m.id !== id),
    }));
    return await persist(
      prevMessages,
      (prev) => set({ messages: prev }),
      deleteMessageDoc(id),
      "messageSaveFailed",
    );
  },

  hydrateStudents: (students) => {
    // Materialize advanceBalance (default 0) for legacy students who predate
    // the `advance_balance` column — prevents undefined/NaN in downstream
    // arithmetic (syncPayments, StudentTable Reste).
    const normalized = students.map((s) =>
      s.advanceBalance === undefined ? { ...s, advanceBalance: 0 } : s,
    );
    const next = replaceIfChanged(get().students, normalized);
    const hasSynced = get().hasSyncedStudents;
    if (next) {
      set({ students: next, hasSyncedStudents: true });
    } else if (!hasSynced) {
      set({ hasSyncedStudents: true });
    }
    maybeRunPaymentSync();
  },
  hydrateSessions: (sessions) => {
    const next = replaceIfChanged(get().sessions, sessions);
    const hasSynced = get().hasSyncedSessions;
    if (next) set({ sessions: next, hasSyncedSessions: true });
    else if (!hasSynced) set({ hasSyncedSessions: true });
  },
  hydratePrices: (prices) => {
    const next = replaceIfChanged(get().prices, prices);
    if (next) set({ prices: next });
  },
  hydrateAttendance: (records) => {
    const next = replaceIfChanged(get().attendanceRecords, records);
    if (next) set({ attendanceRecords: next });
  },
  hydratePayments: (payments) => {
    // Self-heal: collapse duplicate rows that share a logical installment
    // identity (`studentId__subject__month`) — leftovers from loads that
    // generated before hydration, or a re-anchor's re-dated duplicate — and
    // delete the surplus docs from Firestore. Idempotent: a clean ledger is
    // returned untouched and this schedules no writes.
    const { kept, duplicateIds } = dedupePayments(payments);
    if (duplicateIds.length > 0) void deletePaymentsBatchDoc(duplicateIds);

    const next = replaceIfChanged(get().payments, kept);
    const hasSynced = get().hasSyncedPayments;
    if (next) {
      set({ payments: next, hasSyncedPayments: true });
    } else if (!hasSynced) {
      set({ hasSyncedPayments: true });
    }
    // Generation is gated on this hydration (see `syncPayments`), so kick it
    // off now that the real ledger is in place.
    maybeRunPaymentSync();
  },
    hydrateMessages: (messages) => {
      const next = replaceIfChanged(get().messages, messages);
      if (next) set({ messages: next });
    },
  }));

/**
 * Fills any missing installments as soon as BOTH the authoritative ledger
 * (`hasSyncedPayments`) and the student roster are present — regardless of
 * which route mounted first, and without ever generating against an
 * un-hydrated (empty) ledger. Called from the hydrate actions above.
 * `syncPayments` self-guards and self-throttles, so this is a cheap no-op
 * whenever there is nothing to generate.
 */
function maybeRunPaymentSync(): void {
  const state = useEnnajdState.getState();
  if (!state.hasSyncedPayments || state.students.length === 0) return;
  void state.syncPayments(new Date());
}
