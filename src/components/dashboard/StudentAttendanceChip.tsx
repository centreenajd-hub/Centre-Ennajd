import { Check, CheckCircle2, DollarSign, UserX } from "lucide-react";

import { UnpaidWarningBadge } from "@/components/payments/PaymentStatusBadge";
import { Badge } from "@/components/ui/badge";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import type { AttendanceStatus } from "@/types/ennajd";

interface StudentAttendanceChipProps {
  name: string;
  status: AttendanceStatus | "pending";
  hasOutstandingBalance: boolean;
  /**
   * Full unpaid-warning tooltip text (with owed amount). When undefined the
   * student owes nothing for this subject and no ⚠ badge is rendered.
   */
  unpaidWarningTitle?: string;
  isGuest?: boolean;
  onCycleStatus: () => void;
  onSettleOutstanding: () => void;
}

const STATUS_STYLES: Record<AttendanceStatus | "pending", string> = {
  present: "bg-success/15 text-success border-success/30",
  absent: "bg-destructive/10 text-destructive border-destructive/30",
  pending: "bg-muted text-muted-foreground border-border",
};

export function StudentAttendanceChip({
  name,
  status,
  hasOutstandingBalance,
  unpaidWarningTitle,
  isGuest,
  onCycleStatus,
  onSettleOutstanding,
}: StudentAttendanceChipProps) {
  const { t } = useI18n();

  return (
    <div
      className={cn(
        "group flex items-center gap-1.5 rounded-full border py-1 ps-1 pe-2 text-sm font-medium shadow-sm ring-2 transition-colors",
        STATUS_STYLES[status],
        hasOutstandingBalance ? "ring-destructive/40" : "ring-success/40",
      )}
    >
      <button
        type="button"
        onClick={onCycleStatus}
        className="flex items-center gap-1.5 rounded-full py-0.5 ps-1.5 pe-1 transition-opacity hover:opacity-80"
        title={t("attendance")}
      >
        {status === "present" ? (
          <Check className="h-3.5 w-3.5 shrink-0" />
        ) : status === "absent" ? (
          <UserX className="h-3.5 w-3.5 shrink-0" />
        ) : (
          <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-current opacity-60" />
        )}
        <span className="truncate">{name}</span>
        {isGuest && (
          <Badge
            variant="outline"
            className="ms-0.5 rounded-full border-current px-1.5 py-0 text-[10px] leading-4"
          >
            {t("guestBadge")}
          </Badge>
        )}
      </button>
      {unpaidWarningTitle && (
        <UnpaidWarningBadge title={unpaidWarningTitle} />
      )}
      <button
        type="button"
        onClick={onSettleOutstanding}
        disabled={!hasOutstandingBalance}
        title={hasOutstandingBalance ? t("settlePayment") : t("allSettled")}
        className={cn(
          "flex h-5 w-5 shrink-0 items-center justify-center rounded-full transition-colors",
          hasOutstandingBalance
            ? "bg-destructive/15 text-destructive"
            : "cursor-default bg-success/20 text-success",
        )}
      >
        {hasOutstandingBalance ? (
          <DollarSign className="h-3 w-3" />
        ) : (
          <CheckCircle2 className="h-3 w-3" />
        )}
      </button>
    </div>
  );
}
