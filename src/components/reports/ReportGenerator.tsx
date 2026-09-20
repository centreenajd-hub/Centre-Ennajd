import { useMemo, useState } from "react";
import { toast } from "sonner";

import { AttendancePreviewTable } from "@/components/reports/AttendancePreviewTable";
import { IncludedSessionsNote } from "@/components/reports/IncludedSessionsNote";
import { LevelStep } from "@/components/reports/LevelStep";
import { MonthYearPicker } from "@/components/reports/MonthYearPicker";
import { PaymentsPreviewTable } from "@/components/reports/PaymentsPreviewTable";
import { ReportDataSkeleton } from "@/components/reports/ReportDataSkeleton";
import { ReportTypeAndExportCard } from "@/components/reports/ReportTypeAndExportCard";
import { SubjectStep } from "@/components/reports/SubjectStep";
import { TrackAndGroupStep } from "@/components/reports/TrackAndGroupStep";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useEnnajdState } from "@/hooks/use-ennajd-state";
import { buildAttendanceMatrix } from "@/lib/ennajd-attendance-report";
import { formatDateKey } from "@/lib/ennajd-billing";
import { buildPaymentMatrix } from "@/lib/ennajd-payment-report";
import { renderEnnajdReportPdf } from "@/lib/ennajd-report-pdf";
import { getRosterForScope, resolveMatchingSessions, type SessionScope } from "@/lib/ennajd-report-scope";
import { getAcademicYearMonths } from "@/lib/ennajd-report-shared";
import {
  getEnrolledStudentsForCombo,
  getSubjectsFor,
  isCombinedClass,
  isGroupTypeApplicable,
  isTrackRequired,
} from "@/lib/ennajd-taxonomy";
import { useI18n } from "@/lib/i18n";
import type { GroupType, Level, Subject, Track } from "@/types/ennajd";

