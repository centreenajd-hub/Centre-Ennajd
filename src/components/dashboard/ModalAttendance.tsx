import { CalendarDays, Clock, GraduationCap, Users } from "lucide-react";
import { useMemo } from "react";

import AttendancePanel from "@/components/dashboard/AttendancePanel";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useEnnajdState } from "@/hooks/use-ennajd-state";
import { getEnrolledStudentsForSession } from "@/lib/ennajd-taxonomy";
import { useI18n } from "@/lib/i18n";
import type { Session } from "@/types/ennajd";

interface ModalAttendanceProps {
  session: Session | null;
  date: string; // "YYYY-MM-DD"
  now: Date;
  onOpenChange: (open: boolean) => void;
}

/**
 * Attendance modal for a live session: shows the session details (subject,
 * level, track, group type, time, roster) then the per-student attendance
 * panel. Replaces the old inline expansion inside LiveSessionCard.
 */
export function ModalAttendance({
  session,
  date,
  now,
  onOpenChange,
}: ModalAttendanceProps) {
  const { t } = useI18n();
  const students = useEnnajdState((s) => s.students);

  const enrolledCount = useMemo(
    () => (session ? getEnrolledStudentsForSession(students, session).length : 0),
    [students, session],
  );

  if (!session) return null;

  return (
    <Dialog open={true} onOpenChange={onOpenChange}>
      <DialogContent className="grid-rows-[auto_auto_minmax(0,1fr)] w-full max-w-2xl gap-0 overflow-hidden rounded-2xl p-0 sm:max-h-[85vh] sm:max-w-3xl">
        <DialogHeader className="border-b border-border bg-muted/30 px-5 py-4 sm:px-6">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 space-y-2">
              <DialogTitle className="text-base font-bold sm:text-lg">
                {session.subject}
              </DialogTitle>
              <div className="flex flex-wrap items-center gap-1.5">
                <Badge variant="secondary" className="rounded-full">
                  {session.level}
                </Badge>
                {session.track && (
                  <Badge variant="outline" className="rounded-full">
                    {session.track}
                  </Badge>
                )}
                {session.groupType && (
                  <Badge variant="outline" className="rounded-full">
                    {session.groupType === "Small" ? t("small") : t("large")}
                  </Badge>
                )}
              </div>
            </div>
            <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Users className="h-4 w-4" />
              <span className="font-semibold">{enrolledCount}</span>
              <span>{t("totalStudentsLabel")}</span>
            </span>
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
            <span className="flex items-center gap-1">
              <Clock className="h-3.5 w-3.5" />
              {session.startTime}–{session.endTime}
            </span>
            <span className="flex items-center gap-1">
              <CalendarDays className="h-3.5 w-3.5" />
              {date}
            </span>
            {session.teacherName && (
              <span className="flex items-center gap-1">
                <GraduationCap className="h-3.5 w-3.5" />
                {session.teacherName}
              </span>
            )}
          </div>
        </DialogHeader>

        <div className="max-h-[calc(85vh-9rem)] overflow-y-auto px-5 py-4 sm:px-6">
          <AttendancePanel session={session} date={date} now={now} />
        </div>
      </DialogContent>
    </Dialog>
  );
}