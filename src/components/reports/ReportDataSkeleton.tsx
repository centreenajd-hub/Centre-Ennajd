import { Skeleton } from "@/components/ui/skeleton";
import { useI18n } from "@/lib/i18n";

/**
 * Shown while the atomic hydration barrier (`isDataReady`) has not yet
 * flipped — i.e. the billing datasets are still in flight from Supabase.
 * Renders shimmering placeholder rows instead of a matrix table so the
 * user never sees zeroed / blank cells built from a half-empty store.
 */
export function ReportDataSkeleton() {
  const { t } = useI18n();

  return (
    <div className="space-y-3 rounded-2xl border border-border bg-card p-4 shadow-sm">
      <div className="flex items-center justify-between">
        <Skeleton className="h-5 w-40" />
        <Skeleton className="h-5 w-24" />
      </div>
      <div className="space-y-2">
        {Array.from({ length: 6 }).map((_, index) => (
          <div key={index} className="flex items-center gap-3">
            <Skeleton className="h-9 w-40 shrink-0" />
            {Array.from({ length: 5 }).map((_, cellIndex) => (
              <Skeleton
                key={cellIndex}
                className="h-9 flex-1"
                style={{ animationDelay: `${index * 60 + cellIndex * 40}ms` }}
              />
            ))}
          </div>
        ))}
      </div>
      <p className="pt-1 text-center text-xs text-muted-foreground">
        {t("loadingReportData")}
      </p>
    </div>
  );
}
