import { ChevronLeft, ChevronRight, Plus } from "lucide-react";
import { useMemo, useState } from "react";

import { SessionFormDialog } from "@/components/sessions/SessionFormDialog";
import { SessionTable } from "@/components/sessions/SessionTable";
import { WeeklyGrid } from "@/components/sessions/WeeklyGrid";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useEnnajdState } from "@/hooks/use-ennajd-state";
import { LEVELS } from "@/lib/ennajd-taxonomy";
import { formatDateKeyLocal, isOneOffSession } from "@/lib/ennajd-taxonomy";
import { useI18n } from "@/lib/i18n";
import type { Level, Session } from "@/types/ennajd";

function getMonday(date: Date): Date {
  const d = new Date(date);
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  d.setHours(0, 0, 0, 0);
  return d;
}

function addDays(date: Date, days: number): Date {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

function formatWeekLabel(weekStart: Date): string {
  const end = addDays(weekStart, 6);
  const sDay = String(weekStart.getDate()).padStart(2, "0");
  const sMonth = String(weekStart.getMonth() + 1).padStart(2, "0");
  const eDay = String(end.getDate()).padStart(2, "0");
  const eMonth = String(end.getMonth() + 1).padStart(2, "0");
  const year = end.getFullYear();
  return `${sDay}/${sMonth} – ${eDay}/${eMonth} ${year}`;
}

export default function Sessions() {
  const { t } = useI18n();
  const sessions = useEnnajdState((s) => s.sessions);
  const [levelFilter, setLevelFilter] = useState<Level | "all">("all");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingSession, setEditingSession] = useState<Session | null>(null);
  const [activeTab, setActiveTab] = useState("grid");
  const [weekOffset, setWeekOffset] = useState(0);
  const [initialDayOfWeek, setInitialDayOfWeek] = useState<number | null>(null);

  const todayMonday = useMemo(() => getMonday(new Date()), []);
  const weekStart = useMemo(() => addDays(todayMonday, weekOffset * 7), [todayMonday, weekOffset]);
  const weekDates = useMemo(
    () => Array.from({ length: 7 }, (_, i) => formatDateKeyLocal(addDays(weekStart, i))),
    [weekStart],
  );

  const filtered = useMemo(() => {
    const list =
      levelFilter === "all"
        ? sessions
        : sessions.filter((s) => s.level === levelFilter);
    return list;
  }, [sessions, levelFilter]);

  const gridSessions = useMemo(() => {
    const weekSet = new Set(weekDates);
    return filtered.filter((s) => {
      if (isOneOffSession(s)) return s.date ? weekSet.has(s.date) : false;
      return true;
    });
  }, [filtered, weekDates]);

  const sortedForList = useMemo(
    () => [...filtered].sort((a, b) => a.dayOfWeek - b.dayOfWeek),
    [filtered],
  );

  function handleAddForDay(dayOfWeek: number) {
    setEditingSession(null);
    setInitialDayOfWeek(dayOfWeek);
    setDialogOpen(true);
  }

  const expiringSoonCount = useMemo(() => {
    const todayKey = formatDateKeyLocal(new Date());
    const tomorrowKey = formatDateKeyLocal(addDays(new Date(), 1));
    return sessions.filter((s) => isOneOffSession(s) && s.date && (s.date === todayKey || s.date === tomorrowKey)).length;
  }, [sessions]);

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{t("sessions")}</h1>
          <p className="text-sm text-muted-foreground">
            {t("subjectsAndSessions")}
          </p>
        </div>
        <Button
          className="rounded-lg"
          onClick={() => {
            setEditingSession(null);
            setInitialDayOfWeek(null);
            setDialogOpen(true);
          }}
        >
          <Plus className="me-1.5 h-4 w-4" />
          {t("addSession")}
        </Button>
      </div>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="w-full sm:w-56">
          <Select
            value={levelFilter}
            onValueChange={(v: Level | "all") => setLevelFilter(v)}
          >
            <SelectTrigger className="rounded-lg">
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
      </div>

      {expiringSoonCount > 0 && activeTab === "grid" && (
        <div className="rounded-xl border border-accent/30 bg-accent/10 px-4 py-2 text-sm text-accent-foreground">
          {t("upcomingExpiryNotice").replace("{count}", String(expiringSoonCount))}
        </div>
      )}

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="rounded-xl">
          <TabsTrigger value="grid" className="rounded-lg">
            {t("weeklyGrid")}
          </TabsTrigger>
          <TabsTrigger value="list" className="rounded-lg">
            {t("listView")}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="grid" className="space-y-4 mt-4">
          <div className="flex items-center justify-between rounded-2xl border border-border bg-card px-3 py-2 sm:px-4">
            <Button variant="ghost" size="icon" className="h-8 w-8 rounded-lg shrink-0" onClick={() => setWeekOffset((v) => v - 1)}>
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <div className="flex items-center gap-2 text-sm">
              <span className="font-semibold hidden sm:inline">{t("weekOf")} </span>
              <span className="font-semibold">{formatWeekLabel(weekStart)}</span>
              {weekOffset !== 0 && (
                <Button variant="outline" size="sm" className="rounded-lg h-7 text-xs ms-2" onClick={() => setWeekOffset(0)}>
                  {t("today")}
                </Button>
              )}
            </div>
            <Button variant="ghost" size="icon" className="h-8 w-8 rounded-lg shrink-0" onClick={() => setWeekOffset((v) => v + 1)}>
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>

          <WeeklyGrid
            sessions={gridSessions}
            weekDates={weekDates}
            onEdit={(s) => {
              setEditingSession(s);
              setDialogOpen(true);
            }}
            onAddForDay={handleAddForDay}
          />
        </TabsContent>

        <TabsContent value="list" className="mt-4">
          <SessionTable
            sessions={sortedForList}
            onEdit={(session) => {
              setEditingSession(session);
              setDialogOpen(true);
            }}
          />
        </TabsContent>
      </Tabs>

      <SessionFormDialog
        open={dialogOpen}
        onOpenChange={(o) => {
          setDialogOpen(o);
          if (!o) setInitialDayOfWeek(null);
        }}
        session={editingSession}
        initialDayOfWeek={initialDayOfWeek}
      />
    </div>
  );
}
