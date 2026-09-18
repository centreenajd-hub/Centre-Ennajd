import { ChevronDown, Clock, Users } from "lucide-react";
import { useMemo } from "react";

import { ExportAttendanceButton } from "@/components/dashboard/ExportAttendanceButton";
import { Badge } from "@/components/ui/badge";
import { Card, CardHeader } from "@/components/ui/card";
import { useEnnajdState } from "@/hooks/use-ennajd-state";
import { getEnrolledStudentsForSession, isOneOffSession, isSessionVisibleUnified } from "@/lib/ennajd-taxonomy";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import type { Session } from "@/types/ennajd";

interface LiveSessionCardProps {
  session: Session;
  now: Date;
  date: string;
  onOpenAttendance: () => void;
}

function timeToMinutes(time: string): number {
  const [h, m] = time.split(":").map(Number);
  return h * 60 + m;
}

export function LiveSessionCard({
  session,
  now,
  date,
  onOpenAttendance,
}: LiveSessionCardProps) {
  const { t } = useI18n();
  const students = useEnnajdState((s) => s.students);

  const enrolledCount = useMemo(
    () => getEnrolledStudentsForSession(students, session).length,
    [students, session],
  );

  const nowMinutes = now.getHours() * 60 + now.getMinutes();
  const startMinutes = timeToMinutes(session.startTime);
  const endMinutes = timeToMinutes(session.endTime);

  let statusLabel: string;
  let statusClass: string;
  if (nowMinutes < startMinutes) {
    statusLabel = `${t("startsIn")} ${startMinutes - nowMinutes} ${t("minutesShort")}`;
    statusClass = "bg-secondary text-secondary-foreground";
  } else if (nowMinutes <= endMinutes) {
    statusLabel = t("inProgress");
    statusClass = "bg-success/15 text-success";
  } else {
    statusLabel = t("endingSoon");
    statusClass = "bg-accent/20 text-accent-foreground";
  }

  const isExtra = isOneOffSession(session);
  const isActiveWindow = isSessionVisibleUnified(session, now);

  return (
    <Card className="overflow-hidden rounded-2xl border-border shadow-sm transition-shadow hover:shadow-md">
      <CardHeader className="flex flex-row items-start justify-between gap-3 p-4 pb-3 sm:p-5 sm:pb-4">
        <div className="min-w-0 flex-1 space-y-2">
          <div className="flex flex-wrap items-center gap-1.5">
            {isActiveWindow && (
              <Badge className="rounded-full bg-success text-success-foreground">{t("activeNow")}</Badge>
            )}
            {isExtra && (
              <Badge className="rounded-full bg-accent text-accent-foreground">
                {t("extra")} · {session.date ? session.date.slice(5).replace("-", "/") : ""}
              </Badge>
            )}
            <Badge className="rounded-full bg-primary text-primary-foreground">
              {session.subject}
            </Badge>
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
          <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
            <span className="flex items-center gap-1">
              <Clock className="h-3.5 w-3.5" />
              {session.startTime}–{session.endTime}
            </span>
            <span className="flex items-center gap-1">
              <Users className="h-3.5 w-3.5" />
              {enrolledCount}
            </span>
          </div>
        </div>
        <div className="flex flex-col items-end gap-2">
          <div className="flex items-center gap-1.5">
            <span
              className={cn(
                "whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-semibold",
                statusClass,
              )}
            >
              {statusLabel}
            </span>
            <ExportAttendanceButton session={session} />
          </div>
          <button
            type="button"
            onClick={onOpenAttendance}
            className="flex items-center gap-1.5 rounded-full bg-primary/10 px-3 py-1 text-xs font-semibold text-primary transition-colors hover:bg-primary/20"
          >
            {t("modalCheckIn")}
            <ChevronDown className="h-3.5 w-3.5 rotate-[-90deg]" />
          </button>
        </div>
      </CardHeader>
    </Card>
  );
}