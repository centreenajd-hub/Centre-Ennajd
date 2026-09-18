import { Check, UserX } from "lucide-react";

import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";

interface AttendanceStatsBarProps {
  presentCount: number;
  absentCount: number;
  total: number;
}

const MIN_LABEL_PCT = 15;

export function AttendanceStatsBar({
  presentCount,
  absentCount,
  total,
}: AttendanceStatsBarProps) {
  const { t } = useI18n();

  if (total === 0) return null;

  const presentPct = Math.round((presentCount / total) * 100);
  const absentPct = 100 - presentPct;

  return (
    <div className="space-y-2 rounded-xl border border-border bg-muted/30 p-3">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 rounded-full bg-success/15 px-2.5 py-1 text-sm font-bold text-success">
          <Check className="h-4 w-4 shrink-0" />
          <span>
            {t("present")}: {presentCount}
          </span>
        </div>
        <div className="flex items-center gap-1.5 rounded-full bg-destructive/10 px-2.5 py-1 text-sm font-bold text-destructive">
          <UserX className="h-4 w-4 shrink-0" />
          <span>
            {t("absent")}: {absentCount}
          </span>
        </div>
      </div>

      <div className="flex h-3.5 w-full overflow-hidden rounded-full bg-muted">
        {presentPct > 0 && (
          <div
            className="flex items-center justify-center bg-success transition-all duration-300"
            style={{ width: `${presentPct}%` }}
          >
            {presentPct >= MIN_LABEL_PCT && (
              <span className="text-[11px] font-bold text-white">
                {presentCount}
              </span>
            )}
          </div>
        )}
        {absentPct > 0 && (
          <div
            className={cn(
              "flex items-center justify-center bg-destructive transition-all duration-300",
            )}
            style={{ width: `${absentPct}%` }}
          >
            {absentPct >= MIN_LABEL_PCT && (
              <span className="text-[11px] font-bold text-white">
                {absentCount}
              </span>
            )}
          </div>
        )}
      </div>

      <p className="text-center text-xs text-muted-foreground">
        {presentPct}% {t("attendanceRate")}
      </p>
    </div>
  );
}
