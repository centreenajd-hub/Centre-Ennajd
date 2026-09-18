import { useState } from "react";
import { RefreshCw } from "lucide-react";
import { toast } from "sonner";

import { ReportGenerator } from "@/components/reports/ReportGenerator";
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
import { Button } from "@/components/ui/button";
import { useEnnajdState } from "@/hooks/use-ennajd-state";
import { useI18n } from "@/lib/i18n";

export default function Reports() {
  const { t } = useI18n();
  const regeneratePaymentLedger = useEnnajdState((s) => s.regeneratePaymentLedger);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [isRecalculating, setIsRecalculating] = useState(false);

  async function handleRecalculate() {
    setConfirmOpen(false);
    setIsRecalculating(true);
    try {
      const ok = await regeneratePaymentLedger();
      if (ok) toast.success(t("installmentsRecalculated"));
    } finally {
      setIsRecalculating(false);
    }
  }

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{t("reportGenerator")}</h1>
          <p className="text-sm text-muted-foreground">{t("reportGeneratorSubtitle")}</p>
        </div>
        <Button
          variant="outline"
          className="rounded-xl"
          disabled={isRecalculating}
          onClick={() => setConfirmOpen(true)}
        >
          <RefreshCw className={isRecalculating ? "animate-spin" : undefined} />
          {t("recalculateInstallments")}
        </Button>
      </div>
      <ReportGenerator />

      <AlertDialog open={confirmOpen} onOpenChange={(o) => !o && setConfirmOpen(false)}>
        <AlertDialogContent className="rounded-2xl">
          <AlertDialogHeader>
            <AlertDialogTitle>{t("recalculateInstallments")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("recalculateInstallmentsConfirm")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="rounded-lg">{t("cancel")}</AlertDialogCancel>
            <AlertDialogAction
              className="rounded-lg"
              onClick={(e) => {
                e.preventDefault();
                void handleRecalculate();
              }}
            >
              {t("save")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
