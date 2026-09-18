import { FileText } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useEnnajdState } from "@/hooks/use-ennajd-state";
import { renderEnnajdStudentReceiptPdf } from "@/lib/ennajd-report-pdf";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import type { Student, Subject } from "@/types/ennajd";

function currentMonthKey(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

interface StudentReceiptDialogProps {
  student: Student;
}

export function StudentReceiptDialog({ student }: StudentReceiptDialogProps) {
  const { t, lang } = useI18n();

  const [open, setOpen] = useState(false);
  const [subject, setSubject] = useState<Subject | undefined>(student.enrollments[0]?.subject);
  const [monthKey, setMonthKey] = useState(currentMonthKey());
  const [isGenerating, setIsGenerating] = useState(false);

  const locale = lang === "ar" ? "ar" : "fr-FR";
  const [year, month] = monthKey.split("-").map(Number);

  const years = useMemo(() => {
    const current = new Date().getFullYear();
    return [current - 1, current, current + 1];
  }, []);

  const months = useMemo(
    () =>
      Array.from({ length: 12 }, (_, i) => ({
        index: i + 1,
        label: new Date(2024, i, 1).toLocaleDateString(locale, { month: "short" }),
      })),
    [locale],
  );

  const selectedEnrollment = student.enrollments.find((e) => e.subject === subject);

  async function handleGenerate() {
    if (!subject || !selectedEnrollment) return;
    setIsGenerating(true);
    try {
      // Read lazily instead of subscribing: one dialog is mounted per
      // Students-table row, but this data is only needed on click.
      const { sessions, attendanceRecords, payments } = useEnnajdState.getState();
      const { fontDegraded } = await renderEnnajdStudentReceiptPdf({
        student,
        subject,
        monthKey,
        payments,
        attendanceRecords,
        sessions,
        level: student.level,
        track: selectedEnrollment.track,
        groupType: selectedEnrollment.groupType,
        appName: t("appName"),
        lang,
        t,
      });
      if (fontDegraded) {
        toast.warning(t("exportFontDegraded"));
      } else {
        toast.success(t("exportSuccess"));
      }
      setOpen(false);
    } catch (error) {
      console.error("[StudentReceiptDialog] PDF generation failed", error);
      toast.error(t("exportFailed"));
    } finally {
      setIsGenerating(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8 rounded-lg"
          onClick={(e) => e.stopPropagation()}
          title={t("printReceipt")}
        >
          <FileText className="h-4 w-4" />
        </Button>
      </DialogTrigger>
      <DialogContent className="rounded-2xl">
        <DialogHeader>
          <DialogTitle>{t("receiptDialogTitle")}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {student.enrollments.length > 1 && (
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">{t("selectSubjectForReceipt")}</Label>
              <Select value={subject} onValueChange={(v: Subject) => setSubject(v)}>
                <SelectTrigger className="rounded-lg">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {student.enrollments.map((e) => (
                    <SelectItem key={e.subject} value={e.subject}>
                      {e.subject}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">{t("selectMonth")}</Label>
            <Select
              value={String(year)}
              onValueChange={(v) => setMonthKey(`${v}-${String(month).padStart(2, "0")}`)}
            >
              <SelectTrigger className="rounded-lg">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {years.map((y) => (
                  <SelectItem key={y} value={String(y)}>
                    {y}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-3 gap-1.5">
            {months.map((m) => {
              const isSelected = m.index === month;
              return (
                <button
                  key={m.index}
                  type="button"
                  onClick={() => setMonthKey(`${year}-${String(m.index).padStart(2, "0")}`)}
                  className={cn(
                    "rounded-lg px-2 py-2 text-xs font-medium capitalize transition-colors",
                    isSelected
                      ? "bg-primary text-primary-foreground"
                      : "bg-secondary text-secondary-foreground hover:bg-secondary/70",
                  )}
                >
                  {m.label}
                </button>
              );
            })}
          </div>
        </div>

        <DialogFooter>
          <Button
            type="button"
            onClick={handleGenerate}
            disabled={!subject || isGenerating}
            className="rounded-lg"
          >
            {isGenerating ? "…" : t("generateReceipt")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
