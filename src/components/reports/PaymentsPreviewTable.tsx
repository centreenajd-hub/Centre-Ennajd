import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { formatAcademicMonthLabel } from "@/lib/ennajd-report-shared";
import type { PaymentMatrix } from "@/lib/ennajd-payment-report";
import { useI18n, type LangCode } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import type { Subject } from "@/types/ennajd";

import { PaymentCellPopover } from "@/components/reports/PaymentCellPopover";

interface PaymentsPreviewTableProps {
  matrix: PaymentMatrix;
  lang: LangCode;
  subject: Subject;
}

export function PaymentsPreviewTable({ matrix, lang, subject }: PaymentsPreviewTableProps) {
  const { t } = useI18n();
  const locale = lang === "ar" ? "ar" : "fr-FR";

  if (matrix.rows.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-border bg-card/50 py-16 text-center text-muted-foreground">
        {t("noEnrolledStudents")}
      </div>
    );
  }

  return (
    <div className="overflow-x-auto rounded-2xl border border-border">
      <Table>
        <TableHeader>
          <TableRow className="bg-muted/50">
            <TableHead className="sticky start-0 bg-muted/50">
              {t("firstName")} / {t("lastName")}
            </TableHead>
            {matrix.months.map((month) => (
              <TableHead key={month.key} className="whitespace-nowrap text-center">
                {formatAcademicMonthLabel(month, locale)}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {matrix.rows.map((row) => (
            <TableRow key={row.student.id}>
              <TableCell className="sticky start-0 bg-background font-medium">
                {row.student.firstName} {row.student.lastName}
              </TableCell>
              {matrix.months.map((month) => {
                const cell = row.cellsByMonth.get(month.key);
                if (!cell) {
                  return (
                    <TableCell key={month.key} className="text-center text-muted-foreground">
                      –
                    </TableCell>
                  );
                }
                return (
                  <TableCell key={month.key} className="text-center align-top">
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <PaymentCellPopover
                          student={row.student}
                          subject={subject}
                          month={month}
                          lang={lang}
                        >
                          <button
                            type="button"
                            className={cn(
                              "inline-flex items-center gap-0.5 rounded-lg px-2 py-1 text-xs font-semibold ring-1 ring-transparent transition hover:ring-primary/40",
                              cell.isPaid || cell.advanceCredit > 0
                                ? "bg-success/15 text-success"
                                : "bg-destructive/10 text-destructive",
                            )}
                          >
                            {cell.isPaid || cell.advanceCredit === 0
                              ? cell.amountDue
                              : cell.advanceCredit}
                            {cell.isDiscounted && <span className="text-accent">*</span>}
                          </button>
                        </PaymentCellPopover>
                      </TooltipTrigger>
                      {cell.isDiscounted && <TooltipContent>{t("discountedPrice")}</TooltipContent>}
                    </Tooltip>
                    {!cell.isPaid && cell.advanceCredit > 0 && (
                      <div className="mt-1 flex flex-col items-center gap-0.5">
                        <span className="inline-flex whitespace-nowrap rounded-full bg-success/15 px-1.5 text-[9px] font-bold text-success">
                          {t("advanceCreditBadge")}
                        </span>
                        <p className="whitespace-nowrap text-[10px] font-bold text-muted-foreground">
                          {t("remainingAmount")} {cell.remaining}
                        </p>
                      </div>
                    )}
                  </TableCell>
                );
              })}
            </TableRow>
          ))}
          <TableRow className="bg-muted/40">
            <TableCell className="sticky start-0 bg-muted/40 font-bold">{t("totalRow")}</TableCell>
            {matrix.months.map((month) => (
              <TableCell key={month.key} className="text-center font-bold text-primary">
                {matrix.totalsByMonth.get(month.key) ?? 0}
              </TableCell>
            ))}
          </TableRow>
        </TableBody>
      </Table>
    </div>
  );
}
