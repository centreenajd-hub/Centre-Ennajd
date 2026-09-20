// Unit tests for the rebuilt proration engine.
// Run with: npx vitest run src/lib/ennajd-billing.test.ts

import { describe, it, expect } from "vitest";
import {
  applyCreditWaterfall,
  aggregateOverdueInstallments,
  buildDeliveredDatesContext,
  computeExpectedMonthAmount,
  computeMonthInvoice,
  dedupePayments,
  earliestMonthAttendance,
  earliestValidAttendanceDate,
  generateRuleBSchedule,
  generateScheduleFor,
  generateSessionBasedSchedule,
  getEffectivePriceFor,
  getFixedSessionCount,
  getPaymentRemaining,
  getPaymentRuleFor,
  getPaymentsToReceive,
  getStandardSessionCount,
  isPaymentFullyPaid,
  recalculateStudentSubjectLedger,
  reconcilePaymentAmounts,
  reconcileRuleALedger,
  roundMAD,
  type RecalculateResult,
} from "./ennajd-billing";
import type {
  AttendanceRecord,
  AttendanceStatus,
  GroupType,
  Level,
  Payment,
  PriceEntry,
  Session,
  Student,
  Subject,
  SubjectEnrollment,
  Track,
} from "../types/ennajd";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const STUDENT_ID = "student-1";
const NOW = "2025-01-15T12:00:00.000Z";
const PRICE = 400; // monthly fee for a 1x/week subject → perSession = 100

function makeCtx(opts: {
  hasSession?: boolean;
  scheduledDaysOfWeek?: number[];
  gapMonthKeys?: ReadonlySet<string>;
}) {
  return {
    hasSession: opts.hasSession ?? true,
    scheduledDaysOfWeek: opts.scheduledDaysOfWeek ?? [],
    fallbackDayOfWeek: 0,
    gapMonthKeys: opts.gapMonthKeys ?? new Set<string>(),
  };
}

function makeRecurringSession(
  subject: Subject,
  level: Level,
  track: Track | null,
  groupType: GroupType | null,
  dayOfWeek: number,
): Session {
  return {
    id: `session-${subject}-${level}-${dayOfWeek}`,
    subject,
    level,
    track,
    groupType,
    dayOfWeek,
    startTime: "16:00",
    endTime: "18:00",
    kind: "recurring",
    date: null,
  };
}

function makeStudent(opts: {
  id?: string;
  level?: Level;
  track?: Track | null;
  enrollments: SubjectEnrollment[];
  advanceBalance?: number;
}): Student {
  return {
    id: opts.id ?? STUDENT_ID,
    firstName: "Test",
    lastName: "Student",
    whatsappPhone: "",
    parentPhone: "",
    level: opts.level ?? "T.C",
    track: opts.track ?? null,
    enrollments: opts.enrollments,
    createdAt: "2025-01-01T00:00:00.000Z",
    advanceBalance: opts.advanceBalance,
  };
}

function makePayment(
  id: string,
  studentId: string,
  subject: Subject,
  dueDate: string,
  amountDue: number,
  amountPaid = 0,
  isPaid = false,
  rule: Payment["rule"] = "A",
): Payment {
  return {
    id,
    studentId,
    subject,
    dueDate,
    month: dueDate.slice(0, 7),
    isPaid,
    amountDue,
    amountPaid,
    isHalfMonth: false,
    rule,
    updatedAt: NOW,
  };
}

function makeAttendance(
  studentId: string,
  sessionId: string,
  date: string,
  status: AttendanceStatus = "present",
): AttendanceRecord {
  return {
    id: `att-${studentId}-${sessionId}-${date}`,
    studentId,
    sessionId,
    date,
    status,
    markedAt: NOW,
    timestamp: "12:00",
  };
}

// January 2025 Wednesdays: 1, 8, 15, 22, 29 (5 occurrences).
// February 2025 Wednesdays: 5, 12, 19, 26 (4 occurrences).
const WED_CTX = makeCtx({ scheduledDaysOfWeek: [3] });

// ---------------------------------------------------------------------------
// Rule routing — Rule 5 (broadened): EVERY 2Bac Small combo is Rule B
// ---------------------------------------------------------------------------

describe("getPaymentRuleFor — broadened Small-group exclusion", () => {
  it("routes EVERY 2Bac Small combo to Rule B, both tracks + every subject", () => {
    // s.x track
    expect(getPaymentRuleFor("2Bac", "Math", "Small", "s.x")).toBe("B");
    expect(getPaymentRuleFor("2Bac", "PC", "Small", "s.x")).toBe("B");
    expect(getPaymentRuleFor("2Bac", "SVT", "Small", "s.x")).toBe("B");
    // s.m track (broadened — used to be Rule A)
    expect(getPaymentRuleFor("2Bac", "Math", "Small", "s.m")).toBe("B");
    expect(getPaymentRuleFor("2Bac", "PC", "Small", "s.m")).toBe("B");
    expect(getPaymentRuleFor("2Bac", "SVT", "Small", "s.m")).toBe("B");
    // subjects beyond the old Math/PC/SVT whitelist
    expect(getPaymentRuleFor("2Bac", "Philosophy", "Small", "s.x")).toBe("B");
    expect(getPaymentRuleFor("2Bac", "English", "Small", "s.m")).toBe("B");
  });

  it("keeps every other combo on Rule A (session-based proration)", () => {
    expect(getPaymentRuleFor("2Bac", "Math", "Large", "s.x")).toBe("A");
    expect(getPaymentRuleFor("2Bac", "Math", "Large", "s.m")).toBe("A");
    expect(getPaymentRuleFor("2Bac", "Philosophy", null, "s.x")).toBe("A");
    expect(getPaymentRuleFor("1Bac", "Math", null, "s.x")).toBe("A");
    expect(getPaymentRuleFor("T.C", "Math", null, null)).toBe("A");
  });
});

// ---------------------------------------------------------------------------
// Price resolution — customPrice wins outright
// ---------------------------------------------------------------------------

