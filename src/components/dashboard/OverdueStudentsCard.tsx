import { Check, TriangleAlert } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { useEnnajdState } from "@/hooks/use-ennajd-state";
import { getPaymentRemaining } from "@/lib/ennajd-billing";
import { useI18n } from "@/lib/i18n";
import type { Session, Student } from "@/types/ennajd";

export interface OverdueStudentInfo {
  student: Student;
  /** Σ remaining across due-unpaid installments of this session's subject. */
  amount: number;
  /** Earliest unpaid dueDate, or null. */
  earliestDueDate: string | null;
}

interface OverdueStudentsCardProps {
  session: Session;
  /** Roster students owing money for THIS session's subject. */
  entries: OverdueStudentInfo[];
  todayKey: string; // "YYYY-MM-DD"
}

/**
 * Destructive-tinted summary card shown directly under AttendanceStatsBar:
 * every roster student who owes money for this session's subject, with a
 * one-tap "تسوية" button that settles ALL their due installments for that
 * subject at once. Hidden entirely when nobody owes.
 */
export function OverdueStudentsCard({
  session,
  entries,
  todayKey,
}: OverdueStudentsCardProps) {
  const { t } = useI18n();
  const payments = useEnnajdState((s) => s.payments);
  const setPaymentPaid = useEnnajdState((s) => s.setPaymentPaid);

  if (entries.length === 0) return null;

  // Settle ALL due installments of this student+subject in one tap — same
  // semantics as the Payments page's row-settle and the chip's $ button.
  // Sorted dueDate-ascending so the chronological settlement dependency
  // (Month 1 before Month 2, etc.) is satisfied one installment at a time.
  async function handleSettleAll(studentId: string) {
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
    let anySettled = false;
    for (const payment of dueUnpaid) {
      if (await setPaymentPaid(payment.id, true)) anySettled = true;
    }
    if (anySettled) toast.success(t("installmentSettled"));
  }

  return (
    <section className="overflow-hidden rounded-2xl border border-destructive/30 bg-destructive/5">
      <header className="flex items-center gap-2 border-b border-destructive/20 bg-destructive/10 px-4 py-2.5">
        <TriangleAlert className="h-5 w-5 shrink-0 text-destructive" />
        <h3 className="text-sm font-bold text-destructive">
          {t("unpaidWarningFull")}
        </h3>
      </header>
      <ul className="space-y-1.5 p-3">
        {entries.map(({ student, amount, earliestDueDate }) => (
          <li
            key={student.id}
            className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-destructive/20 bg-card/70 px-3 py-2"
          >
            <div className="min-w-0">
              <p className="truncate text-sm font-bold">
                {student.firstName} {student.lastName}
              </p>
              <p className="text-xs text-muted-foreground">
                {t("owesLabel")} <span className="font-bold text-destructive">{amount} MAD</span>
                {earliestDueDate && (
                  <>
                    {" "}
                    · {t("dueDate")} : <span className="font-medium">{earliestDueDate}</span>
                  </>
                )}
              </p>
            </div>
            <Button
              type="button"
              size="sm"
              className="shrink-0 rounded-lg bg-success text-white hover:bg-success/90"
              onClick={() => handleSettleAll(student.id)}
            >
              <Check className="me-1.5 h-4 w-4" />
              {t("settlePayment")}
            </Button>
          </li>
        ))}
      </ul>
    </section>
  );
}
