import { useI18n, type DictKey } from "@/lib/i18n";
import type { Session } from "@/types/ennajd";

const DAY_KEYS: DictKey[] = [
  "sunday",
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
];

interface IncludedSessionsNoteProps {
  sessions: Session[];
  enrolledCount?: number;
}

/**
 * Read-only transparency strip: once the scope is fully resolved, lists
 * every matched session's day/time so the user knows what's aggregated
 * into the report — nothing to select, no session-level choice.
 */
export function IncludedSessionsNote({ sessions, enrolledCount = 0 }: IncludedSessionsNoteProps) {
  const { t } = useI18n();

  if (sessions.length === 0) {
    return (
      <div className="animate-in fade-in space-y-1 rounded-xl border border-dashed border-border bg-muted/30 p-4 text-center text-sm text-muted-foreground duration-300">
        <p>{t("noClassForCombination")}</p>
        {enrolledCount > 0 && <p className="text-xs">{t("noSessionButEnrolledNote")}</p>}
      </div>
    );
  }

  return (
    <div className="animate-in fade-in slide-in-from-top-1 space-y-2 duration-300">
      <p className="text-sm font-semibold text-foreground">{t("sessionsIncluded")}</p>
      <div className="flex flex-wrap gap-2">
        {sessions.map((session) => (
          <span
            key={session.id}
            className="rounded-full border border-border bg-secondary px-3 py-1.5 text-xs font-medium text-secondary-foreground"
          >
            {t(DAY_KEYS[session.dayOfWeek])} {session.startTime}
          </span>
        ))}
      </div>
    </div>
  );
}