describe("getEffectivePriceFor", () => {
  const prices: PriceEntry[] = [
    {
      id: "price-1",
      level: "T.C",
      subject: "Math",
      track: null,
      groupType: "Large",
      price: PRICE,
    },
  ];
  const student = makeStudent({
    level: "T.C",
    enrollments: [{ subject: "Math", track: null, groupType: "Large" }],
  });

  it("resolves the base price for a matching combo", () => {
    expect(
      getEffectivePriceFor(student, student.enrollments[0], prices),
    ).toBe(PRICE);
  });

  it("customPrice wins OUTRIGHT even when the base price row is missing", () => {
    // The empty-ledger root cause: a student whose customPrice is set but
    // whose base PriceEntry row does not exist must still resolve.
    const custom: SubjectEnrollment = {
      subject: "Math",
      track: null,
      groupType: "Large",
      customPrice: 250,
    };
    expect(getEffectivePriceFor(student, custom, [])).toBe(250);
    // And it beats an existing base price too.
    expect(getEffectivePriceFor(student, custom, prices)).toBe(250);
  });

  it("returns undefined only when neither customPrice nor a base price exists", () => {
    expect(
      getEffectivePriceFor(
        student,
        { subject: "PC", track: null, groupType: "Large" },
        prices,
      ),
    ).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Session-based pricing — the per-month proration core (1x/week)
// ---------------------------------------------------------------------------

describe("generateSessionBasedSchedule — 1x/week subject (fixedCount = 4)", () => {
  it("charges the full price when joining at the start of the month (4/4)", () => {
    const schedule = generateSessionBasedSchedule(
      new Date(2025, 0, 1), // Jan 1 (Wednesday)
      new Date(2025, 1, 15),
      WED_CTX,
      PRICE,
    );
    const jan = schedule.find((s) => s.monthKey === "2025-01");
    expect(jan).toBeDefined();
    expect(jan!.amount).toBe(400);
    // The start month's installment is due on the billing start itself.
    expect(jan!.dueDate).toBe("2025-01-01");
  });

  it("charges 75% when 3 of 4 sessions remain (3/4)", () => {
    // Inclusive window: the start session itself is billed, so start on a
    // NON-class day (Jan 14, Tue) → 15, 22, 29 remain = 3.
    const schedule = generateSessionBasedSchedule(
      new Date(2025, 0, 14),
      new Date(2025, 1, 15),
      WED_CTX,
      PRICE,
    );
    expect(schedule.find((s) => s.monthKey === "2025-01")!.amount).toBe(300);
  });

  it("charges 50% when 2 of 4 sessions remain (2/4)", () => {
    const schedule = generateSessionBasedSchedule(
      new Date(2025, 0, 21), // Jan 21 (Tue) → 22, 29 remain
      new Date(2025, 1, 15),
      WED_CTX,
      PRICE,
    );
    expect(schedule.find((s) => s.monthKey === "2025-01")!.amount).toBe(200);
  });

  it("charges nothing when a single session remains (lone session = FREE)", () => {
    const schedule = generateSessionBasedSchedule(
      new Date(2025, 0, 28), // Jan 28 (Tue) → 29 only remains
      new Date(2025, 1, 15),
      WED_CTX,
      PRICE,
    );
    expect(schedule.find((s) => s.monthKey === "2025-01")).toBeUndefined();
    // The next month is still billed in full.
    expect(schedule.find((s) => s.monthKey === "2025-02")!.amount).toBe(400);
  });

  it("bills the 5th occurrence of a month for FREE (invoice stays 400)", () => {
    // January 2025 has 5 Wednesdays; starting Jan 1 → 5 occurrences but
    // billable is capped at fixedCount = 4 → full price, 5th is free.
    const schedule = generateSessionBasedSchedule(
      new Date(2025, 0, 1),
      new Date(2025, 1, 15),
      WED_CTX,
      PRICE,
    );
    expect(schedule.find((s) => s.monthKey === "2025-01")!.amount).toBe(400);
  });

  it("charges full price for complete later months, due on the 1st", () => {
    // A later month anchors on its own 1st → full month (Rule 2).
    const schedule = generateSessionBasedSchedule(
      new Date(2025, 0, 15),
      new Date(2025, 2, 15), // through March
      WED_CTX,
      PRICE,
    );
    const feb = schedule.find((s) => s.monthKey === "2025-02");
    expect(feb!.amount).toBe(400);
    expect(feb!.dueDate).toBe("2025-02-01");
    const mar = schedule.find((s) => s.monthKey === "2025-03");
    expect(mar!.amount).toBe(400);
    expect(mar!.dueDate).toBe("2025-03-01");
  });

  it("emits no installment for months before the billing start", () => {
    const schedule = generateSessionBasedSchedule(
      new Date(2025, 1, 5), // first attendance in February
      new Date(2025, 2, 15),
      WED_CTX,
      PRICE,
    );
    expect(schedule.find((s) => s.monthKey === "2025-01")).toBeUndefined();
    expect(schedule.find((s) => s.monthKey === "2025-02")).toBeDefined();
  });

  it("emits nothing for a subject with no timetable", () => {
    expect(
      generateSessionBasedSchedule(
        new Date(2025, 0, 1),
        new Date(2025, 2, 15),
        makeCtx({ hasSession: false, scheduledDaysOfWeek: [] }),
        PRICE,
      ),
    ).toHaveLength(0);
  });

  it("emits nothing for a gap month (zero scheduled occurrences)", () => {
    const ctx = makeCtx({
      scheduledDaysOfWeek: [3],
      gapMonthKeys: new Set(["2025-02"]),
    });
    const schedule = generateSessionBasedSchedule(
      new Date(2025, 0, 1),
      new Date(2025, 2, 15),
      ctx,
      PRICE,
    );
    const monthKeys = schedule.map((s) => s.monthKey);
    expect(monthKeys).not.toContain("2025-02");
    expect(monthKeys).toContain("2025-01");
    expect(monthKeys).toContain("2025-03");
  });

  it("respects customPrice (Takhfid) in the computation", () => {
    const schedule = generateSessionBasedSchedule(
      new Date(2025, 0, 1),
      new Date(2025, 1, 15),
      WED_CTX,
      300,
    );
    expect(schedule.find((s) => s.monthKey === "2025-01")!.amount).toBe(300);
  });

  it("rounds per-session amounts to whole MAD", () => {
    // price 300 with fixedCount 4 → perSession 75 → 2 sessions = 150.
    const schedule = generateSessionBasedSchedule(
      new Date(2025, 0, 21), // 2 sessions remain (22, 29)
      new Date(2025, 1, 15),
      WED_CTX,
      300,
    );
    expect(schedule.find((s) => s.monthKey === "2025-01")!.amount).toBe(150);
  });
});

// ---------------------------------------------------------------------------
// 2x/week subject — fixedCount = 8
// ---------------------------------------------------------------------------

describe("generateSessionBasedSchedule — 2x/week subject (fixedCount = 8)", () => {
  // January 2025 Mondays: 6, 13, 20, 27. Thursdays: 2, 9, 16, 23, 30 → 9 total.
  const MON_THU_CTX = makeCtx({ scheduledDaysOfWeek: [1, 4] });
  const PRICE_2X = 800; // perSession = 100

  it("computes fixedCount = 8 for two scheduled days", () => {
    expect(getFixedSessionCount(MON_THU_CTX)).toBe(8);
    expect(getFixedSessionCount(WED_CTX)).toBe(4);
  });

  it("getStandardSessionCount mirrors fixedCount for a combo", () => {
    const sessions: Session[] = [
      makeRecurringSession("Math", "T.C", null, "Large", 1),
      makeRecurringSession("Math", "T.C", null, "Large", 4),
      makeRecurringSession("PC", "T.C", null, "Large", 2),
    ];
    expect(
      getStandardSessionCount(sessions, {
        level: "T.C",
        subject: "Math",
        track: null,
        groupType: "Large",
      }),
    ).toBe(8);
  });

  it("charges 50% when 4 of 8 sessions remain (4/8)", () => {
    const schedule = generateSessionBasedSchedule(
      new Date(2025, 0, 18), // Sat — from Mon 20, 27 + Thu 23, 30 = 4
      new Date(2025, 2, 15),
      MON_THU_CTX,
      PRICE_2X,
    );
    expect(schedule.find((s) => s.monthKey === "2025-01")!.amount).toBe(400);
  });

  it("caps a 9-occurrence month at 8 (full price)", () => {
    const schedule = generateSessionBasedSchedule(
      new Date(2025, 0, 1),
      new Date(2025, 1, 15),
      MON_THU_CTX,
      PRICE_2X,
    );
    expect(schedule.find((s) => s.monthKey === "2025-01")!.amount).toBe(800);
  });

  it("charges nothing when only 1 session remains in the start month", () => {
    const schedule = generateSessionBasedSchedule(
      new Date(2025, 0, 29), // Wed — only Thu 30 remains → FREE
      new Date(2025, 1, 15),
      MON_THU_CTX,
      PRICE_2X,
    );
    expect(schedule.find((s) => s.monthKey === "2025-01")).toBeUndefined();
    expect(schedule.find((s) => s.monthKey === "2025-02")!.amount).toBe(800);
  });
});

// ---------------------------------------------------------------------------
// computeMonthInvoice / computeExpectedMonthAmount
// ---------------------------------------------------------------------------

describe("computeMonthInvoice", () => {
  it("matches the schedule for a full-month start", () => {
    expect(computeMonthInvoice(new Date(2025, 0, 1), "2025-01", WED_CTX, PRICE)).toBe(
      400,
    );
  });

  it("prorates a mid-month start", () => {
    expect(computeMonthInvoice(new Date(2025, 0, 21), "2025-01", WED_CTX, PRICE)).toBe(
      200,
    );
  });

  it("computeExpectedMonthAmount mirrors computeMonthInvoice", () => {
    expect(
      computeExpectedMonthAmount(new Date(2025, 0, 21), "2025-01", WED_CTX, PRICE),
    ).toBe(computeMonthInvoice(new Date(2025, 0, 21), "2025-01", WED_CTX, PRICE));
  });

  it("returns null for the start month with a single session left", () => {
    expect(computeMonthInvoice(new Date(2025, 0, 28), "2025-01", WED_CTX, PRICE)).toBeNull();
  });

  it("returns null for months before the billing start", () => {
    expect(computeMonthInvoice(new Date(2025, 2, 1), "2025-01", WED_CTX, PRICE)).toBeNull();
  });

  it("returns null for a subject with no timetable", () => {
    expect(
      computeMonthInvoice(
        new Date(2025, 0, 1),
        "2025-01",
        makeCtx({ hasSession: false, scheduledDaysOfWeek: [] }),
        PRICE,
      ),
    ).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Rule B — the untouched rolling cycle (every 2Bac Small combo)
// ---------------------------------------------------------------------------

describe("Rule B rolling cycle", () => {
  it("bills the full price on the join day and every month on the same day", () => {
    const schedule = generateRuleBSchedule(
      new Date(2025, 0, 12),
      new Date(2025, 3, 15),
      500,
    );
    expect(schedule).toHaveLength(4); // Jan 12, Feb 12, Mar 12, Apr 12
    expect(schedule.map((s) => s.dueDate)).toEqual([
      "2025-01-12",
      "2025-02-12",
      "2025-03-12",
      "2025-04-12",
    ]);
    expect(schedule.every((s) => s.amount === 500)).toBe(true);
  });

  it("generateScheduleFor routes Rule A vs Rule B", () => {
    const ruleA = generateScheduleFor(
      "A",
      new Date(2025, 0, 21),
      new Date(2025, 1, 15),
      WED_CTX,
      PRICE,
    );
    expect(ruleA.find((s) => s.monthKey === "2025-01")!.amount).toBe(200);

    const ruleB = generateScheduleFor(
      "B",
      new Date(2025, 0, 12),
      new Date(2025, 1, 15),
      WED_CTX,
      PRICE,
    );
    expect(ruleB.map((s) => s.dueDate)).toContain("2025-02-12");
  });
});

// ---------------------------------------------------------------------------
// buildDeliveredDatesContext — one_off sessions are free, combos are matched
// ---------------------------------------------------------------------------

describe("buildDeliveredDatesContext", () => {
  it("collects standard recurring days and ignores one_off sessions", () => {
    const sessions: Session[] = [
      makeRecurringSession("Math", "T.C", null, "Large", 3),
      {
        ...makeRecurringSession("Math", "T.C", null, "Large", 5),
        kind: "one_off" as const,
        date: "2025-01-10",
      },
    ];
    const ctx = buildDeliveredDatesContext(
      sessions,
      [],
      { level: "T.C", subject: "Math", track: null, groupType: "Large" },
      new Date(2025, 0, 1),
    );
    expect(ctx.hasSession).toBe(true);
    expect(ctx.scheduledDaysOfWeek).toEqual([3]); // one_off excluded
    expect(getFixedSessionCount(ctx)).toBe(4);
  });

  it("reports no session for a combo without a timetable", () => {
    const ctx = buildDeliveredDatesContext(
      [makeRecurringSession("PC", "T.C", null, "Large", 3)],
      [],
      { level: "T.C", subject: "Math", track: null, groupType: "Large" },
      new Date(2025, 0, 1),
    );
    expect(ctx.hasSession).toBe(false);
    expect(ctx.scheduledDaysOfWeek).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Attendance anchors — per-month (Rule 2) + global
// ---------------------------------------------------------------------------

describe("earliestMonthAttendance — the per-month anchor", () => {
  const attSessions: Session[] = [
    makeRecurringSession("Math", "T.C", null, "Large", 2),
    makeRecurringSession("Math", "T.C", null, "Large", 4),
  ];

  it("returns the earliest PRESENT attendance date WITHIN the month", () => {
    const records: AttendanceRecord[] = [
      makeAttendance(STUDENT_ID, "session-Math-T.C-2", "2026-09-17"),
      makeAttendance(STUDENT_ID, "session-Math-T.C-4", "2026-09-10"),
      makeAttendance(STUDENT_ID, "session-Math-T.C-2", "2026-09-24"),
    ];
    expect(
      earliestMonthAttendance(
        STUDENT_ID,
        "Math",
        "2026-09",
        records,
        attSessions,
        "2026-11-15",
      ),
    ).toEqual(new Date(2026, 8, 10));
  });

  it("returns null for a month with no attendance mark yet", () => {
    // Months with no mark yet anchor on the 1st at the caller level — here
    // the helper reports the absence.
    const records: AttendanceRecord[] = [
      makeAttendance(STUDENT_ID, "session-Math-T.C-2", "2026-09-17"),
    ];
    expect(
      earliestMonthAttendance(
        STUDENT_ID,
        "Math",
        "2026-10",
        records,
        attSessions,
        "2026-11-15",
      ),
    ).toBeNull();
  });

  it("ignores future-dated marks and ABSENT marks", () => {
    const records: AttendanceRecord[] = [
      makeAttendance(STUDENT_ID, "session-Math-T.C-2", "2026-09-01", "absent"),
      makeAttendance(STUDENT_ID, "session-Math-T.C-4", "2026-12-01"), // future
      makeAttendance(STUDENT_ID, "session-Math-T.C-4", "2026-09-15"),
    ];
    expect(
      earliestMonthAttendance(
        STUDENT_ID,
        "Math",
        "2026-09",
        records,
        attSessions,
        "2026-11-15",
      ),
    ).toEqual(new Date(2026, 8, 15));
  });

  it("ignores other students and other subjects' sessions", () => {
    const records: AttendanceRecord[] = [
      makeAttendance("other-student", "session-Math-T.C-2", "2026-09-01"),
      makeAttendance(STUDENT_ID, "session-Math-T.C-2", "2026-09-15"),
    ];
    expect(
      earliestMonthAttendance(
        STUDENT_ID,
        "Math",
        "2026-09",
        records,
        attSessions,
        "2026-11-15",
      ),
    ).toEqual(new Date(2026, 8, 15));
  });
});

describe("earliestValidAttendanceDate — the global anchor", () => {
  const attSessions: Session[] = [
    makeRecurringSession("Math", "T.C", null, "Large", 2),
    makeRecurringSession("PC", "T.C", null, "Large", 3),
  ];

  it("returns the earliest non-future attendance date for the subject", () => {
    const records: AttendanceRecord[] = [
      makeAttendance(STUDENT_ID, "session-Math-T.C-2", "2026-09-17"),
      makeAttendance(STUDENT_ID, "session-Math-T.C-2", "2026-09-10"),
      makeAttendance(STUDENT_ID, "session-Math-T.C-2", "2026-09-24"),
    ];
    expect(
      earliestValidAttendanceDate(STUDENT_ID, "Math", records, attSessions, "2026-11-15"),
    ).toEqual(new Date(2026, 8, 10));
  });

  it("returns null when the student has no attendance yet", () => {
    expect(
      earliestValidAttendanceDate(STUDENT_ID, "Math", [], attSessions, "2026-11-15"),
    ).toBeNull();
  });

  it("ignores future-dated records", () => {
    const records: AttendanceRecord[] = [
      makeAttendance(STUDENT_ID, "session-Math-T.C-2", "2026-09-17"),
      makeAttendance(STUDENT_ID, "session-Math-T.C-2", "2026-12-01"),
    ];
    expect(
      earliestValidAttendanceDate(STUDENT_ID, "Math", records, attSessions, "2026-11-15"),
    ).toEqual(new Date(2026, 8, 17));
  });

  it("ignores ABSENT records — only a PRESENT mark anchors billing", () => {
    const records: AttendanceRecord[] = [
      makeAttendance(STUDENT_ID, "session-Math-T.C-2", "2026-09-01", "absent"),
      makeAttendance(STUDENT_ID, "session-Math-T.C-2", "2026-09-15", "present"),
    ];
    expect(
      earliestValidAttendanceDate(STUDENT_ID, "Math", records, attSessions, "2026-11-15"),
    ).toEqual(new Date(2026, 8, 15));
  });

  it("ignores other students' records and other subjects' sessions", () => {
    const records: AttendanceRecord[] = [
      makeAttendance("other-student", "session-Math-T.C-2", "2026-09-01"),
      makeAttendance(STUDENT_ID, "session-PC-T.C-3", "2026-09-03"),
      makeAttendance(STUDENT_ID, "session-Math-T.C-2", "2026-09-15"),
    ];
    expect(
      earliestValidAttendanceDate(STUDENT_ID, "Math", records, attSessions, "2026-11-15"),
    ).toEqual(new Date(2026, 8, 15));
  });
});

// ---------------------------------------------------------------------------
// applyCreditWaterfall — the wallet waterfall (surplus rolls forward)
// ---------------------------------------------------------------------------

describe("applyCreditWaterfall", () => {
  it("distributes credit across gaps dueDate-ascending (surplus rolls forward)", () => {
    const payments: Payment[] = [
      makePayment("p1", STUDENT_ID, "PC", "2025-01-01", 300),
      makePayment("p2", STUDENT_ID, "PC", "2025-02-01", 300),
      makePayment("p3", STUDENT_ID, "PC", "2025-03-01", 400),
    ];

    const result = applyCreditWaterfall(
      payments,
      STUDENT_ID,
      "PC",
      500,
      "2025-01-15",
      NOW,
    );

    expect(result.remaining).toBe(0);
    expect(result.anyChanged).toBe(true);
    expect(result.updated.find((p) => p.id === "p1")!.amountPaid).toBe(300);
    expect(isPaymentFullyPaid(result.updated.find((p) => p.id === "p1")!)).toBe(true);
    expect(result.updated.find((p) => p.id === "p2")!.amountPaid).toBe(200);
    expect(isPaymentFullyPaid(result.updated.find((p) => p.id === "p2")!)).toBe(false);
    expect(result.updated.find((p) => p.id === "p3")).toBeUndefined();
  });

  it("shows surplus on the NEXT month as partial credit (the green contract)", () => {
    // Month 9 fully paid; a 150 surplus must land on month 10's row.
    const payments: Payment[] = [
      makePayment("m9", STUDENT_ID, "Math", "2026-09-01", 350, 350, true),
      makePayment("m10", STUDENT_ID, "Math", "2026-10-01", 350),
    ];
    const result = applyCreditWaterfall(
      payments,
      STUDENT_ID,
      "Math",
      150,
      "2026-09-30",
      NOW,
    );
    const m10 = result.updated.find((p) => p.id === "m10");
    expect(m10).toBeDefined();
    expect(m10!.amountPaid).toBe(150); // shown GREEN as advance credit
    expect(m10!.isPaid).toBe(false);
    expect(result.remaining).toBe(0);
  });

  it("stores surplus as remaining when credit exceeds all gaps", () => {
    const payments: Payment[] = [
      makePayment("p1", STUDENT_ID, "PC", "2025-01-01", 300),
    ];
    const result = applyCreditWaterfall(payments, STUDENT_ID, "PC", 700, "2025-01-15", NOW);
    expect(result.remaining).toBe(400);
    expect(isPaymentFullyPaid(result.updated[0])).toBe(true);
  });

  it("returns zero credit input unchanged", () => {
    const payments: Payment[] = [
      makePayment("p1", STUDENT_ID, "PC", "2025-01-01", 300),
    ];
    const result = applyCreditWaterfall(payments, STUDENT_ID, "PC", 0, "2025-01-15", NOW);
    expect(result.remaining).toBe(0);
    expect(result.updated).toHaveLength(0);
    expect(result.anyChanged).toBe(false);
  });

  it("handles negative / NaN credit gracefully", () => {
    const payments: Payment[] = [
      makePayment("p1", STUDENT_ID, "PC", "2025-01-01", 300),
    ];
    const result = applyCreditWaterfall(payments, STUDENT_ID, "PC", -50, "2025-01-15", NOW);
    expect(result.remaining).toBe(0);
    expect(result.updated).toHaveLength(0);
  });

  it("cross-subject mode (subject=null) spills across subjects", () => {
    const payments: Payment[] = [
      makePayment("p1", STUDENT_ID, "PC", "2025-01-01", 300),
      makePayment("p2", STUDENT_ID, "Math", "2025-01-01", 200),
    ];
    const result = applyCreditWaterfall(payments, STUDENT_ID, null, 400, "2025-01-15", NOW);
    expect(result.remaining).toBe(0);
    expect(result.updated).toHaveLength(2);
  });

  it("per-subject mode only touches one subject", () => {
    const payments: Payment[] = [
      makePayment("p1", STUDENT_ID, "PC", "2025-01-01", 300),
      makePayment("p2", STUDENT_ID, "Math", "2025-01-01", 200),
    ];
    const result = applyCreditWaterfall(payments, STUDENT_ID, "PC", 400, "2025-01-15", NOW);
    expect(result.remaining).toBe(100);
    expect(result.updated).toHaveLength(1);
    expect(result.updated[0].id).toBe("p1");
  });

  it("skips already-fully-paid installments", () => {
    const payments: Payment[] = [
      makePayment("p1", STUDENT_ID, "PC", "2025-01-01", 300, 300, true),
      makePayment("p2", STUDENT_ID, "PC", "2025-02-01", 300),
    ];
    const result = applyCreditWaterfall(payments, STUDENT_ID, "PC", 100, "2025-01-15", NOW);
    expect(result.remaining).toBe(0); // wallet fully absorbed on p2's 300 gap
    expect(result.updated).toHaveLength(1);
    expect(result.updated[0].id).toBe("p2");
    expect(result.updated[0].amountPaid).toBe(100);
  });

  it("respects studentId filter", () => {
    const payments: Payment[] = [
      makePayment("p1", STUDENT_ID, "PC", "2025-01-01", 300),
      makePayment("p2", "other-student", "PC", "2025-01-01", 300),
    ];
    const result = applyCreditWaterfall(payments, STUDENT_ID, "PC", 300, "2025-01-15", NOW);
    expect(result.remaining).toBe(0);
    expect(result.updated).toHaveLength(1);
    expect(result.updated[0].id).toBe("p1");
  });
});

// ---------------------------------------------------------------------------
// Rule A carryover contract — surplus beyond the prorated first month lands
// on the next month as partial credit (green), and any remainder parks in
// advance_balance. amountDue values mirror the engine's dynamic output for
// a 350 DH subject joined mid-month (219 = 5/8 prorated first month).
// ---------------------------------------------------------------------------

describe("applyCreditWaterfall — Rule A carryover contract", () => {
  const PRORATED_FIRST = 219; // 5 × 43.75
  const FULL_MONTH = 350;

  function specPayments(): Payment[] {
    return [
      makePayment("sept", STUDENT_ID, "Math", "2026-09-15", PRORATED_FIRST),
      makePayment("oct", STUDENT_ID, "Math", "2026-10-01", FULL_MONTH),
      makePayment("nov", STUDENT_ID, "Math", "2026-11-01", FULL_MONTH),
    ];
  }

  it("(a) surplus beyond the prorated first month lands on the next month as partial credit, and any remainder parks as advance_balance", () => {
    // 400 − 219 = 181 surplus → October is PARTIALLY PAID (green chip),
    // wallet exhausted, nothing parks.
    const partial = applyCreditWaterfall(
      specPayments(),
      STUDENT_ID,
      "Math",
      400,
      "2026-09-30",
      NOW,
    );
    const byId = new Map(partial.updated.map((p) => [p.id, p]));
    expect(byId.get("sept")!.amountPaid).toBe(PRORATED_FIRST);
    expect(isPaymentFullyPaid(byId.get("sept")!)).toBe(true);
    expect(byId.get("oct")!.amountPaid).toBe(181); // green advance credit
    expect(byId.get("oct")!.isPaid).toBe(false);
    expect(byId.get("nov")).toBeUndefined(); // wallet dry
    expect(partial.remaining).toBe(0); // advance_balance untouched

    // 619 = 219 + 350 + 50 → Sept & Oct fully paid, Nov partial, nothing parks.
    const threeWay = applyCreditWaterfall(
      specPayments(),
      STUDENT_ID,
      "Math",
      619,
      "2026-09-30",
      NOW,
    );
    const byId3 = new Map(threeWay.updated.map((p) => [p.id, p]));
    expect(isPaymentFullyPaid(byId3.get("sept")!)).toBe(true);
    expect(isPaymentFullyPaid(byId3.get("oct")!)).toBe(true);
    expect(byId3.get("nov")!.amountPaid).toBe(50);
    expect(byId3.get("nov")!.isPaid).toBe(false);
    expect(threeWay.remaining).toBe(0);

    // 1000 covers every gap with 81 left over → the remainder parks in
    // advance_balance (returned as `remaining` for the caller to store).
    const surplus = applyCreditWaterfall(
      specPayments(),
      STUDENT_ID,
      "Math",
      1000,
      "2026-09-30",
      NOW,
    );
    expect(surplus.updated.every(isPaymentFullyPaid)).toBe(true);
    expect(surplus.remaining).toBe(1000 - PRORATED_FIRST - 2 * FULL_MONTH); // 81
  });

  it("(b) a wallet exactly covering multiple months leaves them fully paid with zero remainder", () => {
    const exact = PRORATED_FIRST + 2 * FULL_MONTH; // 919
    const result = applyCreditWaterfall(
      specPayments(),
      STUDENT_ID,
      "Math",
      exact,
      "2026-09-30",
      NOW,
    );
    expect(result.remaining).toBe(0);
    expect(result.updated).toHaveLength(3);
    // No partial month: every credited row is settled, none left green.
    expect(result.updated.every((p) => isPaymentFullyPaid(p))).toBe(true);
    expect(result.updated.every((p) => p.isPaid)).toBe(true);
  });

  it("(c) a wallet fully absorbed by the first gap leaves advance_balance at 0", () => {
    // 100 < 219 → September is partially paid and the wallet hits 0, so
    // nothing parks and later months are untouched.
    const result = applyCreditWaterfall(
      specPayments(),
      STUDENT_ID,
      "Math",
      100,
      "2026-09-30",
      NOW,
    );
    expect(result.remaining).toBe(0);
    expect(result.updated).toHaveLength(1);
    expect(result.updated[0].id).toBe("sept");
    expect(result.updated[0].amountPaid).toBe(100);
    expect(result.updated[0].isPaid).toBe(false);
  });

  it("(d) never re-prices or re-dates Rule B rows, and leaves other subjects' rows untouched", () => {
    const ruleBRow = makePayment(
      "ruleb",
      STUDENT_ID,
      "Math",
      "2026-09-15",
      500,
      0,
      false,
      "B",
    );
    const otherSubjectRow = makePayment(
      "other",
      STUDENT_ID,
      "PC",
      "2026-09-01",
      300,
      0,
      false,
      "B",
    );

    // Per-subject waterfall: the other subject's row is out of scope entirely.
    const result = applyCreditWaterfall(
      [ruleBRow, otherSubjectRow],
      STUDENT_ID,
      "Math",
      150,
      "2026-09-30",
      NOW,
    );
    expect(result.updated).toHaveLength(1);
    const credited = result.updated[0];
    // The in-scope Rule B row may absorb wallet credit (it is still owed),
    // but the waterfall never re-prices or re-dates it — the Rule B anchor,
    // amount, and rule field are frozen.
    expect(credited.id).toBe("ruleb");
    expect(credited.amountDue).toBe(500);
    expect(credited.dueDate).toBe("2026-09-15");
    expect(credited.rule).toBe("B");
    expect(credited.amountPaid).toBe(150);
    expect(credited.isPaid).toBe(false);
    expect(result.remaining).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// aggregateOverdueInstallments — the advance-credit GREEN contract
// ---------------------------------------------------------------------------

describe("aggregateOverdueInstallments — advance-credit green contract", () => {
  const TODAY = "2026-10-15"; // mid-October reference date

  it("flags a currently-due partially paid month (0 < amountPaid < amountDue)", () => {
    const payments: Payment[] = [
      makePayment("m9", STUDENT_ID, "Math", "2026-09-01", 350, 350, true),
      makePayment("m10", STUDENT_ID, "Math", "2026-10-01", 350, 120, false),
    ];
    const rows = aggregateOverdueInstallments(payments, TODAY);
    const row = rows.get(`${STUDENT_ID}__Math`);
    expect(row).toBeDefined();
    expect(row!.installments).toHaveLength(1);
    expect(row!.isPartiallyPaid).toBe(true);
    expect(row!.totalAmountPaid).toBe(120);
    expect(row!.totalRemaining).toBe(230);
  });

  it("keeps a fully-unpaid due month red (no partial flag, no paid credit)", () => {
    const payments: Payment[] = [
      makePayment("m10", STUDENT_ID, "Math", "2026-10-01", 350, 0, false),
    ];
    const row = aggregateOverdueInstallments(payments, TODAY).get(
      `${STUDENT_ID}__Math`,
    );
    expect(row!.isPartiallyPaid).toBe(false);
    expect(row!.totalAmountPaid).toBe(0);
  });

  it("reports the NEXT month's wallet credit on the row (green advance credit)", () => {
    // Sept + Oct are due & unpaid; November absorbed a 181 DH wallet surplus
    // via applyCreditWaterfall → 0 < amountPaid < amountDue ⇒ partial.
    const payments: Payment[] = [
      makePayment("m9", STUDENT_ID, "Math", "2026-09-01", 350, 0, false),
      makePayment("m10", STUDENT_ID, "Math", "2026-10-01", 350, 0, false),
      makePayment("m11", STUDENT_ID, "Math", "2026-11-01", 350, 181, false),
    ];
    const rows = aggregateOverdueInstallments(payments, TODAY);
    const row = rows.get(`${STUDENT_ID}__Math`);
    expect(row).toBeDefined();
    // Only the due months join the worklist — the future month never does.
    expect(row!.installments.map((p) => p.id)).toEqual(["m9", "m10"]);
    // The due months are fully unpaid → the amount cell stays non-green; the
    // future month's credit is carried by the next-due cell instead.
    expect(row!.isPartiallyPaid).toBe(false);
    expect(row!.nextDueDate).toBe("2026-11-01");
    expect(row!.nextDueRemaining).toBe(169); // 350 − 181
    expect(row!.nextDueAmountPaid).toBe(181);
  });

  it("never mints a worklist row for a combo whose only debt is future", () => {
    // A fully-settled combo with a partially-credited future month has
    // nothing due today → it belongs in the settled worklist, not here.
    const payments: Payment[] = [
      makePayment("m10", STUDENT_ID, "Math", "2026-10-01", 350, 350, true),
      makePayment("m11", STUDENT_ID, "Math", "2026-11-01", 350, 181, false),
    ];
    expect(
      aggregateOverdueInstallments(payments, TODAY).has(`${STUDENT_ID}__Math`),
    ).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// dedupePayments — one row per student__subject__month (No-Loop-Bug)
// ---------------------------------------------------------------------------

describe("dedupePayments", () => {
  it("collapses same-month duplicates regardless of dueDate", () => {
    const payments: Payment[] = [
      makePayment("p1", STUDENT_ID, "Math", "2025-01-01", 400, 0, false),
      makePayment("p2", STUDENT_ID, "Math", "2025-01-08", 400, 400, true),
      makePayment("p3", STUDENT_ID, "Math", "2025-02-01", 400, 0, false),
    ];
    const result = dedupePayments(payments);
    expect(result.kept.map((p) => p.id).sort()).toEqual(["p2", "p3"]);
    expect(result.duplicateIds).toEqual(["p1"]); // the settled row wins
  });

  it("returns the ledger untouched when it is already clean", () => {
    const payments: Payment[] = [
      makePayment("p1", STUDENT_ID, "Math", "2025-01-01", 400, 0, false),
      makePayment("p2", STUDENT_ID, "Math", "2025-02-01", 400, 0, false),
    ];
    expect(dedupePayments(payments)).toEqual({ kept: payments, duplicateIds: [] });
  });
});

// ---------------------------------------------------------------------------
// reconcile — daily self-heal
// ---------------------------------------------------------------------------

describe("reconcilePaymentAmounts", () => {
  const sessions = [makeRecurringSession("Math", "T.C", null, "Large", 3)];
  const prices: PriceEntry[] = [
    {
      id: "price-1",
      level: "T.C",
      subject: "Math",
      track: null,
      groupType: "Large",
      price: PRICE,
    },
  ];

  function ledgerStudent(customPrice?: number): Student {
    const enrollment: SubjectEnrollment = {
      subject: "Math",
      track: null,
      groupType: "Large",
      enrolledAt: "2025-01-01T12:00:00.000Z",
    };
    if (customPrice !== undefined) enrollment.customPrice = customPrice;
    return makeStudent({ level: "T.C", enrollments: [enrollment] });
  }

  it("corrects a stale Rule A amount and clears a false isPaid", () => {
    const payments: Payment[] = [
      makePayment("p1", STUDENT_ID, "Math", "2025-01-01", 320, 320, true),
    ];
    const patches = reconcilePaymentAmounts(
      payments,
      [ledgerStudent()],
      sessions,
      prices,
      [],
      "2025-02-15",
    );
    expect(patches).toHaveLength(1);
    expect(patches[0].id).toBe("p1");
    expect(patches[0].amountDue).toBe(400);
    expect(patches[0].isPaid).toBe(false); // 320 < 400
  });

  it("keeps isPaid = true only when amountPaid covers the new amount", () => {
    const payments: Payment[] = [
      makePayment("p1", STUDENT_ID, "Math", "2025-01-01", 320, 400, true),
    ];
    const patches = reconcilePaymentAmounts(
      payments,
      [ledgerStudent()],
      sessions,
      prices,
      [],
      "2025-02-15",
    );
    expect(patches[0].amountDue).toBe(400);
    expect(patches[0].isPaid).toBe(true);
  });

  it("leaves correct rows untouched", () => {
    const payments: Payment[] = [
      makePayment("p1", STUDENT_ID, "Math", "2025-01-01", 400, 0, false),
    ];
    expect(
      reconcilePaymentAmounts(
        payments,
        [ledgerStudent()],
        sessions,
        prices,
        [],
        "2025-02-15",
      ),
    ).toHaveLength(0);
  });

  it("never touches Rule B rows", () => {
    const payments: Payment[] = [
      makePayment("p1", STUDENT_ID, "Math", "2025-01-01", 999, 0, false, "B"),
    ];
    expect(
      reconcilePaymentAmounts(
        payments,
        [ledgerStudent()],
        sessions,
        prices,
        [],
        "2025-02-15",
      ),
    ).toHaveLength(0);
  });

  it("respects customPrice when recomputing", () => {
    const payments: Payment[] = [
      makePayment("p1", STUDENT_ID, "Math", "2025-01-01", 400, 0, false),
    ];
    const patches = reconcilePaymentAmounts(
      payments,
      [ledgerStudent(300)],
      sessions,
      prices,
      [],
      "2025-02-15",
    );
    expect(patches[0].amountDue).toBe(300);
  });
});

describe("reconcileRuleALedger", () => {
  const sessions = [makeRecurringSession("Math", "T.C", null, "Large", 3)];
  const prices: PriceEntry[] = [
    {
      id: "price-1",
      level: "T.C",
      subject: "Math",
      track: null,
      groupType: "Large",
      price: PRICE,
    },
  ];

  function ledgerStudent(enrolledAt = "2025-01-01T12:00:00.000Z"): Student {
    return makeStudent({
      level: "T.C",
      enrollments: [
        { subject: "Math", track: null, groupType: "Large", enrolledAt },
      ],
    });
  }

  it("reports a stale Rule A amount as an update (paid progress preserved)", () => {
    const payments: Payment[] = [
      makePayment("p1", STUDENT_ID, "Math", "2025-01-01", 320, 150, false),
    ];
    const result = reconcileRuleALedger(
      payments,
      [ledgerStudent()],
      sessions,
      prices,
      [],
      "2025-02-15",
    );
    expect(result.delete).toEqual([]);
    expect(result.update).toEqual([
      {
        id: "p1",
        amountDue: 400,
        dueDate: "2025-01-01",
        amountPaid: 150,
        isPaid: false,
      },
    ]);
  });

  it("reports a correct row as untouched", () => {
    const payments: Payment[] = [
      makePayment("p1", STUDENT_ID, "Math", "2025-01-01", 400, 400, true),
    ];
    const result = reconcileRuleALedger(
      payments,
      [ledgerStudent()],
      sessions,
      prices,
      [],
      "2025-02-15",
    );
    expect(result.update).toEqual([]);
    expect(result.delete).toEqual([]);
  });

  it("deletes a row whose month is no longer billable (timetable removed)", () => {
    const payments: Payment[] = [
      makePayment("p1", STUDENT_ID, "Math", "2025-01-01", 400, 0, false),
    ];
    const result = reconcileRuleALedger(
      payments,
      [ledgerStudent()],
      [], // no sessions → no timetable
      prices,
      [],
      "2025-02-15",
    );
    expect(result.update).toEqual([]);
    expect(result.delete).toEqual(["p1"]);
  });

  it("deletes a row whose enrollment was dropped", () => {
    const payments: Payment[] = [
      makePayment("p1", STUDENT_ID, "Math", "2025-01-01", 400, 0, false),
    ];
    const result = reconcileRuleALedger(
      payments,
      [makeStudent({ level: "T.C", enrollments: [] })],
      sessions,
      prices,
      [],
      "2025-02-15",
    );
    expect(result.delete).toEqual(["p1"]);
  });

  it("deletes a row whose price no longer resolves", () => {
    const payments: Payment[] = [
      makePayment("p1", STUDENT_ID, "Math", "2025-01-01", 400, 0, false),
    ];
    const result = reconcileRuleALedger(
      payments,
      [ledgerStudent()],
      sessions,
      [],
      [],
      "2025-02-15",
    );
    expect(result.delete).toEqual(["p1"]);
  });

  it("never touches Rule B rows, even stale ones", () => {
    const payments: Payment[] = [
      makePayment("p1", STUDENT_ID, "Math", "2025-01-01", 999, 0, false, "B"),
    ];
    const result = reconcileRuleALedger(payments, [ledgerStudent()], [], [], [], "2025-02-15");
    expect(result.update).toEqual([]);
    expect(result.delete).toEqual([]);
  });

  it("re-dates the keeper onto the anchor when attendance moved it", () => {
    const payments: Payment[] = [
      makePayment("p1", STUDENT_ID, "Math", "2025-01-01", 400, 0, false),
    ];
    const attendance: AttendanceRecord[] = [
      makeAttendance(STUDENT_ID, "session-Math-T.C-3", "2025-01-08"),
    ];
    const result = reconcileRuleALedger(
      payments,
      [ledgerStudent()],
      sessions,
      prices,
      attendance,
      "2025-01-31",
    );
    expect(result.delete).toEqual([]);
    expect(result.update).toEqual([
      {
        id: "p1",
        amountDue: 400, // Jan 8 + 15 + 22 + 29 = 4 sessions
        dueDate: "2025-01-08",
        amountPaid: 0,
        isPaid: false,
      },
    ]);
  });

  it("collapses two same-month rows into ONE and pools the credit", () => {
    const payments: Payment[] = [
      makePayment("p1", STUDENT_ID, "Math", "2025-01-01", 400, 250, false),
      makePayment("p2", STUDENT_ID, "Math", "2025-01-08", 400, 150, false),
    ];
    const result = reconcileRuleALedger(
      payments,
      [ledgerStudent()],
      sessions,
      prices,
      [],
      "2025-02-15",
    );
    expect(result.delete).toEqual(["p2"]);
    expect(result.update).toEqual([
      {
        id: "p1",
        amountDue: 400,
        dueDate: "2025-01-01",
        amountPaid: 400, // 250 + 150 pooled
        isPaid: true,
      },
    ]);
  });
});

// ---------------------------------------------------------------------------//
// Spec regression — T.C Math 350 DH · Mardi+Jeudi 19:00 · enrolled 2026-09-15
// ---------------------------------------------------------------------------//
// Sept 2026: Tuesdays 1, 8, 15, 22, 29 (5) + Thursdays 3, 10, 17, 24 (4).
// fixedCount = 8, perSession = 350 / 8 = 43.75.
//   billing start 15/09 (no attendance)     → 5 sessions → 219 DH
//   attendance anchor 17/09                  → 4 sessions → 175 DH
//   attendance anchor 10/09 (pre-registration) → 6 sessions → 263 DH
//   attendance anchor 08/09                  → 7 sessions → 306 DH

describe("Spec regression — T.C Math 350 DH · Tue+Thu · enrolled 2026-09-15", () => {
  const TUE_THU_CTX = makeCtx({ scheduledDaysOfWeek: [2, 4] }); // Mardi + Jeudi
  const PRICE_350 = 350;
  const ENROLLED = new Date(2026, 8, 15); // 2026-09-15 (Tuesday)

  it("bills Sept 2026 at 219 DH (5 sessions × 43.75), due on the start date", () => {
    expect(getFixedSessionCount(TUE_THU_CTX)).toBe(8);
    const schedule = generateSessionBasedSchedule(
      ENROLLED,
      new Date(2026, 10, 15), // through Nov 2026
      TUE_THU_CTX,
      PRICE_350,
    );
    const sept = schedule.find((s) => s.monthKey === "2026-09");
    expect(sept).toBeDefined();
    expect(sept!.amount).toBe(219);
    expect(sept!.dueDate).toBe("2026-09-15");
  });

  it("re-bills Sept 2026 at 175 DH when attendance anchors on 17/09", () => {
    const schedule = generateSessionBasedSchedule(
      new Date(2026, 8, 17), // attendance anchor 2026-09-17 (Thursday)
      new Date(2026, 10, 15),
      TUE_THU_CTX,
      PRICE_350,
    );
    const sept = schedule.find((s) => s.monthKey === "2026-09");
    expect(sept!.amount).toBe(175);
    expect(sept!.dueDate).toBe("2026-09-17");
  });

  it("re-bills Sept 2026 at 263 DH when a 10/09 mark predates enrollment", () => {
    const schedule = generateSessionBasedSchedule(
      new Date(2026, 8, 10), // attendance anchor 2026-09-10 (Thursday)
      new Date(2026, 10, 15),
      TUE_THU_CTX,
      PRICE_350,
    );
    const sept = schedule.find((s) => s.monthKey === "2026-09");
    expect(sept!.amount).toBe(263);
    expect(sept!.dueDate).toBe("2026-09-10");
  });

  it("bills Sept 2026 at 306 DH when 7 of 8 sessions remain", () => {
    const schedule = generateSessionBasedSchedule(
      new Date(2026, 8, 8), // attendance anchor 2026-09-08 (Tuesday)
      new Date(2026, 10, 15),
      TUE_THU_CTX,
      PRICE_350,
    );
    const sept = schedule.find((s) => s.monthKey === "2026-09");
    expect(sept!.amount).toBe(306);
    expect(sept!.dueDate).toBe("2026-09-08");
  });

  it("bills Oct 2026 at the full 350 DH (9 occurrences capped at 8)", () => {
    const schedule = generateSessionBasedSchedule(
      ENROLLED,
      new Date(2026, 10, 15),
      TUE_THU_CTX,
      PRICE_350,
    );
    const oct = schedule.find((s) => s.monthKey === "2026-10");
    expect(oct!.amount).toBe(350);
    expect(oct!.dueDate).toBe("2026-10-01");
  });

  it("charges nothing when only one session remains in the start month", () => {
    const schedule = generateSessionBasedSchedule(
      new Date(2026, 8, 25), // Fri — past the last Thursday
      new Date(2026, 10, 15),
      TUE_THU_CTX,
      PRICE_350,
    );
    expect(schedule.find((s) => s.monthKey === "2026-09")).toBeUndefined();
    expect(schedule.find((s) => s.monthKey === "2026-10")!.amount).toBe(350);
  });
});

// ---------------------------------------------------------------------------//
// recalculateStudentSubjectLedger — the reactive per-month rebuild
// ---------------------------------------------------------------------------//

describe("recalculateStudentSubjectLedger", () => {
  const SPEC_SESSIONS: Session[] = [
    makeRecurringSession("Math", "T.C", null, "Large", 2),
    makeRecurringSession("Math", "T.C", null, "Large", 4),
  ];
  const SPEC_PRICES: PriceEntry[] = [
    {
      id: "price-spec",
      level: "T.C",
      subject: "Math",
      track: null,
      groupType: "Large",
      price: 350,
    },
  ];
  const SPEC_AS_OF = new Date(2026, 10, 15); // through Nov 2026
  const SPEC_AS_OF_KEY = "2026-11-15";
  const SPEC_UPDATED_AT = "2026-11-15T12:00:00.000Z";

  function specStudent(
    enrolledAt = "2026-09-15T12:00:00.000Z",
    customPrice?: number,
    advanceBalance?: number,
  ): Student {
    const enrollment: SubjectEnrollment = {
      subject: "Math",
      track: null,
      groupType: "Large",
      enrolledAt,
    };
    if (customPrice !== undefined) enrollment.customPrice = customPrice;
    return makeStudent({ level: "T.C", enrollments: [enrollment], advanceBalance });
  }

  function specCtx(
    payments: Payment[],
    attendanceRecords: AttendanceRecord[],
    asOf = SPEC_AS_OF,
    asOfKey = SPEC_AS_OF_KEY,
  ) {
    return {
      payments,
      sessions: SPEC_SESSIONS,
      attendanceRecords,
      prices: SPEC_PRICES,
      asOf,
      asOfKey,
      updatedAt: SPEC_UPDATED_AT,
    };
  }

  /** Simulates the store's in-place application of a recalc diff. */
  function applyDiff(existing: Payment[], result: RecalculateResult): Payment[] {
    const upsertById = new Map(result.toUpsert.map((p) => [p.id, p]));
    const deleteSet = new Set(result.toDelete);
    const existingIds = new Set(existing.map((p) => p.id));
    const appended = result.toUpsert.filter((p) => !existingIds.has(p.id));
    return existing
      .filter((p) => !deleteSet.has(p.id))
      .map((p) => upsertById.get(p.id) ?? p)
      .concat(appended);
  }

  it("falls back to the enrollment anchor when there is no attendance", () => {
    const result = recalculateStudentSubjectLedger(specStudent(), "Math", specCtx([], []));
    expect(result.toDelete).toEqual([]);
    expect(result.remainingCredit).toBe(0);
    const byMonth = new Map(result.toUpsert.map((p) => [p.month, p]));
    expect(result.toUpsert).toHaveLength(3); // Sept + Oct + Nov
    expect(byMonth.get("2026-09")!.amountDue).toBe(219); // 5 × 43.75
    expect(byMonth.get("2026-09")!.dueDate).toBe("2026-09-15");
    expect(byMonth.get("2026-10")!.amountDue).toBe(350);
    expect(byMonth.get("2026-11")!.amountDue).toBe(350);
  });

  it("re-bills Sept from a pre-registration attendance anchor", () => {
    const attendance = [
      makeAttendance(STUDENT_ID, "session-Math-T.C-4", "2026-09-10"),
    ];
    const result = recalculateStudentSubjectLedger(
      specStudent(),
      "Math",
      specCtx([], attendance),
    );
    expect(result.toDelete).toEqual([]);
    const sept = result.toUpsert.find((p) => p.month === "2026-09")!;
    expect(sept.amountDue).toBe(263); // 6 × 43.75 = 262.5 → 263
    expect(sept.dueDate).toBe("2026-09-10");
  });

  it("emits at most ONE invoice per month (No-Loop-Bug)", () => {
    // A pre-existing ledger for the same months must be REUSED, not
    // duplicated: the invoice key is (studentId, subject, month) and the
    // rebuild reuses the existing row's id for that month.
    const existing: Payment[] = [
      makePayment("sept", STUDENT_ID, "Math", "2026-09-15", 219),
      makePayment("oct", STUDENT_ID, "Math", "2026-10-01", 350),
    ];
    const attendance = [
      makeAttendance(STUDENT_ID, "session-Math-T.C-4", "2026-09-10"),
    ];
    const result = recalculateStudentSubjectLedger(
      specStudent(),
      "Math",
      specCtx(existing, attendance),
    );
    // The re-anchored September row keeps its id — no fresh id minted.
    expect(result.toUpsert.map((p) => p.id)).toContain("sept");
    // Applying the diff leaves exactly one row per month.
    const applied = existing
      .filter((p) => !result.toDelete.includes(p.id))
      .map((p) => (p.id === "sept" ? result.toUpsert.find((r) => r.id === "sept")! : p))
      .concat(result.toUpsert.filter((p) => p.id !== "sept"));
    const counts = new Map<string, number>();
    for (const p of applied) counts.set(p.month, (counts.get(p.month) ?? 0) + 1);
    for (const count of counts.values()) expect(count).toBe(1);
  });

  it("downgrades a settled installment to partially paid when the charge grows", () => {
    const existing: Payment[] = [
      makePayment("sept", STUDENT_ID, "Math", "2026-09-17", 175, 175, true),
      makePayment("oct", STUDENT_ID, "Math", "2026-10-01", 350, 0, false),
    ];
    const attendance = [
      makeAttendance(STUDENT_ID, "session-Math-T.C-4", "2026-09-17"),
      makeAttendance(STUDENT_ID, "session-Math-T.C-4", "2026-09-10"),
    ];
    const result = recalculateStudentSubjectLedger(
      specStudent(),
      "Math",
      specCtx(existing, attendance),
    );
    expect(result.toDelete).toEqual([]);
    expect(result.remainingCredit).toBe(0);
    const byId = new Map(result.toUpsert.map((p) => [p.id, p]));
    const sept = byId.get("sept")!;
    expect(sept.amountDue).toBe(263);
    expect(sept.amountPaid).toBe(175);
    expect(sept.isPaid).toBe(false);
    expect(getPaymentRemaining(sept)).toBe(88);
  });

  it("pulls credit back from the following months (shortfall cascade)", () => {
    const existing: Payment[] = [
      makePayment("sept", STUDENT_ID, "Math", "2026-09-17", 175, 175, true),
      makePayment("oct", STUDENT_ID, "Math", "2026-10-01", 350, 100, false),
    ];
    const attendance = [
      makeAttendance(STUDENT_ID, "session-Math-T.C-4", "2026-09-17"),
      makeAttendance(STUDENT_ID, "session-Math-T.C-4", "2026-09-10"),
    ];
    const result = recalculateStudentSubjectLedger(
      specStudent(),
      "Math",
      specCtx(existing, attendance),
    );
    const byId = new Map(result.toUpsert.map((p) => [p.id, p]));
    expect(byId.get("sept")!.amountPaid).toBe(263); // 175 own + 88 pulled back
    expect(isPaymentFullyPaid(byId.get("sept")!)).toBe(true);
    expect(byId.get("oct")!.amountPaid).toBe(12); // 100 − 88
  });

  it("pushes surplus forward when the charge shrinks (surplus cascade)", () => {
    const existing: Payment[] = [
      makePayment("sept", STUDENT_ID, "Math", "2026-09-17", 350, 350, true),
      makePayment("oct", STUDENT_ID, "Math", "2026-10-01", 350, 0, false),
    ];
    const attendance = [
      makeAttendance(STUDENT_ID, "session-Math-T.C-4", "2026-09-17"),
    ];
    const result = recalculateStudentSubjectLedger(
      specStudent(),
      "Math",
      specCtx(existing, attendance),
    );
    const byId = new Map(result.toUpsert.map((p) => [p.id, p]));
    expect(byId.get("sept")!.amountDue).toBe(175);
    expect(byId.get("sept")!.amountPaid).toBe(175);
    expect(isPaymentFullyPaid(byId.get("sept")!)).toBe(true);
    expect(byId.get("oct")!.amountPaid).toBe(175); // surplus rolled forward
  });

  it("lands carried wallet surplus on the NEXT month as partial credit", () => {
    // Sept is settled and the student carries 150 DH of advance credit. The
    // rebuild pools the wallet with Sept's paid credit: Sept absorbs 219,
    // and the 150 surplus lands on October's row as green advance credit.
    const existing: Payment[] = [
      makePayment("sept", STUDENT_ID, "Math", "2026-09-15", 219, 219, true),
      makePayment("oct", STUDENT_ID, "Math", "2026-10-01", 350, 0, false),
    ];
    const result = recalculateStudentSubjectLedger(
      specStudent("2026-09-15T12:00:00.000Z", undefined, 150),
      "Math",
      specCtx(existing, []),
    );
    const byId = new Map(result.toUpsert.map((p) => [p.id, p]));
    expect(byId.get("oct")!.amountPaid).toBe(150); // green advance credit
    expect(byId.get("oct")!.isPaid).toBe(false);
    expect(result.remainingCredit).toBe(0); // wallet fully absorbed
  });

  it("parks unabsorbed surplus in the wallet when no gap remains", () => {
    // Only Sept exists (asOf = end of Sept), it is settled, and the wallet
    // holds 150. The rebuild can absorb nothing more → surplus survives.
    const existing: Payment[] = [
      makePayment("sept", STUDENT_ID, "Math", "2026-09-15", 219, 219, true),
    ];
    const result = recalculateStudentSubjectLedger(
      specStudent("2026-09-15T12:00:00.000Z", undefined, 150),
      "Math",
      specCtx(existing, [], new Date(2026, 8, 30), "2026-09-30"),
    );
    expect(result.remainingCredit).toBe(150);
  });

  it("deletes a month that stopped being billable and redistributes its credit", () => {
    // A late 29/09 attendance leaves a single session in September → FREE →
    // no installment. The settled Sept row is deleted and its credit lands on Oct.
    const existing: Payment[] = [
      makePayment("sept", STUDENT_ID, "Math", "2026-09-17", 175, 175, true),
      makePayment("oct", STUDENT_ID, "Math", "2026-10-01", 350, 0, false),
    ];
    const attendance = [
      makeAttendance(STUDENT_ID, "session-Math-T.C-2", "2026-09-29"),
    ];
    const result = recalculateStudentSubjectLedger(
      specStudent(),
      "Math",
      specCtx(existing, attendance),
    );
    expect(result.toDelete).toEqual(["sept"]);
    const byId = new Map(result.toUpsert.map((p) => [p.id, p]));
    expect(byId.get("oct")!.amountPaid).toBe(175); // Sept's credit moved
  });

  it("is idempotent — recomputing the same state yields no further diff", () => {
    const existing: Payment[] = [
      makePayment("sept", STUDENT_ID, "Math", "2026-09-17", 175, 175, true),
      makePayment("oct", STUDENT_ID, "Math", "2026-10-01", 350, 100, false),
    ];
    const attendance = [
      makeAttendance(STUDENT_ID, "session-Math-T.C-4", "2026-09-17"),
      makeAttendance(STUDENT_ID, "session-Math-T.C-4", "2026-09-10"),
    ];
    const student = specStudent();
    const first = recalculateStudentSubjectLedger(
      student,
      "Math",
      specCtx(existing, attendance),
    );
    const applied = applyDiff(existing, first);
    const second = recalculateStudentSubjectLedger(
      student,
      "Math",
      specCtx(applied, attendance),
    );
    expect(second.toDelete).toEqual([]);
    expect(second.toUpsert).toEqual([]);
    expect(second.remainingCredit).toBe(0);
  });

  it("honors customPrice when rebuilding", () => {
    const result = recalculateStudentSubjectLedger(
      specStudent("2026-09-15T12:00:00.000Z", 300), // Takhfid
      "Math",
      specCtx([], []),
    );
    // 300 / 8 = 37.5; Sept = 5 × 37.5 = 187.5 → 188.
    expect(result.toUpsert.find((p) => p.month === "2026-09")!.amountDue).toBe(188);
  });

  it("deletes stale rows when the enrollment was dropped", () => {
    const existing: Payment[] = [
      makePayment("sept", STUDENT_ID, "Math", "2026-09-15", 219, 0, false),
      makePayment("oct", STUDENT_ID, "Math", "2026-10-01", 350, 100, false),
    ];
    const noEnrollment = makeStudent({ level: "T.C", enrollments: [] });
    const result = recalculateStudentSubjectLedger(
      noEnrollment,
      "Math",
      specCtx(existing, []),
    );
    expect(result.toDelete).toEqual(["sept", "oct"]);
    expect(result.toUpsert).toEqual([]);
    expect(result.remainingCredit).toBe(100); // released to the wallet
  });

  it("short-circuits to a no-op for EVERY 2Bac Small combo (Rule B isolation)", () => {
    const ruleBCombos: Array<{ track: Track; subject: Subject }> = [
      { track: "s.x", subject: "Math" },
      { track: "s.m", subject: "Math" },
      { track: "s.x", subject: "PC" },
      { track: "s.m", subject: "SVT" },
      { track: "s.x", subject: "Philosophy" },
    ];
    for (const { track, subject } of ruleBCombos) {
      const ruleBStudent = makeStudent({
        level: "2Bac",
        track,
        enrollments: [
          {
            subject,
            track,
            groupType: "Small",
            enrolledAt: "2026-09-15T12:00:00.000Z",
          },
        ],
      });
      const existing: Payment[] = [
        makePayment(
          "b1",
          STUDENT_ID,
          subject,
          "2026-09-15",
          500,
          0,
          false,
          "B",
        ),
      ];
      const attendance = [
        makeAttendance(STUDENT_ID, `session-${subject}-2Bac-2`, "2026-09-01"),
      ];
      const result = recalculateStudentSubjectLedger(
        ruleBStudent,
        subject,
        specCtx(existing, attendance),
      );
      expect(result.toDelete).toEqual([]);
      expect(result.toUpsert).toEqual([]);
      expect(result.remainingCredit).toBe(0);
    }
  });
});

// ---------------------------------------------------------------------------
// roundMAD — the integer contract (no decimals ever reach a parent)
// ---------------------------------------------------------------------------

describe("roundMAD — smart rounding", () => {
  it("rounds a fractional session cost to a clean whole MAD", () => {
    // The spec example: 5 × 43.75 = 218.75 → 219.
    expect(roundMAD(5 * (350 / 8))).toBe(219);
    expect(roundMAD(218.75)).toBe(219);
    expect(roundMAD(218.4)).toBe(218);
  });

  it("leaves whole amounts untouched and never returns a fraction", () => {
    expect(roundMAD(350)).toBe(350);
    expect(roundMAD(0)).toBe(0);
    expect(Number.isInteger(roundMAD(131.25))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// getPaymentsToReceive — the "Paiements à recevoir" worklist: one row per
// student + subject with the CLEAN INTEGER complement to reach the full
// monthly_price, plus the credit already carried onto that month.
// ---------------------------------------------------------------------------

describe("getPaymentsToReceive — clean complement worklist", () => {
  const TODAY = "2026-10-15";
  const PRICE = 350;

  function specStudent(): Student {
    return makeStudent({
      id: STUDENT_ID,
      enrollments: [
        {
          subject: "Math",
          track: null,
          groupType: "Large",
          enrolledAt: "2026-09-15T00:00:00.000Z",
        },
      ],
    });
  }

  it("(spec example) reports a clean 219 MAD complement on Month 2 with 131 carried credit", () => {
    // Month 1 = 219 (5/8 × 350 rounded) settled; Month 2 = 350 carrying the
    // 131 surplus → the parent's next collection is exactly 219, an integer.
    const payments: Payment[] = [
      makePayment("sept", STUDENT_ID, "Math", "2026-09-15", 219, 219, true),
      makePayment("oct", STUDENT_ID, "Math", "2026-10-01", 350, 131, false),
    ];
    const rows = getPaymentsToReceive(payments, [specStudent()], TODAY);
    expect(rows).toHaveLength(1);
    const row = rows[0];
    expect(row.studentName).toBe("Test Student");
    expect(row.subject).toBe("Math");
    expect(row.monthlyPrice).toBe(350);
    expect(row.creditCarried).toBe(131);
    expect(row.complement).toBe(219);
    expect(Number.isInteger(row.complement)).toBe(true);
    expect(row.isOverdue).toBe(true); // due 2026-10-01 < TODAY 2026-10-15
  });

  it("flags overdue months and drops fully-covered ones", () => {
    const payments: Payment[] = [
      makePayment("oct", STUDENT_ID, "Math", "2026-10-01", 350, 0, false),
      makePayment("nov", STUDENT_ID, "Math", "2026-11-01", 350, 350, true),
    ];
    const rows = getPaymentsToReceive(payments, [specStudent()], TODAY);
    expect(rows).toHaveLength(1);
    expect(rows[0].paymentId).toBe("oct");
    expect(rows[0].complement).toBe(350);
    expect(rows[0].isOverdue).toBe(true);
  });

  it("keeps only the EARLIEST unpaid month per student + subject", () => {
    const payments: Payment[] = [
      makePayment("sept", STUDENT_ID, "Math", "2026-09-01", 350, 0, false),
      makePayment("oct", STUDENT_ID, "Math", "2026-10-01", 350, 0, false),
    ];
    const rows = getPaymentsToReceive(payments, [specStudent()], TODAY);
    expect(rows).toHaveLength(1);
    expect(rows[0].monthKey).toBe("2026-09");
  });

  it("emits one row per subject and skips students with no doc", () => {
    const student2 = makeStudent({
      id: "student-2",
      enrollments: [
        {
          subject: "PC",
          track: null,
          groupType: "Large",
          enrolledAt: "2026-09-01T00:00:00.000Z",
        },
      ],
    });
    const payments: Payment[] = [
      makePayment("m1", STUDENT_ID, "Math", "2026-10-01", 350, 0, false),
      makePayment("m2", "student-2", "PC", "2026-09-01", 400, 0, false),
      // Orphan payment (student doc deleted) → dropped.
      makePayment("m3", "ghost", "SVT", "2026-09-01", 300, 0, false),
    ];
    const rows = getPaymentsToReceive(payments, [specStudent(), student2], TODAY);
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.subject)).toEqual(["PC", "Math"]); // date-sorted
  });

  it("never returns a fractional complement", () => {
    const payments: Payment[] = [
      makePayment("oct", STUDENT_ID, "Math", "2026-10-01", 219, 0, false),
    ];
    const rows = getPaymentsToReceive(payments, [specStudent()], TODAY);
    expect(rows).toHaveLength(1);
    expect(rows[0].complement).toBe(219);
    expect(Number.isInteger(rows[0].complement)).toBe(true);
  });
});
