import { CalendarClock } from "lucide-react";

import { useI18n } from "@/lib/i18n";
import type { Session } from "@/types/ennajd";

interface UpcomingSessionNoticeProps {
  session: Session;
  minutesUntil: number;
}

export function UpcomingSessionNotice({ session, minutesUntil }: UpcomingSessionNoticeProps) {
  const { t } = useI18n();
  const hours = Math.floor(minutesUntil / 60);
  const minutes = minutesUntil % 60;

  return (
    <div className="flex flex-col items-center justify-center gap-3 rounded-3xl border border-dashed border-border bg-card/60 px-6 py-14 text-center">
      <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-secondary text-secondary-foreground">
        <CalendarClock className="h-7 w-7" />
      </div>
      <p className="text-base font-semibold text-foreground">{t("noLiveSessions")}</p>
      <p className="text-sm text-muted-foreground">
        {t("nextSessionIn")}{" "}
        <span className="font-semibold text-foreground">
          {hours > 0 ? `${hours}h ` : ""}
          {minutes}
          {t("minutesShort")}
        </span>
        {" — "}
        {session.subject} · {session.level}
        {session.track ? ` · ${session.track}` : ""}
      </p>
    </div>
  );
}
