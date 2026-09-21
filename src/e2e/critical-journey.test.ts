// E2E JOURNEY TEST — login → attendance → settlement → green in reports.
//
// One fully-offline, deterministic end-to-end walk through Centre Ennajd's
// most critical flow, delivered as a single sequential `it()` — exactly what
// a Playwright E2E spec would do, but runnable with the project's existing
// Vitest runner (no browser dependency):
//
//   1. Login        — the REAL `auth-client.signIn` runs against a mocked
//                     Supabase client (including its error-code mapping).
//   2. Boot         — `hydrateInitialData`, the atomic hydration barrier,
//                     loads the roster/timetable/prices/ledger.
//   3. Attendance   — 3 × `markAttendance(..., "present")`; the reactive
//                     ledger re-anchors from the first PRESENT date and
//                     re-prices Sept/Oct live (Rule A).
//   4. Worklist     — `aggregateOverdueInstallments` aggregates the debt.
//   5. Guard        — settling October first is BLOCKED (Month 1 still red).
//   6. Settle Sept  — flips green; October keeps its prepaid carryover display.
//   7. Settle Oct   — now allowed.
//   8. Reports      — `buildPaymentMatrix` shows both months green.
//
// Run with:
//
//   npx vitest run src/e2e/critical-journey.test.ts
//
// Expected values (Rule A, T.C Math Large, 350 MAD/month, Tue+Thu,
// perSession = 350 / 8 = 43.75, fixedCount = 8):
//   boot ledger  : Sept 218 (5 × 43.75 floored, enrollment anchor 15/09),
//                  Oct 218 (carryover-adjusted), Nov 350.
//   after marks  : Sept 131 (3 × 43.75 floored, anchor 22/09), Oct 131
//                  (350 − (350 − 131) — the Month-2 carryover contract).
//   worklist     : totalRemaining 262 (131 + 131).
//   matrix, pre  : Sept red 131; Oct GREEN 219 (the prepaid carryover credit
//                  350 − 131) with remaining 0.
//   matrix, post : Sept green 131; Oct green 131; footers 131 / 131.
//
// Why service-level rather than rendered React: the configured Vitest
// environment is `node` (no jsdom / @testing-library). The journey drives the
// app's REAL single source of truth (the Zustand store), the REAL billing
// engine, the REAL auth client and the REAL report matrix builder — the exact
// code paths the pages call. Every assertion is against production logic.
//
// Why ONE `it()`: an E2E journey is sequential by nature, and the store's
// module-level sync throttle (`lastSyncPaymentsMs`) is not reset by a store
// reset, which would make per-phase tests flaky. A single walk keeps the
// throttle consumed exactly once.

import { beforeEach, describe, expect, it, vi } from "vitest";

import { signIn } from "@/lib/auth-client";
import {
  aggregateOverdueInstallments,
  isPaymentFullyPaid,
} from "@/lib/ennajd-billing";
import {
  buildPaymentMatrix,
  type PaymentCell,
  type PaymentMatrix,
} from "@/lib/ennajd-payment-report";
import { getAcademicYearMonths } from "@/lib/ennajd-report-shared";
import { translate as t } from "@/lib/i18n";
import { useEnnajdState } from "@/hooks/use-ennajd-state";
import type {
  AttendanceRecord,
  Payment,
  PriceEntry,
  Session,
  Student,
} from "@/types/ennajd";

// ---------------------------------------------------------------------------//
// Deterministic fixtures — fixed clock 2026-11-15 (same as the contract suite).
// ---------------------------------------------------------------------------//

const NOW = "2026-11-15T12:00:00";
const TODAY_KEY = "2026-11-15";
const STUDENT_ID = "student-1";
const EMAIL = "staff@ennajd.ma";
const PASSWORD = "secret123";

