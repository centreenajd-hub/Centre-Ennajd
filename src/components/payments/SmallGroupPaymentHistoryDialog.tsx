import { useMemo } from "react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useEnnajdState } from "@/hooks/use-ennajd-state";
import {
  getDueBalanceForStudentSubject,
  getPaymentRemaining,
  isPaymentFullyPaid,
} from "@/lib/ennajd-billing";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import type { Payment, Student, Subject } from "@/types/ennajd";

interface SmallGroupPaymentHistoryDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  student: Student;
  subject: Subject;
  todayKey: string;
}

function formatDisplayDateShort(isoDate: string): string {
  const d = new Date(isoDate);
  if (isNaN(d.getTime())) return "—";
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const yyyy = d.getFullYear();
  return `${dd}/${mm}/${yyyy}`;
}

function formatMonthLabel(monthKey: string): string {
  const [y, m] = monthKey.split("-");
  return m && y ? `${m}/${y}` : monthKey;
}

type InstallmentStatus = "paid" | "unpaid" | "overdue";

function statusOf(payment: Payment, todayKey: string): InstallmentStatus {
  if (isPaymentFullyPaid(payment)) return "paid";
  if (payment.dueDate < todayKey) return "overdue";
  return "unpaid";
}

export function SmallGroupPaymentHistoryDialog({
  open,
  onOpenChange,
  student,
  subject,
  todayKey,
}: SmallGroupPaymentHistoryDialogProps) {
  const { t, lang } = useI18n();
  const payments = useEnnajdState((s) => s.payments);
  const setPaymentPaid = useEnnajdState((s) => s.setPaymentPaid);

  const installments = useMemo(
    () =>
      payments
        .filter((p) => p.studentId === student.id && p.subject === subject)
        .sort((a, b) => a.dueDate.localeCompare(b.dueDate)),
    [payments, student.id, subject],
  );

  const summary = useMemo(
    () => getDueBalanceForStudentSubject(payments, student.id, subject, todayKey),
    [payments, student.id, subject, todayKey],
  );

  function handleSettle(id: string) {
    setPaymentPaid(id, true);
    toast.success(t("installmentSettled"));
  }

  function handleUndo(id: string) {
    setPaymentPaid(id, false);
    toast.success(t("installmentUnpaid"));
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        dir={lang === "ar" ? "rtl" : "ltr"}
        className="max-h-[85vh] overflow-y-auto sm:max-w-2xl"
      >
        <DialogHeader>
          <DialogTitle>{t("paymentHistoryTitle")}</DialogTitle>
          <DialogDescription>
            {student.firstName} {student.lastName} ·{" "}
            {subject === "Math" ? "Maths" : subject === "PC" ? "Physique" : subject}
            {summary.hasInstallments && (
              <>
                {" · "}
                <span
                  className={cn(
                    summary.dueTotal > 0 ? "font-semibold text-destructive" : "text-success",
                  )}
                >
                  {summary.dueTotal > 0
                    ? `${t("remainingAmount")}: ${summary.dueTotal} MAD`
                    : t("upToDate")}
                </span>
              </>
            )}
          </DialogDescription>
        </DialogHeader>

        {installments.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            {t("paymentHistoryEmpty")}
          </p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("colDueDate")}</TableHead>
                <TableHead>{t("colMonth")}</TableHead>
                <TableHead className="text-right">{t("colAmount")}</TableHead>
                <TableHead>{t("colStatus")}</TableHead>
                <TableHead className="text-right">{" "}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {installments.map((payment) => {
                const status = statusOf(payment, todayKey);
                const remaining = getPaymentRemaining(payment);
                return (
                  <TableRow key={payment.id}>
                    <TableCell className="font-medium tabular-nums">
                      {formatDisplayDateShort(payment.dueDate)}
                    </TableCell>
                    <TableCell className="tabular-nums text-muted-foreground">
                      {formatMonthLabel(payment.month)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      <span>{payment.amountDue} MAD</span>
                      {(payment.amountPaid ?? 0) > 0 && (
                        <span className="block text-[11px] text-muted-foreground">
                          {t("tuitionPaidLabel")}: {payment.amountPaid} MAD
                        </span>
                      )}
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant={status === "overdue" ? "destructive" : "secondary"}
                        className={cn(
                          "rounded-full",
                          status === "paid" && "bg-success text-white",
                          status === "unpaid" && "bg-amber-500/15 text-amber-700 dark:text-amber-300",
                        )}
                      >
                        {status === "paid"
                          ? t("installmentStatusPaid")
                          : status === "overdue"
                            ? t("installmentStatusOverdue")
                            : t("installmentStatusUnpaid")}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      {status === "paid" ? (
                        <Button
                          variant="outline"
                          size="sm"
                          className="rounded-full"
                          onClick={() => handleUndo(payment.id)}
                        >
                          ↻ {t("correctCancel")}
                        </Button>
                      ) : (
                        <Button
                          size="sm"
                          className="rounded-full bg-emerald-600 text-white hover:bg-emerald-700"
                          onClick={() => handleSettle(payment.id)}
                        >
                          ✓ {remaining} MAD
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </DialogContent>
    </Dialog>
  );
}
