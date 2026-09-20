// Reactive ledger tests — the markAttendance → recalculatePaymentsForStudentSubject
// wiring. The persistence layer (Supabase doc writes) and toasts are mocked so
// these exercise the store's reactive contract, not the network.
//
// Run with: npx vitest run src/hooks/use-ennajd-state.test.ts

import { beforeEach, describe, expect, it, vi } from "vitest";
import { isPaymentFullyPaid } from "../lib/ennajd-billing";
import { useEnnajdState } from "./use-ennajd-state";
import type {
  AttendanceRecord,
  Payment,
  PriceEntry,
  Session,
  Student,
  Subject,
} from "../types/ennajd";

// Fixed clock so the "now + 1 month" generation horizon is deterministic.
const NOW = "2026-11-15T12:00:00";
const TODAY_KEY = "2026-11-15";

const STUDENT_ID = "student-1";
const STUDENT: Student = {
  id: STUDENT_ID,
  firstName: "Aicha",
  lastName: "Bennani",
  whatsappPhone: "",
  parentPhone: "",
  level: "T.C",
  track: null,
  enrollments: [
    { subject: "Math", track: null, groupType: "Large", enrolledAt: "2026-09-15T12:00:00.000Z" },
  ],
  createdAt: "2025-01-01T00:00:00.000Z",
  advanceBalance: 0,
};

// Tue + Thu recurring Math slots for T.C Large (8 sessions/month → perSession
// = 350 / 8 = 43.75).
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

// 2Bac s.x Small — Rule B territory: a fixed 500 MAD/month rolling cycle
// anchored on the enrollment date. Deterministic (no session-count math), so
// the wallet-carryover tests below can predict exactly which months exist.
const SESSION_2BAC: Session = {
  id: "session-math-2bac",
  subject: "Math",
  level: "2Bac",
  track: "s.x",
  groupType: "Small",
  dayOfWeek: 2,
  startTime: "16:00",
  endTime: "18:00",
  kind: "recurring",
  date: null,
};

const PRICE_2BAC: PriceEntry = {
  id: "price-math-2bac",
  level: "2Bac",
  subject: "Math",
  track: "s.x",
  groupType: "Small",
  price: 500,
};

// Shared mock state — lets a single test flip a doc write to a rejection.
const mockState = vi.hoisted(() => ({
  failNextPaymentBatch: false,
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
  upsertPaymentsBatchDoc: vi.fn().mockImplementation(() =>
    mockState.failNextPaymentBatch
      ? Promise.reject(new Error("simulated offline failure"))
      : Promise.resolve(undefined),
  ),
  updatePaymentsBatchDoc: vi.fn().mockResolvedValue(undefined),
  deletePaymentsBatchDoc: vi.fn().mockResolvedValue(undefined),
  upsertMessageDoc: vi.fn().mockResolvedValue(undefined),
  deleteMessageDoc: vi.fn().mockResolvedValue(undefined),
}));

const toast = vi.hoisted(() => ({
  success: vi.fn(),
  warning: vi.fn(),
  error: vi.fn(),
}));

vi.mock("sonner", () => ({ toast }));

/** Restores the pristine pre-hydration store between tests. */
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
  });
  mockState.failNextPaymentBatch = false;
  toast.success.mockClear();
  toast.warning.mockClear();
  toast.error.mockClear();
}

/**
 * Seeds a hydrated Rule A ledger: student + timetable + price, and the
 * installments a pre-mark sync would have built off the ENROLLMENT anchor
 * (Sept = 218 for the 15/09 joiner, 5/8 × 43.75 floored).
 */
function seedRuleALedger(payments: Payment[], advanceBalance = 0) {
  resetStore();
  useEnnajdState.setState({
    students: [{ ...STUDENT, advanceBalance }],
    sessions: SESSIONS,
    prices: PRICES,
    payments,
    hasSyncedPayments: true,
    lastPaymentsSyncDateKey: TODAY_KEY,
  });
}

function payment(
  id: string,
  dueDate: string,
  amountDue: number,
  rule: Payment["rule"] = "A",
  amountPaid = 0,
): Payment {
  return {
    id,
    studentId: STUDENT_ID,
    subject: "Math",
    dueDate,
    month: dueDate.slice(0, 7),
    isPaid: amountPaid >= amountDue,
    amountDue,
    amountPaid,
    isHalfMonth: false,
    rule,
    updatedAt: "2026-09-15T00:00:00.000Z",
  };
}