const STUDENT: Student = {
  id: STUDENT_ID,
  firstName: "Aicha",
  lastName: "Bennani",
  whatsappPhone: "",
  parentPhone: "",
  level: "T.C",
  track: null,
  enrollments: [
    {
      subject: "Math",
      track: null,
      groupType: "Large",
      enrolledAt: "2026-09-15T12:00:00.000Z",
    },
  ],
  createdAt: "2025-01-01T00:00:00.000Z",
  advanceBalance: 0,
};

// Tue + Thu recurring Math slots for T.C Large (fixedCount = 8,
// perSession = 350 / 8 = 43.75).
const SESSIONS: Session[] = [
  {
    id: "session-math-tue",
    subject: "Math",
    level: "T.C",
    track: null,
    groupType: "Large",
    dayOfWeek: 2,
    startTime: "16:00",
    endTime: "18:00",
    kind: "recurring",
    date: null,
  },
  {
    id: "session-math-thu",
    subject: "Math",
    level: "T.C",
    track: null,
    groupType: "Large",
    dayOfWeek: 4,
    startTime: "16:00",
    endTime: "18:00",
    kind: "recurring",
    date: null,
  },
];

const PRICES: PriceEntry[] = [
  {
    id: "price-math-tc",
    level: "T.C",
    subject: "Math",
    track: null,
    groupType: "Large",
    price: 350,
  },
];

/** A Rule A installment row for the seeded ledger. */
function payment(
  id: string,
  dueDate: string,
  amountDue: number,
): Payment {
  return {
    id,
    studentId: STUDENT_ID,
    subject: "Math",
    dueDate,
    month: dueDate.slice(0, 7),
    isPaid: false,
    amountDue,
    amountPaid: 0,
    isHalfMonth: false,
    rule: "A",
    updatedAt: "2026-09-15T00:00:00.000Z",
  };
}

// The enrollment-anchored schedule a boot-time sync would have built for a
// 15/09 joiner: Sept 218 (5 × 43.75 floored), Oct 218 (carryover), Nov 350.
const SEED_PAYMENTS: Payment[] = [
  payment("sept", "2026-09-15", 218),
  payment("oct", "2026-10-01", 218),
  payment("nov", "2026-11-01", 350),
];

// The three sessions Aicha actually attended (Tue/Thu of late September).
const ATTENDED_DATES = ["2026-09-22", "2026-09-24", "2026-09-29"];

// ---------------------------------------------------------------------------//
// Offline harness — mocked Supabase client, mocked persistence, mocked toasts.
// ---------------------------------------------------------------------------//

/** Hoisted fixture holder — the mock factories read these lazily at call time. */
const F = vi.hoisted(() => ({
  students: [] as Student[],
  sessions: [] as Session[],
  prices: [] as PriceEntry[],
  payments: [] as Payment[],
  attendance: [] as AttendanceRecord[],
  signInCalls: [] as Array<{ email: string; password: string }>,
  /** Set to a Supabase-shaped error to make the next `signIn` fail. */
  signInError: null as { message: string; code: string } | null,
}));

// The real `auth-client.ts` runs against this — including `mapSupabaseError`.
vi.mock("@/lib/supabase", () => ({
  supabase: {
    auth: {
      signInWithPassword: vi.fn(async ({ email, password }) => {
        F.signInCalls.push({ email, password });
        if (F.signInError !== null) {
          return { data: { user: null }, error: F.signInError };
        }
        return { data: { user: { id: "staff-1", email } }, error: null };
      }),
      getUser: vi.fn(async () => ({ data: { user: null }, error: null })),
      onAuthStateChange: vi.fn(() => ({
        data: { subscription: { unsubscribe: vi.fn() } },
      })),
      signOut: vi.fn(async () => ({ error: null })),
      setSession: vi.fn(async () => ({ data: { session: null }, error: null })),
    },
    from: vi.fn(() => ({
      select: vi.fn(() => ({ data: [], error: null })),
      upsert: vi.fn(() => ({ error: null })),
      update: vi.fn(() => ({ error: null, count: 1 })),
      delete: vi.fn(() => ({ error: null })),
      eq: vi.fn(function () {
        return this;
      }),
      in: vi.fn(function () {
        return this;
      }),
    })),
    channel: vi.fn(() => ({
      on: vi.fn(function () {
        return this;
      }),
      subscribe: vi.fn(function () {
        return this;
      }),
    })),
    removeChannel: vi.fn(),
  },
}));

