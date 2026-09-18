import { AlertCircle, Check, CheckCircle2, MinusCircle, Undo2 } from "lucide-react";
import { useMemo } from "react";
import { toast } from "sonner";

import { OverdueBadge } from "@/components/payments/PaymentStatusBadge";
import { RecordPartialPaymentDialog } from "@/components/payments/RecordPartialPaymentDialog";
import { SettleStudentDialog } from "@/components/students/SettleStudentDialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useEnnajdState } from "@/hooks/use-ennajd-state";
import { getDueBalanceForStudentSubject } from "@/lib/ennajd-billing";
import { useI18n } from "@/lib/i18n";
import { normalizeText } from "@/lib/text-normalize";
import type { Student, Subject } from "@/types/ennajd";

interface SmallGroupsPanelProps {
  /** Subject currently displayed — its 2Bac s.x Small-group roster only. */
  subject: Subject;
  /** Page-level name search, applied on top of the subject roster. */
  search: string;
  todayKey: string; // "YYYY-MM-DD"
}

export function SmallGroupsPanel({ subject, search, todayKey }: SmallGroupsPanelProps) {
  const { t } = useI18n();
  const students = useEnnajdState((s) => s.students);
  const payments = useEnnajdState((s) => s.payments);
  const setPaymentPaid = useEnnajdState((s) => s.setPaymentPaid);

  // Roster: 2Bac s.x students with a Small-group enrollment in this subject,
  // filtered by the page-level name search. Track must be s.x to match Rule B.
  const roster = useMemo(() => {
    const query = normalizeText(search);
    return students.filter(
      (student) =>
        student.level === "2Bac" &&
        student.enrollments.some((e) => e.subject === subject && e.groupType === "Small" && e.track === "s.x") &&
        (query === "" ||
          normalizeText(`${student.firstName} ${student.lastName}`).includes(query)),
    );
  }, [students, subject, search]);

  const entries = useMemo(
    () =>
      roster.map((student) => ({
        student,
        balance: getDueBalanceForStudentSubject(payments, student.id, subject, todayKey),
      })),
    [roster, payments, subject, todayKey],
  );

  const unpaidEntries = entries.filter((e) => e.balance.dueUnpaid.length > 0);
  const paidEntries = entries.filter((e) => e.balance.dueUnpaid.length === 0);

  function handleSettleFirst(entry: (typeof entries)[number]) {
    // Settles the earliest due installment — identical behavior to the rest
    // of the app; the student slides into the Paid panel once nothing is due.
    const first = entry.balance.dueUnpaid[0];
    if (!first) return;
    setPaymentPaid(first.id, true);
    toast.success(t("installmentSettled"));
  }

  function handleMarkUnpaid(entry: (typeof entries)[number]) {
    const last = entry.balance.lastPaidDue;
    if (!last) return;
    setPaymentPaid(last.id, false);
    toast.success(t("installmentUnpaid"));
  }

  if (roster.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-border bg-card/50 py-16 text-center text-muted-foreground">
        {search.trim() ? t("noResults") : t("noStudentsInSubject")}
      </div>
    );
  }

  return (
    <div className="grid items-start gap-4 lg:grid-cols-2">
          {/* --- Payés --- */}
          <section className="min-w-0 overflow-hidden rounded-2xl border border-success/30 bg-success/5">
        <header className="flex items-center justify-between gap-2 border-b border-success/20 bg-success/10 px-4 py-3">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="h-5 w-5 text-success" />
            <h2 className="text-sm font-bold text-success">{t("paidPanelTitle")}</h2>
          </div>
          <Badge variant="secondary" className="rounded-full">
            {paidEntries.length}
          </Badge>
        </header>
        <div className="space-y-2 p-3">
          {paidEntries.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">{t("noPaidYet")}</p>
          ) : (
            paidEntries.map(({ student, balance }) => (
              <PaidRow
                key={student.id}
                student={student}
                hasInstallments={balance.hasInstallments}
                nextDueDate={balance.nextUpcoming?.dueDate ?? null}
                nextRemaining={
                  balance.nextUpcoming
                    ? Math.max(
                        0,
                        balance.nextUpcoming.amountDue -
                          (balance.nextUpcoming.amountPaid ?? 0),
                      )
                    : null
                }
                canMarkUnpaid={balance.lastPaidDue !== null}
                onMarkUnpaid={() => handleMarkUnpaid({ student, balance })}
              />
            ))
          )}
        </div>
      </section>

      {/* --- Impayés --- */}
            <section className="min-w-0 overflow-hidden rounded-2xl border border-destructive/30 bg-destructive/5">
        <header className="flex items-center justify-between gap-2 border-b border-destructive/20 bg-destructive/10 px-4 py-3">
          <div className="flex items-center gap-2">
            <AlertCircle className="h-5 w-5 text-destructive" />
            <h2 className="text-sm font-bold text-destructive">{t("unpaidPanelTitle")}</h2>
          </div>
          <Badge variant="secondary" className="rounded-full">
            {unpaidEntries.length}
          </Badge>
        </header>
        <div className="space-y-2 p-3">
          {unpaidEntries.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-2 py-8 text-center">
              <CheckCircle2 className="h-8 w-8 text-success" />
              <p className="font-semibold text-success">{t("allSettled")} 🎉</p>
            </div>
          ) : (
            unpaidEntries.map(({ student, balance }) => (
              <UnpaidRow
                key={student.id}
                student={student}
                subject={subject}
                dueTotal={balance.dueTotal}
                amountPaid={balance.amountPaid}
                dueCount={balance.dueUnpaid.length}
                earliestDueDate={balance.earliestDueDate}
                isOverdue={balance.isOverdue}
                onSettleFirst={() => handleSettleFirst({ student, balance })}
              />
            ))
          )}
        </div>
      </section>
    </div>
  );
}