/** Same as `payment()` but for an arbitrary subject (cross-subject tests). */
function paymentFor(
  subject: Subject,
  id: string,
  dueDate: string,
  amountDue: number,
  amountPaid = 0,
): Payment {
  return {
    id,
    studentId: STUDENT_ID,
    subject,
    dueDate,
    month: dueDate.slice(0, 7),
    isPaid: amountPaid >= amountDue,
    amountDue,
    amountPaid,
    isHalfMonth: false,
    rule: "A",
    updatedAt: "2026-09-15T00:00:00.000Z",
  };
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

/** The student's current wallet balance. */
function walletBalance(): number {
  return (
    useEnnajdState.getState().students.find((s) => s.id === STUDENT_ID)!
      .advanceBalance ?? 0
  );
}

/** Every row handed to the batch upsert so far in this test. */
async function upsertedRows(): Promise<Payment[]> {
  const db = await import("@/lib/dbServices");
  return vi.mocked(db.upsertPaymentsBatchDoc).mock.calls.flatMap((call) => call[0]);
}

/** Every per-id patch handed to the batch update so far in this test. */
async function patchedRows(): Promise<Array<{ id: string }>> {
  const db = await import("@/lib/dbServices");
  return vi.mocked(db.updatePaymentsBatchDoc).mock.calls.flatMap((call) => call[0]);
}

/** Every payment id handed to `deletePaymentsBatchDoc` so far in this test. */
async function deletePaymentsBatchDocIds(): Promise<string[]> {
  const db = await import("@/lib/dbServices");
  return vi.mocked(db.deletePaymentsBatchDoc).mock.calls.flatMap((call) => call[0]);
}

/** Asserts the ledger keeps exactly one row per month — no duplicate ids. */
function expectOneRowPerMonth() {
  const months = useEnnajdState.getState().payments.map((p) => p.month);
  const counts = new Map<string, number>();
  for (const m of months) counts.set(m, (counts.get(m) ?? 0) + 1);
  for (const count of counts.values()) expect(count).toBe(1);
}

describe("reactive ledger — markAttendance trigger", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    resetStore();
  });

  it("populates an EMPTY ledger from a fresh attendance mark (the empty-ledger regression)", async () => {
    // The reported symptom: the ledger stays completely empty after marking
    // attendance. The old recalc bailed silently on `!hasSyncedPayments`;
    // the rebuild fires unconditionally.
    resetStore();
    useEnnajdState.setState({
      students: [STUDENT],
      sessions: SESSIONS,
      prices: PRICES,
      payments: [], // nothing generated yet
      hasSyncedPayments: false, // the old gate
    });

    const ok = await useEnnajdState
      .getState()
      .markAttendance(STUDENT_ID, "session-math-thu", "2026-09-10", "present");
    expect(ok).toBe(true);
    await flushReactive();

    const ledger = ledgerByMonth();
    expect(ledger.size).toBeGreaterThan(0);
    // The 10/09 mark predates registration but is INCLUSIVE — Sept re-bills
    // to 6 × 43.75 = 262.5 → the FLOORED 262, dated on the anchor.
    expect(ledger.get("2026-09")!.amountDue).toBe(262);
    expect(ledger.get("2026-09")!.dueDate).toBe("2026-09-10");
    // October is the transition month: the full 350 (never the remainder),
    // absorbing the 88 carried credit (350 − 262) → 262 to collect.
    expect(ledger.get("2026-10")!.amountDue).toBe(350);
  });

  it("re-bills Sept from a pre-registration attendance mark", async () => {
    seedRuleALedger([
      payment("sept", "2026-09-15", 219),
      payment("oct", "2026-10-01", 350),
      payment("nov", "2026-11-01", 350),
    ]);

    const ok = await useEnnajdState
      .getState()
      .markAttendance(STUDENT_ID, "session-math-thu", "2026-09-10", "present");
    expect(ok).toBe(true);
    await flushReactive();

    const ledger = ledgerByMonth();
    expect(ledger.get("2026-09")!.amountDue).toBe(262);
    expect(ledger.get("2026-09")!.dueDate).toBe("2026-09-10");
    expect(ledger.get("2026-10")!.amountDue).toBe(350); // the full price
  });

  it("keeps exactly one installment per month after re-anchoring", async () => {
    seedRuleALedger([
      payment("sept", "2026-09-15", 219),
      payment("oct", "2026-10-01", 350),
    ]);

    await useEnnajdState
      .getState()
      .markAttendance(STUDENT_ID, "session-math-thu", "2026-09-10", "present");
    await flushReactive();

    expectOneRowPerMonth();
    expect(ledgerByMonth().get("2026-09")!.amountDue).toBe(262);
  });

  it("never resets a settled installment when attendance re-anchors it", async () => {
    // SETTLEMENT PROTECTION: Sept was charged 350 and settled on the
    // enrollment anchor. A 17/09 attendance mark would drop the engine's
    // September charge to 175 and would previously have rolled the 175
    // surplus onto October — but the settled row is immutable. It keeps its
    // amountDue, its payment and its green status; October is already at the
    // full price, so the 17/09 anchor leaves it untouched too.
    seedRuleALedger([
      payment("sept", "2026-09-15", 350, "A", 350),
      payment("oct", "2026-10-01", 350),
    ]);

    await useEnnajdState
      .getState()
      .markAttendance(STUDENT_ID, "session-math-thu", "2026-09-17", "present");
    await flushReactive();

    const ledger = ledgerByMonth();
    const sept = ledger.get("2026-09")!;
    expect(sept.amountDue).toBe(350); // untouched
    expect(sept.amountPaid).toBe(350); // untouched
    expect(sept.isPaid).toBe(true); // still green
    // October was already at the full price — the anchor move leaves it as is.
    expect(ledger.get("2026-10")!.amountDue).toBe(350);
    expect(ledger.get("2026-10")!.amountPaid).toBe(0);
  });

  it("lands carried wallet surplus on the next UNSETTLED month as green credit", async () => {
    // Sept settled, 500 DH parked in the wallet — the enrollment-time
    // full-fee surplus. A mark on the enrollment date re-derives the ledger.
    // The settled September row is immutable, so the wallet surplus fully
    // covers the rebuilt October (350) and the remaining 150 lands on
    // November as green advance credit.
    seedRuleALedger(
      [
        payment("sept", "2026-09-15", 218, "A", 218),
        payment("oct", "2026-10-01", 350),
      ],
      500, // advanceBalance
    );
    vi.clearAllMocks();

    await useEnnajdState
      .getState()
      .markAttendance(STUDENT_ID, "session-math-tue", "2026-09-15", "present");
    await flushReactive();

    const ledger = ledgerByMonth();
    expect(ledger.get("2026-09")!.amountPaid).toBe(218); // untouched
    expect(ledger.get("2026-10")!.amountDue).toBe(350);
    expect(ledger.get("2026-10")!.amountPaid).toBe(350); // wallet covered it
    expect(ledger.get("2026-10")!.isPaid).toBe(true);
    expect(ledger.get("2026-11")!.amountPaid).toBe(150); // the remainder, green
    expect(ledger.get("2026-11")!.isPaid).toBe(false);
    expect(walletBalance()).toBe(0); // wallet drained

    const db = await import("@/lib/dbServices");
    expect(db.updateStudentAdvanceBalanceDoc).toHaveBeenCalledWith(STUDENT_ID, 0);
  });

  it("commits the rebuild in ONE payments write (single-write contract)", async () => {
    seedRuleALedger([
      payment("sept", "2026-09-15", 219),
      payment("oct", "2026-10-01", 350),
    ]);
    vi.clearAllMocks();

    await useEnnajdState
      .getState()
      .markAttendance(STUDENT_ID, "session-math-thu", "2026-09-10", "present");
    await flushReactive();

    const db = await import("@/lib/dbServices");
    // Exactly ONE payments write for the whole recalc — there is no second
    // per-id update whose echo could revert the rebuilt rows.
    expect(db.upsertPaymentsBatchDoc).toHaveBeenCalledTimes(1);
    expect(db.updatePaymentsBatchDoc).not.toHaveBeenCalled();
    // The shipped rows already carry their waterfall credit, and no id ships
    // twice (PostgREST "cannot affect row a second time").
    const rows = await upsertedRows();
    expect(rows.length).toBeGreaterThan(0);
    const ids = rows.map((p) => p.id);
    expect(ids).toEqual([...new Set(ids)]);
  });

  it("confirms the recalc with a toast naming the student", async () => {
    seedRuleALedger([
      payment("sept", "2026-09-15", 350, "A", 350),
      payment("oct", "2026-10-01", 350),
    ]);

    await useEnnajdState
      .getState()
      .markAttendance(STUDENT_ID, "session-math-thu", "2026-09-17", "present");
    await flushReactive();

    expect(toast.success).toHaveBeenCalledTimes(1);
    expect(toast.success).toHaveBeenCalledWith(expect.stringContaining("Aicha"));
  });

  it("is idempotent — a second mark of the same date moves nothing", async () => {
    seedRuleALedger([payment("sept", "2026-09-15", 219)]);

    const store = useEnnajdState.getState();
    await store.markAttendance(STUDENT_ID, "session-math-thu", "2026-09-10", "present");
    await flushReactive();
    expect(ledgerByMonth().get("2026-09")!.amountDue).toBe(262);

    toast.success.mockClear();
    // Same student+session+date → the existing record is replaced, the anchor
    // is unchanged, so the ledger must not move again.
    await useEnnajdState
      .getState()
      .markAttendance(STUDENT_ID, "session-math-thu", "2026-09-10", "present", {
        isManualOverride: true,
      });
    await flushReactive();

    expect(ledgerByMonth().get("2026-09")!.amountDue).toBe(262);
    expect(toast.success).not.toHaveBeenCalled();
  });

  it("deletes stale rows BEFORE upserting rebuilt ones (unique-constraint safe)", async () => {
    // Two rows share the Sept month; the 10/09 mark re-anchors Sept onto a
    // new dueDate. The collapse must delete the surplus row BEFORE the
    // re-dated survivor is upserted, or the unique(student, subject,
    // due_date) index would reject the whole batch.
    seedRuleALedger([
      payment("sept", "2026-09-15", 219),
      payment("sept-dup", "2026-09-17", 100),
      payment("oct", "2026-10-01", 350),
      payment("nov", "2026-11-01", 350),
    ]);

    // The db mocks accumulate calls across this file's tests — clear so
    // every order number below belongs to THIS mark's write path.
    vi.clearAllMocks();

    await useEnnajdState
      .getState()
      .markAttendance(STUDENT_ID, "session-math-thu", "2026-09-10", "present");
    await flushReactive();

    const db = await import("@/lib/dbServices");
    const deleteOrders = vi.mocked(db.deletePaymentsBatchDoc).mock.invocationCallOrder;
    const upsertOrders = vi.mocked(db.upsertPaymentsBatchDoc).mock.invocationCallOrder;
    expect(deleteOrders.length).toBeGreaterThan(0);
    expect(upsertOrders.length).toBeGreaterThan(0);
    // EVERY delete lands before EVERY upsert.
    expect(Math.max(...deleteOrders)).toBeLessThan(Math.min(...upsertOrders));

    // The surplus Sept row is gone...
    expect(await deletePaymentsBatchDocIds()).toContain("sept-dup");
    // ...and exactly one row per month survived.
    expectOneRowPerMonth();
  });

  it("never blocks on a persistence failure (warning toast, kept attendance)", async () => {
    seedRuleALedger([payment("sept", "2026-09-15", 219)]);
    mockState.failNextPaymentBatch = true;

    const ok = await useEnnajdState
      .getState()
      .markAttendance(STUDENT_ID, "session-math-thu", "2026-09-10", "present");
    await flushReactive();

    // The attendance write itself landed and stays recorded...
    expect(ok).toBe(true);
    const records: AttendanceRecord[] = useEnnajdState.getState().attendanceRecords;
    expect(records).toHaveLength(1);
    expect(records[0].date).toBe("2026-09-10");
    // ...and the recalc failure surfaced as a warning, never an error throw.
    expect(toast.warning).toHaveBeenCalled();
  });

  it("leaves a Rule B (2Bac Small) ledger on its fixed schedule", async () => {
    resetStore();
    useEnnajdState.setState({
      students: [
        {
          ...STUDENT,
          id: STUDENT_ID,
          level: "2Bac",
          track: "s.x",
          enrollments: [
            {
              subject: "Math",
              track: "s.x",
              groupType: "Small",
              enrolledAt: "2026-09-15T12:00:00.000Z",
            },
          ],
        },
      ],
      sessions: [SESSION_2BAC],
      prices: [PRICE_2BAC],
      // The full Rule B rolling cycle through the generation horizon already
      // exists, so the only thing that could move the ledger is the recalc.
      payments: [
        payment("b-sept", "2026-09-15", 500, "B"),
        payment("b-oct", "2026-10-15", 500, "B"),
        payment("b-nov", "2026-11-15", 500, "B"),
        payment("b-dec", "2026-12-15", 500, "B"),
      ],
      hasSyncedPayments: true,
      lastPaymentsSyncDateKey: TODAY_KEY,
    });

    await useEnnajdState
      .getState()
      .markAttendance(STUDENT_ID, "session-math-2bac", "2026-09-01", "present");
    await flushReactive();

    const payments = useEnnajdState.getState().payments;
    expect(payments).toHaveLength(4);
    expect(payments.every((p) => p.rule === "B")).toBe(true);
    expect(payments.map((p) => p.amountDue)).toEqual([500, 500, 500, 500]);
    expect(payments.map((p) => p.dueDate)).toEqual([
      "2026-09-15",
      "2026-10-15",
      "2026-11-15",
      "2026-12-15",
    ]);
    // Nothing moved, so no confirmation toast and no writes.
    expect(toast.success).not.toHaveBeenCalled();
    const db = await import("@/lib/dbServices");
    expect(db.upsertPaymentsBatchDoc).not.toHaveBeenCalled();
    expect(db.deletePaymentsBatchDoc).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------//
// regeneratePaymentLedger — the manual "recalculate installments" button.
// ---------------------------------------------------------------------------//

describe("regeneratePaymentLedger", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    resetStore();
    vi.clearAllMocks();
  });

  it("rebuilds Rule A, keeps Rule B, and deletes before inserting", async () => {
    seedRuleALedger([
      payment("sept", "2026-09-15", 219),
      payment("oct", "2026-10-01", 350),
      payment("ruleB", "2026-10-15", 500, "B"),
    ]);

    const ok = await useEnnajdState.getState().regeneratePaymentLedger();
    expect(ok).toBe(true);

    const db = await import("@/lib/dbServices");
    const deleteCalls = vi.mocked(db.deletePaymentsBatchDoc).mock.calls;
    const upsertCalls = vi.mocked(db.upsertPaymentsBatchDoc).mock.calls;

    // Every Rule A row is deleted before the rebuild is inserted.
    expect(deleteCalls).toHaveLength(1);
    expect(deleteCalls[0][0]).toEqual(["sept", "oct"]);
    expect(upsertCalls).toHaveLength(1);
    expect(
      vi.mocked(db.deletePaymentsBatchDoc).mock.invocationCallOrder[0]!,
    ).toBeLessThan(
      vi.mocked(db.upsertPaymentsBatchDoc).mock.invocationCallOrder[0]!,
    );

    // DB constraints guarded on the shipped rows: one row per natural key,
    // and every amountDue strictly positive (check (amount_due > 0)).
    const keys = new Set<string>();
    for (const p of upsertCalls[0][0]) {
      expect(p.amountDue).toBeGreaterThan(0);
      const key = `${p.studentId}__${p.subject}__${p.dueDate}`;
      expect(keys.has(key)).toBe(false);
      keys.add(key);
    }

    // Rule B is never part of the rebuild nor deleted.
    expect(upsertCalls[0][0].find((p) => p.id === "ruleB")).toBeUndefined();
    expect(useEnnajdState.getState().payments.filter((p) => p.rule === "B"))
      .toHaveLength(1);
  });

  it("never deletes or rebuilds a Rule A row carrying a settlement", async () => {
    // SETTLEMENT PROTECTION: the settled September row (status = paid) is
    // kept verbatim and joins `existingKeys`, so the generator skips it —
    // it is never part of the delete batch nor the rebuild. Only the
    // unsettled October row is deleted and regenerated.
    seedRuleALedger([
      payment("sept", "2026-09-15", 219, "A", 219), // settled
      payment("oct", "2026-10-01", 350), // unsettled
    ]);

    const ok = await useEnnajdState.getState().regeneratePaymentLedger();
    expect(ok).toBe(true);

    const db = await import("@/lib/dbServices");
    const deleteCalls = vi.mocked(db.deletePaymentsBatchDoc).mock.calls;
    expect(deleteCalls).toHaveLength(1);
    expect(deleteCalls[0][0]).toEqual(["oct"]); // Sept protected

    // The settled row survived untouched.
    const sept = useEnnajdState.getState().payments.find((p) => p.id === "sept")!;
    expect(sept.amountDue).toBe(219);
    expect(sept.amountPaid).toBe(219);
    expect(sept.isPaid).toBe(true);
  });

  it("rolls back and surfaces the real DB error when the write fails", async () => {
    seedRuleALedger([payment("sept", "2026-09-15", 219)]);
    mockState.failNextPaymentBatch = true;

    const ok = await useEnnajdState.getState().regeneratePaymentLedger();
    expect(ok).toBe(false);

    // The toast carries the actual failure reason, not a generic message.
    expect(toast.error).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        description: expect.stringContaining("simulated offline failure"),
      }),
    );
    // The local ledger is rolled back to its pre-rebuild state.
    expect(useEnnajdState.getState().payments.map((p) => p.id)).toEqual(["sept"]);
  });
});

