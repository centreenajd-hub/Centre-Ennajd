import { Download } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useEnnajdState } from "@/hooks/use-ennajd-state";
import { renderEnnajdReportPdf } from "@/lib/ennajd-report-pdf";
import { useI18n } from "@/lib/i18n";
import type { Session } from "@/types/ennajd";

interface ExportAttendanceButtonProps {
  session: Session;
}

export function ExportAttendanceButton({ session }: ExportAttendanceButtonProps) {
  const { t, lang } = useI18n();
  const students = useEnnajdState((s) => s.students);
  const attendanceRecords = useEnnajdState((s) => s.attendanceRecords);
  const payments = useEnnajdState((s) => s.payments);
  const getBasePrice = useEnnajdState((s) => s.getBasePrice);

  async function handleExport(e: React.MouseEvent) {
    e.stopPropagation();
    const now = new Date();
    const monthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
    try {
      const { fontDegraded } = await renderEnnajdReportPdf({
        sessions: [session],
        level: session.level,
        track: session.track,
        groupType: session.groupType,
        subject: session.subject,
        monthKey,
        reportTypes: ["attendance"],
        students,
        attendanceRecords,
        payments,
        basePrice: getBasePrice(session.level, session.subject, session.track, session.groupType),
        lang,
        t,
        appName: t("appName"),
      });
      if (fontDegraded) {
        toast.warning(t("exportFontDegraded"));
      }
    } catch (error) {
      console.error("[ExportAttendanceButton] PDF generation failed", error);
      toast.error(t("exportFailed"));
    }
  }

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          size="icon"
          variant="secondary"
          onClick={handleExport}
          className="h-8 w-8 rounded-full bg-primary/10 text-primary hover:bg-primary/20"
        >
          <Download className="h-4 w-4" />
        </Button>
      </TooltipTrigger>
      <TooltipContent>{t("exportAttendance")}</TooltipContent>
    </Tooltip>
  );
}