import { Pencil, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useEnnajdState } from "@/hooks/use-ennajd-state";
import { formatDateKeyLocal, isOneOffSession } from "@/lib/ennajd-taxonomy";
import { useI18n } from "@/lib/i18n";
import type { Session } from "@/types/ennajd";

const DAY_KEYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"] as const;

function formatDayHeader(dateKey: string, t: (k: any) => string): string {
  const [y, m, d] = dateKey.split("-").map(Number);
  const dt = new Date(y, m - 1, d);
  const dayName = t(DAY_KEYS[dt.getDay()] as any);
  const dd = String(d).padStart(2, "0");
  const mm = String(m).padStart(2, "0");
  return `${dayName} ${dd}/${mm}`;
}

function SessionGridCard({
  session,
  onEdit,
}: {
  session: Session;
  onEdit: (s: Session) => void;
}) {
  const { t } = useI18n();
  const deleteSession = useEnnajdState((s) => s.deleteSession);
  const [confirm, setConfirm] = useState(false);
  const isExtra = isOneOffSession(session);
  const dayLabel = session.date ? session.date.slice(5).replace("-", "/") : "";

  return (
    <>
      <div
        className={
          isExtra
            ? "group relative rounded-xl border border-accent/40 bg-accent/20 p-2.5 space-y-1.5 animate-in fade-in"
            : "group relative rounded-xl border border-primary/20 bg-primary/10 p-2.5 space-y-1.5"
        }
      >
        {isExtra && (
          <Badge className="rounded-full bg-accent text-accent-foreground text-[10px] px-1.5 py-0">
            {t("extra")} · {dayLabel}
          </Badge>
        )}
        <p className="text-sm font-semibold leading-tight break-words">
                  {session.subject} · {session.startTime}–{session.endTime}
                </p>
        <div className="flex flex-wrap gap-1">
          <Badge variant="secondary" className="rounded-full text-[10px] px-1.5 py-0">
            {session.level}
          </Badge>
          {session.track && (
            <Badge variant="outline" className="rounded-full text-[10px] px-1.5 py-0">
              {session.track}
            </Badge>
          )}
          {session.groupType && (
            <Badge variant="outline" className="rounded-full text-[10px] px-1.5 py-0">
              {session.groupType === "Small" ? t("small") : t("large")}
            </Badge>
          )}
        </div>
        {session.teacherName && (
          <p className="text-xs text-muted-foreground truncate">{session.teacherName}</p>
        )}
        <div className="flex gap-1 pt-1 opacity-100 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity">
          <Button variant="ghost" size="icon" className="h-7 w-7 rounded-lg" onClick={() => onEdit(session)}>
            <Pencil className="h-3.5 w-3.5" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 rounded-lg text-destructive hover:text-destructive"
            onClick={() => setConfirm(true)}
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>
      <AlertDialog open={confirm} onOpenChange={(o) => !o && setConfirm(false)}>
        <AlertDialogContent className="rounded-2xl">
          <AlertDialogHeader>
            <AlertDialogTitle>{t("confirmDeleteTitle")}</AlertDialogTitle>
            <AlertDialogDescription>{t("confirmDeleteSession")}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="rounded-lg">{t("cancel")}</AlertDialogCancel>
            <AlertDialogAction
              className="rounded-lg bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => {
                deleteSession(session.id);
                toast.success(t("sessionDeleted"));
                setConfirm(false);
              }}
            >
              {t("delete")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

interface WeeklyGridProps {
  sessions: Session[];
  weekDates: string[];
  onEdit: (s: Session) => void;
  onAddForDay: (dayOfWeek: number) => void;
}

export function WeeklyGrid({ sessions, weekDates, onEdit, onAddForDay }: WeeklyGridProps) {
  const { t } = useI18n();
  const todayKey = formatDateKeyLocal(new Date());

  function dayOfWeekForKey(dateKey: string): number {
    const [y, m, d] = dateKey.split("-").map(Number);
    return new Date(y, m - 1, d).getDay();
  }

  function sessionsForDay(dayIdx: number): Session[] {
    const dateKey = weekDates[dayIdx];
    const dow = dayOfWeekForKey(dateKey);
    return sessions.filter((s) => {
      if (isOneOffSession(s)) return s.date === dateKey;
      return s.dayOfWeek === dow;
    });
  }

  return (
    <>
      {/* Desktop grid */}
            <div className="hidden md:grid md:grid-cols-7 gap-2">
              {weekDates.map((dateKey, idx) => {
                const isToday = dateKey === todayKey;
                const daySessions = sessionsForDay(idx);
                return (
                  <div
                    key={dateKey}
                    className={
                      isToday
                        ? "min-w-0 rounded-2xl border bg-card p-2 space-y-2 ring-2 ring-primary"
                        : "min-w-0 rounded-2xl border bg-card p-2 space-y-2"
                    }
                  >
              <div className="text-center border-b border-border pb-2">
                <p className={isToday ? "text-xs font-bold text-primary" : "text-xs font-semibold"}>
                  {formatDayHeader(dateKey, t)}
                </p>
              </div>
              <div className="space-y-2 min-h-[140px]">
                {daySessions.length === 0 ? (
                  <p className="text-[11px] text-muted-foreground text-center py-6">{t("gridEmptyDay")}</p>
                ) : (
                  daySessions.map((s) => (
                    <SessionGridCard key={s.id} session={s} onEdit={onEdit} />
                  ))
                )}
              </div>
              <Button
                variant="outline"
                size="sm"
                className="w-full rounded-xl border-dashed text-xs h-7"
                onClick={() => onAddForDay(dayOfWeekForKey(dateKey))}
              >
                <Plus className="h-3 w-3 me-1" />
                {t("addSessionForDay")}
              </Button>
            </div>
          );
        })}
      </div>

      {/* Mobile accordion */}
      <div className="sm:hidden rounded-2xl border border-border bg-card overflow-hidden">
        <Accordion type="multiple" defaultValue={weekDates.filter((k) => k === todayKey)} className="w-full">
          {weekDates.map((dateKey, idx) => {
            const isToday = dateKey === todayKey;
            const daySessions = sessionsForDay(idx);
            return (
              <AccordionItem key={dateKey} value={dateKey} className="border-b last:border-0">
                <AccordionTrigger
                  className={`px-4 py-3 text-sm ${isToday ? "bg-primary/5 text-primary font-bold" : "font-medium"}`}
                >
                  <span className="flex items-center gap-2">
                    {formatDayHeader(dateKey, t)}
                    {daySessions.length > 0 && (
                      <Badge variant="secondary" className="rounded-full text-[10px] px-1.5 py-0">
                        {daySessions.length}
                      </Badge>
                    )}
                  </span>
                </AccordionTrigger>
                <AccordionContent className="px-3 pb-3">
                  <div className="space-y-2">
                    {daySessions.length === 0 ? (
                      <p className="text-xs text-muted-foreground text-center py-4">{t("gridEmptyDay")}</p>
                    ) : (
                      daySessions.map((s) => (
                        <SessionGridCard key={s.id} session={s} onEdit={onEdit} />
                      ))
                    )}
                    <Button
                      variant="outline"
                      size="sm"
                      className="w-full rounded-xl border-dashed text-xs"
                      onClick={() => onAddForDay(dayOfWeekForKey(dateKey))}
                    >
                      <Plus className="h-3 w-3 me-1" />
                      {t("addSessionForDay")}
                    </Button>
                  </div>
                </AccordionContent>
              </AccordionItem>
            );
          })}
        </Accordion>
      </div>
    </>
  );
}
