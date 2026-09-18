import { MessageCircle, Pencil, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { useI18n } from "@/lib/i18n";
import type { LevelMessage } from "@/types/ennajd";

interface MessageCardProps {
  message: LevelMessage;
  onSend?: (message: LevelMessage) => void;
  onUse?: (message: LevelMessage) => void;
  onEdit: (message: LevelMessage) => void;
  onDelete: (message: LevelMessage) => void;
}

/** Detect script so an Arabic body renders right-to-left inside the card. */
function isArabicText(text: string): boolean {
  return /[\u0590-\u05FF\u0600-\u06FF\u0750-\u077F]/.test(text);
}

export function MessageCard({ message, onSend, onUse, onEdit, onDelete }: MessageCardProps) {
  const { t } = useI18n();
  const handlePrimary = onUse ?? onSend;

  return (
    <div className="flex flex-col rounded-2xl border border-border bg-card p-4 shadow-sm transition-shadow hover:shadow-md">
      <h3 className="font-bold leading-snug">{message.title}</h3>
      <p
        dir={isArabicText(message.body) ? "rtl" : "ltr"}
        className="mt-1.5 line-clamp-3 whitespace-pre-line text-sm text-muted-foreground"
      >
        {message.body}
      </p>
      <div className="mt-4 flex items-center gap-1.5 border-t border-border pt-3">
        {handlePrimary && (
          <Button
            size="sm"
            className="me-0.5 flex-1 rounded-lg bg-success text-success-foreground hover:bg-success/90"
            onClick={() => handlePrimary(message)}
          >
            <MessageCircle className="me-1.5 h-4 w-4" />
            {onUse ? t("useTemplate") : t("sendMessage")}
          </Button>
        )}
        <Button
          variant="ghost"
          size="icon"
          className="h-9 w-9 rounded-lg"
          onClick={() => onEdit(message)}
          aria-label={t("edit")}
        >
          <Pencil className="h-4 w-4" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="h-9 w-9 rounded-lg text-destructive hover:text-destructive"
          onClick={() => onDelete(message)}
          aria-label={t("delete")}
        >
          <Trash2 className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}
