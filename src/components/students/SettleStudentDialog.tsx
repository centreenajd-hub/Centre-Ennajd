import { CheckCircle2, CircleDollarSign, Wallet } from "lucide-react";
import type { ReactNode } from "react";
import { useMemo } from "react";
import { toast } from "sonner";

import { AdjustBalanceDialog } from "@/components/payments/AdjustBalanceDialog";
import { PaymentNoteLine } from "@/components/payments/PaymentRuleTable";
import { RecordPartialPaymentDialog } from "@/components/payments/RecordPartialPaymentDialog";
import { RegistrationFeeCard } from "@/components/payments/RegistrationFeeCard";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { useEnnajdState } from "@/hooks/use-ennajd-state";
import { formatDateKey, getPaymentRemaining, isRegistrationFeeApplicable } from "@/lib/ennajd-billing";
import { useI18n } from "@/lib/i18n";
import type { Student } from "@/types/ennajd";

interface SettleStudentDialogProps {
  student: Student;
  /** Visually disable the wallet trigger when the student has no installments yet. */
  disabled?: boolean;
  /** Custom trigger — defaults to the wallet icon button when not provided. */
  trigger?: ReactNode;
}

export function SettleStudentDialog({ student, disabled, trigger }: SettleStudentDialogProps) {
  const { t } = useI18n();
  const payments = useEnnajdState((s) => s.payments);
  const setPaymentPaid = useEnnajdState((s) => s.setPaymentPaid);

  // Same "remaining" definition as hasOutstandingBalance: unpaid and
  // dueDate <= today. Future installments are shown separately, not settled.
  const todayKey = formatDateKey(new Date());

  const settlement = useMemo(() => {
    const all = payments.filter((p) => p.studentId === student.id);
    const byDueDate = (a: { dueDate: string; subject: string }, b: { dueDate: string; subject: string }) =>
      a.dueDate.localeCompare(b.dueDate) || a.subject.localeCompare(b.subject);
    const remaining = all
      .filter((p) => !p.isPaid && p.dueDate <= todayKey && getPaymentRemaining(p) > 0)
      .sort(byDueDate);
    const upcoming = all
      .filter((p) => !p.isPaid && p.dueDate > todayKey && getPaymentRemaining(p) > 0)
      .sort(byDueDate);
    const totalDefined = all.reduce((sum, p) => sum + p.amountDue, 0);
    // "Paid" counts what was actually covered: settled installments at full
    // amount plus every partial amountPaid on still-outstanding installments.
    const totalPaid = all.reduce(
      (sum, p) =>
        sum +
        (p.isPaid
          ? p.amountDue
          : Math.min(p.amountDue, p.amountPaid ?? 0)),
      0,
    );
    const totalRemaining = remaining.reduce(
      (sum, p) => sum + getPaymentRemaining(p),
      0,
    );
    const totalUpcoming = upcoming.reduce(
      (sum, p) => sum + getPaymentRemaining(p),
      0,
    );
    return { all, remaining, upcoming, totalDefined, totalPaid, totalRemaining, totalUpcoming };
  }, [payments, student.id, todayKey]);

  const hasInstallments = settlement.all.length > 0;
  const nothingDue = settlement.remaining.length === 0;

  // paymentNote per subject (pencil dialog) — one lookup for all rows.
  const noteBySubject = useMemo(() => {
    const map = new Map<string, string>();
    for (const enrollment of student.enrollments) {
      if (enrollment.paymentNote) map.set(enrollment.subject, enrollment.paymentNote);
    }
    return map;
  }, [student.enrollments]);

  async function handleSettleAll() {
    let anySettled = false;
    for (const payment of settlement.remaining) {
      if (await setPaymentPaid(payment.id, true)) anySettled = true;
    }
    if (anySettled) toast.success(t("settledToast"));
  }

  return (
    <Dialog>
      <DialogTrigger asChild>
        {trigger ?? (
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 rounded-lg"
            disabled={disabled}
            onClick={(e) => e.stopPropagation()}
            title={t("settleStudentTitle")}
          >
            <Wallet className="h-4 w-4" />
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="sm:max-w-2xl max-h-[85vh] overflow-y-auto rounded-2xl">
        <DialogHeader>
          <DialogTitle>
            {student.firstName} {student.lastName}
          </DialogTitle>
          <DialogDescription>{t("settleStudentTitle")}</DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                  <div className="rounded-xl border border-border bg-muted/40 p-3">
                    <p className="text-xs text-muted-foreground">{t("totalDefined")}</p>
                    <p className="mt-1 text-lg font-bold">{settlement.totalDefined} MAD</p>
                  </div>
                  <div className="rounded-xl bg-success/15 p-3">
                    <p className="text-xs font-medium text-success/80">{t("totalPaid")}</p>
                    <p className="mt-1 text-lg font-bold text-success">{settlement.totalPaid} MAD</p>
                  </div>
                  <div className="rounded-xl bg-destructive/10 p-3">
                    <p className="text-xs font-medium text-destructive/80">{t("remainingAmount")}</p>
                    <p className="mt-1 text-lg font-bold text-destructive">{settlement.totalRemaining} MAD</p>
                  </div>
                </div>

        {/* Registration fee (رسوم التسجيل) — tracked completely separately
            from the installment stats above; the fee never flows into them.
            Eligibility: ≥1 non-Small enrollment (2Bac s.x Small-only are exempt). */}
        {isRegistrationFeeApplicable(student) && (
          <RegistrationFeeCard student={student} />
        )}

        {!hasInstallments ? (
          <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border py-10 text-center text-sm text-muted-foreground">
            {t("noInstallmentsYet")}
          </div>
        ) : (
          <div className="space-y-4">
            {nothingDue ? (
              <div className="flex flex-col items-center justify-center gap-2 rounded-xl border border-success/30 bg-success/10 py-8 text-center">
                <CheckCircle2 className="h-10 w-10 text-success" />
                <p className="font-semibold text-success">{t("allSettled")} 🎉</p>
              </div>
            ) : (
              <div className="space-y-1.5">
                {settlement.remaining.map((payment) => {
                  const partiallyPaid = (payment.amountPaid ?? 0) > 0;
                  const remainingAmount = getPaymentRemaining(payment);
                  const note = noteBySubject.get(payment.subject);
                  return (
                                      <div
                                        key={payment.id}
                                        className="rounded-lg border border-border px-3 py-2"
                                      >
                                        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                                          <div className="min-w-0">
                                            <p className="text-sm font-medium">{payment.subject}</p>
                                            <p className="text-xs text-muted-foreground">{payment.dueDate}</p>
                                            {partiallyPaid && (
                                              <p className="mt-0.5 text-xs font-bold text-accent-foreground">
                                                {t("remainingAmount")} : {remainingAmount} / {payment.amountDue} MAD
                                              </p>
                                            )}
                                          </div>
                                          <div className="flex shrink-0 items-center gap-2">
                                            <span className="whitespace-nowrap text-sm font-semibold">
                                              {payment.amountDue} MAD
                                            </span>
                                            <RecordPartialPaymentDialog
                                              student={student}
                                              subject={payment.subject}
                                            />
                                            <AdjustBalanceDialog
                                              student={student}
                                              subject={payment.subject}
                                            />
                                            <Button
                                              type="button"
                                              size="sm"
                                              variant="default"
                                              className="rounded-lg"
                                              onClick={() => setPaymentPaid(payment.id, true)}
                                            >
                                              <CircleDollarSign className="me-1.5 h-4 w-4" />
                                              {t("settlePayment")}
                                            </Button>
                                          </div>
                                        </div>
                                        {note && <PaymentNoteLine note={note} />}
                                      </div>
                  );
                })}
              </div>
            )}

            {settlement.upcoming.length > 0 && (
              <div className="space-y-1.5">
                <p className="text-xs font-medium text-muted-foreground">
                  {t("upcoming")} ({settlement.totalUpcoming} MAD)
                </p>
                {settlement.upcoming.map((payment) => {
                  const partiallyPaid = (payment.amountPaid ?? 0) > 0;
                  const remainingAmount = getPaymentRemaining(payment);
                  const note = noteBySubject.get(payment.subject);
                  return (
                    <div key={payment.id} className="rounded-lg bg-muted/40 px-3 py-2">
                                          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                                            <div className="min-w-0">
                                              <p className="text-sm font-medium text-muted-foreground">
                                                {payment.subject}
                                              </p>
                                              <p className="text-xs text-muted-foreground/80">{payment.dueDate}</p>
                                              {partiallyPaid && (
                                                <p className="mt-0.5 text-xs font-bold text-accent-foreground">
                                                  {t("remainingAmount")} : {remainingAmount} / {payment.amountDue} MAD
                                                </p>
                                              )}
                                            </div>
                                            <div className="flex items-center gap-1">
                                              <span className="whitespace-nowrap text-sm font-semibold text-muted-foreground">
                                                {payment.amountDue} MAD
                                              </span>
                                              <AdjustBalanceDialog
                                                student={student}
                                                subject={payment.subject}
                                              />
                                            </div>
                                          </div>
                                          {note && <PaymentNoteLine note={note} />}
                                        </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        <DialogFooter>
          {hasInstallments && nothingDue && (
            <p className="text-xs text-muted-foreground">{t("noOutstandingNow")}</p>
          )}
          <Button type="button" onClick={handleSettleAll} disabled={nothingDue} className="rounded-lg">
            {nothingDue
              ? t("settleRemaining")
              : `${t("settleRemaining")} (${settlement.totalRemaining} MAD)`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
