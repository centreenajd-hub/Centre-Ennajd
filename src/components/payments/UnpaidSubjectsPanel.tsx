import { AlertCircle, CheckCircle2 } from "lucide-react";
import { useMemo } from "react";

import { PaymentRuleTable } from "@/components/payments/PaymentRuleTable";
import { Badge } from "@/components/ui/badge";
import type { SubjectOverdueRow } from "@/lib/ennajd-billing";
import { useI18n } from "@/lib/i18n";
import type { Student } from "@/types/ennajd";

interface UnpaidSubjectsPanelProps {
  /** Aggregated worklist rows: exactly one per student + subject, due & unpaid. */
  rows: SubjectOverdueRow[];
  todayKey: string;
  studentsById: Map<string, Student>;
}

/**
 * Red "Impayés / لم يؤدوا" panel of the Rule A tab — wraps the existing
 * PaymentRuleTable (pagination, receipt/partial/settle/pencil actions) with
 * a destructive-tinted header carrying the row count and Σ remaining.
 */
export function UnpaidSubjectsPanel({
  rows,
  todayKey,
  studentsById,
}: UnpaidSubjectsPanelProps) {
  const { t } = useI18n();

  const totalRemaining = useMemo(
    () => rows.reduce((sum, row) => sum + row.totalRemaining, 0),
    [rows],
  );

  return (
    <section className="min-w-0 overflow-hidden rounded-2xl border border-destructive/30 bg-destructive/5">
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-destructive/20 bg-destructive/10 px-4 py-3">
        <div className="flex items-center gap-2">
          <AlertCircle className="h-5 w-5 shrink-0 text-destructive" />
          <h2 className="text-sm font-bold text-destructive">
            {t("ruleAUnpaidPanelTitle")}
          </h2>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <Badge variant="secondary" className="rounded-full">
            {rows.length}
          </Badge>
          {rows.length > 0 && (
            <Badge
              variant="destructive"
              className="rounded-full"
              title={t("totalOutstandingLabel")}
            >
              {t("totalOutstandingLabel")} : {totalRemaining} MAD
            </Badge>
          )}
        </div>
      </header>
      <div className="space-y-3 p-3">
        {rows.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-border bg-card/50 py-14 text-center">
            <CheckCircle2 className="h-9 w-9 text-success" />
            <p className="font-semibold text-success">{t("allSettled")} 🎉</p>
            <p className="text-sm text-muted-foreground">{t("noPaymentsDue")}</p>
          </div>
        ) : (
          <PaymentRuleTable
            rows={rows}
            todayKey={todayKey}
            studentsById={studentsById}
          />
        )}
      </div>
    </section>
  );
}
