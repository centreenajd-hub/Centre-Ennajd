import { BookOpen, Layers, Plus, Search, Users, X } from "lucide-react";
import { useMemo, useState } from "react";

import { StudentFormSheet } from "@/components/students/StudentFormSheet";
import { StudentTable } from "@/components/students/StudentTable";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useEnnajdState } from "@/hooks/use-ennajd-state";
import {
  GROUP_TYPES,
  LEVELS,
  TRACKS,
  getSubjectsFor,
  isGroupTypeSelectableForLevel,
  isTrackRequired,
} from "@/lib/ennajd-taxonomy";
import { useI18n } from "@/lib/i18n";
import type { GroupType, Level, Student, Subject, Track } from "@/types/ennajd";

export default function Students() {
  const { t, lang } = useI18n();
  const students = useEnnajdState((s) => s.students);
  const [search, setSearch] = useState("");
  const [levelFilter, setLevelFilter] = useState<Level | "all">("all");
  const [trackFilter, setTrackFilter] = useState<Track | null>(null);
  const [subjectFilter, setSubjectFilter] = useState<Subject | "all">("all");
  const [groupFilter, setGroupFilter] = useState<GroupType | "all">("all");
  const [sheetOpen, setSheetOpen] = useState(false);
  const [editingStudent, setEditingStudent] = useState<Student | null>(null);

  const availableSubjects = useMemo<Subject[]>(() => {
    if (levelFilter === "all") return [];
    if (isTrackRequired(levelFilter) && !trackFilter) return [];
    return getSubjectsFor(levelFilter, trackFilter);
  }, [levelFilter, trackFilter]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return students.filter((s) => {
      const matchesLevel = levelFilter === "all" || s.level === levelFilter;
      const matchesTrack = !trackFilter || s.track === trackFilter;
      const matchesSubject =
        subjectFilter === "all" ||
        s.enrollments.some((e) => e.subject === subjectFilter);
      const matchesGroup =
        groupFilter === "all" ||
        s.enrollments.some((e) => e.groupType === groupFilter);
      const fullName = `${s.firstName} ${s.lastName}`.toLowerCase();
      const matchesSearch = !q || fullName.includes(q);
      return (
        matchesLevel &&
        matchesTrack &&
        matchesSubject &&
        matchesGroup &&
        matchesSearch
      );
    });
  }, [students, search, levelFilter, trackFilter, subjectFilter, groupFilter]);

  const hasActiveFilter =
    levelFilter !== "all" ||
    trackFilter !== null ||
    subjectFilter !== "all" ||
    groupFilter !== "all" ||
    search.trim().length > 0;

  const showTrackFilter =
    levelFilter !== "all" && isTrackRequired(levelFilter);
  const showSubjectFilter = levelFilter !== "all";
  const showGroupFilter =
    levelFilter !== "all" && isGroupTypeSelectableForLevel(levelFilter);
  const subjectDisabled =
    showSubjectFilter &&
    isTrackRequired(levelFilter as Level) &&
    !trackFilter;

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
    setGroupFilter("all");
  }

  function handleClearFilters() {
    setLevelFilter("all");
    setTrackFilter(null);
    setSubjectFilter("all");
    setGroupFilter("all");
    setSearch("");
  }

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{t("students")}</h1>
          <p className="text-sm text-muted-foreground">
            {hasActiveFilter ? (
              <span className="font-medium text-foreground">
                {lang === "ar"
                  ? `${filtered.length} نتيجة`
                  : `${filtered.length} résultat${filtered.length !== 1 ? "s" : ""}`}
              </span>
            ) : (
              <>
                {students.length} {t("totalStudents").toLowerCase()}
              </>
            )}
          </p>
        </div>
        <Button
          className="rounded-lg"
          onClick={() => {
            setEditingStudent(null);
            setSheetOpen(true);
          }}
        >
          <Plus className="me-1.5 h-4 w-4" />
          {t("addStudent")}
        </Button>
      </div>

      <div className="flex flex-col gap-3">
        <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
          <div className="relative flex-1 min-w-[200px]">
            <Search className="absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              className="rounded-lg ps-9"
              placeholder={t("search")}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>

          <div className="w-full sm:w-[180px]">
            <Select
              value={levelFilter}
              onValueChange={(v: Level | "all") => handleLevelChange(v)}
            >
              <SelectTrigger className="rounded-lg border-input bg-background focus:ring-primary">
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

          {showTrackFilter || showSubjectFilter || showGroupFilter ? (
            <div
              className={
                [showTrackFilter, showSubjectFilter, showGroupFilter].filter(
                  Boolean,
                ).length > 1
                  ? "grid grid-cols-2 gap-3 sm:contents"
                  : "contents"
              }
            >
              {showTrackFilter && (
                <div className="w-full sm:w-[140px]">
                  <Select
                    value={trackFilter ?? ""}
                    onValueChange={handleTrackChange}
                  >
                    <SelectTrigger className="rounded-lg border-input bg-background focus:ring-primary gap-2">
                      <Layers className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                      <SelectValue placeholder={t("selectTrack")} />
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
                <div className="w-full sm:w-[180px]">
                  <Select
                    value={subjectFilter}
                    onValueChange={handleSubjectChange}
                    disabled={subjectDisabled}
                  >
                    <SelectTrigger className="rounded-lg border-input bg-background focus:ring-primary gap-2 disabled:opacity-60">
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
                <div className="w-full sm:w-[160px]">
                  <Select
                    value={groupFilter}
                    onValueChange={(v: GroupType | "all") => setGroupFilter(v)}
                  >
                    <SelectTrigger className="rounded-lg border-input bg-background focus:ring-primary gap-2">
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
            </div>
          ) : null}
        </div>

        {hasActiveFilter && (
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs text-muted-foreground">
              {lang === "ar"
                ? `${filtered.length} نتيجة`
                : `${filtered.length} résultat${filtered.length !== 1 ? "s" : ""}`}
              {subjectFilter !== "all" && (
                <span className="ms-1 font-medium text-foreground">
                  · {subjectFilter}
                </span>
              )}
              {levelFilter !== "all" && (
                <span className="ms-1">· {levelFilter}</span>
              )}
              {trackFilter && (
                <span className="ms-1">· {trackFilter}</span>
              )}
              {groupFilter !== "all" && (
                <span className="ms-1">
                  · {groupFilter === "Large" ? t("large") : t("small")}
                </span>
              )}
            </span>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 rounded-full px-2.5 text-xs gap-1"
              onClick={handleClearFilters}
            >
              <X className="h-3 w-3" />
              {t("clearFilters")}
            </Button>
          </div>
        )}
      </div>

      <StudentTable
        students={filtered}
        onEdit={(student) => {
          setEditingStudent(student);
          setSheetOpen(true);
        }}
        emptyState={{
          levelFilter,
          subjectFilter,
          search,
          onClearFilters: handleClearFilters,
        }}
      />

      <StudentFormSheet
        open={sheetOpen}
        onOpenChange={setSheetOpen}
        student={editingStudent}
      />
    </div>
  );
}
