import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useI18n } from "@/lib/i18n";

interface SmallGroupInlineEditProps {
  initialDay: string;
  initialMonth: string;
  initialYear: string;
  initialPhone: string;
  onSave: (p: { day: string; month: string; year: string; phone: string }) => void;
  onCancel: () => void;
}

export function SmallGroupInlineEdit({
  initialDay,
  initialMonth,
  initialYear,
  initialPhone,
  onSave,
  onCancel,
}: SmallGroupInlineEditProps) {
  const { t } = useI18n();
  const [day, setDay] = useState(initialDay);
  const [month, setMonth] = useState(initialMonth);
  const [year, setYear] = useState(initialYear);
  const [phone, setPhone] = useState(initialPhone);

  function handleSave() {
    if (!day || !month || !year) return;
    onSave({ day, month, year, phone });
  }

  return (
    <div className="space-y-3 rounded-xl border border-border bg-muted/30 p-3">
      <div className="space-y-1">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          DATE DE LA PREMIÈRE SÉANCE
        </p>
        <div className="flex gap-2">
          <Input
            inputMode="numeric"
            placeholder="DD"
            value={day}
            onChange={(e) => setDay(e.target.value.replace(/\D/g, "").slice(0, 2))}
            className="h-9 w-16 rounded-lg text-center"
          />
          <Input
            inputMode="numeric"
            placeholder="MM"
            value={month}
            onChange={(e) => setMonth(e.target.value.replace(/\D/g, "").slice(0, 2))}
            className="h-9 w-16 rounded-lg text-center"
          />
          <Input
            inputMode="numeric"
            placeholder="YYYY"
            value={year}
            onChange={(e) => setYear(e.target.value.replace(/\D/g, "").slice(0, 4))}
            className="h-9 w-24 rounded-lg text-center"
          />
        </div>
      </div>
      <div className="space-y-1">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          {t("phoneLabel")}
        </p>
        <Input
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          placeholder="0678784898"
          className="h-9 rounded-lg"
        />
      </div>
      <div className="flex gap-2">
        <Button size="sm" className="rounded-full bg-success text-white hover:bg-success/90" onClick={handleSave}>
          ✓ {t("saveEdit")}
        </Button>
        <Button size="sm" variant="ghost" className="rounded-full" onClick={onCancel}>
          ✕ {t("cancel")}
        </Button>
      </div>
    </div>
  );
}
