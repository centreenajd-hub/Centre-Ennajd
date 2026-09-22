// Unit cover for the post-review live-session behavior:
//   1. A session appears at its scheduled time and is NEVER auto-hidden
//      afterwards (the old start+70min cutoff is gone). The day rollover is
//      the only automatic removal; everything else is the admin's ⋮ menu.
//   2. isSessionInProgress drives the "active now" badge and is bounded by
//      endTime, while the card itself outlives it.
//   3. Dismissals are persisted per occurrence and pruned once stale.
//
// Run with: npx vitest run src/lib/session-dismissal.test.ts

import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  isOneOffSessionVisible,
  isSessionInProgress,
  isSessionVisible,
} from "@/lib/ennajd-taxonomy";
import {
  dismissalKey,
  dismissSession,
  isSessionDismissed,
  undismissSession,
} from "@/lib/session-dismissal";

const DAY = 2; // Tuesday
const START = "16:00";
const END = "18:00";

/** Tuesday 2026-11-17 at HH:MM local time. */
function tueAt(hours: number, minutes = 0): Date {
  return new Date(2026, 10, 17, hours, minutes, 0, 0);
}

/** Wednesday 2026-11-18 at HH:MM local time. */
function wedAt(hours: number, minutes = 0): Date {
  return new Date(2026, 10, 18, hours, minutes, 0, 0);
}

function recurringSession() {
  return {
    id: "s1",
    subject: "Math" as const,
    level: "T.C" as const,
    track: null,
    groupType: "Large" as const,
    dayOfWeek: DAY,
    startTime: START,
    endTime: END,
    kind: "recurring" as const,
    date: null,
  };
}

function oneOffSession(date: string) {
  return { ...recurringSession(), id: "s2", kind: "one_off" as const, date };
}

describe("live session visibility — appears on time, never auto-hidden", () => {
  it("is hidden before the 40-min pre-start window", () => {
    expect(isSessionVisible(recurringSession(), tueAt(15, 19))).toBe(false); // 41 min before
  });

  it("appears exactly at start-40min", () => {
    expect(isSessionVisible(recurringSession(), tueAt(15, 20))).toBe(true);
    expect(isSessionVisible(recurringSession(), tueAt(16, 0))).toBe(true); // start
  });

  it("STAYS visible long after it ends (no auto-hide)", () => {
    expect(isSessionVisible(recurringSession(), tueAt(18, 30))).toBe(true); // 30 min after end
    expect(isSessionVisible(recurringSession(), tueAt(23, 59))).toBe(true); // late evening
  });

  it("is hidden on other weekdays", () => {
    expect(isSessionVisible(recurringSession(), wedAt(16, 0))).toBe(false);
  });

  it("one-off: visible only on its own date from the window onward", () => {
    const session = oneOffSession("2026-11-17");
    expect(isOneOffSessionVisible(session, tueAt(15, 20))).toBe(true);
    expect(isOneOffSessionVisible(session, tueAt(23, 0))).toBe(true);
    expect(isOneOffSessionVisible(session, wedAt(16, 0))).toBe(false); // wrong date
  });
});

describe("isSessionInProgress — bounded by endTime", () => {
  it("is live from the pre-start window until endTime", () => {
    expect(isSessionInProgress(recurringSession(), tueAt(15, 20))).toBe(true);
    expect(isSessionInProgress(recurringSession(), tueAt(17, 0))).toBe(true);
  });

  it("turns off once the session has ended (card stays, badge goes)", () => {
    expect(isSessionInProgress(recurringSession(), tueAt(18, 1))).toBe(false);
    expect(isSessionInProgress(recurringSession(), tueAt(23, 0))).toBe(false);
  });

  it("is false on other days", () => {
    expect(isSessionInProgress(recurringSession(), wedAt(17, 0))).toBe(false);
  });
});

describe("session dismissal — persisted per occurrence", () => {
  const store: Record<string, string> = {};

  beforeEach(() => {
    Object.keys(store).forEach((k) => delete store[k]);
    vi.setSystemTime(tueAt(12, 0)); // Tuesday 2026-11-17 midday
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => (key in store ? store[key] : null),
      setItem: (key: string, value: string) => {
        store[key] = value;
      },
      removeItem: (key: string) => {
        delete store[key];
      },
    });
  });

  it("hides a session only after the admin dismisses it", () => {
    expect(isSessionDismissed("s1", "2026-11-17")).toBe(false);
    dismissSession("s1", "2026-11-17");
    expect(isSessionDismissed("s1", "2026-11-17")).toBe(true);
  });

  it("survives a reload (persisted to localStorage)", () => {
    dismissSession("s1", "2026-11-17");
    // A fresh module read (simulating reload) still sees the dismissal.
    expect(store["ennajd:dismissed-live-sessions"]).toContain(
      dismissalKey("s1", "2026-11-17"),
    );
  });

  it("is undone by undismissSession", () => {
    dismissSession("s1", "2026-11-17");
    undismissSession("s1", "2026-11-17");
    expect(isSessionDismissed("s1", "2026-11-17")).toBe(false);
  });

  it("does not hide the session's next occurrence", () => {
    dismissSession("s1", "2026-11-17"); // this Tuesday
    expect(isSessionDismissed("s1", "2026-11-24")).toBe(false); // next Tuesday
  });

  it("prunes dismissals from days already past", () => {
    dismissSession("s1", "2026-11-10"); // last week
    expect(isSessionDismissed("s1", "2026-11-10")).toBe(false);
  });
});
