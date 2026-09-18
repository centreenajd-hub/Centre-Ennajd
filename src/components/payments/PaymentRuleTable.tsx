import { Check, FileText, StickyNote } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import { AdjustBalanceDialog } from "@/components/payments/AdjustBalanceDialog";
import { OverdueBadge } from "@/components/payments/PaymentStatusBadge";
import { RecordPartialPaymentDialog } from "@/components/payments/RecordPartialPaymentDialog";
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
import type { SubjectOverdueRow } from "@/lib/ennajd-billing";
import { renderEnnajdStudentReceiptPdf } from "@/lib/ennajd-report-pdf";
import { useI18n } from "@/lib/i18n";
import { getPageNumbers } from "@/lib/pagination";
import { cn } from "@/lib/utils";
import type { Student, Subject } from "@/types/ennajd";

interface PaymentRuleTableProps {
  /** Aggregated worklist rows: exactly one per student + subject, due & unpaid. */
  rows: SubjectOverdueRow[];
  todayKey: string; // "YYYY-MM-DD"
  // Precomputed id → student lookup so row rendering is O(1) instead of a
  // full students scan per row. Built once in Payments so both tables share it.
  studentsById: Map<string, Student>;
}

const PAGE_SIZE = 25;

export function PaymentRuleTable({
  rows,
  todayKey,
  studentsById,
}: PaymentRuleTableProps) {
  const { t, lang } = useI18n();
  const setPaymentPaid = useEnnajdState((s) => s.setPaymentPaid);
  const allPayments = useEnnajdState((s) => s.payments);
  const sessions = useEnnajdState((s) => s.sessions);
  const attendanceRecords = useEnnajdState((s) => s.attendanceRecords);
  const [page, setPage] = useState(1);
  const [generatingId, setGeneratingId] = useState<string | null>(null);

  function studentFor(studentId: string): Student | undefined {
    return studentsById.get(studentId);
  }

  function enrollmentFor(student: Student | undefined, subject: Subject) {
    return student?.enrollments.find((e) => e.subject === subject);
  }

  function groupTypeFor(student: Student | undefined, subject: Subject): string | null {
    const groupType = enrollmentFor(student, subject)?.groupType;
    return groupType ? (groupType === "Small" ? t("small") : t("large")) : null;
  }

  // Receipt month = the LATEST due installment of the row = current billing
  // cycle — the receipt then lists every installment of that calendar month.
  async function handlePrintReceipt(row: SubjectOverdueRow) {
    const student = studentFor(row.studentId);
    const enrollment = enrollmentFor(student, row.subject);
    if (!student || !enrollment) return;
    const latest = row.installments[row.installments.length - 1];
    setGeneratingId(`${row.studentId}__${row.subject}`);
    try {
      const { fontDegraded } = await renderEnnajdStudentReceiptPdf({
        student,
        subject: row.subject,
        monthKey: latest.month,
        payments: allPayments,
        attendanceRecords,
        sessions,
        level: student.level,
        track: enrollment.track,
        groupType: enrollment.groupType,
        appName: t("appName"),
        lang,
        t,
      });
      if (fontDegraded) {
        toast.warning(t("exportFontDegraded"));
      } else {
        toast.success(t("exportSuccess"));
      }
    } catch (error) {
      console.error("[PaymentRuleTable] Receipt generation failed", error);
      toast.error(t("exportFailed"));
    } finally {
      setGeneratingId(null);
    }
  }

  // Settles the ENTIRE visible subject debt: every due+unpaid installment of
  // the row goes isPaid → the row vanishes instantly (synchronous Zustand
  // update) and only reappears when the next cycle's dueDate passes today.
  function handleSettleRow(row: SubjectOverdueRow) {
    for (const payment of row.installments) {
      setPaymentPaid(payment.id, true);
    }
    toast.success(t("installmentSettled"));
  }

  const sorted = useMemo(() => {
    function nameFor(row: SubjectOverdueRow): string {
      const student = studentsById.get(row.studentId);
      return student ? `${student.firstName} ${student.lastName}` : "";
    }
    return [...rows].sort((a, b) => {
      const byDate = a.earliestDueDate.localeCompare(b.earliestDueDate);
      if (byDate !== 0) return byDate;
      return nameFor(a).localeCompare(nameFor(b));
    });
  }, [rows, studentsById]);

  const totalPages = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE));

  // Reset to page 1 whenever the (filtered) row set changes, so a
  // search/filter tweak never leaves the user stranded on an empty page.
  useEffect(() => {
    setPage(1);
  }, [rows]);

  const currentPage = Math.min(page, totalPages);
  const paged = sorted.slice(
    (currentPage - 1) * PAGE_SIZE,
    currentPage * PAGE_SIZE,
  );

  // NOTE: the empty state lives in the enclosing UnpaidSubjectsPanel so each
  // panel can carry its own message — the table itself only renders rows.

  return (
    <>
      <div className="hidden sm:block overflow-x-auto rounded-2xl border border-border bg-card">
              <Table className="min-w-[820px]">
                <TableHeader>
            <TableRow className="bg-muted/50">
              <TableHead>{t("firstName")} / {t("lastName")}</TableHead>
              <TableHead>{t("level")}</TableHead>
              <TableHead>{t("subject")}</TableHead>
              <TableHead>{t("dueDate")}</TableHead>
              <TableHead>{t("amountDue")}</TableHead>
              <TableHead className="text-end">{t("nextDueColumn")}</TableHead>
              <TableHead className="text-end">{t("settlePayment")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {paged.map((row) => {
              const rowKey = `${row.studentId}__${row.subject}`;
              const student = studentFor(row.studentId);
              const groupLabel = groupTypeFor(student, row.subject);
              const dueCount = row.installments.length;
              const note = enrollmentFor(student, row.subject)?.paymentNote;
              return (
                <TableRow
                  key={rowKey}
                  className={cn(row.isOverdue && "border-s-2 border-s-destructive")}
                >
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
                      {groupLabel && (
                        <Badge variant="outline" className="rounded-full">
                          {groupLabel}
                        </Badge>
                      )}
                    </div>
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-wrap items-center gap-1">
                      <span>{row.subject}</span>
                    </div>
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-wrap items-center gap-1.5">
                      {row.earliestDueDate}
                      {dueCount > 1 && (
                        <Badge variant="outline" className="rounded-full">
                          {dueCount} {t("installments")}
                        </Badge>
                      )}
                      {row.isOverdue && <OverdueBadge />}
                    </div>
                  </TableCell>
                  <TableCell>
                    <span
                      className={cn(
                        "font-semibold",
                        row.isPartiallyPaid && "text-success",
                      )}
                    >
                      {row.totalRemaining} MAD
                    </span>
                    {row.isPartiallyPaid && (
                      <span className="ms-1.5 whitespace-nowrap text-xs font-bold text-success">
                        · {t("paidSoFar")} {row.totalAmountPaid} MAD
                      </span>
                    )}
                  </TableCell>
                  <TableCell className="text-end whitespace-nowrap">
                    {row.nextDueDate ? (
                      <span className="text-sm">
                        {row.nextDueDate}
                        {row.nextDueRemaining > 0
                          ? ` · ${row.nextDueRemaining} MAD`
                          : " · " + t("advanceApplied")}
                      </span>
                    ) : (
                      "—"
                    )}
                  </TableCell>
                  <TableCell className="text-end whitespace-nowrap">
                                      <div className="flex items-center justify-end gap-1">
                                        <Button
                                          variant="ghost"
                                          size="icon"
                                          className="h-8 w-8 rounded-lg"
                                          disabled={generatingId === rowKey}
                                          onClick={() => handlePrintReceipt(row)}
                                          title={t("printReceipt")}
                                        >
                                          <FileText className="h-4 w-4" />
                                        </Button>
                                        {student && (
                                          <RecordPartialPaymentDialog
                                            student={student}
                                            subject={row.subject}
                                          />
                                        )}
                                        {student && (
                                          <AdjustBalanceDialog student={student} subject={row.subject} />
                                        )}
                                        <Button
                                          type="button"
                                          size="sm"
                                          className="rounded-lg bg-success text-white hover:bg-success/90 whitespace-nowrap"
                                          onClick={() => handleSettleRow(row)}
                                        >
                                          <Check className="me-1.5 h-4 w-4" />
                                          {t("settlePayment")}
                                        </Button>
                                      </div>
                                    </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>

      <div className="grid gap-3 sm:hidden">
        {paged.map((row) => {
          const rowKey = `${row.studentId}__${row.subject}`;
          const student = studentFor(row.studentId);
          const groupLabel = groupTypeFor(student, row.subject);
          const dueCount = row.installments.length;
          const note = enrollmentFor(student, row.subject)?.paymentNote;
          return (
            <div
              key={rowKey}
              className={cn(
                "rounded-2xl border border-border bg-card p-4 shadow-sm",
                row.isOverdue && "border-s-2 border-s-destructive",
              )}
            >
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="font-semibold">
                    {student ? `${student.firstName} ${student.lastName}` : "—"}
                  </p>
                  <p className="text-sm text-muted-foreground">
                    {row.subject} · {row.earliestDueDate}
                    {dueCount > 1 && (
                      <span className="ms-1.5 font-medium">
                        · {dueCount} {t("installments")}
                      </span>
                    )}
                  </p>
                </div>
                <div className="flex items-center gap-1">
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 rounded-lg"
                    disabled={generatingId === rowKey}
                    onClick={() => handlePrintReceipt(row)}
                    title={t("printReceipt")}
                  >
                    <FileText className="h-4 w-4" />
                  </Button>
                  {student && (
                    <RecordPartialPaymentDialog
                      student={student}
                      subject={row.subject}
                    />
                  )}
                  {student && (
                    <AdjustBalanceDialog student={student} subject={row.subject} />
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
                {groupLabel && (
                  <Badge variant="outline" className="rounded-full">
                    {groupLabel}
                  </Badge>
                )}
                {row.isOverdue && <OverdueBadge />}
                <span
                  className={cn(
                    "ms-auto font-semibold",
                    row.isPartiallyPaid && "text-success",
                  )}
                >
                  {row.totalRemaining} MAD
                </span>
              </div>
              {row.isPartiallyPaid && (
                <p className="mt-1 text-xs font-bold text-success">
                  {t("paidSoFar")} : {row.totalAmountPaid} MAD ·{" "}
                  {t("remainingAmount")} : {row.totalRemaining} MAD
                </p>
              )}
              {row.nextDueDate && (
                <p className="mt-1 text-xs text-accent-foreground/80">
                  <span className="font-medium">{t("nextDueColumn")} :</span>{" "}
                  {row.nextDueDate}{" "}
                  {row.nextDueRemaining > 0
                    ? `· ${row.nextDueRemaining} MAD`
                    : `· ${t("advanceApplied")}`}
                </p>
              )}
              {note && <PaymentNoteLine note={note} />}
              <Button
                type="button"
                size="sm"
                className="mt-3 w-full rounded-lg bg-success text-white hover:bg-success/90"
                onClick={() => handleSettleRow(row)}
              >
                <Check className="me-1.5 h-4 w-4" />
                {t("settlePayment")}
              </Button>
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
  );
}

/** Sticky-note accent line rendered under a row that carries a payment note. */
export function PaymentNoteLine({ note }: { note: string }) {
  return (
    <p className="mt-1.5 flex items-center gap-1.5 text-xs font-medium text-accent-foreground">
      <StickyNote className="h-3.5 w-3.5 shrink-0" />
      <span className="min-w-0 break-words">{note}</span>
    </p>
  );
}