// ---------------------------------------------------------------------------//
// recordPartialPayment — the wallet waterfall lands surplus on the NEXT month's
// gap, not on a duplicate of the same month.
// ---------------------------------------------------------------------------//

describe("recordPartialPayment — waterfall", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    resetStore();
    vi.clearAllMocks();
  });

  it("absorbs a 350 payment as Sept 175 + Oct 175, one row per month", async () => {
    // The September amount is 175 (a 17/09 joiner, 4 sessions × 43.75). A
    // 350 payment fills Sept entirely and lands the 175 surplus on October's
    // gap — never on a second September row.
    seedRuleALedger([
      payment("sept", "2026-09-17", 175),
      payment("oct", "2026-10-01", 350),
      payment("nov", "2026-11-01", 350),
    ]);

    await useEnnajdState
      .getState()
      .recordPartialPayment(STUDENT_ID, "Math", 350, new Date("2026-10-15T12:00:00"));

    const ledger = ledgerByMonth();
    expect(ledger.get("2026-09")!.amountPaid).toBe(175);
    expect(isPaymentFullyPaid(ledger.get("2026-09")!)).toBe(true);
    expect(ledger.get("2026-10")!.amountPaid).toBe(175);
    expect(ledger.get("2026-10")!.amountDue).toBe(350);
    expect(ledger.get("2026-10")!.isPaid).toBe(false);
    // November untouched — the waterfall stops when the credit runs out.
    expect(ledger.get("2026-11")!.amountPaid).toBe(0);

    expectOneRowPerMonth();

    // The surplus was absorbed, so nothing was parked in advanceBalance.
    expect(walletBalance()).toBe(0);

    // SINGLE-WRITE CONTRACT — the realtime echo race fix. The whole waterfall
    // commits as exactly ONE payments write; there is no second per-id update
    // whose echo could land after the optimistic set and revert October to 0.
    const db = await import("@/lib/dbServices");
    expect(db.upsertPaymentsBatchDoc).toHaveBeenCalledTimes(1);
    expect(db.updatePaymentsBatchDoc).not.toHaveBeenCalled();

    // The October row inside that ONE payload already carries amountPaid 175 —
    // so the echo can only ever re-deliver 175, never the pre-credit 0.
    const oct = (await upsertedRows()).find((p) => p.id === "oct");
    expect(oct).toBeDefined();
    expect(oct!.amountPaid).toBe(175);
    expect(oct!.isPaid).toBe(false);
    // No id ships twice in the batch.
    const ids = (await upsertedRows()).map((p) => p.id);
    expect(ids).toEqual([...new Set(ids)]);
  });

  it("parks surplus in advanceBalance when every installment is fully paid", async () => {
    // Latent lost-credit bug: with no gap anywhere (all installments through
    // the generation horizon are settled), the credit can be absorbed by
    // nothing and must land in the wallet.
    seedRuleALedger([
      payment("sept", "2026-09-15", 350, "A", 350),
      payment("oct", "2026-10-01", 350, "A", 350),
      payment("nov", "2026-11-01", 350, "A", 350),
      payment("dec", "2026-12-01", 350, "A", 350),
    ]);

    await useEnnajdState
      .getState()
      .recordPartialPayment(STUDENT_ID, "Math", 200, new Date("2026-10-15T12:00:00"));

    const db = await import("@/lib/dbServices");
    expect(walletBalance()).toBe(200);
    // Nothing was generated and no credit landed → the wallet write is the
    // ONLY write. No payments echo at all, so nothing can revert the store.
    expect(db.upsertPaymentsBatchDoc).not.toHaveBeenCalled();
    expect(db.updatePaymentsBatchDoc).not.toHaveBeenCalled();
    expect(db.updateStudentAdvanceBalanceDoc).toHaveBeenCalledWith(STUDENT_ID, 200);
  });
});

