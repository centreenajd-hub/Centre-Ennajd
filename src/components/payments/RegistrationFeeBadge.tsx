// Compact red badge for the students table: shows the remaining registration
// fee (رسوم التسجيل) next to the installment SettlementBadge. Renders null
// when the fee is paid (or the student is exempt / legacy with no fee stored)
// — the user rule is "show only when not fully paid".

import { Receipt } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import {
  getRegistrationFeeRemaining,
  isRegistrationFeeUnpaid,
} from "@/lib/ennajd-billing";
import { useI18n } from "@/lib/i18n";
import type { Student } from "@/types/ennajd";

interface RegistrationFeeBadgeProps {
  student: Student;
}

export function RegistrationFeeBadge({ student }: RegistrationFeeBadgeProps) {
  const { t } = useI18n();

  // Hidden when paid or not eligible — never adds noise for settled rows.
  if (!isRegistrationFeeUnpaid(student)) return null;

  const remaining = getRegistrationFeeRemaining(student);

  return (
    <Badge
      variant="destructive"
      className="gap-1 rounded-full"
      title={`${t("registrationFeeRemainingLabel")}: ${remaining} / ${student.registrationFee?.amountDue ?? 0} MAD`}
    >
      <Receipt className="h-3 w-3" />
      {remaining} MAD
    </Badge>
  );
}
