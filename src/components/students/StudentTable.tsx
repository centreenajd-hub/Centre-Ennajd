import { Pencil, SearchX, Trash2, TriangleAlert, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
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
import { StudentReceiptDialog } from "@/components/reports/StudentReceiptDialog";
import { RegistrationFeeBadge } from "@/components/payments/RegistrationFeeBadge";
import { SettleStudentDialog } from "@/components/students/SettleStudentDialog";
import { useEnnajdState } from "@/hooks/use-ennajd-state";
import { formatDateKey, getPaymentRemaining } from "@/lib/ennajd-billing";
import { isGroupTypeApplicable } from "@/lib/ennajd-taxonomy";
import { useI18n } from "@/lib/i18n";
import { getPageNumbers } from "@/lib/pagination";
import { cn } from "@/lib/utils";
import type { GroupType, Level, Student, Subject } from "@/types/ennajd";

interface EmptyState {
  levelFilter: Level | "all";
  subjectFilter: Subject | "all";
  search: string;
  onClearFilters?: () => void;
}

interface StudentTableProps {
  students: Student[];
  onEdit: (student: Student) => void;
  emptyState?: EmptyState;
}

const PAGE_SIZE = 25;

function getStudentGroupTypes(student: Student): GroupType[] {
  const types = new Set<GroupType>();
  for (const enrollment of student.enrollments) {
    if (enrollment.groupType) types.add(enrollment.groupType);
  }
  return Array.from(types);
}

function hasMissingGroupType(student: Student): boolean {
  return student.enrollments.some(
    (enrollment) =>
      isGroupTypeApplicable(student.level, enrollment.subject) &&
      !enrollment.groupType,
  );
}

function GroupTypeBadges({
  student,
  t,
}: {
  student: Student;
  t: (key: string) => string;
}) {
  const groupTypes = getStudentGroupTypes(student);
  const missing = hasMissingGroupType(student);
  if (groupTypes.length === 0 && !missing) return <>—</>;
  return (
    <div className="flex flex-wrap gap-1">
      {groupTypes.map((gt) => (
        <Badge
          key={gt}
          className="rounded-full"
          variant={gt === "Small" ? "default" : "outline"}
        >
          {gt === "Small" ? t("small") : t("large")}
        </Badge>
      ))}
      {missing && (
        <Badge
          variant="destructive"
          className="gap-1 rounded-full"
          title={t("missingGroupTypeWarning")}
        >
          <TriangleAlert className="h-3 w-3" />
          {t("missingGroupTypeWarning")}
        </Badge>
      )}
    </div>
  );
}

function SettlementBadge({
  info,
  t,
}: {
  info?: {
    count: number;
    dueInstallmentCount: number;
    remaining: number;
  };
  t: (key: string) => string;
}) {
  if (!info || info.count === 0) {
    return (
      <Badge variant="outline" className="rounded-full text-muted-foreground">
        —
      </Badge>
    );
  }
  // Installments exist (e.g. strictly-future ones) but NO installment is due
  // yet → show a dash, not "Payé".
  if (info.dueInstallmentCount === 0) {
    return (
      <Badge variant="outline" className="rounded-full text-muted-foreground">
        -
      </Badge>
    );
  }
  if (info.remaining > 0) {
    return (
      <Badge variant="destructive" className="rounded-full">
        {t("remainingAmount")}: {info.remaining} MAD
      </Badge>
    );
  }
  return (
    <Badge variant="secondary" className="rounded-full bg-success/15 text-success">
      {t("allSettled")}
    </Badge>
  );
}

function EmptyDiagnostic({ emptyState }: { emptyState: EmptyState }) {
  const { t } = useI18n();
  const hasActiveFilter =
    emptyState.levelFilter !== "all" ||
    emptyState.subjectFilter !== "all" ||
    emptyState.search.trim().length > 0;

  return (
    <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed bg-card px-6 py-10 text-center">
      <div className="flex h-10 w-10 items-center justify-center rounded-full bg-muted">
        <SearchX className="h-5 w-5 text-muted-foreground" />
      </div>
      <p className="mt-3 text-sm font-semibold">{t("noResultsForFilter")}</p>
      <p className="mt-1 text-sm text-muted-foreground">
        {t("noResultsForFilterHint")}
        {emptyState.subjectFilter !== "all" && (
          <span className="ms-1.5 font-medium text-foreground">· {emptyState.subjectFilter}</span>
        )}
        {emptyState.search.trim() && (
          <span className="ms-1.5 font-medium text-foreground">· “{emptyState.search.trim()}”</span>
        )}
        {emptyState.levelFilter !== "all" && hasActiveFilter && emptyState.subjectFilter === "all" && !emptyState.search.trim() && (
          <span className="ms-1.5 font-medium text-foreground">· {emptyState.levelFilter}</span>
        )}
        {emptyState.levelFilter !== "all" && (emptyState.subjectFilter !== "all" || !!emptyState.search.trim()) && (
          <span className="ms-1.5 font-medium text-foreground">· {emptyState.levelFilter}</span>
        )}
      </p>
      {hasActiveFilter && emptyState.onClearFilters && (
        <Button
          variant="outline"
          size="sm"
          className="mt-4 rounded-full gap-1"
          onClick={emptyState.onClearFilters}
        >
          <X className="h-3.5 w-3.5" />
          {t("clearFilters")}
        </Button>
      )}
    </div>
  );
}

export function StudentTable({ students, onEdit, emptyState }: StudentTableProps) {
  const { t } = useI18n();
  const deleteStudent = useEnnajdState((s) => s.deleteStudent);
  const payments = useEnnajdState((s) => s.payments);
  const [pendingDelete, setPendingDelete] = useState<Student | null>(null);
  const [page, setPage] = useState(1);

  // Reste Balance Guard (Business Rule 5) + Attendance vs Billing (Rule 3):
  // - Balance = Sum of past due amounts strictly where dueDate <= today (YYYY-MM-DD local).
  // - Completely exclude future auto-generated sessions beyond today's date.
  // - Attendance is tracked separately and never deducts from billing; a scheduled
  //   standard class counts as CONSUMED SESSION even if student absent.
  // - Extra "حصة إضافية" sessions (isExtra:true / kind==="one_off") are already
  //   excluded at generation time in ennajd-billing.ts and never reach this table.
  // - Partial payments are netted via getPaymentRemaining (amountDue - amountPaid).
  // - `dueInstallmentCount` tracks ALL due installments (paid or not) to distinguish
  //   Rule A single-session skip (no current-month installment) from fully-paid.
  const settlementByStudent = useMemo(() => {
    const todayKey = formatDateKey(new Date());
    const map = new Map<
      string,
      { count: number; dueInstallmentCount: number; remaining: number }
    >();
    for (const payment of payments) {
      const entry = map.get(payment.studentId) ?? {
        count: 0,
        dueInstallmentCount: 0,
        remaining: 0,
      };
      entry.count += 1;
      // Count ALL due installments (paid or not) — needed to distinguish
      // Rule A single-session skip (no due installment this month) from a
      // fully-paid student.
      if (payment.dueDate <= todayKey) {
        entry.dueInstallmentCount += 1;
        // Explicit future exclusion: only past-due installments count toward
        // Reste, and only while a real gap remains — credit already covering
        // the month means nothing is owed (settlement is the explicit flag).
        if (!payment.isPaid) {
          const remaining = getPaymentRemaining(payment);
          if (remaining > 0) entry.remaining += remaining;
        }
      }
      map.set(payment.studentId, entry);
    }
    // Subtract each student's advanceBalance (cross-subject credit carried
    // over from prior over-payments) so the "Reste" reflects the true net
    // amount the student owes.
    for (const student of students) {
      const entry = map.get(student.id);
      if (entry && student.advanceBalance && student.advanceBalance > 0) {
        entry.remaining = Math.max(0, entry.remaining - student.advanceBalance);
      }
    }
    return map;
  }, [payments, students]);

  const totalPages = Math.max(1, Math.ceil(students.length / PAGE_SIZE));

  // Reset to page 1 whenever the (filtered) student set changes, so a
  // search/filter tweak never leaves the user stranded on an empty page.
  useEffect(() => {
    setPage(1);
  }, [students]);

  // Clamp the current page in case a filter shrank the list mid-pagination.
  const currentPage = Math.min(page, totalPages);
  const paged = students.slice(
    (currentPage - 1) * PAGE_SIZE,
    currentPage * PAGE_SIZE,
  );

  if (students.length === 0) {
    if (emptyState) {
      return <EmptyDiagnostic emptyState={emptyState} />;
    }
    return (
      <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-border bg-card/50 py-16 text-center text-muted-foreground">
        {t("noResults")}
      </div>
    );
  }

  return (
    <>
      <div className="hidden sm:block overflow-x-auto rounded-2xl border border-border">
              <Table className="min-w-[860px]">
                <TableHeader>
            <TableRow className="bg-muted/50">
              <TableHead>
                {t("firstName")} / {t("lastName")}
              </TableHead>
              <TableHead>{t("level")}</TableHead>
              <TableHead>{t("track")}</TableHead>
              <TableHead>{t("groupType")}</TableHead>
              <TableHead>{t("subjectsAndSessions")}</TableHead>
              <TableHead>{t("balanceColumn")}</TableHead>
              <TableHead className="text-end">{t("edit")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {paged.map((student) => (
              <TableRow
                key={student.id}
                className="cursor-pointer"
                onClick={() => onEdit(student)}
              >
                <TableCell className="font-medium">
                  {student.firstName} {student.lastName}
                </TableCell>
                <TableCell>
                  <Badge variant="secondary" className="rounded-full">
                    {student.level}
                  </Badge>
                </TableCell>
                <TableCell>{student.track ?? "—"}</TableCell>
                <TableCell>
                  <GroupTypeBadges student={student} t={t} />
                </TableCell>
                <TableCell>
                  <Badge variant="outline" className="rounded-full">
                    {student.enrollments.length} {t("subjectsCount")}
                  </Badge>
                </TableCell>
                <TableCell>
                  <div className="flex flex-wrap items-center gap-1">
                    <SettlementBadge info={settlementByStudent.get(student.id)} t={t} />
                    <RegistrationFeeBadge student={student} />
                  </div>
                </TableCell>
                <TableCell className="text-end whitespace-nowrap">
                                  <div
                                    className="flex justify-end gap-1"
                                    onClick={(e) => e.stopPropagation()}
                                  >
                    <StudentReceiptDialog student={student} />
                    <SettleStudentDialog
                      student={student}
                      disabled={!settlementByStudent.has(student.id)}
                    />
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 rounded-lg"
                      onClick={() => onEdit(student)}
                    >
                      <Pencil className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 rounded-lg text-destructive hover:text-destructive"
                      onClick={() => setPendingDelete(student)}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <div className="grid gap-3 sm:hidden">
        {paged.map((student) => (
          <div
            key={student.id}
            className="rounded-2xl border border-border bg-card p-4 shadow-sm"
            onClick={() => onEdit(student)}
          >
            <div className="flex items-start justify-between">
              <div>
                <p className="font-semibold">
                  {student.firstName} {student.lastName}
                </p>
                <p className="text-sm text-muted-foreground">
                  {student.whatsappPhone}
                </p>
              </div>
              <div className="flex gap-1" onClick={(e) => e.stopPropagation()}>
                <StudentReceiptDialog student={student} />
                <SettleStudentDialog
                  student={student}
                  disabled={!settlementByStudent.has(student.id)}
                />
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 rounded-lg"
                  onClick={() => onEdit(student)}
                >
                  <Pencil className="h-4 w-4" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 rounded-lg text-destructive hover:text-destructive"
                  onClick={() => setPendingDelete(student)}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            </div>
            <div className="mt-3 flex flex-wrap gap-1.5">
              <SettlementBadge info={settlementByStudent.get(student.id)} t={t} />
              <RegistrationFeeBadge student={student} />
              <Badge variant="secondary" className="rounded-full">
                {student.level}
              </Badge>
              {student.track && (
                <Badge variant="outline" className="rounded-full">
                  {student.track}
                </Badge>
              )}
              {getStudentGroupTypes(student).map((gt) => (
                <Badge key={gt} className="rounded-full">
                  {gt === "Small" ? t("small") : t("large")}
                </Badge>
              ))}
              {hasMissingGroupType(student) && (
                <Badge variant="destructive" className="gap-1 rounded-full">
                  <TriangleAlert className="h-3 w-3" />
                  {t("missingGroupTypeWarning")}
                </Badge>
              )}
              <Badge variant="outline" className="rounded-full">
                {student.enrollments.length} {t("subjectsCount")}
              </Badge>
            </div>
          </div>
        ))}
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

      <AlertDialog
        open={!!pendingDelete}
        onOpenChange={(open) => !open && setPendingDelete(null)}
      >
        <AlertDialogContent className="rounded-2xl">
          <AlertDialogHeader>
            <AlertDialogTitle>{t("confirmDeleteTitle")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("confirmDeleteStudent")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="rounded-lg">
              {t("cancel")}
            </AlertDialogCancel>
            <AlertDialogAction
              className="rounded-lg bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => {
                if (pendingDelete) {
                  deleteStudent(pendingDelete.id);
                  toast.success(t("studentDeleted"));
                }
                setPendingDelete(null);
              }}
            >
              {t("delete")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
