import { useMemo } from "react";

import { AttendanceStatsBar } from "@/components/dashboard/AttendanceStatsBar";
import {
  OverdueStudentsCard,
  type OverdueStudentInfo,
} from "@/components/dashboard/OverdueStudentsCard";
import { StudentAttendanceChip } from "@/components/dashboard/StudentAttendanceChip";
import { useEnnajdState } from "@/hooks/use-ennajd-state";
import { formatDateKey, getPaymentRemaining } from "@/lib/ennajd-billing";
import { getEnrolledStudentsForSession } from "@/lib/ennajd-taxonomy";
import { useI18n } from "@/lib/i18n";
import type { AttendanceRecord, AttendanceStatus, Session } from "@/types/ennajd";

interface AttendancePanelProps {
  session: Session;
  date: string; // "YYYY-MM-DD"
  now: Date;
}

function nextStatus(current: AttendanceStatus | "pending"): AttendanceStatus {
  return current === "present" ? "absent" : "present";
}

export default function AttendancePanel({ session, date, now }: AttendancePanelProps) {
  const { t } = useI18n();
  const students = useEnnajdState((s) => s.students);
  const attendanceRecords = useEnnajdState((s) => s.attendanceRecords);
  const payments = useEnnajdState((s) => s.payments);
  const markAttendance = useEnnajdState((s) => s.markAttendance);
  const setPaymentPaid = useEnnajdState((s) => s.setPaymentPaid);

  const enrolledStudents = useMemo(
    () => getEnrolledStudentsForSession(students, session),
    [students, session],
  );

  // One index for this session+date: studentId → record. Feeds status
  // lookups, stats, and guest derivation in O(1) instead of re-scanning
  // the whole attendance array per roster student.
  const recordByStudent = useMemo(() => {
    const map = new Map<string, AttendanceRecord>();
    for (const r of attendanceRecords) {
      if (r.sessionId === session.id && r.date === date) map.set(r.studentId, r);
    }
    return map;
  }, [attendanceRecords, session.id, date]);

  const guestStudents = useMemo(() => {
    const guestIds = new Set<string>();
    for (const r of recordByStudent.values()) {
      if (r.isGuest) guestIds.add(r.studentId);
    }
    return students.filter((s) => guestIds.has(s.id));
  }, [students, recordByStudent]);

  const rosterStudents = useMemo(
    () => [...enrolledStudents, ...guestStudents],
    [enrolledStudents, guestStudents],
  );

  // Same semantics as the store's hasOutstandingBalance (any unpaid
  // installment due on or before today), precomputed as a Set so each chip
  // is a lookup instead of a full payments scan.
  const todayKey = formatDateKey(now);
  const outstandingKeys = useMemo(() => {
    const keys = new Set<string>();
    for (const p of payments) {
      // Credit that already covers the month means nothing is owed, so it
      // never flags the student as outstanding.
      if (!p.isPaid && p.dueDate <= todayKey && getPaymentRemaining(p) > 0) {
        keys.add(`${p.studentId}__${p.subject}`);
      }
    }
    return keys;
  }, [payments, todayKey]);

  // Overdue detail map for THIS session's subject: studentId → amount owed
  // (Σ remaining across due-unpaid installments) + earliest due date. One
  // O(payments) pass per render, memoized; feeds the OverdueStudentsCard
  // and each chip's ⚠ badge/tooltip in O(1).
  const subjectOverdueByStudent = useMemo(() => {
    const map = new Map<string, { amount: number; earliestDueDate: string | null }>();
    for (const p of payments) {
      if (
        p.subject !== session.subject ||
        p.isPaid ||
        p.dueDate > todayKey ||
        getPaymentRemaining(p) <= 0
      ) {
        continue;
      }
      const entry = map.get(p.studentId);
      if (entry) {
        entry.amount += getPaymentRemaining(p);
        if (p.dueDate < (entry.earliestDueDate ?? "9999-99-99")) {
          entry.earliestDueDate = p.dueDate;
        }
      } else {
        map.set(p.studentId, { amount: getPaymentRemaining(p), earliestDueDate: p.dueDate });
      }
    }
    return map;
  }, [payments, session.subject, todayKey]);

  // Roster intersection (orphans/other students excluded) for the summary card.
  const overdueEntries = useMemo<OverdueStudentInfo[]>(() => {
    const rosterIds = new Set(rosterStudents.map((s) => s.id));
    const list: OverdueStudentInfo[] = [];
    for (const [studentId, info] of subjectOverdueByStudent) {
      if (!rosterIds.has(studentId)) continue;
      const student = students.find((s) => s.id === studentId);
      if (!student) continue;
      list.push({ student, amount: info.amount, earliestDueDate: info.earliestDueDate });
    }
    // Most indebted first, then by name for stable ordering.
    list.sort((a, b) => b.amount - a.amount || `${a.student.firstName} ${a.student.lastName}`.localeCompare(`${b.student.firstName} ${b.student.lastName}`));
    return list;
  }, [rosterStudents, subjectOverdueByStudent, students]);

  const statusFor = (studentId: string): AttendanceStatus | "pending" =>
    recordByStudent.get(studentId)?.status ?? "pending";

  const attendanceStats = useMemo(() => {
    const total = rosterStudents.length;
    const presentCount = rosterStudents.filter(
      (s) => recordByStudent.get(s.id)?.status === "present",
    ).length;
    const absentCount = total - presentCount;
    return { total, presentCount, absentCount };
  }, [rosterStudents, recordByStudent]);

  // Settle the WHOLE subject debt in one tap — aligned with the Payments
  // page row-settle and the OverdueStudentsCard button (previously this only
  // cleared the single earliest installment). Sorted dueDate-ascending so
  // the chronological settlement dependency (Month 1 before Month 2, etc.)
  // is satisfied one installment at a time.
  async function settleOutstanding(studentId: string): Promise<void> {
    const dueUnpaid = payments
      .filter(
        (p) =>
          p.studentId === studentId &&
          p.subject === session.subject &&
          !p.isPaid &&
          p.dueDate <= todayKey &&
          getPaymentRemaining(p) > 0,
      )
      .sort((a, b) => a.dueDate.localeCompare(b.dueDate));
    for (const payment of dueUnpaid) {
      await setPaymentPaid(payment.id, true);
    }
  }

  return (
    <div className="space-y-4">
      <AttendanceStatsBar
        presentCount={attendanceStats.presentCount}
        absentCount={attendanceStats.absentCount}
        total={attendanceStats.total}
      />

      <OverdueStudentsCard
        session={session}
        entries={overdueEntries}
        todayKey={todayKey}
      />

      {rosterStudents.length === 0 ? (
        <p className="rounded-xl border border-dashed border-border bg-muted/40 py-6 text-center text-sm text-muted-foreground">
          {t("noEnrolledStudents")}
        </p>
      ) : (
        <div className="flex flex-wrap gap-2">
          {rosterStudents.map((student) => {
            const isGuestChip = guestStudents.some((g) => g.id === student.id);
            const overdueInfo = subjectOverdueByStudent.get(student.id);
            const warningTitle = overdueInfo
              ? `${t("unpaidWarningFull")} · ${overdueInfo.amount} MAD`
              : undefined;
            return (
              <StudentAttendanceChip
                key={student.id}
                name={`${student.firstName} ${student.lastName}`}
                status={statusFor(student.id)}
                isGuest={isGuestChip}
                hasOutstandingBalance={outstandingKeys.has(
                  `${student.id}__${session.subject}`,
                )}
                unpaidWarningTitle={warningTitle}
                onCycleStatus={() =>
                  markAttendance(
                    student.id,
                    session.id,
                    date,
                    nextStatus(statusFor(student.id)),
                    { isManualOverride: true, isGuest: isGuestChip },
                  )
                }
                onSettleOutstanding={() => settleOutstanding(student.id)}
              />
            );
          })}
        </div>
      )}
    </div>
  );
}