vi.mock("@/lib/dbServices", () => ({
  addStudentDoc: vi.fn().mockResolvedValue(undefined),
  updateStudentDoc: vi.fn().mockResolvedValue(undefined),
  updateStudentAdvanceBalanceDoc: vi.fn().mockResolvedValue(undefined),
  deleteStudentDoc: vi.fn().mockResolvedValue(undefined),
  addSessionDoc: vi.fn().mockResolvedValue(undefined),
  updateSessionDoc: vi.fn().mockResolvedValue(undefined),
  deleteSessionDoc: vi.fn().mockResolvedValue(undefined),
  setPriceDoc: vi.fn().mockResolvedValue(undefined),
  markAttendanceDoc: vi.fn().mockResolvedValue(undefined),
  upsertAttendanceBatchDoc: vi.fn().mockResolvedValue(undefined),
  upsertPaymentDoc: vi.fn().mockResolvedValue(undefined),
  upsertPaymentsBatchDoc: vi.fn().mockResolvedValue(undefined),
  updatePaymentsBatchDoc: vi.fn().mockResolvedValue(undefined),
  deletePaymentsBatchDoc: vi.fn().mockResolvedValue(undefined),
  upsertMessageDoc: vi.fn().mockResolvedValue(undefined),
  deleteMessageDoc: vi.fn().mockResolvedValue(undefined),
  fetchAllStudents: vi.fn(async () => F.students),
  fetchAllSessions: vi.fn(async () => F.sessions),
  fetchAllAttendance: vi.fn(async () => F.attendance),
  fetchAllPrices: vi.fn(async () => F.prices),
  fetchAllPayments: vi.fn(async () => F.payments),
}));

const toast = vi.hoisted(() => ({
  success: vi.fn(),
  warning: vi.fn(),
  error: vi.fn(),
}));

vi.mock("sonner", () => ({ toast }));

// Point the hoisted holder at the fixtures (module body runs before tests).
F.students = [STUDENT];
F.sessions = SESSIONS;
F.prices = PRICES;
F.payments = SEED_PAYMENTS;
F.attendance = []; // the journey generates its own attendance

// ---------------------------------------------------------------------------//
// Helpers
// ---------------------------------------------------------------------------//

/** Restores the pristine pre-hydration store. */
function resetStore() {
  useEnnajdState.setState({
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
    hasSyncedAttendance: false,
    hasSyncedPrices: false,
    isDataReady: false,
  });
  F.signInCalls.length = 0;
  F.signInError = null;
  toast.success.mockClear();
  toast.warning.mockClear();
  toast.error.mockClear();
}

/** The recalc is queued on a microtask and awaits its own batch writes, so
 *  let the microtask queue drain plenty of turns before asserting. */
async function flushReactive() {
  for (let i = 0; i < 25; i++) await Promise.resolve();
}

/** One row per (month), latest state wins — robust to id churn from the
 *  dueDate-reanchoring dedupe. */
function ledgerByMonth(): Map<string, Payment> {
  return new Map(useEnnajdState.getState().payments.map((p) => [p.month, p]));
}

/** The Tue/Thu slot a given calendar date falls on. */
function sessionIdForDate(date: string): string {
  return new Date(`${date}T12:00:00`).getDay() === 2
    ? "session-math-tue"
    : "session-math-thu";
}

/** The report matrix for Math over the Sept 2026 → Aug 2027 academic year,
 *  built from the CURRENT store (mirrors what the Reports page renders). */
function buildMatrix(): PaymentMatrix {
  const s = useEnnajdState.getState();
  return buildPaymentMatrix(
    s.students,
    s.payments,
    "Math",
    getAcademicYearMonths("2026-11"),
    350,
    s.sessions,
    s.attendanceRecords,
    TODAY_KEY,
    s.prices,
  );
}

