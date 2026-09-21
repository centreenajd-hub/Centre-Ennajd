// "Paiements à recevoir" — the dashboard collection forecast. One row per
// student + subject, showing the CLEAN INTEGER complement the parent must pay
// next to bring that month to its full monthly_price (dynamic from the prices
// table — never a hardcoded number), plus the credit already carried onto it.

import { CircleDollarSign, Wallet } from "lucide-react";
import { Link } from "react-router-dom";
import { useMemo } from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useEnnajdState } from "@/hooks/use-ennajd-state";
import { useNowTick } from "@/hooks/use-now-tick";
import { getPaymentsToReceive, formatDateKey } from "@/lib/ennajd-billing";
import { formatAcademicMonthLabel } from "@/lib/ennajd-report-shared";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";

export function PaymentsToReceiveCard() {
  const { t, lang } = useI18n();
  const students = useEnnajdState((s) => s.students);
  const payments = useEnnajdState((s) => s.payments);
  const setPaymentPaid = useEnnajdState((s) => s.setPaymentPaid);

  const now = useNowTick();
  const todayKey = formatDateKey(now);
  const locale = lang === "ar" ? "ar" : "fr-FR";

  const rows = useMemo(
    () => getPaymentsToReceive(payments, students, todayKey),
    [payments, students, todayKey],
  );

  const total = useMemo(
    () => rows.reduce((sum, row) => sum + row.complement, 0),
    [rows],
  );

  const monthLabel = (monthKey: string) => {
    const [year, month] = monthKey.split("-").map(Number);
    return formatAcademicMonthLabel(
      { key: monthKey, monthIndex0: month - 1, year },
      locale,
    );
  };

  // Settles exactly this month's clean complement in one tap.
  async function handleSettle(paymentId: string) {
    if (await setPaymentPaid(paymentId, true)) {
      toast.success(t("installmentSettled"));
    }
  }

  if (rows.length === 0) return null;

  return (
    <section className="overflow-hidden rounded-2xl border border-accent/30 bg-accent/5">
      <header className="flex items-center justify-between gap-2 border-b border-accent/20 bg-accent/10 px-4 py-2.5">
        <div className="flex items-center gap-2">
          <Wallet className="h-5 w-5 shrink-0 text-accent-foreground" />
          <h3 className="text-sm font-bold text-accent-foreground">
            {t("paymentsToReceive")}
          </h3>
        </div>
        <div className="flex items-center gap-1.5">
          <Badge variant="outline" className="rounded-full text-[10px]">
            {rows.length}
          </Badge>
          <span className="text-xs font-bold text-accent-foreground">
            {total} MAD
          </span>
        </div>
      </header>
      <ul className="space-y-1.5 p-3">
        {rows.map((row) => (
          <li
            key={row.paymentId}
            className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-accent/20 bg-card/70 px-3 py-2"
          >
            <div className="min-w-0">
              <p className="truncate text-sm font-bold">
                {row.studentName}
              </p>
              <p className="flex flex-wrap items-center gap-1 text-xs text-muted-foreground">
                <Badge variant="secondary" className="rounded-full text-[10px]">
                  {row.subject}
                </Badge>
                <span>{monthLabel(row.monthKey)}</span>
                <span>·</span>
                <span>
                  {row.monthlyPrice} MAD
                  {row.creditCarried > 0 && (
                    <>
                      {" "}
                      − {t("advanceCredit")} {row.creditCarried}
                    </>
                  )}
                </span>
                {row.isOverdue && (
                  <Badge variant="destructive" className="rounded-full text-[10px]">
                    {t("overdue")}
                  </Badge>
                )}
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <span
                className={cn(
                  "text-sm font-bold",
                  row.isOverdue ? "text-destructive" : "text-success",
                )}
              >
                {row.complement} MAD
              </span>
              <Button
                type="button"
                size="sm"
                className="shrink-0 rounded-lg bg-success text-white hover:bg-success/90"
                onClick={() => handleSettle(row.paymentId)}
              >
                <CircleDollarSign className="me-1.5 h-4 w-4" />
                {t("settlePayment")}
              </Button>
            </div>
          </li>
        ))}
      </ul>
      <footer className="border-t border-accent/20 px-4 py-2">
        <Link
          to="/payments"
          className="block text-center text-xs font-semibold text-primary hover:underline"
        >
          {t("viewAllPayments")}
        </Link>
      </footer>
    </section>
  );
}
