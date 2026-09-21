import { Bell, CheckCircle2, CircleDollarSign, Receipt } from "lucide-react";
import { Link } from "react-router-dom";
import { useMemo } from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { SettleStudentDialog } from "@/components/students/SettleStudentDialog";
import { useEnnajdState } from "@/hooks/use-ennajd-state";
import { useNowTick } from "@/hooks/use-now-tick";
import {
  aggregateRegistrationFeeDebtors,
  formatDateKey,
  getPaymentRemaining,
  isPaymentPartiallyPaid,
} from "@/lib/ennajd-billing";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import type { Payment, Student, Subject } from "@/types/ennajd";

function isSmallGroup2Bac(payment: Payment, student: Student | undefined): boolean {
  if (!student || student.level !== "2Bac" || student.track !== "s.x") return false;
  const enrollment = student.enrollments.find((e) => e.subject === payment.subject);
  return enrollment?.groupType === "Small";
}

/** Max subjects shown per row before the "+N" overflow chip. */
const MAX_SUBJECTS_SHOWN = 3;

interface StudentGroup {
  studentId: string;
  /** Overdue installments, oldest dueDate first. */
  payments: Payment[];
  /** Unique subjects in first-appearance order (payments are date-sorted). */
  subjects: Subject[];
  /** Earliest dueDate across the group's overdue installments. */
  oldestDueDate: string;
  /** Net remaining: Σ (amountDue − amountPaid) — partial payments included. */
  remainingTotal: number;
  /** True when any installment has 0 < amountPaid < amountDue. */
  hasPartial: boolean;
}

/**
 * Groups a section's overdue installments into ONE row per student:
 * payments sorted oldest-first, unique subjects in appearance order,
 * net remaining (partial payments credited) and oldest due date.
 */
function groupByStudent(overdue: Payment[]): StudentGroup[] {
  const byStudent = new Map<string, StudentGroup>();
  for (const payment of overdue) {
    let group = byStudent.get(payment.studentId);
    if (!group) {
      group = {
        studentId: payment.studentId,
        payments: [],
        subjects: [],
        oldestDueDate: payment.dueDate,
        remainingTotal: 0,
        hasPartial: false,
      };
      byStudent.set(payment.studentId, group);
    }
    group.payments.push(payment);
    if (!group.subjects.includes(payment.subject)) {
      group.subjects.push(payment.subject);
    }
    if (payment.dueDate < group.oldestDueDate) {
      group.oldestDueDate = payment.dueDate;
    }
    group.remainingTotal += getPaymentRemaining(payment);
    if (isPaymentPartiallyPaid(payment)) {
      group.hasPartial = true;
    }
  }
  return Array.from(byStudent.values()).sort((a, b) =>
    a.oldestDueDate.localeCompare(b.oldestDueDate),
  );
}

interface StudentNotificationRowProps {
  group: StudentGroup;
  student: Student | undefined;
}

