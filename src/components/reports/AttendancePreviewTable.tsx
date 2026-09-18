import { Info, Pencil } from "lucide-react";
import { useMemo, useState } from "react";

import { AttendanceEditPopover } from "@/components/reports/AttendanceEditPopover";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { getClassDayDates, type AttendanceMatrix } from "@/lib/ennajd-attendance-report";
import type { SessionScope } from "@/lib/ennajd-report-scope";
import { getEnrolledStudentsForCombo } from "@/lib/ennajd-taxonomy";
import { useI18n, type LangCode } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import type { Session } from "@/types/ennajd";

/** Local Date from "YYYY-MM-DD" — avoids the UTC shift of new Date(string). */
function localDate(dateKey: string): Date {
  const [y, m, d] = dateKey.split("-").map(Number);
  return new Date(y, m - 1, d);
}

/**
 * Day-column header label: weekday first, then dd/mm — e.g. "الأحد 01/09" (AR)
 * or "dim. 01/09" (FR). Built from two calls so the weekday always precedes
 * the date regardless of locale ordering.
 */
function formatDayHeader(dateKey: string, locale: string): string {
  const d = localDate(dateKey);
  const weekday = d.toLocaleDateString(locale, { weekday: "short" });
  const dayMonth = d.toLocaleDateString(locale, { day: "2-digit", month: "2-digit" });
  return `${weekday} ${dayMonth}`;
}

interface AttendancePreviewTableProps {
  matrix: AttendanceMatrix;
  lang: LangCode;
  /** All matching sessions of the current scope — drives Edit Mode correctability. */
  sessions: Session[];
  /** Current report scope — decides which matrix rows are guests (not enrolled in the combo). */
  scope: SessionScope;
  /** "YYYY-MM-DD" today key — future days are never editable. */
  todayKey: string;
}