// ---------------------------------------------------------------------------//
// applyInitialTuitionPayment — the create-time cross-subject waterfall. Same
// single-write contract as recordPartialPayment: the fully-waterfalled rows
// ship in ONE upsert (credit merged in place, never appended as copies), and
// unabsorbed surplus always reaches advanceBalance.
// ---------------------------------------------------------------------------//

// A Monday PC slot alongside the Tue/Thu Math slots, so the student is
// enrolled in two Rule A subjects and a single credit can spill across them.
const SESSION_PC: Session = {
  id: "session-pc-mon",
  subject: "PC",
  level: "T.C",
  track: null,
  groupType: "Large",
  dayOfWeek: 1,
  startTime: "16:00",
  endTime: "18:00",
  kind: "recurring",
  date: null,
};

const PRICE_PC: PriceEntry = {
  id: "price-pc-tc",
  level: "T.C",
  subject: "PC",
  track: null,
  groupType: "Large",
  price: 350,
};

/**
 * Hydrated ledger for a student enrolled in BOTH Math and PC (both T.C Large,
 * Rule A, 350 MAD/month from the 15/09 enrollment anchor).
 */
function seedCrossSubjectLedger(payments: Payment[]) {
  resetStore();
  useEnnajdState.setState({
    students: [
      {
        ...STUDENT,
        enrollments: [
          { subject: "Math", track: null, groupType: "Large", enrolledAt: "2026-09-15T12:00:00.000Z" },
          { subject: "PC", track: null, groupType: "Large", enrolledAt: "2026-09-15T12:00:00.000Z" },
        ],
      },
    ],
    sessions: [...SESSIONS, SESSION_PC],
    prices: [...PRICES, PRICE_PC],
    payments,
    hasSyncedPayments: true,
    lastPaymentsSyncDateKey: TODAY_KEY,
  });
}

