import { addMonthsClamped, formatDateKey } from "@/lib/ennajd-billing";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";

interface SmallGroupPeriodsTableProps {
  enrolledAt: string; // ISO date
  todayKey: string; // YYYY-MM-DD
  monthsToShow?: number; // default 12
}

function formatDisplayDate(d: Date): string {
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const yyyy = d.getFullYear();
  return `${dd}/${mm}/${yyyy}`;
}

function toDateKey(d: Date): string {
  return formatDateKey(d);
}

export function SmallGroupPeriodsTable({
  enrolledAt,
  todayKey,
  monthsToShow = 12,
}: SmallGroupPeriodsTableProps) {
  const { t } = useI18n();
  const base = new Date(enrolledAt);
  if (isNaN(base.getTime())) return null;

  const rows = Array.from({ length: monthsToShow }, (_, i) => {
    const du = addMonthsClamped(base, i);
    const au = addMonthsClamped(base, i + 1);
    // period N covers [DU, AU) — AU is next period's start, but display inclusive AU-1? Plan says DU = enrolled+ (i-1) and AU = enrolled+ i
    // We keep as computed: Période 1: DU=24/02 AU=24/03 etc.
    const duKey = toDateKey(du);
    const auKey = toDateKey(au);
    // Current period: todayKey >= DU and < AU (and for last row, still highlight if >= DU)
    const isCurrent =
      todayKey >= duKey && (i === monthsToShow - 1 ? true : todayKey < auKey);
    return { n: i + 1, du, au, duLabel: formatDisplayDate(du), auLabel: formatDisplayDate(au), isCurrent };
  });

  return (
    <div className="overflow-hidden rounded-xl border border-border bg-card">
      <div className="grid grid-cols-3 bg-muted/50 px-3 py-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
        <span>PÉRIODE</span>
        <span className="text-center">{t("periodDu")}</span>
        <span className="text-center">{t("periodAu")}</span>
      </div>
      <div className="divide-y divide-border">
        {rows.map((r) => (
          <div
            key={r.n}
            className={cn(
              "grid grid-cols-3 items-center px-3 py-2 text-sm",
              r.isCurrent && "bg-teal-50 font-bold text-teal-700 dark:bg-teal-950/30 dark:text-teal-300"
            )}
          >
            <span className="text-xs font-medium">Période {r.n}</span>
            <span className="text-center tabular-nums text-xs sm:text-sm">{r.duLabel}</span>
            <span className="text-center tabular-nums text-xs sm:text-sm">{r.auLabel}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
