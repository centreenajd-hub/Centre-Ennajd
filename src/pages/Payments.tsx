import { BookOpen, ChevronDown, Layers, LayoutGrid, Table2, Users } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { PaidSubjectsPanel } from "@/components/payments/PaidSubjectsPanel";
import { RegistrationFeePanel } from "@/components/payments/RegistrationFeePanel";
import { SmallGroupsCardsGrid } from "@/components/payments/SmallGroupsCardsGrid";
import { SmallGroupsPanel } from "@/components/payments/SmallGroupsPanel";
import { UnpaidSubjectsPanel } from "@/components/payments/UnpaidSubjectsPanel";
import { Badge } from "@/components/ui/badge";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { useEnnajdState } from "@/hooks/use-ennajd-state";
import { useNowTick } from "@/hooks/use-now-tick";
import {
  aggregateOverdueInstallments,
  aggregateRegistrationFeeDebtors,
  aggregateSettledInstallments,
  formatDateKey,
  getDueBalanceForStudentSubject,
  type SubjectOverdueRow,
  type SubjectSettledRow,
} from "@/lib/ennajd-billing";
import {
  GROUP_TYPES,
  LEVELS,
  SMALL_GROUP_SUBJECTS,
  TRACKS,
  getSubjectsFor,
  isGroupTypeApplicable,
  isGroupTypeSelectableForLevel,
  isTrackRequired,
} from "@/lib/ennajd-taxonomy";
import { useI18n } from "@/lib/i18n";
import { runWhenIdle } from "@/lib/run-when-idle";
import { normalizeText } from "@/lib/text-normalize";
import type { GroupType, Level, Subject, Track } from "@/types/ennajd";

/** Display label for the small-group subject buttons ("Math" → "Maths"). */
function smallSubjectLabel(subject: Subject): string {
  return subject === "Math" ? "Maths" : subject;
}