describe("applyInitialTuitionPayment — single-write cross-subject waterfall", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    resetStore();
    vi.clearAllMocks();
  });

  it("spills across subjects in ONE upsert, no per-id update", async () => {
    // Both September installments are unpaid. A 500 payment fills Math (350)
    // and spills the remaining 150 onto PC — the cross-subject spill.
    seedCrossSubjectLedger([
      paymentFor("Math", "m-sept", "2026-09-15", 350),
      paymentFor("PC", "p-sept", "2026-09-15", 350),
    ]);

    await useEnnajdState
      .getState()
      .applyInitialTuitionPayment(STUDENT_ID, 500, new Date("2026-10-15T12:00:00"));

    const db = await import("@/lib/dbServices");

    // Exactly ONE payments write; the per-id update whose echo used to revert
    // the credit is gone entirely.
    expect(db.upsertPaymentsBatchDoc).toHaveBeenCalledTimes(1);
    expect(db.updatePaymentsBatchDoc).not.toHaveBeenCalled();

    // The credited EXISTING rows ship as full rows already carrying their
    // credit — the echo can only ever re-deliver these exact amounts.
    const byId = new Map((await upsertedRows()).map((p) => [p.id, p]));
    expect(byId.get("m-sept")!.amountPaid).toBe(350);
    expect(byId.get("p-sept")!.amountPaid).toBe(150);
    // No id ships twice in the single batch.
    const ids = (await upsertedRows()).map((p) => p.id);
    expect(ids).toEqual([...new Set(ids)]);

    // The store holds the same values as the payload it just shipped.
    const ledger = useEnnajdState.getState().payments;
    expect(ledger.find((p) => p.id === "m-sept")!.amountPaid).toBe(350);
    expect(ledger.find((p) => p.id === "p-sept")!.amountPaid).toBe(150);

    // Fully absorbed → the wallet was never touched.
    expect(db.updateStudentAdvanceBalanceDoc).not.toHaveBeenCalled();
    expect(walletBalance()).toBe(0);
  });

  it("parks unabsorbed surplus in advanceBalance (latent lost-credit fix)", async () => {
    // Every installment through the generation horizon is already settled, so
    // the waterfall has no gap and the whole payment must survive as surplus.
    seedCrossSubjectLedger([
      paymentFor("Math", "m-sept", "2026-09-15", 350, 350),
      paymentFor("Math", "m-oct", "2026-10-01", 350, 350),
      paymentFor("Math", "m-nov", "2026-11-01", 350, 350),
      paymentFor("Math", "m-dec", "2026-12-01", 350, 350),
      paymentFor("PC", "p-sept", "2026-09-15", 350, 350),
      paymentFor("PC", "p-oct", "2026-10-01", 350, 350),
      paymentFor("PC", "p-nov", "2026-11-01", 350, 350),
      paymentFor("PC", "p-dec", "2026-12-01", 350, 350),
    ]);

    await useEnnajdState
      .getState()
      .applyInitialTuitionPayment(STUDENT_ID, 200, new Date("2026-10-15T12:00:00"));

    const db = await import("@/lib/dbServices");
    expect(walletBalance()).toBe(200);
    expect(db.upsertPaymentsBatchDoc).not.toHaveBeenCalled();
    expect(db.updatePaymentsBatchDoc).not.toHaveBeenCalled();
    expect(db.updateStudentAdvanceBalanceDoc).toHaveBeenCalledWith(STUDENT_ID, 200);
  });

  it("reverts the ledger and rethrows when the write fails", async () => {
    seedCrossSubjectLedger([
      paymentFor("Math", "m-sept", "2026-09-15", 350),
      paymentFor("PC", "p-sept", "2026-09-15", 350),
    ]);
    mockState.failNextPaymentBatch = true;

    // The caller (StudentFormSheet) relies on the rethrow to stay open.
    await expect(
      useEnnajdState
        .getState()
        .applyInitialTuitionPayment(STUDENT_ID, 500, new Date("2026-10-15T12:00:00")),
    ).rejects.toThrow("simulated offline failure");

    // Both optimistic slices rolled back to the snapshot.
    expect(useEnnajdState.getState().payments.map((p) => p.id)).toEqual([
      "m-sept",
      "p-sept",
    ]);
    expect(walletBalance()).toBe(0);
    expect(toast.error).toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------//
// syncPayments — the daily self-heal, and the wallet (advanceBalance)
// carryover regression. Credit parked in the wallet from an earlier
// over-payment must land on the next month's installment, applied IN PLACE.
// ---------------------------------------------------------------------------//

/** Wallet credit carried into the sync (MAD). */
const WALLET = 200;

/**
 * Hydrated Rule B ledger (2Bac s.x Small, 500 MAD/month from the 15/09
 * enrollment). `force` is used only to step past the module-level
 * once-per-minute + once-per-calendar-day throttles — the ledger logic
 * itself is identical to the daily path.
 */
function seedWalletLedger(payments: Payment[], advanceBalance: number) {
  resetStore();
  useEnnajdState.setState({
    students: [
      {
        ...STUDENT,
        level: "2Bac",
        track: "s.x",
        enrollments: [
          {
            subject: "Math",
            track: "s.x",
            groupType: "Small",
            enrolledAt: "2026-09-15T12:00:00.000Z",
          },
        ],
        advanceBalance,
      },
    ],
    sessions: [SESSION_2BAC],
    prices: [PRICE_2BAC],
    payments,
    hasSyncedPayments: true,
    // null so the once-per-calendar-day guard lets this sync run.
    lastPaymentsSyncDateKey: null,
  });
}

/** A Rule B installment: 500 MAD due on the 15th of `month`. */
function ruleBPayment(id: string, month: string, amountPaid = 0): Payment {
  return {
    id,
    studentId: STUDENT_ID,
    subject: "Math",
    dueDate: `${month}-15`,
    month,
    isPaid: amountPaid >= 500,
    amountDue: 500,
    amountPaid,
    isHalfMonth: false,
    rule: "B",
    updatedAt: "2026-09-15T00:00:00.000Z",
  };
}

describe("syncPayments — wallet carryover to the next month", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    resetStore();
    vi.clearAllMocks();
  });

  it("lands the carried-over wallet on next month's NEW installment", async () => {
    // Sept–Nov fully paid, 200 MAD parked in the wallet. The generation
    // horizon is now + 1 month = mid-December, so the sync mints exactly one
    // new row: December — and the wallet credit must land on it.
    seedWalletLedger(
      [
        ruleBPayment("b-sept", "2026-09", 500),
        ruleBPayment("b-oct", "2026-10", 500),
        ruleBPayment("b-nov", "2026-11", 500),
      ],
      WALLET,
    );

    await useEnnajdState.getState().syncPayments(new Date(NOW), { force: true });

    const db = await import("@/lib/dbServices");

    // December was generated and the 200 wallet credit landed on it.
    const dec = ledgerByMonth().get("2026-12");
    expect(dec).toBeDefined();
    expect(dec!.amountDue).toBe(500);
    expect(dec!.amountPaid).toBe(WALLET);
    expect(dec!.isPaid).toBe(false);
    // The wallet was drained — the carryover did not linger.
    expect(walletBalance()).toBe(0);

    expectOneRowPerMonth();

    // The generated + credited December row ships in the UPSERT batch...
    const upserted = await upsertedRows();
    expect(upserted.map((p) => p.id)).toEqual([dec!.id]);
    // ...and NEVER ALSO in the per-id update batch.
    const patched = await patchedRows();
    expect(patched.map((p) => p.id)).not.toContain(dec!.id);
    // No id is written twice across the whole commit.
    const writtenIds = [...upserted, ...patched].map((p) => p.id);
    expect(writtenIds).toEqual([...new Set(writtenIds)]);

    // The wallet drain itself was persisted.
    expect(db.updateStudentAdvanceBalanceDoc).toHaveBeenCalledWith(STUDENT_ID, 0);
  });

  it("patches an EXISTING row's credit per-id, never appends a duplicate", async () => {
    // The full cycle through the horizon already exists, so syncPayments
    // generates NOTHING — the 200 wallet credit must land on the existing
    // unpaid December row through the per-id UPDATE path alone.
    seedWalletLedger(
      [
        ruleBPayment("b-sept", "2026-09", 500),
        ruleBPayment("b-oct", "2026-10", 500),
        ruleBPayment("b-nov", "2026-11", 500),
        ruleBPayment("b-dec", "2026-12", 0),
      ],
      WALLET,
    );

    await useEnnajdState.getState().syncPayments(new Date(NOW), { force: true });

    const db = await import("@/lib/dbServices");

    // December kept its id and its amountDue — only amountPaid moved.
    const dec = ledgerByMonth().get("2026-12");
    expect(dec!.id).toBe("b-dec");
    expect(dec!.amountDue).toBe(500);
    expect(dec!.amountPaid).toBe(WALLET);
    expect(dec!.isPaid).toBe(false);
    expect(walletBalance()).toBe(0);

    // NO new rows were generated → the upsert batch stays empty...
    expect(db.upsertPaymentsBatchDoc).not.toHaveBeenCalled();
    // ...the credit ships as ONE per-id UPDATE on the existing row only.
    expect(db.updatePaymentsBatchDoc).toHaveBeenCalledTimes(1);
    const patches = vi.mocked(db.updatePaymentsBatchDoc).mock.calls[0][0] as Array<{
      id: string;
    }>;
    expect(patches.map((p) => p.id)).toEqual(["b-dec"]);
    expect(db.updateStudentAdvanceBalanceDoc).toHaveBeenCalledWith(STUDENT_ID, 0);

    expectOneRowPerMonth();
  });

  it("leaves the wallet intact when no installment can absorb it", async () => {
    // Everything through the horizon is already fully paid, so the waterfall
    // has no gap to fill: the carryover must survive untouched for the next
    // sync, and nothing must be written.
    seedWalletLedger(
      [
        ruleBPayment("b-sept", "2026-09", 500),
        ruleBPayment("b-oct", "2026-10", 500),
        ruleBPayment("b-nov", "2026-11", 500),
        ruleBPayment("b-dec", "2026-12", 500),
      ],
      WALLET,
    );

    await useEnnajdState.getState().syncPayments(new Date(NOW), { force: true });

    const db = await import("@/lib/dbServices");
    expect(walletBalance()).toBe(WALLET);
    expect(db.upsertPaymentsBatchDoc).not.toHaveBeenCalled();
    expect(db.updatePaymentsBatchDoc).not.toHaveBeenCalled();
    expect(db.updateStudentAdvanceBalanceDoc).not.toHaveBeenCalled();
    expectOneRowPerMonth();
  });
});
