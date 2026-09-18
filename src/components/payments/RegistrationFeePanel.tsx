// Red "Frais d'inscription — impayés / رسوم التسجيل — لم تُدفع" panel of the
// Rule A tab: one row per registration-fee debtor with the red remaining,
// the paid portion for partials, the free-text note, a one-click Settle and
// the pencil dialog. The fee is COMPLETELY separate from the installment
// engine above — its money never flows into any installment total.
// Renders NOTHING when there are zero debtors (user rule: quiet when paid).

import { CircleDollarSign, Receipt } from "lucide-react";
import { useMemo } from "react";
import { toast } from "sonner";

import { RegistrationFeeDialog } from "@/components/payments/RegistrationFeeDialog";
import { PaymentNoteLine } from "@/components/payments/PaymentRuleTable";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useEnnajdState } from "@/hooks/use-ennajd-state";
import type { RegistrationFeeRow } from "@/lib/ennajd-billing";
import { useI18n } from "@/lib/i18n";
import type { Student } from "@/types/ennajd";

interface RegistrationFeePanelProps {
  /** Filtered debtor rows (already respects the page's search + level filter). */
  rows: RegistrationFeeRow[];
  studentsById: Map<string, Student>;
}

export function RegistrationFeePanel({ rows, studentsById }: RegistrationFeePanelProps) {
  const { t } = useI18n();
  const settleRegistrationFee = useEnnajdState(
    (s) => s.settleRegistrationFee,
  );

  const totalRemaining = useMemo(
    () => rows.reduce((sum, row) => sum + row.remaining, 0),
    [rows],
  );

  // Quiet when paid — zero debtors renders nothing at all.
  if (rows.length === 0) return null;

  function handleSettle(studentId: string) {
    settleRegistrationFee(studentId);
    toast.success(t("registrationFeeSettledToast"));
  }

  return (
    <section className="min-w-0 overflow-hidden rounded-2xl border border-destructive/30 bg-destructive/5">
          <header className="flex flex-wrap items-center justify-between gap-2 border-b border-destructive/20 bg-destructive/10 px-4 py-3">
            <div className="flex flex-wrap items-center gap-2">
              <Receipt className="h-5 w-5 shrink-0 text-destructive" />
          <h2 className="text-sm font-bold text-destructive">
            {t("registrationFeeUnpaidPanelTitle")}
          </h2>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <Badge variant="secondary" className="rounded-full">
            {rows.length}
          </Badge>
          <Badge
            variant="destructive"
            className="rounded-full"
            title={t("registrationFeeTotalRemaining")}
          >
            {t("registrationFeeTotalRemaining")} : {totalRemaining} MAD
          </Badge>
        </div>
      </header>
      <div className="space-y-1.5 p-3">
        {rows.map((row) => {
          const student = studentsById.get(row.studentId);
          const partiallyPaid = row.amountPaid > 0;
          return (
            <div
              key={row.studentId}
              className="rounded-xl border border-border bg-card px-3 py-2"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate text-sm font-bold">
                    {student
                      ? `${student.firstName} ${student.lastName}`
                      : "—"}
                  </p>
                  <div className="mt-0.5 flex flex-wrap items-center gap-1">
                    {student && (
                      <Badge variant="secondary" className="rounded-full text-[10px]">
                        {student.level}
                      </Badge>
                    )}
                    <span className="text-xs font-bold text-destructive">
                      {row.remaining} / {row.amountDue} MAD
                    </span>
                    {partiallyPaid && (
                      <span className="text-xs font-medium text-accent-foreground">
                        {t("registrationFeePaidLabel")}: {row.amountPaid} MAD
                      </span>
                    )}
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-1.5">
                  {student && (
                    <RegistrationFeeDialog student={student} size="icon" />
                  )}
                  <Button
                    type="button"
                    size="sm"
                    className="rounded-lg"
                    onClick={() => handleSettle(row.studentId)}
                  >
                    <CircleDollarSign className="me-1.5 h-4 w-4" />
                    {t("registrationFeeSettle")}
                  </Button>
                </div>
              </div>
              {row.note && <PaymentNoteLine note={row.note} />}
            </div>
          );
        })}
      </div>
    </section>
  );
}