export default function Payments() {
  const { t } = useI18n();
  const students = useEnnajdState((s) => s.students);
  const payments = useEnnajdState((s) => s.payments);
  const syncPayments = useEnnajdState((s) => s.syncPayments);

  const now = useNowTick();
  const todayKey = formatDateKey(now);

  const [search, setSearch] = useState("");
  const [levelFilter, setLevelFilter] = useState<Level | "all">("all");
  const [trackFilter, setTrackFilter] = useState<Track | null>(null);
  const [subjectFilter, setSubjectFilter] = useState<Subject | "all">("all");
  const [groupFilter, setGroupFilter] = useState<GroupType | "all">("all");
  const [activeTab, setActiveTab] = useState("ruleA");
  const [smallGroupSubject, setSmallGroupSubject] = useState<Subject>("Math");
  const [smallGroupView, setSmallGroupView] = useState<"cards" | "table">("cards");
  const [tablesOpen, setTablesOpen] = useState(true);

  // Taxonomy-gated visibility for the Level → Track → Subject → Group chain.
  const showTrackFilter =
    levelFilter !== "all" && isTrackRequired(levelFilter);
  const availableSubjects = useMemo<Subject[]>(() => {
    if (levelFilter === "all") return [];
    if (isTrackRequired(levelFilter) && !trackFilter) return [];
    return getSubjectsFor(levelFilter, trackFilter);
  }, [levelFilter, trackFilter]);
  const showSubjectFilter = levelFilter !== "all";
  const subjectDisabled =
    showSubjectFilter && isTrackRequired(levelFilter as Level) && !trackFilter;
  const showGroupFilter =
    levelFilter !== "all" && isGroupTypeSelectableForLevel(levelFilter);

  function handleLevelChange(v: Level | "all") {
    setLevelFilter(v);
    setTrackFilter(null);
    setSubjectFilter("all");
    setGroupFilter("all");
  }

  function handleTrackChange(v: string) {
    setTrackFilter(v as Track);
    setSubjectFilter("all");
    setGroupFilter("all");
  }

  function handleSubjectChange(v: Subject | "all") {
    setSubjectFilter(v);
    if (
      v !== "all" &&
      levelFilter !== "all" &&
      !isGroupTypeApplicable(levelFilter, v)
    ) {
      setGroupFilter("all");
    }
  }

  useEffect(() => {
    return runWhenIdle(() => syncPayments(now));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const studentsById = useMemo(() => {
    const map = new Map(students.map((s) => [s.id, s]));
    return map;
  }, [students]);

  const hasEnrollmentFilters =
    subjectFilter !== "all" || trackFilter !== null || groupFilter !== "all";

  const enrollmentMatches = (enrollment: { subject: Subject; track: Track | null; groupType: GroupType | null }): boolean =>
    (subjectFilter === "all" || enrollment.subject === subjectFilter) &&
    (trackFilter === null || enrollment.track === trackFilter) &&
    (groupFilter === "all" || enrollment.groupType === groupFilter);

  const passesFilters = (studentId: string, subject?: Subject): boolean => {
    const student = studentsById.get(studentId);
    if (!student) return false;
    if (levelFilter !== "all" && student.level !== levelFilter) return false;
    const query = normalizeText(search);
    if (query && !normalizeText(`${student.firstName} ${student.lastName}`).includes(query)) {
      return false;
    }
    if (!hasEnrollmentFilters) return true;
    const candidates =
      subject !== undefined
        ? student.enrollments.filter((e) => e.subject === subject)
        : student.enrollments;
    return candidates.some(enrollmentMatches);
  };

  const ruleAOverdueRows = useMemo(() => {
    const due = payments.filter(
      (p) => p.rule === "A" && !p.isPaid && p.dueDate <= todayKey,
    );
    const aggregated = aggregateOverdueInstallments(due, todayKey);
    const filtered: SubjectOverdueRow[] = [];
    for (const row of aggregated.values()) {
      if (passesFilters(row.studentId, row.subject)) filtered.push(row);
    }
    return filtered;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    payments,
    studentsById,
    levelFilter,
    search,
    subjectFilter,
    trackFilter,
    groupFilter,
    todayKey,
  ]);

  const ruleASettledRows = useMemo(() => {
    const ruleA = payments.filter((p) => p.rule === "A");
    const aggregated = aggregateSettledInstallments(ruleA, todayKey);
    const filtered: SubjectSettledRow[] = [];
    for (const row of aggregated.values()) {
      if (passesFilters(row.studentId, row.subject)) filtered.push(row);
    }
    return filtered;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    payments,
    studentsById,
    levelFilter,
    search,
    subjectFilter,
    trackFilter,
    groupFilter,
    todayKey,
  ]);

  const feeDebtorRows = useMemo(() => {
    const aggregated = aggregateRegistrationFeeDebtors(students);
    return aggregated.rows.filter((row) => passesFilters(row.studentId));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    students,
    studentsById,
    levelFilter,
    search,
    subjectFilter,
    trackFilter,
    groupFilter,
  ]);

  const smallGroupUnpaidCounts = useMemo(() => {
    const counts = new Map<Subject, number>();
    for (const subject of SMALL_GROUP_SUBJECTS) {
      const roster = students.filter(
        (student) =>
          student.level === "2Bac" &&
          student.enrollments.some((e) => e.subject === subject && e.groupType === "Small" && e.track === "s.x"),
      );
      counts.set(
        subject,
        roster.filter(
          (student) =>
            getDueBalanceForStudentSubject(payments, student.id, subject, todayKey).dueUnpaid
              .length > 0,
        ).length,
      );
    }
    return counts;
  }, [students, payments, todayKey]);

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">{t("paymentsPage")}</h1>
        <p className="text-sm text-muted-foreground">{t("amountDue")}</p>
      </div>

      <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
        <div className="relative flex-1 min-w-[200px]">
          <Input
            className="rounded-xl"
            placeholder={t("filterByName")}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        {activeTab !== "smallGroups" && (
          <>
            <div className="w-full sm:w-48">
              <Select
                value={levelFilter}
                onValueChange={(v: Level | "all") => handleLevelChange(v)}
              >
                <SelectTrigger className="rounded-xl">
                  <SelectValue placeholder={t("filterByLevel")} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">{t("allLevels")}</SelectItem>
                  {LEVELS.map((lvl) => (
                    <SelectItem key={lvl} value={lvl}>
                      {lvl}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {showTrackFilter && (
              <div className="w-full sm:w-40">
                <Select
                  value={trackFilter ?? ""}
                  onValueChange={handleTrackChange}
                >
                  <SelectTrigger className="rounded-xl gap-2">
                    <Layers className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                    <SelectValue placeholder={t("filterByTrack")} />
                  </SelectTrigger>
                  <SelectContent>
                    {TRACKS.map((tr) => (
                      <SelectItem key={tr} value={tr}>
                        {tr}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            {showSubjectFilter && (
              <div className="w-full sm:w-48">
                <Select
                  value={subjectFilter}
                  onValueChange={handleSubjectChange}
                  disabled={subjectDisabled}
                >
                  <SelectTrigger className="rounded-xl gap-2 disabled:opacity-60">
                    <BookOpen className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                    <SelectValue
                      placeholder={
                        subjectDisabled
                          ? t("selectTrackFirst")
                          : t("filterBySubject")
                      }
                    />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">{t("allSubjects")}</SelectItem>
                    {availableSubjects.map((subj) => (
                      <SelectItem key={subj} value={subj}>
                        {subj}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            {showGroupFilter && (
              <div className="w-full sm:w-44">
                <Select
                  value={groupFilter}
                  onValueChange={(v: GroupType | "all") => setGroupFilter(v)}
                >
                  <SelectTrigger className="rounded-xl gap-2">
                    <Users className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                    <SelectValue placeholder={t("filterByGroup")} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">{t("allGroups")}</SelectItem>
                    {GROUP_TYPES.map((gt) => (
                      <SelectItem key={gt} value={gt}>
                        {gt === "Large" ? t("large") : t("small")}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
          </>
        )}
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-4">
        <TabsList className="w-full rounded-xl sm:w-auto">
          <TabsTrigger value="ruleA" className="rounded-lg">
            {t("ruleAPaymentsTitle")}
          </TabsTrigger>
          <TabsTrigger value="smallGroups" className="rounded-lg">
            {t("smallGroupsTab")}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="ruleA" className="space-y-4">
          <p className="text-sm text-muted-foreground">{t("ruleAPaymentsSubtitle")}</p>
          <div className="grid items-start gap-4 lg:grid-cols-2">
            <UnpaidSubjectsPanel
              rows={ruleAOverdueRows}
              todayKey={todayKey}
              studentsById={studentsById}
            />
            <PaidSubjectsPanel rows={ruleASettledRows} studentsById={studentsById} />
          </div>
          <RegistrationFeePanel rows={feeDebtorRows} studentsById={studentsById} />
        </TabsContent>

        <TabsContent value="smallGroups" className="space-y-4">
          <p className="text-sm text-muted-foreground">{t("smallGroupsHint")}</p>

          <ToggleGroup
            type="single"
            value={smallGroupSubject}
            onValueChange={(v) => {
              if (v) setSmallGroupSubject(v as Subject);
            }}
            variant="outline"
            className="w-full flex-col rounded-xl bg-muted/30 p-1 sm:flex-row"
          >
            {SMALL_GROUP_SUBJECTS.map((subject) => {
              const unpaidCount = smallGroupUnpaidCounts.get(subject) ?? 0;
              return (
                <ToggleGroupItem
                  key={subject}
                  value={subject}
                  className="flex-1 rounded-lg justify-center gap-2 data-[state=on]:bg-card data-[state=on]:shadow-sm"
                >
                  {smallSubjectLabel(subject)}
                  {unpaidCount > 0 && (
                    <Badge className="rounded-full bg-accent/15 text-accent-foreground">
                      {unpaidCount}
                    </Badge>
                  )}
                </ToggleGroupItem>
              );
            })}
          </ToggleGroup>

          {/* View switcher */}
          <div className="flex items-center gap-2">
            <div className="inline-flex rounded-full bg-muted p-1">
              <button
                type="button"
                onClick={() => setSmallGroupView("cards")}
                className={
                  smallGroupView === "cards"
                    ? "inline-flex items-center gap-1.5 rounded-full bg-card px-3.5 py-1.5 text-xs font-semibold shadow-sm"
                    : "inline-flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-xs text-muted-foreground hover:text-foreground"
                }
              >
                <LayoutGrid className="h-3.5 w-3.5" />
                {t("cardsView")}
              </button>
              <button
                type="button"
                onClick={() => setSmallGroupView("table")}
                className={
                  smallGroupView === "table"
                    ? "inline-flex items-center gap-1.5 rounded-full bg-card px-3.5 py-1.5 text-xs font-semibold shadow-sm"
                    : "inline-flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-xs text-muted-foreground hover:text-foreground"
                }
              >
                <Table2 className="h-3.5 w-3.5" />
                {t("tableView")}
              </button>
            </div>
            <span className="text-xs text-muted-foreground">
              {smallGroupView === "cards" ? t("cardsView") : t("tableView")} · {t("smallGroupsHint")}
            </span>
          </div>

          {smallGroupView === "cards" && (
            <SmallGroupsCardsGrid subject={smallGroupSubject} search={search} todayKey={todayKey} />
          )}

          <Collapsible open={tablesOpen} onOpenChange={setTablesOpen} className="space-y-3">
            <CollapsibleTrigger className="flex w-full items-center justify-between rounded-xl border border-border bg-card px-4 py-3 text-sm font-semibold hover:bg-muted/50">
              <span>{t("tableView")} — Payés / Impayés</span>
              <ChevronDown className={`h-4 w-4 transition-transform ${tablesOpen ? "rotate-180" : ""}`} />
            </CollapsibleTrigger>
            <CollapsibleContent className="space-y-3">
              <SmallGroupsPanel
                subject={smallGroupSubject}
                search={search}
                todayKey={todayKey}
              />
            </CollapsibleContent>
          </Collapsible>
        </TabsContent>
      </Tabs>
    </div>
  );
}
