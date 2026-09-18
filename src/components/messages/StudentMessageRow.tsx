import { MessageCircle, Phone, UserRound } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { buildWhatsAppLink } from "@/lib/ennajd-whatsapp";
import { useI18n } from "@/lib/i18n";
import type { Student } from "@/types/ennajd";

interface StudentMessageRowProps {
  student: Student;
  messageText: string;
}

function isArabicText(text: string): boolean {
  return /[\u0590-\u05FF\u0600-\u06FF\u0750-\u077F]/.test(text);
}

export function StudentMessageRow({ student, messageText }: StudentMessageRowProps) {
  const { t } = useI18n();
  const trimmed = messageText.trim();
  const hasText = trimmed.length > 0;
  const studentPhone = student.whatsappPhone?.trim() ?? "";
  const parentPhone = student.parentPhone?.trim() ?? "";
  const studentDisabled = !hasText || !studentPhone;
  const parentDisabled = !hasText || !parentPhone;

  function sendTo(phone: string) {
    const text = messageText.trim();
    if (!text || !phone.trim()) return;
    window.open(buildWhatsAppLink(text, phone), "_blank", "noopener,noreferrer");
    toast.success(t("whatsAppOpened"));
  }

  const titleStudent = !hasText ? t("writeMessageFirst") : !studentPhone ? t("phoneMissing") : undefined;
  const titleParent = !hasText ? t("writeMessageFirst") : !parentPhone ? t("phoneMissing") : undefined;

  const subjectsLabel =
    student.enrollments.length === 0
      ? "—"
      : student.enrollments.map((e) => e.subject).join(" · ");

  return (
    <div className="flex flex-col gap-3 rounded-2xl border border-border bg-card p-4 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p
            dir={isArabicText(`${student.firstName} ${student.lastName}`) ? "rtl" : "ltr"}
            className="truncate text-sm font-bold leading-tight"
          >
            {student.firstName} {student.lastName}
          </p>
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
            <Badge variant="secondary" className="rounded-full px-2.5 py-0.5 text-xs font-medium">
              {student.level}
            </Badge>
            {student.track && (
              <Badge variant="outline" className="rounded-full px-2 py-0.5 text-xs">
                {student.track}
              </Badge>
            )}
            <span className="text-xs text-muted-foreground">
              {student.enrollments.length} {t("subjectsCount")} · {subjectsLabel}
            </span>
          </div>
          <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
            <span className="inline-flex items-center gap-1">
              <UserRound className="h-3 w-3" />
              {studentPhone ? studentPhone : t("phoneMissing")}
            </span>
            <span className="inline-flex items-center gap-1">
              <Phone className="h-3 w-3" />
              {parentPhone ? parentPhone : t("phoneMissing")}
            </span>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <Button
          size="sm"
          className="rounded-lg bg-success text-success-foreground hover:bg-success/90 disabled:opacity-50"
          disabled={studentDisabled}
          title={titleStudent}
          onClick={() => sendTo(studentPhone)}
        >
          <MessageCircle className="me-1.5 h-4 w-4 shrink-0" />
          <span className="truncate text-xs font-semibold">{t("sendToStudent")}</span>
        </Button>
        <Button
          size="sm"
          variant="outline"
          className="rounded-lg disabled:opacity-50"
          disabled={parentDisabled}
          title={titleParent}
          onClick={() => sendTo(parentPhone)}
        >
          <Phone className="me-1.5 h-4 w-4 shrink-0" />
          <span className="truncate text-xs font-semibold">{t("sendToParent")}</span>
        </Button>
      </div>
    </div>
  );
}
