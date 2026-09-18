import { TriangleAlert } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { useI18n } from "@/lib/i18n";

export function OverdueBadge() {
  const { t } = useI18n();
  return (
    <Badge variant="destructive" className="rounded-full">
      {t("overdue")}
    </Badge>
  );
}

interface UnpaidWarningBadgeProps {
  /** Full tooltip text, e.g. "⚠️ لم يؤد الواجب المستحق · 200 MAD". */
  title: string;
  /** Extra tailwind classes for the surrounding context. */
  className?: string;
}

/**
 * Compact ⚠ pill reused by the attendance chip and the smart-search rows —
 * short bilingual label inside, full details via the `title` attribute.
 */
export function UnpaidWarningBadge({ title, className }: UnpaidWarningBadgeProps) {
  const { t } = useI18n();
  return (
    <Badge
      variant="outline"
      title={title}
      className={`gap-1 whitespace-nowrap rounded-full border-destructive/40 bg-destructive/10 px-1.5 py-0 text-[10px] font-bold leading-4 text-destructive ${className ?? ""}`}
    >
      <TriangleAlert className="h-3 w-3 shrink-0" />
      {t("unpaidWarningShort")}
    </Badge>
  );
}
