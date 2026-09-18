// Month-cell popover for the Report Generator's payments preview — lists the
// month's installments with instant per-installment ✓/↺ actions, a one-click
// "settle the whole month", its undo, and embeds the existing
// RecordPartialPaymentDialog + AdjustBalanceDialog behind compact triggers.
// All writes reuse the plain store actions (setPaymentPaid etc.) so the
// matrix, wallet panels and PDF all stay in sync.

import { Check, CheckCircle2, RotateCcw, Undo2, X } from "lucide-react";
import { useMemo } from "react";
import { toast } from "sonner";

import { AdjustBalanceDialog } from "@/components/payments/AdjustBalanceDialog";
import { RecordPartialPaymentDialog } from "@/components/payments/RecordPartialPaymentDialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useEnnajdState } from "@/hooks/use-ennajd-state";
import { formatAcademicMonthLabel, type AcademicMonth } from "@/lib/ennajd-report-shared";
import { useI18n, type LangCode } from "@/lib/i18n";
import type { Student, Subject } from "@/types/ennajd";

/** Local-time "dd/MM/yy" — avoids the UTC shift of new Date("YYYY-MM-DD"). */
function formatDateLabel(dateKey: string, locale: string): string {
  const [y, m, d] = dateKey.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(locale, {
    day: "2-digit",
    month: "2-digit",
    year: "2-digit",
  });
}

interface PaymentCellPopoverProps {
  student: Student;
  subject: Subject;
  month: AcademicMonth;
  lang: LangCode;
  /** Children render as the trigger (the month amount chip). */
  children: React.ReactNode;
}

/** App-wide settled semantics: flag OR paid credit covering the amount. */
function isSettled(payment: { isPaid: boolean; amountDue: number; amountPaid?: number }): boolean {
  return payment.isPaid || (payment.amountPaid ?? 0) >= payment.amountDue;
}

export function PaymentCellPopover({
  student,
  subject,
  month,
  lang,
  children,
}: PaymentCellPopoverProps) {
  const { t } = useI18n();
  const payments = useEnnajdState((s) => s.payments);
  const setPaymentPaid = useEnnajdState((s) => s.setPaymentPaid);

  const locale = lang === "ar" ? "ar" : "fr-FR";
  // Live — reads the store, so an action in this popover re-renders the list
  // immediately (the closed-over matrix is only used for the trigger).
  const monthPayments = useMemo(
    () =>
      payments
        .filter(
          (p) => p.studentId === student.id && p.subject === subject && p.month === month.key,
        )
        .sort((a, b) => a.dueDate.localeCompare(b.dueDate)),
    [payments, student.id, subject, month.key],
  );

  const unpaidCount = monthPayments.filter((p) => !isSettled(p)).length;
  const paidCount = monthPayments.length - unpaidCount;

  function handleSettleMonth() {
    for (const payment of monthPayments.filter((p) => !isSettled(p))) {
      setPaymentPaid(payment.id, true);
    }
    toast.success(t("installmentSettled"));
  }

  function handleUnsettleMonth() {
    for (const payment of monthPayments.filter((p) => isSettled(p))) {
      setPaymentPaid(payment.id, false);
    }
    toast.success(t("installmentUnpaid"));
  }

  return (
    <Popover>
      <PopoverTrigger asChild>{children}</PopoverTrigger>
      <PopoverContent align="center" className="w-80 rounded-2xl p-4">
        <header className="space-y-0.5 text-center">
          <p className="text-sm font-bold">{t("monthInstallmentsTitle")}</p>
          <p className="text-xs text-muted-foreground">
            {student.firstName} {student.lastName} ·{" "}
            {formatAcademicMonthLabel(month, locale)}
          </p>
        </header>

        <ul className="mt-3 space-y-1.5">
          {monthPayments.map((payment) => {
            const paid = isSettled(payment);
            const partial = !paid && (payment.amountPaid ?? 0) > 0;
            const remaining = Math.max(0, payment.amountDue - (payment.amountPaid ?? 0));
            return (
              <li
                key={payment.id}
                className="flex items-center justify-between gap-2 rounded-xl border border-border bg-muted/40 px-2.5 py-2"
              >
                <div className="min-w-0 flex-1 space-y-1">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="text-xs font-semibold">
                      {formatDateLabel(payment.dueDate, locale)}
                    </span>
                    <span className="text-xs font-bold text-primary">
                      {payment.amountDue} MAD
                    </span>
                  </div>
                  <div>
                    {paid ? (
                      <Badge className="gap-1 rounded-full bg-success/15 px-2 text-[10px] font-bold text-success">
                        <Check className="h-3 w-3" />
                        {t("paid")}
                      </Badge>
                    ) : partial ? (
                      <Badge className="gap-1 rounded-full bg-success/15 px-2 text-[10px] font-bold text-success">
                        {t("advanceCreditBadge")} · {t("remainingAmount")} {remaining}
                      </Badge>
                    ) : (
                      <Badge className="gap-1 rounded-full bg-destructive/10 px-2 text-[10px] font-bold text-destructive">
                        <X className="h-3 w-3" />
                        {t("unpaid")}
                      </Badge>
                    )}
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  {paid ? (
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 rounded-lg text-muted-foreground hover:text-foreground"
                      title={t("markUnpaid")}
                      aria-label={t("markUnpaid")}
                      onClick={() => {
                        setPaymentPaid(payment.id, false);
                        toast.success(t("installmentUnpaid"));
                      }}
                    >
                      <RotateCcw className="h-4 w-4" />
                    </Button>
                  ) : (
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 rounded-lg text-success hover:bg-success/10 hover:text-success"
                      title={t("markPaid")}
                      aria-label={t("markPaid")}
                      onClick={() => {
                        setPaymentPaid(payment.id, true);
                        toast.success(t("installmentSettled"));
                      }}
                    >
                      <Check className="h-4 w-4" />
                    </Button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>

        {unpaidCount > 0 && (
          <Button
            type="button"
            className="mt-3 h-9 w-full gap-1.5 rounded-xl bg-success text-success-foreground hover:bg-success/90"
            onClick={handleSettleMonth}
          >
            <CheckCircle2 className="h-4 w-4" />
            {t("payMonthAction")}
          </Button>
        )}
        {paidCount > 0 && (
          <Button
            type="button"
            variant="ghost"
            className="mt-2 h-9 w-full gap-1.5 rounded-xl text-muted-foreground hover:text-foreground"
            onClick={handleUnsettleMonth}
          >
            <Undo2 className="h-4 w-4" />
            {t("unpayMonthAction")}
          </Button>
        )}

        <div className="mt-3 flex items-center justify-center gap-2 border-t border-border pt-3">
          <RecordPartialPaymentDialog student={student} subject={subject} size="sm" />
          <AdjustBalanceDialog student={student} subject={subject} size="sm" />
        </div>

        <p className="mt-2.5 text-start text-[10px] leading-relaxed text-muted-foreground">
          {t("popoversScopeNote")}
        </p>
      </PopoverContent>
    </Popover>
  );
}