/** Every row in this view is by definition 2Bac · s.x · Small — the badges
 *  are constant, kept for parity with the other payments tables. */
function StudentBadges() {
  const { t } = useI18n();
  return (
    <div className="flex flex-wrap items-center gap-1">
      <Badge variant="secondary" className="rounded-full">
        2Bac
      </Badge>
      <Badge variant="outline" className="rounded-full">
        s.x
      </Badge>
      <Badge variant="outline" className="rounded-full">
        {t("small")}
      </Badge>
    </div>
  );
}

interface PaidRowProps {
  student: Student;
  hasInstallments: boolean;
  nextDueDate: string | null;
  nextRemaining: number | null;
  canMarkUnpaid: boolean;
  onMarkUnpaid: () => void;
}

function PaidRow({
  student,
  hasInstallments,
  nextDueDate,
  nextRemaining,
  canMarkUnpaid,
  onMarkUnpaid,
}: PaidRowProps) {
  const { t } = useI18n();
  // A partially-covered upcoming installment (surplus rolled forward from
  // an earlier partial payment) still shows its remaining amount in accent.
  const showNextRemaining =
    nextDueDate !== null && nextRemaining !== null && nextRemaining > 0;
  return (
    <div className="flex items-center gap-2.5 rounded-xl border border-success/20 bg-card/70 px-3 py-2.5">
      {hasInstallments ? (
        <CheckCircle2 className="h-5 w-5 shrink-0 text-success" />
      ) : (
        <MinusCircle className="h-5 w-5 shrink-0 text-muted-foreground/60" />
      )}
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold">
          {student.firstName} {student.lastName}
        </p>
        <div className="mt-1">
          <StudentBadges />
        </div>
        <p className="mt-1 text-xs text-muted-foreground">
          {!hasInstallments ? (
            <span className="italic">{t("noEnrollmentsForSubject")}</span>
          ) : nextDueDate ? (
            <>
              {t("nextDue")} : <span className="font-medium">{nextDueDate}</span>
              {showNextRemaining && (
                <span className="ms-1.5 font-bold text-accent-foreground">
                  · {t("remainingAmount")} {nextRemaining} MAD
                </span>
              )}
            </>
          ) : (
            t("upToDate")
          )}
        </p>
      </div>
      <div className="flex shrink-0 items-center gap-1">
        {canMarkUnpaid && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-7 gap-1 rounded-lg px-2 text-xs text-muted-foreground"
            onClick={onMarkUnpaid}
            title={t("markUnpaid")}
          >
            <Undo2 className="h-3.5 w-3.5" />
            <span className="hidden xl:inline">{t("markUnpaid")}</span>
          </Button>
        )}
        <SettleStudentDialog student={student} />
      </div>
    </div>
  );
}

interface UnpaidRowProps {
  student: Student;
  subject: Subject;
  dueTotal: number;
  amountPaid: number;
  dueCount: number;
  earliestDueDate: string | null;
  isOverdue: boolean;
  onSettleFirst: () => void;
}

function UnpaidRow({
  student,
  subject,
  dueTotal,
  amountPaid,
  dueCount,
  earliestDueDate,
  isOverdue,
  onSettleFirst,
}: UnpaidRowProps) {
  const { t } = useI18n();
  const isPartiallyPaid = amountPaid > 0;
  return (
    <div className="flex flex-col gap-2.5 rounded-xl border border-destructive/20 bg-card/70 px-3 py-2.5 sm:flex-row sm:items-center">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <p className="truncate text-sm font-semibold">
            {student.firstName} {student.lastName}
          </p>
          {isOverdue && <OverdueBadge />}
        </div>
        <div className="mt-1">
          <StudentBadges />
        </div>
        <p className="mt-1.5 text-xs text-muted-foreground">
          {t("dueDate")} : <span className="font-medium">{earliestDueDate ?? "—"}</span>
          {dueCount > 1 && (
            <span className="ms-1.5">
              · {dueCount} {t("installments")}
            </span>
          )}
        </p>
        {isPartiallyPaid && (
          <p className="mt-1 text-xs font-bold text-accent-foreground">
            {t("paidSoFar")} : {amountPaid} MAD · {t("remainingAmount")} :{" "}
            {dueTotal} MAD
          </p>
        )}
      </div>
      <div className="flex items-center justify-between gap-2 sm:justify-end">
        <span
          className={
            isPartiallyPaid
              ? "whitespace-nowrap text-sm font-bold text-accent-foreground"
              : "whitespace-nowrap text-sm font-bold text-destructive"
          }
        >
          {dueTotal} MAD
        </span>
        <SettleStudentDialog student={student} />
        <RecordPartialPaymentDialog student={student} subject={subject} />
        <Button
          type="button"
          size="sm"
          className="rounded-lg bg-success text-white hover:bg-success/90"
          onClick={onSettleFirst}
        >
          <Check className="me-1.5 h-4 w-4" />
          {t("settlePayment")}
        </Button>
      </div>
    </div>
  );
}
