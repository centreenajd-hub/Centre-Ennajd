// Attendance report engine — pure date math + matrix building for the PDF
// export and its live preview. Zero React/Zustand, mirrors the "Shield"
// pattern of ennajd-taxonomy.ts / ennajd-billing.ts. All functions take
// explicit params (monthKey/todayKey), no hidden `new Date()`.

import { getRosterForScope, type SessionScope } from "@/lib/ennajd-report-scope";
import { sortStudentsAlphabetically } from "@/lib/ennajd-report-shared";
import type { AttendanceRecord, Session, Student } from "@/types/ennajd";

export interface AttendanceCell {
  status: "present" | "absent" | "not-occurred";
  timestamp: string | null; // "HH:mm", null when not-occurred
  /** The saved record's id, present when this cell has an actual record. */
  recordId?: string;
  /** The session the record belongs to — present only on recorded cells. */
  sessionId?: string;
  /** Mirrors the record's isGuest flag (Small-group cross-attendance). */
  isGuest?: boolean;
}

export interface AttendanceMatrixRow {
  student: Student;
  cellsByDate: Map<string, AttendanceCell>; // key: "YYYY-MM-DD"
}

export interface AttendanceMatrix {
  dates: string[]; // sorted "YYYY-MM-DD" occurrence dates for the month
  rows: AttendanceMatrixRow[];
}

function daysInMonthKey(monthKey: string): number {
  const [year, month] = monthKey.split("-").map(Number);
  return new Date(year, month, 0).getDate();
}

/** Every calendar date in `monthKey` ("YYYY-MM") matching session.dayOfWeek. */
export function getMonthOccurrenceDates(session: Session, monthKey: string): string[] {
  const [year, month] = monthKey.split("-").map(Number);
  const totalDays = daysInMonthKey(monthKey);
  const dates: string[] = [];
  for (let day = 1; day <= totalDays; day++) {
    const date = new Date(year, month - 1, day);
    if (date.getDay() === session.dayOfWeek) {
      const dd = String(day).padStart(2, "0");
      const mm = String(month).padStart(2, "0");
      dates.push(`${year}-${mm}-${dd}`);
    }
  }
  return dates;
}

/**
 * Every calendar day of `monthKey` (1..28/29/30/31) when at least one
 * session is scheduled for this scope — non-class days render blank in the
 * matrix, same as any other "not-occurred" cell. When `sessions` is empty
 * (no scheduled session at all for this scope), returns [] so the matrix
 * stays a name-only roster.
 */
export function getMonthOccurrenceDatesForSessions(sessions: Session[], monthKey: string): string[] {
  if (sessions.length === 0) return [];
  const [year, month] = monthKey.split("-").map(Number);
  const totalDays = daysInMonthKey(monthKey);
  const dates: string[] = [];
  for (let day = 1; day <= totalDays; day++) {
    const dd = String(day).padStart(2, "0");
    const mm = String(month).padStart(2, "0");
    dates.push(`${year}-${mm}-${dd}`);
  }
  return dates;
}

/**
 * Every calendar date of `monthKey` that is an actual scheduled class day
 * for at least one of `sessions`: recurring sessions contribute every date
 * matching their dayOfWeek, one_off sessions contribute their exact date
 * (when it falls inside the month). Used to decide which past cells of the
 * preview matrix are correctable in Edit Mode — a date is editable only
 * when it is a real class day (or the student already has a record on it).
 * Pure date math, no React/Zustand.
 */
export function getClassDayDates(sessions: Session[], monthKey: string): Set<string> {
  const [year, month] = monthKey.split("-").map(Number);
  const totalDays = daysInMonthKey(monthKey);
  const classDays = new Set<string>();

  for (const session of sessions) {
    const key = (session.kind ?? "recurring") as Session["kind"];
    if (key === "one_off") {
      if (session.date && session.date.startsWith(`${monthKey}-`)) {
        classDays.add(session.date);
      }
      continue;
    }
    for (let day = 1; day <= totalDays; day++) {
      const date = new Date(year, month - 1, day);
      if (date.getDay() === session.dayOfWeek) {
        const dd = String(day).padStart(2, "0");
        classDays.add(`${monthKey}-${dd}`);
      }
    }
  }
  return classDays;
}

/**
 * Builds a Name-sorted student × date matrix covering every calendar day of
 * the month for all matching sessions' scope. Includes both enrolled
 * students and any guest who has at least one attendance record for one of
 * the matching sessions that month. A day only counts as a real class
 * occurrence ("delivered") if at least one student has a `present` record
 * for it — days with no one present (cancelled/no-show, or simply not a
 * class day) render blank ("not-occurred") for everyone, exactly like a day
 * after `todayKey`. When `sessions` is empty (no scheduled session for this
 * scope), `dates` stays empty but `rows` still lists every enrolled student
 * for `scope` — a name-only roster.
 */
export function buildAttendanceMatrix(
  sessions: Session[],
  scope: SessionScope,
  monthKey: string,
  students: Student[],
  attendanceRecords: AttendanceRecord[],
  todayKey: string,
): AttendanceMatrix {
  const dates = getMonthOccurrenceDatesForSessions(sessions, monthKey);

  const sessionIds = new Set(sessions.map((s) => s.id));
  const recordsForSessions = attendanceRecords.filter((r) => sessionIds.has(r.sessionId));
  const roster = getRosterForScope(students, scope, sessions, attendanceRecords);
  const rosterStudents = sortStudentsAlphabetically(roster);

  const deliveredDates = new Set<string>();
  for (const record of recordsForSessions) {
    if (record.status === "present") deliveredDates.add(record.date);
  }

  const rows: AttendanceMatrixRow[] = rosterStudents.map((student) => {
    const cellsByDate = new Map<string, AttendanceCell>();
    for (const date of dates) {
      const record = recordsForSessions.find(
        (r) => r.studentId === student.id && r.date === date,
      );
      // Future days stay blank for everyone. Past/today days with no one
      // present anywhere (cancelled / all-absent) also render blank — but we
      // still surface the record pointer so Edit Mode can correct them.
      if (date > todayKey || !deliveredDates.has(date)) {
        cellsByDate.set(date, {
          status: "not-occurred",
          timestamp: null,
          ...(record && {
            recordId: record.id,
            sessionId: record.sessionId,
            isGuest: record.isGuest,
          }),
        });
        continue;
      }
      if (!record) {
        cellsByDate.set(date, { status: "not-occurred", timestamp: null });
        continue;
      }
      cellsByDate.set(date, {
        status: record.status,
        timestamp: record.timestamp,
        recordId: record.id,
        sessionId: record.sessionId,
        isGuest: record.isGuest,
      });
    }
    return { student, cellsByDate };
  });

  return { dates, rows };
}