function StudentNotificationRow({ group, student }: StudentNotificationRowProps) {
  const { t } = useI18n();

  const shownSubjects = group.subjects.slice(0, MAX_SUBJECTS_SHOWN);
  const overflowSubjects = group.subjects.length - shownSubjects.length;

  return (
    <div className="flex items-start justify-between gap-2 rounded-xl border border-border bg-card p-3">
      <div className="min-w-0 flex-1 space-y-1">
        <p className="truncate text-sm font-semibold">
          {student ? `${student.firstName} ${student.lastName}` : "—"}
        </p>
        <div className="flex flex-wrap items-center gap-1">
          {student && (
            <Badge variant="secondary" className="rounded-full text-[10px]">
              {student.level}
            </Badge>
          )}
          {student?.track && (
            <Badge variant="outline" className="rounded-full text-[10px]">
              {student.track}
            </Badge>
          )}
          <span className="truncate text-xs text-muted-foreground">
            {shownSubjects.join(" · ")}
          </span>
          {overflowSubjects > 0 && (
            <span className="text-xs text-muted-foreground">+{overflowSubjects}</span>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-1.5 text-xs">
          <span className="font-medium text-destructive">{group.oldestDueDate}</span>
          <Badge variant="destructive" className="rounded-full text-[10px]">
            {t("overdue")}
          </Badge>
          <span className="text-muted-foreground">
            {group.payments.length} {t("installments")}
          </span>
          <span className="font-semibold text-destructive">
            {t("remainingAmount")}: {group.remainingTotal} MAD
          </span>
          {group.hasPartial && (
            <Badge className="rounded-full bg-accent text-[10px] text-accent-foreground">
              {t("partialPill")}
            </Badge>
          )}
        </div>
      </div>
      {student && (
        <div className="shrink-0">
          <SettleStudentDialog
            student={student}
            trigger={
              <Button
                type="button"
                size="sm"
                variant="secondary"
                className="gap-1 rounded-lg"
                title={t("settleStudentTitle")}
              >
                <CheckCircle2 className="h-3.5 w-3.5" />
                {t("settlePayment")}
              </Button>
            }
          />
        </div>
      )}
    </div>
  );
}

export function NotificationBell() {
  const { t } = useI18n();
  const students = useEnnajdState((s) => s.students);
  const payments = useEnnajdState((s) => s.payments);
  const settleRegistrationFee = useEnnajdState((s) => s.settleRegistrationFee);
  const hasSyncedPayments = useEnnajdState((s) => s.hasSyncedPayments);
  const hasSyncedStudents = useEnnajdState((s) => s.hasSyncedStudents);
  const hasSynced = hasSyncedPayments && hasSyncedStudents;

  // Live clock: advances todayKey at midnight without leaking a 30s render to every page.
  // useNowTick ticks every 60s and pauses when the tab is hidden.
  const now = useNowTick();
  const todayKey = formatDateKey(now);

  const studentsById = useMemo(() => new Map(students.map((s) => [s.id, s])), [students]);

  const {
    generalGroups,
    smallGroupGroups,
    feeDebtorRows,
    studentCount,
    installmentCount,
  } = useMemo(() => {
    // Orphan guard: ignore payments whose student doc no longer exists.
    // After a console wipe where students is cleared but payments still lingers
    // in the IndexedDB cache, this prevents the badge from counting stale orphans.
    // A month whose credit covers it owes nothing — never a debtor.
    const overdue = payments.filter(
      (p) =>
        !p.isPaid &&
        p.dueDate < todayKey &&
        studentsById.has(p.studentId) &&
        getPaymentRemaining(p) > 0,
    );
    const smallGroup: Payment[] = [];
    const general: Payment[] = [];
    for (const payment of overdue) {
      const student = studentsById.get(payment.studentId);
      if (isSmallGroup2Bac(payment, student)) {
        smallGroup.push(payment);
      } else {
        general.push(payment);
      }
    }
    const generalGroups = groupByStudent(general);
    const smallGroupGroups = groupByStudent(smallGroup);
    // Registration fee (رسال التسجيل) debtors — separate accounting from the
    // installments above. The badge counts the UNION: unique installment
    // debtors + fee debtors (a student owing both is counted exactly once).
    const feeDebtors = aggregateRegistrationFeeDebtors(students);
    const uniqueStudentIds = new Set(overdue.map((p) => p.studentId));
    for (const row of feeDebtors.rows) uniqueStudentIds.add(row.studentId);
    return {
      generalGroups,
      smallGroupGroups,
      feeDebtorRows: feeDebtors.rows,
      studentCount: uniqueStudentIds.size,
      installmentCount: overdue.length,
    };
  }, [payments, students, studentsById, todayKey]);

  const badgeLabel = studentCount > 99 ? "99+" : String(studentCount);
  // Suppress badge until the initial Supabase snapshot has been confirmed.
  // Before hydratePayments/hydrateStudents fire, hasSynced is false and we render no badge
  // — preventing a brief flash of a stale IndexedDB 99+ on first load.
  const showBadge = hasSynced && studentCount > 0;

  const hasAny = studentCount > 0;

  // One-click fee settle — toast handled here (the store action stays silent).
  function handleSettleFee(studentId: string) {
    settleRegistrationFee(studentId);
    toast.success(t("registrationFeeSettledToast"));
  }

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="relative rounded-full"
          aria-label={studentCount > 0 ? `${t("notifications")} (${badgeLabel})` : t("notifications")}
        >
          <Bell className="h-4 w-4" />
          {showBadge && (
            <span
              className={cn(
                "absolute -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-bold leading-none text-destructive-foreground animate-in fade-in zoom-in-95 duration-200",
                "end-0",
              )}
              aria-hidden="true"
            >
              {badgeLabel}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        className="w-[360px] max-h-[70vh] overflow-y-auto rounded-2xl p-0 shadow-lg sm:w-[400px]"
      >
        <div className="sticky top-0 z-10 border-b border-border bg-card/95 px-4 py-3 backdrop-blur-sm">
          <p className="text-sm font-bold text-foreground">{t("overduePaymentsTitle")}</p>
          <p className="text-xs text-muted-foreground">
            {studentCount} {t("studentsCount")} · {installmentCount} {t("installments")}
          </p>
        </div>

        <div className="space-y-4 p-3">
          {!hasAny ? (
            <p className="py-10 text-center text-sm text-muted-foreground">
              {t("noOverduePayments")}
            </p>
          ) : (
            <>
              {generalGroups.length > 0 && (
                <div className="space-y-2">
                  <div className="flex items-center gap-1.5 px-1">
                    <p className="text-xs font-semibold text-foreground">
                      {t("overduePaymentsAllLevels")}
                    </p>
                    <Badge variant="outline" className="rounded-full text-[10px]">
                      {generalGroups.length}
                    </Badge>
                  </div>
                  <div className="space-y-1.5">
                    {generalGroups.map((group) => (
                      <StudentNotificationRow
                        key={group.studentId}
                        group={group}
                        student={studentsById.get(group.studentId)}
                      />
                    ))}
                  </div>
                </div>
              )}

              {smallGroupGroups.length > 0 && (
                <div className="space-y-2">
                  <div className="flex items-center gap-1.5 px-1">
                    <p className="text-xs font-semibold text-foreground">
                      {t("overduePaymentsSmallGroup2Bac")}
                    </p>
                    <Badge variant="outline" className="rounded-full text-[10px]">
                      {smallGroupGroups.length}
                    </Badge>
                  </div>
                  <div className="space-y-1.5">
                    {smallGroupGroups.map((group) => (
                      <StudentNotificationRow
                        key={`small-${group.studentId}`}
                        group={group}
                        student={studentsById.get(group.studentId)}
                      />
                    ))}
                  </div>
                </div>
              )}

              {feeDebtorRows.length > 0 && (
                <div className="space-y-2">
                  <div className="flex items-center gap-1.5 px-1">
                    <Receipt className="h-3.5 w-3.5 text-destructive" />
                    <p className="text-xs font-semibold text-foreground">
                      {t("registrationFeeBellSection")}
                    </p>
                    <Badge variant="outline" className="rounded-full text-[10px]">
                      {feeDebtorRows.length}
                    </Badge>
                  </div>
                  <div className="space-y-1.5">
                    {feeDebtorRows.map((row) => {
                      const student = studentsById.get(row.studentId);
                      return (
                        <div
                          key={`fee-${row.studentId}`}
                          className="flex items-center justify-between gap-2 rounded-xl border border-border bg-card p-3"
                        >
                          <div className="min-w-0 flex-1 space-y-1">
                            <p className="truncate text-sm font-semibold">
                              {student
                                ? `${student.firstName} ${student.lastName}`
                                : "—"}
                            </p>
                            <div className="flex flex-wrap items-center gap-1">
                              {student && (
                                <Badge variant="secondary" className="rounded-full text-[10px]">
                                  {student.level}
                                </Badge>
                              )}
                              <span className="text-xs font-semibold text-destructive">
                                {t("registrationFeeRemainingLabel")}: {row.remaining} / {row.amountDue} MAD
                              </span>
                            </div>
                          </div>
                          <div className="shrink-0">
                            <Button
                              type="button"
                              size="sm"
                              variant="secondary"
                              className="gap-1 rounded-lg"
                              onClick={() => handleSettleFee(row.studentId)}
                              title={t("registrationFeeSettle")}
                            >
                              <CircleDollarSign className="h-3.5 w-3.5" />
                              {t("registrationFeeSettle")}
                            </Button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </>
          )}
        </div>

        <div className="sticky bottom-0 border-t border-border bg-card/95 px-4 py-2.5 backdrop-blur-sm">
          <Link
            to="/payments"
            className="block text-center text-xs font-semibold text-primary hover:underline"
          >
            {t("viewAllPayments")}
          </Link>
        </div>
      </PopoverContent>
    </Popover>
  );
}