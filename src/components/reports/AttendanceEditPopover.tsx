// Edit Mode correction popover for the Report Generator's attendance
// preview — opens on a correctable day cell and writes attendance straight
// through `markAttendance` (isManualOverride, same call as the Dashboard
// chips). Works on saved records (targets their own sessionId, keeps
// isGuest) and on blank past class days (picks the session; guests stay
// guests).

import { Check, X } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useEnnajdState } from "@/hooks/use-ennajd-state";
import { useI18n, type LangCode } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import type { AttendanceStatus, Session, Student } from "@/types/ennajd";

interface AttendanceEditPopoverProps {
  student: Student;
  /** "YYYY-MM-DD" — the corrected day. */
  date: string;
  lang: LangCode;
  /** Sessions of this scope that are (or may be) delivered on `date` — recurring by dayOfWeek + one_off by exact date. */
  cellSessions: Session[];
  /** Every matching session of the scope — fallback lookup for a record whose session no longer matches the day schedule. */
  allSessions: Session[];
  /** When the cell already holds a record, its sessionId + isGuest are reused so the correction lands on the same session. */
  recordSessionId?: string;
  recordIsGuest?: boolean;
  /** True when the student is NOT enrolled in this combo (guest row) — new records are then created with isGuest: true, mirroring AttendancePanel. */
  studentIsGuest?: boolean;
  /** Children render as the trigger (the day chip). */
  children: React.ReactNode;
}

