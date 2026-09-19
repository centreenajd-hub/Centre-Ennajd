import { useEffect, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Moon } from "lucide-react";

import { useEnnajdState } from "@/hooks/use-ennajd-state";
import {
  ALL_SUBJECTS,
  LEVELS,
  canSubjectBeSmallGroup,
  formatDateKeyLocal,
  getSessionKind,
  isCombinedClass,
  isGroupTypeApplicable,
  isTrackRequired,
} from "@/lib/ennajd-taxonomy";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import type { GroupType, Level, Session, SessionKind, Subject, Track } from "@/types/ennajd";

const DAY_KEYS = [
  "sunday",
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
] as const;

interface SessionFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  session?: Session | null;
  initialLevel?: Level | null;
  initialDayOfWeek?: number | null;
}

const emptyForm = {
  subject: "Math" as Subject,
  level: "T.C" as Level,
  track: null as Track | null,
  groupType: null as GroupType | null,
  dayOfWeek: 1,
  startTime: "16:00",
  endTime: "18:00",
  teacherName: "" as string,
  kind: "recurring" as SessionKind,
  date: "" as string,
};

function roundToNearest5(date: Date): string {
  const totalMinutes = date.getHours() * 60 + date.getMinutes();
  const rounded = Math.round(totalMinutes / 5) * 5;
  const normalized = ((rounded % 1440) + 1440) % 1440;
  const hours = Math.floor(normalized / 60);
  const minutes = normalized % 60;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

function addMinutesToTime(time: string, minutes: number): string {
  const [h, m] = time.split(":").map(Number);
  const total = (((h * 60 + m + minutes) % 1440) + 1440) % 1440;
  const hours = Math.floor(total / 60);
  const mins = total % 60;
  return `${String(hours).padStart(2, "0")}:${String(mins).padStart(2, "0")}`;
}

// Same arithmetic as addMinutesToTime but without the modulo, so an overnight
// end time can legitimately reach hours 24–47 (e.g. "22:55" + 120 → "24:55").
function addMinutesNoWrap(time: string, minutes: number): string {
  const [h, m] = time.split(":").map(Number);
  const total = h * 60 + m + minutes;
  const hours = Math.floor(total / 60);
  const mins = total % 60;
  return `${String(hours).padStart(2, "0")}:${String(mins).padStart(2, "0")}`;
}

// <input type="time"> cannot render hours >= 24, so an overnight end stored as
// e.g. "24:55" is wrapped back to "00:55" for display. The endsNextDay flag
// re-derives from the (smaller) display value and re-clamps on submit.
function normalizeTimeForInput(time: string): string {
  const [h, m] = time.split(":").map(Number);
  if (h < 24) return time;
  const hours = h - 24;
  return `${String(hours).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

export function SessionFormDialog({
  open,
  onOpenChange,
  session,
  initialLevel,
  initialDayOfWeek,
}: SessionFormDialogProps) {
  const { t } = useI18n();
  const addSession = useEnnajdState((s) => s.addSession);
  const updateSession = useEnnajdState((s) => s.updateSession);
  const [form, setForm] = useState(emptyForm);
  const [calendarOpen, setCalendarOpen] = useState(false);

  useEffect(() => {
    if (session) {
      setForm({
        subject: session.subject,
        level: session.level,
        track: session.track,
        groupType: session.groupType,
        dayOfWeek: session.dayOfWeek,
        startTime: session.startTime,
        endTime: normalizeTimeForInput(session.endTime),
        teacherName: session.teacherName ?? "",
        kind: getSessionKind(session),
        date: session.date ?? "",
      });
    } else {
      const startTime = roundToNearest5(new Date());
      setForm({
        ...emptyForm,
        level: initialLevel ?? emptyForm.level,
        dayOfWeek: initialDayOfWeek ?? emptyForm.dayOfWeek,
        startTime,
        endTime: addMinutesToTime(startTime, 120),
        kind: "recurring",
        date: "",
      });
    }
  }, [session, initialLevel, initialDayOfWeek, open]);

  const trackRequired = isTrackRequired(form.level);
  const combined = isCombinedClass(form.level, form.subject);
  // Zero-padded "HH:mm" compares lexicographically the same as numerically, so
  // an end earlier than the start means the session crosses midnight.
  const endsNextDay = form.endTime < form.startTime;
    const groupApplicable =
      !combined && isGroupTypeApplicable(form.level, form.subject);
    const smallAllowed =
      !combined && canSubjectBeSmallGroup(form.level, form.track, form.subject);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (trackRequired && !combined && !form.track) {
      toast.error(t("invalidCombination"));
      return;
    }

    if (form.kind === "one_off") {
      if (!form.date) {
        toast.error(t("sessionDateRequired"));
        return;
      }
      const todayKey = formatDateKeyLocal(new Date());
      if (form.date < todayKey) {
        toast.error(t("sessionDatePast"));
        return;
      }
    }

    const dayOfWeek =
      form.kind === "one_off" && form.date
        ? new Date(form.date + "T12:00:00").getDay()
        : form.dayOfWeek;

    const payload = {
      subject: form.subject,
      level: form.level,
      track: trackRequired && !combined ? form.track : null,
      groupType: groupApplicable ? form.groupType ?? "Large" : null,
      dayOfWeek,
      startTime: form.startTime,
      endTime: endsNextDay ? addMinutesNoWrap(form.endTime, 1440) : form.endTime,
      teacherName: form.teacherName || undefined,
      kind: form.kind,
      date: form.kind === "one_off" ? form.date : null,
    };

    // Await the DB write: the success toast + dialog close only fire once the
    // row is confirmed. On failure the store reverts its optimistic state and
    // fires the error toast itself — the dialog stays open, so a rejected
    // insert is never indistinguishable from a success.
    const saved = session
      ? await updateSession(session.id, payload)
      : await addSession(payload);
    if (!saved) return;

    toast.success(t("sessionSaved"));
    onOpenChange(false);
  }

  const todayKey = formatDateKeyLocal(new Date());
  const selectedDate = form.date ? new Date(form.date + "T12:00:00") : undefined;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl rounded-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{session ? t("editSession") : t("addSession")}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <Label>{t("sessionKind")}</Label>
            <RadioGroup
              value={form.kind}
              onValueChange={(v: SessionKind) => setForm((f) => ({ ...f, kind: v }))}
              className="flex gap-4"
            >
              <div className="flex items-center gap-2">
                <RadioGroupItem value="recurring" id="kind-recurring" />
                <Label htmlFor="kind-recurring" className="cursor-pointer font-normal">
                  {t("recurringSession")}
                </Label>
              </div>
              <div className="flex items-center gap-2">
                <RadioGroupItem value="one_off" id="kind-oneoff" />
                <Label htmlFor="kind-oneoff" className="cursor-pointer font-normal">
                  {t("oneOffSession")}
                </Label>
              </div>
            </RadioGroup>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>{t("level")}</Label>
              <Select
                value={form.level}
                onValueChange={(v: Level) =>
                  setForm((f) => ({ ...f, level: v, track: null }))
                }
              >
                <SelectTrigger className="rounded-lg">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {LEVELS.map((lvl) => (
                    <SelectItem key={lvl} value={lvl}>
                      {lvl}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>{t("subject")}</Label>
              <Select
                value={form.subject}
                onValueChange={(v: Subject) =>
                  setForm((f) => ({ ...f, subject: v }))
                }
              >
                <SelectTrigger className="rounded-lg">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ALL_SUBJECTS.map((subj) => (
                    <SelectItem key={subj} value={subj}>
                      {subj}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {(trackRequired && !combined) || groupApplicable ? (
                      <div
                        className={cn(
                          "grid gap-3",
                          trackRequired && !combined && groupApplicable && "sm:grid-cols-2",
                        )}
                      >
                        {trackRequired && !combined && (
                          <div className="space-y-1.5">
                            <Label>{t("track")}</Label>
                            <Select
                              value={form.track ?? undefined}
                              onValueChange={(v: Track) => setForm((f) => ({ ...f, track: v }))}
                            >
                              <SelectTrigger className="rounded-lg">
                                <SelectValue placeholder={t("selectTrack")} />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="s.x">s.x</SelectItem>
                                <SelectItem value="s.m">s.m</SelectItem>
                              </SelectContent>
                            </Select>
                          </div>
                        )}
          
                        {groupApplicable && (
                          <div className="min-w-0 space-y-1.5">
                            <Label>{t("groupType")}</Label>
                            <Select
                              value={form.groupType ?? "Large"}
                              onValueChange={(v: GroupType) =>
                                setForm((f) => ({ ...f, groupType: v }))
                              }
                            >
                              <SelectTrigger className="rounded-lg">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="Large">{t("large")}</SelectItem>
                                {smallAllowed && <SelectItem value="Small">{t("small")}</SelectItem>}
                              </SelectContent>
                            </Select>
                          </div>
                        )}
                      </div>
                    ) : null}

          {form.kind === "recurring" ? (
            <div className="space-y-1.5">
              <Label>{t("dayOfWeek")}</Label>
              <Select
                value={String(form.dayOfWeek)}
                onValueChange={(v) =>
                  setForm((f) => ({ ...f, dayOfWeek: Number(v) }))
                }
              >
                <SelectTrigger className="rounded-lg">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {DAY_KEYS.map((key, idx) => (
                    <SelectItem key={key} value={String(idx)}>
                      {t(key)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          ) : (
            <div className="space-y-1.5">
              <Label>{t("dateOfSession")}</Label>
              <div className="flex gap-2">
                <Input
                  type="date"
                  className="rounded-lg flex-1"
                  value={form.date}
                  min={todayKey}
                  onChange={(e) => setForm((f) => ({ ...f, date: e.target.value }))}
                />
                <Button
                  type="button"
                  variant="outline"
                  className="rounded-lg shrink-0"
                  onClick={() => setCalendarOpen((v) => !v)}
                >
                  📅
                </Button>
              </div>
              {calendarOpen && (
                <div className="rounded-2xl border border-border p-2 bg-card">
                  <Calendar
                    mode="single"
                    selected={selectedDate}
                    onSelect={(d) => {
                      if (d) setForm((f) => ({ ...f, date: formatDateKeyLocal(d) }));
                      setCalendarOpen(false);
                    }}
                    disabled={(date) => formatDateKeyLocal(date) < todayKey}
                  />
                </div>
              )}
              {form.date && (
                <p className="text-xs text-muted-foreground">
                  {t(DAY_KEYS[new Date(form.date + "T12:00:00").getDay()])} · {form.date}
                </p>
              )}
            </div>
          )}

          <div className="space-y-1.5">
            <Label>{t("teacherName")}</Label>
            <Input
              type="text"
              className="rounded-lg"
              value={form.teacherName}
              onChange={(e) =>
                setForm((f) => ({ ...f, teacherName: e.target.value }))
              }
              placeholder={t("teacherNamePlaceholder")}
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>{t("startTime")}</Label>
              <Input
                type="time"
                className="rounded-lg"
                value={form.startTime}
                onChange={(e) => {
                  const startTime = e.target.value;
                  setForm((f) => ({
                    ...f,
                    startTime,
                    endTime: addMinutesToTime(startTime, 120),
                  }));
                }}
              />
            </div>
            <div className="space-y-1.5">
              <Label>{t("endTime")}</Label>
              <Input
                type="time"
                className="rounded-lg"
                value={form.endTime}
                onChange={(e) =>
                  setForm((f) => ({ ...f, endTime: e.target.value }))
                }
              />
            </div>
          </div>
          {endsNextDay && (
            <p className="flex items-center gap-1.5 text-xs text-amber-600 dark:text-amber-500">
              <Moon className="size-3.5 shrink-0" />
              {t("sessionEndsNextDay")}
            </p>
          )}

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              className="rounded-lg"
              onClick={() => onOpenChange(false)}
            >
              {t("cancel")}
            </Button>
            <Button type="submit" className="rounded-lg">
              {t("save")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
