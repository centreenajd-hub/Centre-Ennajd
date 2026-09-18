import {
  BookOpen,
  Eraser,
  Layers,
  MessageSquare,
  Plus,
  Search,
  SearchX,
  X,
} from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import { MessageCard } from "@/components/messages/MessageCard";
import { MessageFormDialog } from "@/components/messages/MessageFormDialog";
import { StudentMessageRow } from "@/components/messages/StudentMessageRow";
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
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useEnnajdState } from "@/hooks/use-ennajd-state";
import { getSubjectsFor, isTrackRequired, LEVELS, TRACKS } from "@/lib/ennajd-taxonomy";
import { useI18n } from "@/lib/i18n";
import type { Level, LevelMessage, Subject, Track } from "@/types/ennajd";

export default function Messages() {
  const { t, lang } = useI18n();
  const messages = useEnnajdState((s) => s.messages);
  const students = useEnnajdState((s) => s.students);
  const deleteMessage = useEnnajdState((s) => s.deleteMessage);

  const [levelFilter, setLevelFilter] = useState<Level>("T.C");
  const [trackFilter, setTrackFilter] = useState<Track | null>(null);
  const [subjectFilter, setSubjectFilter] = useState<Subject | "all">("all");
  const [search, setSearch] = useState("");
  const [messageText, setMessageText] = useState("");

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingMessage, setEditingMessage] = useState<LevelMessage | null>(null);
  const [pendingDelete, setPendingDelete] = useState<LevelMessage | null>(null);

  const composerRef = useRef<HTMLDivElement>(null);

  const availableSubjects = useMemo<Subject[]>(() => {
    if (isTrackRequired(levelFilter) && !trackFilter) return [];
    return getSubjectsFor(levelFilter, trackFilter);
  }, [levelFilter, trackFilter]);

  const filteredStudents = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = students.filter((s) => {
      const matchesLevel = s.level === levelFilter;
      const matchesTrack = !trackFilter || s.track === trackFilter;
      const matchesSubject =
        subjectFilter === "all" || s.enrollments.some((e) => e.subject === subjectFilter);
      const fullName = `${s.firstName} ${s.lastName}`.toLowerCase();
      const matchesSearch = !q || fullName.includes(q);
      return matchesLevel && matchesTrack && matchesSubject && matchesSearch;
    });
    return list.sort((a, b) =>
      `${a.firstName} ${a.lastName}`.localeCompare(`${b.firstName} ${b.lastName}`),
    );
  }, [students, levelFilter, trackFilter, subjectFilter, search]);

  const levelMessages = useMemo(
    () =>
      messages
        .filter((m) => m.level === levelFilter)
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
    [messages, levelFilter],
  );

  const hasActiveFilter =
    trackFilter !== null || subjectFilter !== "all" || search.trim().length > 0;

  const showTrackFilter = isTrackRequired(levelFilter);
  const subjectDisabled = isTrackRequired(levelFilter) && !trackFilter;

  function handleLevelChange(v: Level) {
    setLevelFilter(v);
    setTrackFilter(null);
    setSubjectFilter("all");
  }

  function handleTrackChange(v: string) {
    setTrackFilter(v as Track);
    setSubjectFilter("all");
  }

  function handleClearFilters() {
    setLevelFilter("T.C");
    setTrackFilter(null);
    setSubjectFilter("all");
    setSearch("");
  }

  function handleUseTemplate(msg: LevelMessage) {
    setMessageText(msg.body);
    composerRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
  }

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{t("messages")}</h1>
          <p className="text-sm text-muted-foreground">{t("messagesPageSubtitle")}</p>
        </div>
        <Button
          className="rounded-lg"
          onClick={() => {
            setEditingMessage(null);
            setDialogOpen(true);
          }}
        >
          <Plus className="me-1.5 h-4 w-4" />
          {t("addMessage")}
        </Button>
      </div>

      {/* Filter bar */}
      <div className="flex flex-col gap-3">
        <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
          <div className="relative flex-1 min-w-[200px]">
            <Search className="absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              className="rounded-lg ps-9"
              placeholder={t("searchByName")}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>

          <div className="w-full sm:w-[160px]">
            <Select value={levelFilter} onValueChange={(v: Level) => handleLevelChange(v)}>
              <SelectTrigger className="rounded-lg">
                <SelectValue placeholder={t("selectLevel")} />
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

          <div
            className={
              showTrackFilter ? "grid grid-cols-2 gap-3 sm:contents" : "contents"
            }
          >
            {showTrackFilter && (
              <div className="w-full sm:w-[130px]">
                <Select
                  value={trackFilter ?? ""}
                  onValueChange={handleTrackChange}
                >
                  <SelectTrigger className="rounded-lg gap-2">
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

            <div className="w-full sm:w-[180px]">
              <Select
                value={subjectFilter}
                onValueChange={(v: Subject | "all") => setSubjectFilter(v as Subject | "all")}
                disabled={subjectDisabled}
              >
                <SelectTrigger className="rounded-lg gap-2 disabled:opacity-60">
                  <BookOpen className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                  <SelectValue
                    placeholder={
                      subjectDisabled ? t("selectTrackFirst") : t("filterBySubject")
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
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-muted-foreground">
            {filteredStudents.length} {t("filteredStudentsLabel")}
            <span className="ms-1 font-medium text-foreground">· {levelFilter}</span>
            {trackFilter && <span className="ms-1">· {trackFilter}</span>}
            {subjectFilter !== "all" && (
              <span className="ms-1 font-medium text-foreground">· {subjectFilter}</span>
            )}
          </span>
          {hasActiveFilter && (
            <Button
              variant="ghost"
              size="sm"
              className="h-7 rounded-full px-2.5 text-xs gap-1"
              onClick={handleClearFilters}
            >
              <X className="h-3 w-3" />
              {t("clearFilters")}
            </Button>
          )}
        </div>
      </div>

      {/* Composer */}
      <div ref={composerRef} className="rounded-2xl border border-border bg-card p-4 shadow-sm">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-sm font-bold">{t("messageComposerTitle")}</h2>
          <span className="text-xs text-muted-foreground">
            {messageText.length > 0 ? `${messageText.length}` : ""}
          </span>
        </div>
        <p className="mt-1 text-xs text-muted-foreground">{t("messageForStudentsHint")}</p>

        {levelMessages.length > 0 && (
          <div className="mt-3 flex flex-col gap-2">
            <span className="text-xs font-medium text-muted-foreground">
              {t("templatesBarLabel")}
            </span>
            <div className="flex flex-wrap gap-2">
              {levelMessages.map((m) => (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => handleUseTemplate(m)}
                  className="inline-flex max-w-full items-center rounded-full border border-border bg-muted/50 px-3 py-1 text-xs font-medium transition-colors hover:bg-muted text-start"
                  title={m.body}
                >
                  <span className="truncate">{m.title}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="mt-4 space-y-2">
          <Textarea
            dir="auto"
            rows={4}
            className="resize-y rounded-xl"
            placeholder={t("messageBodyPlaceholder")}
            value={messageText}
            onChange={(e) => setMessageText(e.target.value)}
          />
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs text-muted-foreground">{t("whatsAppHint")}</p>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 rounded-full px-3 text-xs gap-1"
              onClick={() => setMessageText("")}
              disabled={!messageText}
            >
              <Eraser className="h-3.5 w-3.5" />
              {t("clearMessage")}
            </Button>
          </div>
        </div>
      </div>

      {/* Students list */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-bold">
            {lang === "ar"
              ? `${filteredStudents.length} ${t("filteredStudentsLabel")}`
              : `${filteredStudents.length} ${t("filteredStudentsLabel")}`}
          </h2>
          {filteredStudents.length > 0 && (
            <Badge variant="secondary" className="rounded-full text-xs">
              {levelFilter}
              {trackFilter ? ` · ${trackFilter}` : ""}
              {subjectFilter !== "all" ? ` · ${subjectFilter}` : ""}
            </Badge>
          )}
        </div>

        {filteredStudents.length === 0 ? (
          <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed bg-card/50 px-6 py-12 text-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-muted text-muted-foreground">
              <SearchX className="h-6 w-6" />
            </div>
            <p className="mt-3 text-sm font-medium">{t("noStudentsForFilter")}</p>
            <p className="mt-1 max-w-sm text-xs text-muted-foreground">
              {t("noResultsForFilterHint")}
            </p>
            {hasActiveFilter && (
              <Button
                variant="outline"
                size="sm"
                className="mt-4 rounded-lg"
                onClick={handleClearFilters}
              >
                <X className="me-1.5 h-4 w-4" />
                {t("clearFilters")}
              </Button>
            )}
          </div>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            {filteredStudents.map((student) => (
              <StudentMessageRow
                key={student.id}
                student={student}
                messageText={messageText}
              />
            ))}
          </div>
        )}
      </div>

      {/* Saved templates management */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-bold">
            {t("messages")} · {levelFilter}
          </h2>
          <span className="text-xs text-muted-foreground">
            {levelMessages.length} {t("subjectsCount")}
          </span>
        </div>

        {levelMessages.length === 0 ? (
          <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-border bg-card/50 px-6 py-10 text-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/10 text-primary">
              <MessageSquare className="h-6 w-6" />
            </div>
            <p className="mt-3 max-w-sm text-sm text-muted-foreground">
              {t("emptyMessages")}
            </p>
            <Button
              className="mt-4 rounded-lg"
              onClick={() => {
                setEditingMessage(null);
                setDialogOpen(true);
              }}
            >
              <Plus className="me-1.5 h-4 w-4" />
              {t("addMessage")}
            </Button>
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2">
            {levelMessages.map((message) => (
              <MessageCard
                key={message.id}
                message={message}
                onUse={handleUseTemplate}
                onEdit={(msg) => {
                  setEditingMessage(msg);
                  setDialogOpen(true);
                }}
                onDelete={setPendingDelete}
              />
            ))}
          </div>
        )}
      </div>

      <MessageFormDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        level={levelFilter}
        message={editingMessage}
      />

      <AlertDialog
        open={!!pendingDelete}
        onOpenChange={(open) => !open && setPendingDelete(null)}
      >
        <AlertDialogContent className="rounded-2xl">
          <AlertDialogHeader>
            <AlertDialogTitle>{t("confirmDeleteTitle")}</AlertDialogTitle>
            <AlertDialogDescription>{t("confirmDeleteMessage")}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="rounded-lg">{t("cancel")}</AlertDialogCancel>
            <AlertDialogAction
              className="rounded-lg bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => {
                if (pendingDelete) {
                  deleteMessage(pendingDelete.id);
                  toast.success(t("messageDeleted"));
                }
                setPendingDelete(null);
              }}
            >
              {t("delete")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
