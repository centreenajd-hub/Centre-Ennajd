import { Check, CheckCircle2, Undo2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import { AdjustBalanceDialog } from "@/components/payments/AdjustBalanceDialog";
import { PaymentNoteLine } from "@/components/payments/PaymentRuleTable";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Pagination,
  PaginationContent,
  PaginationEllipsis,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
} from "@/components/ui/pagination";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useEnnajdState } from "@/hooks/use-ennajd-state";
import type { SubjectSettledRow } from "@/lib/ennajd-billing";
import { useI18n } from "@/lib/i18n";
import { getPageNumbers } from "@/lib/pagination";
import { cn } from "@/lib/utils";
import type { Student } from "@/types/ennajd";

interface PaidSubjectsPanelProps {
  /** One row per student + subject that has installments and nothing due today. */
  rows: SubjectSettledRow[];
  studentsById: Map<string, Student>;
}

const PAGE_SIZE = 25;

/**
 * Green "Payés / أدوا الواجب" panel of the Rule A tab — every student+subject
 * combination whose ledger has generated installments and zero due-unpaid
 * today. Rows offer mark-unpaid (re-opens the latest settled installment) and
 * the pencil (balance/note) dialog.
 */
export function PaidSubjectsPanel({ rows, studentsById }: PaidSubjectsPanelProps) {
  const { t } = useI18n();
  const setPaymentPaid = useEnnajdState((s) => s.setPaymentPaid);
  const [page, setPage] = useState(1);

  // Settled rows sorted A→Z by name (plan: existing ordering convention).
  const sorted = useMemo(() => {
    function nameFor(row: SubjectSettledRow): string {
      const student = studentsById.get(row.studentId);
      return student ? `${student.firstName} ${student.lastName}` : "";
    }
    return [...rows].sort((a, b) => nameFor(a).localeCompare(nameFor(b)));
  }, [rows, studentsById]);

  const totalCovered = useMemo(
    () => rows.reduce((sum, row) => sum + row.totalCovered, 0),
    [rows],
  );

  const totalPages = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE));
  useEffect(() => {
    setPage(1);
  }, [rows]);

  const currentPage = Math.min(page, totalPages);
  const paged = sorted.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);

  // Mark-unpaid: re-open the LATEST settled installment (same convention as
  // SmallGroupsPanel's undo path). The row instantly migrates to Impayés.
  function handleMarkUnpaid(row: SubjectSettledRow) {
    if (!row.latestSettledPaymentId) return;
    setPaymentPaid(row.latestSettledPaymentId, false);
    toast.success(t("installmentUnpaid"));
  }

  return (
    <section className="min-w-0 overflow-hidden rounded-2xl border border-success/30 bg-success/5">
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-success/20 bg-success/10 px-4 py-3">
        <div className="flex items-center gap-2">
          <CheckCircle2 className="h-5 w-5 shrink-0 text-success" />
          <h2 className="text-sm font-bold text-success">
            {t("ruleAPaidPanelTitle")}
          </h2>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <Badge variant="secondary" className="rounded-full">
            {rows.length}
          </Badge>
          {rows.length > 0 && (
            <Badge
              className="rounded-full bg-success text-white"
              title={t("totalCoveredLabel")}
            >
              {t("totalCoveredLabel")} : {totalCovered} MAD
            </Badge>
          )}
        </div>
      </header>
      <div className="space-y-3 p-3">
        {rows.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-border bg-card/50 py-14 text-center">
            <CheckCircle2 className="h-9 w-9 text-success/60" />
            <p className="text-sm text-muted-foreground">{t("noPaidYet")}</p>
          </div>
        ) : (
          <>
            {/* Desktop table */}
                        <div className="hidden sm:block overflow-x-auto rounded-2xl border border-border bg-card">
                          <Table className="min-w-[820px]">
                            <TableHeader>
                  <TableRow className="bg-muted/50">
                    <TableHead>{t("firstName")} / {t("lastName")}</TableHead>
                    <TableHead>{t("level")}</TableHead>
                    <TableHead>{t("subject")}</TableHead>
                    <TableHead>{t("statusLabel")}</TableHead>
                    <TableHead>{t("nextDue")}</TableHead>
                    <TableHead className="text-end">{t("actionsLabel")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {paged.map((row) => {
                    const rowKey = `${row.studentId}__${row.subject}`;
                    const student = studentsById.get(row.studentId);
                    const note =
                      student?.enrollments.find((e) => e.subject === row.subject)
                        ?.paymentNote;
                    return (
                      <TableRow key={rowKey}>
                        <TableCell className="font-medium">
                          <div>
                            {student ? `${student.firstName} ${student.lastName}` : "—"}
                            {note && <PaymentNoteLine note={note} />}
                          </div>
                        </TableCell>
                        <TableCell>
                          <div className="flex flex-wrap items-center gap-1">
                            <Badge variant="secondary" className="rounded-full">
                              {student?.level ?? "—"}
                            </Badge>
                            {student?.track && (
                              <Badge variant="outline" className="rounded-full">
                                {student.track}
                              </Badge>
                            )}
                          </div>
                        </TableCell>
                        <TableCell>
                          <span>{row.subject}</span>
                        </TableCell>
                        <TableCell>
                          <Badge className="gap-1 rounded-full bg-success/15 text-success">
                            <Check className="h-3 w-3" />
                            {t("upToDate")}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          {row.nextUpcomingDueDate ? (
                            <span className="whitespace-nowrap">
                              {row.nextUpcomingDueDate}
                              {row.nextUpcomingRemaining > 0 && (
                                <span className="ms-1.5 font-semibold text-accent-foreground">
                                  · {row.nextUpcomingRemaining} MAD
                                </span>
                              )}
                            </span>
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </TableCell>
                        <TableCell className="text-end">
                          <div className="flex items-center justify-end gap-1">
                            {student && (
                              <AdjustBalanceDialog
                                student={student}
                                subject={row.subject}
                              />
                            )}
                            {row.latestSettledPaymentId && (
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-8 gap-1 rounded-lg px-2 text-xs text-muted-foreground"
                                onClick={() => handleMarkUnpaid(row)}
                                title={t("markUnpaid")}
                              >
                                <Undo2 className="h-3.5 w-3.5" />
                                {t("markUnpaid")}
                              </Button>
                            )}
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>

            {/* Mobile cards */}
            <div className="grid gap-3 sm:hidden">
              {paged.map((row) => {
                const rowKey = `${row.studentId}__${row.subject}`;
                const student = studentsById.get(row.studentId);
                const note =
                  student?.enrollments.find((e) => e.subject === row.subject)
                    ?.paymentNote;
                return (
                  <div
                    key={rowKey}
                    className="rounded-2xl border border-border bg-card p-4 shadow-sm"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <p className="font-semibold">
                          {student ? `${student.firstName} ${student.lastName}` : "—"}
                        </p>
                        <p className="text-sm text-muted-foreground">
                          {row.subject} ·{" "}
                          {row.nextUpcomingDueDate
                            ? `${t("nextDue")} : ${row.nextUpcomingDueDate}`
                            : t("upToDate")}
                        </p>
                      </div>
                      <div className="flex items-center gap-1">
                        {student && (
                          <AdjustBalanceDialog student={student} subject={row.subject} />
                        )}
                        {row.latestSettledPaymentId && (
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 rounded-lg text-muted-foreground"
                            onClick={() => handleMarkUnpaid(row)}
                            title={t("markUnpaid")}
                          >
                            <Undo2 className="h-4 w-4" />
                          </Button>
                        )}
                      </div>
                    </div>
                    <div className="mt-3 flex flex-wrap items-center gap-1.5">
                      <Badge variant="secondary" className="rounded-full">
                        {student?.level ?? "—"}
                      </Badge>
                      {student?.track && (
                        <Badge variant="outline" className="rounded-full">
                          {student.track}
                        </Badge>
                      )}
                      <Badge className="gap-1 rounded-full bg-success/15 text-success">
                        <Check className="h-3 w-3" />
                        {t("upToDate")}
                      </Badge>
                      {row.nextUpcomingRemaining > 0 && row.nextUpcomingDueDate && (
                        <span className="ms-auto text-xs font-bold text-accent-foreground">
                          {t("remainingAmount")} : {row.nextUpcomingRemaining} MAD
                        </span>
                      )}
                    </div>
                    {note && <PaymentNoteLine note={note} />}
                  </div>
                );
              })}
            </div>

            {totalPages > 1 && (
              <Pagination>
                <PaginationContent>
                  <PaginationItem>
                    <PaginationPrevious
                      href="#"
                      onClick={(e) => {
                        e.preventDefault();
                        setPage((p) => Math.max(1, p - 1));
                      }}
                      className={cn(currentPage === 1 && "pointer-events-none opacity-50")}
                    />
                  </PaginationItem>
                  {getPageNumbers(currentPage, totalPages).map((p, i) =>
                    p === "ellipsis" ? (
                      <PaginationItem key={`ellipsis-${i}`}>
                        <PaginationEllipsis />
                      </PaginationItem>
                    ) : (
                      <PaginationItem key={p}>
                        <PaginationLink
                          href="#"
                          isActive={p === currentPage}
                          onClick={(e) => {
                            e.preventDefault();
                            setPage(p);
                          }}
                        >
                          {p}
                        </PaginationLink>
                      </PaginationItem>
                    ),
                  )}
                  <PaginationItem>
                    <PaginationNext
                      href="#"
                      onClick={(e) => {
                        e.preventDefault();
                        setPage((p) => Math.min(totalPages, p + 1));
                      }}
                      className={cn(
                        currentPage === totalPages && "pointer-events-none opacity-50",
                      )}
                    />
                  </PaginationItem>
                </PaginationContent>
              </Pagination>
            )}
          </>
        )}
      </div>
    </section>
  );
}
