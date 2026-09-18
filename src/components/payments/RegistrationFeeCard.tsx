// Wallet card for the one-time registration fee (رسوم التسجيل), rendered
// inside SettleStudentDialog after the 3-stat grid. Completely separate from
// the installment stats above — the fee NEVER flows into those totals.
// - UNPAID: red-tinted compact card with the bold remaining, a one-click
//   Settle button, the pencil dialog and the free-text note.
// - PAID (including legacy students with no stored fee): a subtle green
//   line "رسوم التسجيل ✓" with a ghost pencil whose tooltip explains the
//   legacy default — the manual entry point to un-mark a legacy student.

import { CircleDollarSign, Receipt } from "lucide-react";
import { toast } from "sonner";

import { RegistrationFeeDialog } from "@/components/payments/RegistrationFeeDialog";
import { PaymentNoteLine } from "@/components/payments/PaymentRuleTable";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useEnnajdState } from "@/hooks/use-ennajd-state";
import {
  getRegistrationFeeRemaining,
  isRegistrationFeeUnpaid,
} from "@/lib/ennajd-billing";
import { useI18n } from "@/lib/i18n";
import type { Student } from "@/types/ennajd";

interface RegistrationFeeCardProps {
  student: Student;
}

export function RegistrationFeeCard({ student }: RegistrationFeeCardProps) {
  const { t } = useI18n();
  const settleRegistrationFee = useEnnajdState(
    (s) => s.settleRegistrationFee,
  );

  const unpaid = isRegistrationFeeUnpaid(student);
  const remaining = getRegistrationFeeRemaining(student);
  const due = student.registrationFee?.amountDue;
  const paidPortion = student.registrationFee?.amountPaid ?? 0;
  const note = student.registrationFee?.note;

  function handleSettle() {
    settleRegistrationFee(student.id);
    toast.success(t("registrationFeeSettledToast"));
  }

  // Paid / legacy: one quiet success-tinted line + the ghost pencil.
  if (!unpaid) {
    return (
      <div className="flex items-center justify-between gap-2 rounded-xl bg-success/10 px-3 py-2">
        <div className="flex min-w-0 items-center gap-2">
          <Receipt className="h-4 w-4 shrink-0 text-success" />
          <p className="truncate text-sm font-medium text-success">
            {t("registrationFee")} ✓
          </p>
        </div>
        <RegistrationFeeDialog
          student={student}
          size="icon"
          tooltip={t("registrationFeeLegacyHint")}
        />
      </div>
    );
  }

  // Unpaid: red-tinted compact card with Settle + pencil + note.
  return (
    <div className="rounded-xl border border-destructive/30 bg-destructive/5 px-3 py-2.5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <Receipt className="h-4 w-4 shrink-0 text-destructive" />
          <p className="truncate text-sm font-semibold">
            {t("registrationFee")}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <Badge variant="destructive" className="rounded-full">
            {t("registrationFeeRemainingLabel")}: {remaining} / {due} MAD
          </Badge>
          <RegistrationFeeDialog student={student} size="icon" />
          <Button
            type="button"
            size="sm"
            className="rounded-lg"
            onClick={handleSettle}
          >
            <CircleDollarSign className="me-1.5 h-4 w-4" />
            {t("registrationFeeSettle")}
          </Button>
        </div>
      </div>
      {paidPortion > 0 && (
        <p className="mt-1 text-xs font-bold text-accent-foreground">
          {t("registrationFeePaidLabel")}: {paidPortion} / {due} MAD
        </p>
      )}
      {note && <PaymentNoteLine note={note} />}
    </div>
  );
}
