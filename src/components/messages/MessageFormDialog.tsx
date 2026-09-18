import { useEffect, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useEnnajdState } from "@/hooks/use-ennajd-state";
import { useI18n } from "@/lib/i18n";
import type { Level, LevelMessage } from "@/types/ennajd";

interface MessageFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  level: Level;
  message?: LevelMessage | null;
}

export function MessageFormDialog({
  open,
  onOpenChange,
  level,
  message,
}: MessageFormDialogProps) {
  const { t } = useI18n();
  const addMessage = useEnnajdState((s) => s.addMessage);
  const updateMessage = useEnnajdState((s) => s.updateMessage);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");

  useEffect(() => {
    if (message) {
      setTitle(message.title);
      setBody(message.body);
    } else {
      setTitle("");
      setBody("");
    }
  }, [message, open]);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmedTitle = title.trim();
    const trimmedBody = body.trim();
    if (!trimmedTitle || !trimmedBody) {
      toast.error(t("required"));
      return;
    }

    if (message) {
      updateMessage(message.id, { title: trimmedTitle, body: trimmedBody });
    } else {
      addMessage({ level, title: trimmedTitle, body: trimmedBody });
    }
    toast.success(t("messageSaved"));
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl rounded-2xl">
        <DialogHeader>
          <DialogTitle>
            {message ? t("editMessage") : t("addMessage")}
          </DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <Label>{t("messageTitle")}</Label>
            <Input
              type="text"
              dir="auto"
              className="rounded-lg"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={t("messageTitlePlaceholder")}
              autoFocus
            />
          </div>
          <div className="space-y-1.5">
            <Label>{t("messageBody")}</Label>
            <Textarea
              dir="auto"
              rows={5}
              className="resize-y rounded-lg"
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder={t("messageBodyPlaceholder")}
            />
          </div>
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