/** One student's cell in the matrix for a given month. */
function cellFor(
  matrix: PaymentMatrix,
  studentId: string,
  monthKey: string,
): PaymentCell | null {
  const row = matrix.rows.find((r) => r.student.id === studentId);
  return row ? (row.cellsByMonth.get(monthKey) ?? null) : null;
}

// ---------------------------------------------------------------------------//
// THE JOURNEY — one sequential walk, exactly as a staff member lives it.
// ---------------------------------------------------------------------------//

describe("critical journey — login → attendance → settlement → green in reports", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    resetStore();
    vi.clearAllMocks();
  });

  it("walks the full critical flow end to end", async () => {
    // ------------------------------------------------------------------ //
    // PHASE 1 — LOGIN
    // The real `auth-client.signIn` runs against the mocked Supabase client;
    // the credentials reach `signInWithPassword` verbatim.
    // ------------------------------------------------------------------ //
    await signIn(EMAIL, PASSWORD);
    expect(F.signInCalls).toContainEqual({ email: EMAIL, password: PASSWORD });

    // Wrong credentials map to the Firebase-compatible code the login page's
    // i18n table understands (real error-mapping code exercised).
    F.signInError = {
      message: "Invalid login credentials",
      code: "invalid_credentials",
    };
    await expect(signIn(EMAIL, "wrong-password")).rejects.toMatchObject({
      code: "auth/invalid-credential",
    });
    F.signInError = null;

    // ------------------------------------------------------------------ //
    // PHASE 2 — BOOT (the atomic hydration barrier)
    // hydrateInitialData fires every billing-critical fetch in ONE
    // allSettled, flips isDataReady, and only then generates the ledger.
    // ------------------------------------------------------------------ //
    await useEnnajdState.getState().hydrateInitialData();
    await flushReactive();

    expect(useEnnajdState.getState().isDataReady).toBe(true);
    expect(useEnnajdState.getState().students).toHaveLength(1);

    const bootLedger = ledgerByMonth();
    expect(bootLedger.get("2026-09")!.amountDue).toBe(218);
    expect(bootLedger.get("2026-10")!.amountDue).toBe(218);

    // ------------------------------------------------------------------ //
    // PHASE 3 — ATTENDANCE (the reactive ledger)
    // Each PRESENT mark persists and re-anchors the Rule A ledger from the
    // student's first attended session — Sept/Oct re-price LIVE, with no
    // manual recalc and no refresh.
    // ------------------------------------------------------------------ //
    const store = useEnnajdState.getState();
    for (const date of ATTENDED_DATES) {
      const ok = await store.markAttendance(
        STUDENT_ID,
        sessionIdForDate(date),
        date,
        "present",
      );
      expect(ok).toBe(true);
      await flushReactive();
    }

    // 3 attendance records persisted.
    expect(useEnnajdState.getState().attendanceRecords).toHaveLength(3);
    const db = await import("@/lib/dbServices");
    expect(vi.mocked(db.markAttendanceDoc)).toHaveBeenCalledTimes(3);

    // The ledger re-anchored onto 22/09: Sept re-bills to 3 × 43.75 floored
    // (131) and October to the carryover-adjusted 131.
    const ledger = ledgerByMonth();
    expect(ledger.get("2026-09")!.amountDue).toBe(131);
    expect(ledger.get("2026-10")!.amountDue).toBe(131);
    // The recalc confirmation named the student.
    expect(toast.success).toHaveBeenCalledWith(
      expect.stringContaining("Aicha"),
    );

    // ------------------------------------------------------------------ //
    // PHASE 4 — PAYMENTS WORKLIST
    // Aicha appears in the red "Impayés" panel with her due installments
    // aggregated into one row.
    // ------------------------------------------------------------------ //
    const worklist = aggregateOverdueInstallments(
      useEnnajdState.getState().payments,
      TODAY_KEY,
    );
    const worklistRow = worklist.get(`${STUDENT_ID}__Math`);
    expect(worklistRow).toBeDefined();
    expect(worklistRow!.totalRemaining).toBe(262); // 131 + 131

    // ------------------------------------------------------------------ //
    // PHASE 5 — CHRONOLOGICAL SETTLEMENT GUARD
    // Settling October FIRST is blocked: Month 2 can never go green while
    // Month 1 is still red.
    // ------------------------------------------------------------------ //
    const octId = ledgerByMonth().get("2026-10")!.id;
    toast.error.mockClear();
    const blocked = await useEnnajdState
      .getState()
      .setPaymentPaid(octId, true);
    expect(blocked).toBe(false);
    expect(toast.error).toHaveBeenCalledWith(
      t("chronologicalSettlementBlocked"),
    );
    // October is still red.
    expect(ledgerByMonth().get("2026-10")!.isPaid).toBe(false);

    // Pre-settlement report snapshot (captured between the guard and the
    // settlement): September is red at 131; October shows its PREPAID
    // CARRYOVER credit (350 − 131 = 219) in green, owing nothing.
    const matrixPre = buildMatrix();
    const preSept = cellFor(matrixPre, STUDENT_ID, "2026-09");
    const preOct = cellFor(matrixPre, STUDENT_ID, "2026-10");
    expect(preSept!.isPaid).toBe(false);
    expect(preSept!.amountDue).toBe(131);
    expect(preOct!.isPaid).toBe(true); // the prepaid carryover display
    expect(preOct!.amountDue).toBe(219); // the carryover credit
    expect(preOct!.remaining).toBe(0);

    // ------------------------------------------------------------------ //
    // PHASE 6 — SETTLE SEPTEMBER
    // Month 1 flips green alone; its amount is unchanged; October KEEPS its
    // prepaid carryover display until it is settled itself.
    // ------------------------------------------------------------------ //
    const septId = ledgerByMonth().get("2026-09")!.id;
    const okSept = await useEnnajdState.getState().setPaymentPaid(septId, true);
    expect(okSept).toBe(true);

    const sept = ledgerByMonth().get("2026-09")!;
    expect(isPaymentFullyPaid(sept)).toBe(true);
    expect(sept.amountDue).toBe(131); // unchanged by the settlement

    // Settling Month 1 did not clear Month 2's prepaid display.
    const midOct = cellFor(buildMatrix(), STUDENT_ID, "2026-10");
    expect(midOct!.isPaid).toBe(true);
    expect(midOct!.amountDue).toBe(219); // carryover still displayed

    // ------------------------------------------------------------------ //
    // PHASE 7 — SETTLE OCTOBER
    // Month 1 is green, so Month 2 is now allowed to settle.
    // ------------------------------------------------------------------ //
    const okOct = await useEnnajdState.getState().setPaymentPaid(octId, true);
    expect(okOct).toBe(true);
    expect(isPaymentFullyPaid(ledgerByMonth().get("2026-10")!)).toBe(true);

    // ------------------------------------------------------------------ //
    // PHASE 8 — REPORTS (both months green)
    // The payment matrix shows Sept + Oct settled at 131 each; the carryover
    // override is cleared now that October carries its own settlement.
    // ------------------------------------------------------------------ //
    const matrixPost = buildMatrix();
    const postSept = cellFor(matrixPost, STUDENT_ID, "2026-09");
    const postOct = cellFor(matrixPost, STUDENT_ID, "2026-10");
    expect(postSept!.isPaid).toBe(true);
    expect(postSept!.amountDue).toBe(131);
    expect(postOct!.isPaid).toBe(true);
    expect(postOct!.amountDue).toBe(131); // settled due, override cleared
    expect(postOct!.remaining).toBe(0);
    expect(matrixPost.totalsByMonth.get("2026-09")).toBe(131);
    expect(matrixPost.totalsByMonth.get("2026-10")).toBe(131);
  });
});
