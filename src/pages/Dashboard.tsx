import { GraduationCap, Radio, Users } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { GlobalAttendanceSearch } from "@/components/dashboard/GlobalAttendanceSearch";
import { LiveSessionCard } from "@/components/dashboard/LiveSessionCard";
import { ModalAttendance } from "@/components/dashboard/ModalAttendance";
import { UpcomingSessionNotice } from "@/components/dashboard/UpcomingSessionNotice";
import { useEnnajdState } from "@/hooks/use-ennajd-state";
import { useNowTick } from "@/hooks/use-now-tick";
import { getMinutesUntilNextOccurrence, isSessionVisibleUnified } from "@/lib/ennajd-taxonomy";
import { dismissalKey, useDismissedSessions } from "@/lib/session-dismissal";
import { useI18n } from "@/lib/i18n";
import { runWhenIdle } from "@/lib/run-when-idle";
import type { Session } from "@/types/ennajd";

export default function Dashboard() {
  const { t } = useI18n();
  const studentsCount = useEnnajdState((s) => s.students.length);
  const sessionsCount = useEnnajdState((s) => s.sessions.length);
  const sessions = useEnnajdState((s) => s.sessions);
  const runAutoAbsenceSweep = useEnnajdState((s) => s.runAutoAbsenceSweep);
  const sweepExpiredOneOffSessions = useEnnajdState((s) => s.sweepExpiredOneOffSessions);
  const syncPayments = useEnnajdState((s) => s.syncPayments);

  const now = useNowTick();
  const [modalSession, setModalSession] = useState<Session | null>(null);

  const date = now.toISOString().slice(0, 10);

  // Sessions the admin dismissed from the live list (per occurrence). These
  // stay dismissed until the day rolls over — the app never removes a live
  // session on its own.
  const dismissed = useDismissedSessions();

  const liveSessions = useMemo(
    () =>
      sessions.filter(
        (session) =>
          isSessionVisibleUnified(session, now) &&
          !dismissed.has(dismissalKey(session.id, date)),
      ),
    [sessions, now, date, dismissed],
  );

  const nextSession = useMemo(() => {
    if (sessions.length === 0) return null;
    const sorted = [...sessions].sort(
      (a, b) =>
        getMinutesUntilNextOccurrence(a, now) - getMinutesUntilNextOccurrence(b, now),
    );
    const best = sorted[0];
    if (!best || getMinutesUntilNextOccurrence(best, now) === Infinity) return null;
    return best;
  }, [sessions, now]);

  useEffect(() => {
      // runAutoAbsenceSweep is idempotent (markAttendance never overwrites), so
      // deferring it to idle time is safe and keeps this 30s tick from blocking
      // the main thread during navigation.
      return runWhenIdle(() => runAutoAbsenceSweep(now));
    }, [now, runAutoAbsenceSweep]);

  useEffect(() => {
    return runWhenIdle(() => sweepExpiredOneOffSessions(now));
  }, [now, sweepExpiredOneOffSessions]);

  useEffect(() => {
    // syncPayments throttles itself to once/day internally; run it off the
    // idle callback so it never competes with this tick's render.
    return runWhenIdle(() => syncPayments(now));
  }, [now, syncPayments]);

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="flex items-center gap-3 rounded-2xl border border-border bg-card p-4 shadow-sm">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-secondary text-secondary-foreground">
            <Users className="h-5 w-5" />
          </div>
          <div>
            <p className="text-xl font-bold">{studentsCount}</p>
            <p className="text-xs text-muted-foreground">{t("totalStudents")}</p>
          </div>
        </div>
        <div className="flex items-center gap-3 rounded-2xl border border-border bg-card p-4 shadow-sm">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-accent text-accent-foreground">
            <GraduationCap className="h-5 w-5" />
          </div>
          <div>
            <p className="text-xl font-bold">{sessionsCount}</p>
            <p className="text-xs text-muted-foreground">{t("totalSessions")}</p>
          </div>
        </div>
        <div className="flex items-center gap-3 rounded-2xl border border-border bg-card p-4 shadow-sm">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-success/15 text-success">
            <Radio className="h-5 w-5" />
          </div>
          <div>
            <p className="text-xl font-bold">{liveSessions.length}</p>
            <p className="text-xs text-muted-foreground">{t("liveSessionsCount")}</p>
          </div>
        </div>
      </div>

      <GlobalAttendanceSearch now={now} date={date} liveSessions={liveSessions} />

      <div className="space-y-3">
        <h2 className="text-lg font-bold tracking-tight">{t("liveSessions")}</h2>

        {liveSessions.length === 0 ? (
          nextSession ? (
            <UpcomingSessionNotice
              session={nextSession}
              minutesUntil={getMinutesUntilNextOccurrence(nextSession, now)}
            />
          ) : (
            <p className="rounded-2xl border border-dashed border-border bg-card/50 py-14 text-center text-sm text-muted-foreground">
              {t("noLiveSessions")}
            </p>
          )
        ) : (
          <div className="space-y-3">
            {liveSessions.map((session) => (
              <LiveSessionCard
                key={session.id}
                session={session}
                now={now}
                onOpenAttendance={() => setModalSession(session)}
              />
            ))}
          </div>
        )}
      </div>

      <ModalAttendance
        session={modalSession}
        date={date}
        now={now}
        onOpenChange={(open) => {
          if (!open) setModalSession(null);
        }}
      />
    </div>
  );
}