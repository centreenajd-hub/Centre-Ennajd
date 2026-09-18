import { useState } from "react";
import { Pencil, Trash2 } from "lucide-react";
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
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useEnnajdState } from "@/hooks/use-ennajd-state";
import { isOneOffSession } from "@/lib/ennajd-taxonomy";
import { useI18n } from "@/lib/i18n";
import type { Session } from "@/types/ennajd";

const DAY_KEYS = [
  "sunday",
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
] as const;

interface SessionTableProps {
  sessions: Session[];
  onEdit: (session: Session) => void;
}

export function SessionTable({ sessions, onEdit }: SessionTableProps) {
  const { t } = useI18n();
  const deleteSession = useEnnajdState((s) => s.deleteSession);
  const [pendingDelete, setPendingDelete] = useState<Session | null>(null);

  if (sessions.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-border bg-card/50 py-16 text-center text-muted-foreground">
        {t("noResults")}
      </div>
    );
  }

  return (
    <>
      <div className="hidden sm:block overflow-x-auto rounded-2xl border border-border">
              <Table className="min-w-[860px]">
                <TableHeader>
            <TableRow className="bg-muted/50">
              <TableHead>{t("subject")}</TableHead>
              <TableHead>{t("level")}</TableHead>
              <TableHead>{t("track")}</TableHead>
              <TableHead>{t("groupType")}</TableHead>
              <TableHead>{t("dayOfWeek")}</TableHead>
              <TableHead>{t("sessionType")}</TableHead>
              <TableHead>{t("startTime")}</TableHead>
              <TableHead className="text-end">{t("edit")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {sessions.map((session) => {
              const isExtra = isOneOffSession(session);
              return (
                <TableRow key={session.id}>
                  <TableCell className="font-medium">{session.subject}</TableCell>
                  <TableCell>
                    <Badge variant="secondary" className="rounded-full">
                      {session.level}
                    </Badge>
                  </TableCell>
                  <TableCell>{session.track ?? "—"}</TableCell>
                  <TableCell>
                    {session.groupType ? (
                      <Badge
                        className="rounded-full"
                        variant={session.groupType === "Small" ? "default" : "outline"}
                      >
                        {session.groupType === "Small" ? t("small") : t("large")}
                      </Badge>
                    ) : (
                      "—"
                    )}
                  </TableCell>
                  <TableCell>{t(DAY_KEYS[session.dayOfWeek])}</TableCell>
                  <TableCell>
                    {isExtra ? (
                      <Badge className="rounded-full bg-accent text-accent-foreground">
                        {t("extra")} · {session.date ? session.date.slice(5).replace("-", "/") : ""}
                      </Badge>
                    ) : (
                      <Badge variant="secondary" className="rounded-full">
                        {t("fix")}
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell>
                    {session.startTime}–{session.endTime}
                  </TableCell>
                  <TableCell className="text-end">
                    <div className="flex justify-end gap-1">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 rounded-lg"
                        onClick={() => onEdit(session)}
                      >
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 rounded-lg text-destructive hover:text-destructive"
                        onClick={() => setPendingDelete(session)}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>

      <div className="grid gap-3 sm:hidden">
        {sessions.map((session) => {
          const isExtra = isOneOffSession(session);
          return (
            <div
              key={session.id}
              className={
                isExtra
                  ? "rounded-2xl border border-accent/40 bg-accent/10 p-4 shadow-sm"
                  : "rounded-2xl border border-border bg-card p-4 shadow-sm"
              }
            >
              <div className="flex items-start justify-between">
                <div>
                  <p className="font-semibold flex items-center gap-2">
                    {session.subject}
                    {isExtra ? (
                      <Badge className="rounded-full bg-accent text-accent-foreground text-[10px] px-1.5 py-0">
                        {t("extra")} · {session.date ? session.date.slice(5).replace("-", "/") : ""}
                      </Badge>
                    ) : (
                      <Badge variant="secondary" className="rounded-full text-[10px] px-1.5 py-0">
                        {t("fix")}
                      </Badge>
                    )}
                  </p>
                </div>
                <div className="flex gap-1">
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 rounded-lg"
                    onClick={() => onEdit(session)}
                  >
                    <Pencil className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 rounded-lg text-destructive hover:text-destructive"
                    onClick={() => setPendingDelete(session)}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </div>
              <div className="mt-3 flex flex-wrap gap-1.5">
                <Badge variant="secondary" className="rounded-full">
                  {session.level}
                </Badge>
                {session.track && (
                  <Badge variant="outline" className="rounded-full">
                    {session.track}
                  </Badge>
                )}
                {session.groupType && (
                  <Badge className="rounded-full">
                    {session.groupType === "Small" ? t("small") : t("large")}
                  </Badge>
                )}
              </div>
              <p className="mt-2 text-sm text-muted-foreground">
                {t(DAY_KEYS[session.dayOfWeek])} · {session.startTime}–
                {session.endTime}
              </p>
            </div>
          );
        })}
      </div>

      <AlertDialog
        open={!!pendingDelete}
        onOpenChange={(open) => !open && setPendingDelete(null)}
      >
        <AlertDialogContent className="rounded-2xl">
          <AlertDialogHeader>
            <AlertDialogTitle>{t("confirmDeleteTitle")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("confirmDeleteSession")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="rounded-lg">
              {t("cancel")}
            </AlertDialogCancel>
            <AlertDialogAction
              className="rounded-lg bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => {
                if (pendingDelete) {
                  deleteSession(pendingDelete.id);
                  toast.success(t("sessionDeleted"));
                }
                setPendingDelete(null);
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