function currentMonthKey(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

export function ReportGenerator() {
  const { t, lang } = useI18n();
  const students = useEnnajdState((s) => s.students);
  const sessions = useEnnajdState((s) => s.sessions);
  const attendanceRecords = useEnnajdState((s) => s.attendanceRecords);
  const payments = useEnnajdState((s) => s.payments);
  const getBasePrice = useEnnajdState((s) => s.getBasePrice);
  // HYDRATION BARRIER — stays false until the atomic initial load has
  // settled every billing dataset. The tables render a skeleton (not
  // zeroed cells) while the queries are in flight.
  const isDataReady = useEnnajdState((s) => s.isDataReady);

  const [level, setLevel] = useState<Level | null>(null);
  const [track, setTrack] = useState<Track | null>(null);
  const [subject, setSubject] = useState<Subject | null>(null);
  const [groupType, setGroupType] = useState<GroupType | null>(null);
  const [monthKey, setMonthKey] = useState<string>(currentMonthKey());
  const [attendanceChecked, setAttendanceChecked] = useState(true);
    const [paymentsChecked, setPaymentsChecked] = useState(true);
    const [isGenerating, setIsGenerating] = useState(false);

  const trackRequired = level ? isTrackRequired(level) : false;
  const subjects = level ? getSubjectsFor(level, trackRequired ? track : null) : [];
  const combined = level && subject ? isCombinedClass(level, subject) : false;
  const groupApplicable = level && subject && !combined ? isGroupTypeApplicable(level, subject) : false;

  function handleLevelChange(newLevel: Level) {
    setLevel(newLevel);
    setTrack(null);
    setSubject(null);
    setGroupType(null);
  }

  function handleTrackChange(newTrack: string) {
    setTrack(newTrack as Track);
    setSubject(null);
    setGroupType(null);
  }

  function handleSubjectChange(newSubject: Subject) {
    setSubject(newSubject);
    setGroupType(null);
  }

  function handleGroupTypeChange(newGroupType: string) {
    setGroupType(newGroupType as GroupType);
  }

  const scopeReady =
    !!level &&
    !!subject &&
    (!trackRequired || combined || !!track) &&
    (!groupApplicable || !!groupType);

  // Single source of truth for the selected Level+Track+GroupType+Subject
  // combination, independent of whether any Session actually matches it.
  const scope = useMemo<SessionScope | null>(() => {
    if (!scopeReady || !level || !subject) return null;
    return {
      level,
      subject,
      track: combined ? null : trackRequired ? track : null,
      groupType: groupApplicable ? groupType : null,
    };
  }, [scopeReady, level, subject, track, groupType, combined, trackRequired, groupApplicable]);

  const matchingSessions = useMemo(() => {
    if (!scope) return [];
    return resolveMatchingSessions(sessions, scope);
  }, [scope, sessions]);

  const roster = useMemo(() => {
    if (!scope) return [];
    return getRosterForScope(students, scope, matchingSessions, attendanceRecords);
  }, [scope, matchingSessions, students, attendanceRecords]);

  const todayKey = formatDateKey(new Date());

  const attendanceMatrix = useMemo(() => {
    if (!scope) return null;
    return buildAttendanceMatrix(matchingSessions, scope, monthKey, students, attendanceRecords, todayKey);
  }, [scope, matchingSessions, monthKey, students, attendanceRecords, todayKey]);

  const academicMonths = useMemo(() => getAcademicYearMonths(monthKey), [monthKey]);

  const basePrice = useMemo(() => {
    if (!scope || !level || !subject) return undefined;
    return getBasePrice(level, subject, scope.track, scope.groupType);
  }, [scope, level, subject, getBasePrice]);

  const paymentMatrix = useMemo(() => {
    if (!scope || !subject) return null;
    const enrolledRoster = getEnrolledStudentsForCombo(students, scope);
    return buildPaymentMatrix(
      enrolledRoster,
      payments,
      subject,
      academicMonths,
      basePrice,
      matchingSessions,
      attendanceRecords,
      todayKey,
    );
  }, [scope, subject, students, payments, academicMonths, basePrice, attendanceRecords, todayKey]);

  const canGenerate =
    (attendanceChecked || paymentsChecked) && roster.length > 0 && isDataReady;

  async function handleGenerate() {
    if (!scope || !level || !subject) return;
    if (roster.length === 0) {
      toast.error(t("noResults"));
      return;
    }
    const reportTypes: Array<"attendance" | "payments"> = [];
        if (attendanceChecked) reportTypes.push("attendance");
        if (paymentsChecked) reportTypes.push("payments");
        if (reportTypes.length === 0) return;

    setIsGenerating(true);
    try {
      const { fontDegraded } = await renderEnnajdReportPdf({
        sessions: matchingSessions,
        level,
        track: scope.track,
        groupType: scope.groupType,
        subject,
        monthKey,
        reportTypes,
        students,
        attendanceRecords,
        payments,
        basePrice,
        lang,
        t,
        appName: t("appName"),
      });
      if (fontDegraded) {
        toast.warning(t("exportFontDegraded"));
      } else {
        toast.success(t("exportSuccess"));
      }
    } catch (error) {
      console.error("[ReportGenerator] PDF generation failed", error);
      toast.error(t("exportFailed"));
    } finally {
      setIsGenerating(false);
    }
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_280px]">
      <div className="space-y-5">
        <div className="space-y-5 rounded-2xl border border-border bg-card p-4 shadow-sm sm:p-5">
          <LevelStep value={level} onChange={handleLevelChange} />

          {level && trackRequired && (
            <TrackAndGroupStep mode="track" value={track} onChange={handleTrackChange} />
          )}

          {level && (!trackRequired || track) && (
            <SubjectStep subjects={subjects} value={subject} onChange={handleSubjectChange} />
          )}

          {level && subject && groupApplicable && (
                      <TrackAndGroupStep
                        mode="groupType"
                        value={groupType}
                        onChange={handleGroupTypeChange}
                        allowSmall={track === "s.x"}
                      />
                    )}

          {scopeReady && (
            <IncludedSessionsNote sessions={matchingSessions} enrolledCount={roster.length} />
          )}
        </div>

        {!!scope && (
          <>
            <ReportTypeAndExportCard
                          attendanceChecked={attendanceChecked}
                          paymentsChecked={paymentsChecked}
                          onAttendanceChange={setAttendanceChecked}
                          onPaymentsChange={setPaymentsChecked}
                          onGenerate={handleGenerate}
              disabled={!canGenerate}
              isGenerating={isGenerating}
            />

            {!isDataReady ? (
              <ReportDataSkeleton />
            ) : roster.length === 0 ? (
              <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-border bg-card/50 py-16 text-center text-muted-foreground">
                {t("noEnrolledStudents")}
              </div>
            ) : (
              <Tabs defaultValue="attendance" className="space-y-3">
                <TabsList className="rounded-xl">
                  <TabsTrigger value="attendance" className="rounded-lg">
                    {t("attendanceReport")}
                  </TabsTrigger>
                  <TabsTrigger value="payments" className="rounded-lg">
                    {t("paymentsReport")}
                  </TabsTrigger>
                </TabsList>
                <TabsContent value="attendance">
                  {attendanceMatrix && scope && (
                    <AttendancePreviewTable
                      matrix={attendanceMatrix}
                      lang={lang}
                      sessions={matchingSessions}
                      scope={scope}
                      todayKey={todayKey}
                    />
                  )}
                </TabsContent>
                <TabsContent value="payments">
                  {paymentMatrix && subject && (
                    <PaymentsPreviewTable
                      matrix={paymentMatrix}
                      lang={lang}
                      subject={subject}
                    />
                  )}
                </TabsContent>
              </Tabs>
            )}
          </>
        )}
      </div>

      <div className="lg:sticky lg:top-20 lg:h-fit">
        <MonthYearPicker monthKey={monthKey} onChange={setMonthKey} />
      </div>
    </div>
  );
}
