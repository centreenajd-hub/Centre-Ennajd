import { useMemo } from "react";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";

interface MonthYearPickerProps {
  monthKey: string; // "YYYY-MM"
  onChange: (monthKey: string) => void;
}

export function MonthYearPicker({ monthKey, onChange }: MonthYearPickerProps) {
  const { t, lang } = useI18n();
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

  return (
    <div className="space-y-3 rounded-2xl border border-border bg-card p-4 shadow-sm">
      <div className="space-y-1.5">
        <Label className="text-xs text-muted-foreground">{t("selectMonth")}</Label>
        <Select
          value={String(year)}
          onValueChange={(v) => onChange(`${v}-${String(month).padStart(2, "0")}`)}
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
              onClick={() => onChange(`${year}-${String(m.index).padStart(2, "0")}`)}
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
      <p className="text-[11px] leading-snug text-muted-foreground">{t("monthYearCaption")}</p>
    </div>
  );
}