export function AttendanceEditPopover({
  student,
  date,
  lang,
  cellSessions,
  allSessions,
  recordSessionId,
  recordIsGuest,
  studentIsGuest = false,
  children,
}: AttendanceEditPopoverProps) {
  const { t } = useI18n();
  const markAttendance = useEnnajdState((s) => s.markAttendance);
  const locale = lang === "ar" ? "ar" : "fr-FR";

  // Local-time date (avoids the UTC shift of new Date("YYYY-MM-DD")).
  const [y, m, d] = date.split("-").map(Number);
  const formattedDate = new Date(y, m - 1, d).toLocaleDateString(locale, {
    day: "numeric",
    month: "short",
    year: "numeric",
  });

  async function applyStatus(sessionId: string, status: AttendanceStatus, isGuest: boolean) {
    // Chip update is optimistic (instant); the success toast only fires once
    // the write is confirmed. On failure the store reverts the chip and fires
    // the error toast itself.
    const ok = await markAttendance(student.id, sessionId, date, status, {
      isManualOverride: true,
      isGuest,
    });
    if (ok) toast.success(t("attendanceSaved"));
  }

  // Editing an existing record always targets that record's session (keeps
  // its id + isGuest), even when several sessions share the day.
  const recordSession = recordSessionId
    ? cellSessions.find((s) => s.id === recordSessionId) ?? allSessions.find((s) => s.id === recordSessionId)
    : undefined;
  if (recordSession) {
    const isGuest = recordIsGuest ?? false;
    return (
      <Popover>
        <PopoverTrigger asChild>{children}</PopoverTrigger>
        <PopoverContent align="center" className="w-64 rounded-2xl p-4">
          <header className="space-y-0.5 text-center">
            <p className="text-sm font-bold">{t("correctAttendanceTitle")}</p>
            <p className="text-xs text-muted-foreground">
              {student.firstName} {student.lastName} · {formattedDate}
            </p>
            <p className="text-[11px] text-muted-foreground">
              {recordSession.startTime}–{recordSession.endTime}
              {recordSession.teacherName ? ` · ${recordSession.teacherName}` : ""}
            </p>
          </header>
          <div className="mt-3 grid grid-cols-2 gap-2">
            <Button
              type="button"
              className="h-10 gap-1.5 rounded-xl bg-success text-success-foreground hover:bg-success/90"
              onClick={() => applyStatus(recordSession.id, "present", isGuest)}
            >
              <Check className="h-4 w-4" />
              {t("present")}
            </Button>
            <Button
              type="button"
              variant="destructive"
              className="h-10 gap-1.5 rounded-xl"
              onClick={() => applyStatus(recordSession.id, "absent", isGuest)}
            >
              <X className="h-4 w-4" />
              {t("absent")}
            </Button>
          </div>
        </PopoverContent>
      </Popover>
    );
  }

  // No record and no scheduled session to attribute a new record to —
  // shouldn't normally happen (Edit Mode only opens on class days), render
  // the trigger as a plain non-interactive element.
  if (cellSessions.length === 0) {
    return <>{children}</>;
  }

  // No record yet — a blank past class day. Single session: quick two-button
  // popover. Multiple sessions (two teachers, same combo): pick one first.
  if (cellSessions.length === 1) {
    return (
      <Popover>
        <PopoverTrigger asChild>{children}</PopoverTrigger>
        <PopoverContent align="center" className="w-64 rounded-2xl p-4">
          <header className="space-y-0.5 text-center">
            <p className="text-sm font-bold">{t("correctAttendanceTitle")}</p>
            <p className="text-xs text-muted-foreground">
              {student.firstName} {student.lastName} · {formattedDate}
            </p>
            <p className="text-[11px] text-muted-foreground">
              {cellSessions[0].startTime}–{cellSessions[0].endTime}
              {cellSessions[0].teacherName ? ` · ${cellSessions[0].teacherName}` : ""}
            </p>
          </header>
          <div className="mt-3 grid grid-cols-2 gap-2">
            <Button
              type="button"
              className="h-10 gap-1.5 rounded-xl bg-success text-success-foreground hover:bg-success/90"
              onClick={() => applyStatus(cellSessions[0].id, "present", studentIsGuest)}
            >
              <Check className="h-4 w-4" />
              {t("present")}
            </Button>
            <Button
              type="button"
              variant="destructive"
              className="h-10 gap-1.5 rounded-xl"
              onClick={() => applyStatus(cellSessions[0].id, "absent", studentIsGuest)}
            >
              <X className="h-4 w-4" />
              {t("absent")}
            </Button>
          </div>
        </PopoverContent>
      </Popover>
    );
  }

  // Multi-session day (no record): the popover lists each session with its
  // own Present/Absent pair so the correction goes to the intended class.
  return (
    <Popover>
      <PopoverTrigger asChild>{children}</PopoverTrigger>
      <PopoverContent align="center" className="w-72 space-y-2.5 rounded-2xl p-4">
        <header className="space-y-0.5 text-center">
          <p className="text-sm font-bold">{t("correctAttendanceTitle")}</p>
          <p className="text-xs text-muted-foreground">
            {student.firstName} {student.lastName} · {formattedDate}
          </p>
        </header>
        {cellSessions.map((session) => (
          <div
            key={session.id}
            className={cn(
              "rounded-xl border border-border bg-muted/40 p-2.5",
              "space-y-2",
            )}
          >
            <p className="text-center text-[11px] font-medium text-muted-foreground">
              {session.startTime}–{session.endTime}
              {session.teacherName ? ` · ${session.teacherName}` : ""}
            </p>
            <div className="grid grid-cols-2 gap-2">
              <Button
                type="button"
                size="sm"
                className="h-9 gap-1 rounded-lg bg-success text-success-foreground hover:bg-success/90"
                onClick={() => applyStatus(session.id, "present", studentIsGuest)}
              >
                <Check className="h-3.5 w-3.5" />
                {t("present")}
              </Button>
              <Button
                type="button"
                size="sm"
                variant="destructive"
                className="h-9 gap-1 rounded-lg"
                onClick={() => applyStatus(session.id, "absent", studentIsGuest)}
              >
                <X className="h-3.5 w-3.5" />
                {t("absent")}
              </Button>
            </div>
          </div>
        ))}
      </PopoverContent>
    </Popover>
  );
}