export function AttendancePreviewTable({
  matrix,
  lang,
  sessions,
  scope,
  todayKey,
}: AttendancePreviewTableProps) {
  const { t } = useI18n();
  const locale = lang === "ar" ? "ar" : "fr-FR";
  const [editMode, setEditMode] = useState(false);

  // Actual class days of the matrix's month for this scope (recurring by
  // dayOfWeek + one_off by exact date) — Edit Mode allows correcting any
  // past class day, even one the matrix renders as "–" (everyone-absent
  // day) or a student with no record at all.
  const classDayDates = useMemo(
    () =>
      getClassDayDates(
        sessions,
        matrix.dates.length > 0 ? matrix.dates[0].slice(0, 7) : "",
      ),
    [sessions, matrix.dates],
  );

  // Guest detection (same as AttendancePanel): a matrix row that is NOT
  // enrolled in this exact combo is a cross-attending guest — new records
  // for them are created with isGuest: true.
  const guestStudentIds = useMemo(() => {
    const enrolledIds = new Set(
      getEnrolledStudentsForCombo(matrix.rows.map((r) => r.student), scope).map((s) => s.id),
    );
    return new Set(matrix.rows.map((r) => r.student.id).filter((id) => !enrolledIds.has(id)));
  }, [matrix.rows, scope]);

  function isEditable(date: string, studentId: string): boolean {
    if (date > todayKey) return false; // future days are locked, always
    if (classDayDates.has(date)) return true; // real class day (past/today)
    // No scheduled class, but the student already has a record on that day
    // (e.g. a one-off that later changed scope) — still correctable.
    return matrix.rows.some(
      (row) => row.student.id === studentId && row.cellsByDate.get(date)?.recordId != null,
    );
  }

  function sessionsForDate(date: string): Session[] {
    // Local-time day-of-week (same parsing as ennajd-attendance-report.ts) —
    // new Date("YYYY-MM-DD") would be parsed as UTC and can shift a day.
    const dayOfWeek = localDate(date).getDay();
    return sessions.filter((session) => {
      if ((session.kind ?? "recurring") === "one_off") return session.date === date;
      return session.dayOfWeek === dayOfWeek;
    });
  }

  if (matrix.dates.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-border bg-card/50 py-16 text-center text-muted-foreground">
        {t("noOccurrencesThisMonth")}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          variant={editMode ? "default" : "outline"}
          size="sm"
          className={cn(
            "gap-1.5 rounded-full",
            editMode && "bg-accent text-accent-foreground hover:bg-accent/90",
          )}
          onClick={() => setEditMode((v) => !v)}
        >
          <Pencil className="h-3.5 w-3.5" />
          {t("editAttendanceMode")}
        </Button>
        {editMode && (
          <p className="inline-flex items-center gap-1.5 rounded-full bg-accent/10 px-3 py-1 text-xs font-medium text-accent-foreground">
            <Info className="h-3.5 w-3.5 shrink-0" />
            {t("editAttendanceHint")}
          </p>
        )}
      </div>

      <div className="overflow-x-auto rounded-2xl border border-border">
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/50">
              <TableHead className="sticky start-0 bg-muted/50">
                {t("firstName")} / {t("lastName")}
              </TableHead>
              {matrix.dates.map((date) => (
                <TableHead key={date} className="whitespace-nowrap text-center">
                  {formatDayHeader(date, locale)}
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
                {matrix.dates.map((date) => {
                  const cell = row.cellsByDate.get(date);
                  if (!cell || cell.status === "not-occurred") {
                    if (!editMode) {
                      return (
                        <TableCell key={date} className="text-center text-muted-foreground">
                          –
                        </TableCell>
                      );
                    }
                    const editable = isEditable(date, row.student.id);
                    if (!editable) {
                      return (
                        <TableCell
                          key={date}
                          className="cursor-not-allowed text-center text-muted-foreground/50"
                          title={t("futureDateLocked")}
                        >
                          –
                        </TableCell>
                      );
                    }
                    return (
                      <TableCell key={date} className="text-center">
                        <AttendanceEditPopover
                          student={row.student}
                          date={date}
                          lang={lang}
                          cellSessions={sessionsForDate(date)}
                          allSessions={sessions}
                          recordSessionId={cell.sessionId}
                          recordIsGuest={cell.isGuest}
                          studentIsGuest={guestStudentIds.has(row.student.id)}
                        >
                          <button
                            type="button"
                            className="inline-flex items-center justify-center rounded-lg px-2 py-1 text-xs font-semibold text-muted-foreground ring-1 ring-transparent transition hover:bg-accent/10 hover:ring-primary/40 hover:text-foreground"
                            title={t("correctAttendanceTitle")}
                          >
                            –
                          </button>
                        </AttendanceEditPopover>
                      </TableCell>
                    );
                  }
                  const isPresent = cell.status === "present";
                  const chip = (
                    <span
                      className={cn(
                        "inline-flex flex-col items-center rounded-lg px-2 py-1 text-xs font-semibold",
                        isPresent ? "bg-success/15 text-success" : "bg-destructive/10 text-destructive",
                      )}
                    >
                      <span>{isPresent ? "P" : "A"}</span>
                      <span className="text-[10px] font-normal text-muted-foreground">
                        {cell.timestamp}
                      </span>
                    </span>
                  );
                  if (!editMode) {
                    return (
                      <TableCell key={date} className="text-center">
                        {chip}
                      </TableCell>
                    );
                  }
                  const editable = isEditable(date, row.student.id);
                  if (!editable) {
                    return (
                      <TableCell
                        key={date}
                        className="cursor-not-allowed text-center opacity-40"
                        title={t("futureDateLocked")}
                      >
                        {chip}
                      </TableCell>
                    );
                  }
                  return (
                    <TableCell key={date} className="text-center">
                      <AttendanceEditPopover
                        student={row.student}
                        date={date}
                        lang={lang}
                        cellSessions={sessionsForDate(date)}
                        allSessions={sessions}
                        recordSessionId={cell.sessionId}
                        recordIsGuest={cell.isGuest}
                        studentIsGuest={guestStudentIds.has(row.student.id)}
                      >
                        <button
                          type="button"
                          className="inline-flex rounded-lg ring-1 ring-transparent transition hover:ring-primary/40"
                          title={t("correctAttendanceTitle")}
                        >
                          {chip}
                        </button>
                      </AttendanceEditPopover>
                    </TableCell>
                  );
                })}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
