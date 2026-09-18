import { Download } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { useI18n } from "@/lib/i18n";

interface ReportTypeAndExportCardProps {
  attendanceChecked: boolean;
  paymentsChecked: boolean;
  onAttendanceChange: (checked: boolean) => void;
  onPaymentsChange: (checked: boolean) => void;
  onGenerate: () => void;
  disabled: boolean;
  isGenerating: boolean;
}

export function ReportTypeAndExportCard({
  attendanceChecked,
  paymentsChecked,
  onAttendanceChange,
  onPaymentsChange,
  onGenerate,
  disabled,
  isGenerating,
}: ReportTypeAndExportCardProps) {
  const { t } = useI18n();
  const bothChecked = attendanceChecked && paymentsChecked;

  function handleBothChange(checked: boolean) {
    onAttendanceChange(checked);
    onPaymentsChange(checked);
  }

  return (
    <div className="animate-in fade-in space-y-4 rounded-2xl border border-border bg-card p-4 shadow-sm duration-300">
      <div className="flex flex-wrap items-center gap-4">
        <label className="flex items-center gap-2 text-sm font-medium">
          <Checkbox
            checked={attendanceChecked}
            onCheckedChange={(v) => onAttendanceChange(!!v)}
          />
          {t("attendanceReport")}
        </label>
        <label className="flex items-center gap-2 text-sm font-medium">
          <Checkbox checked={paymentsChecked} onCheckedChange={(v) => onPaymentsChange(!!v)} />
          {t("paymentsReport")}
        </label>
        <label className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
                  <Checkbox checked={bothChecked} onCheckedChange={(v) => handleBothChange(!!v)} />
                  {t("bothReports")}
                </label>
              </div>
      <Button
        type="button"
        onClick={onGenerate}
        disabled={disabled || isGenerating}
        className="w-full gap-2 rounded-xl bg-primary text-primary-foreground hover:bg-primary/90 sm:w-auto"
      >
        <Download className="h-4 w-4" />
        {isGenerating ? "…" : t("generatePdf")}
      </Button>
    </div>
  );
}
