import { useState } from "react";
import { CalendarIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useI18n } from "@/lib/i18n";

interface SmallGroupInlineEditProps {
  /** ISO date of the student's current first session for this subject. */
  initialDateIso: string;
  initialPhone: string;
  onSave: (p: { dateIso: string; phone: string }) => void;
  onCancel: () => void;
}

function parseDate(iso: string): Date | undefined {
  const d = new Date(iso);
  return isNaN(d.getTime()) ? undefined : d;
}

function formatDisplay(date: Date): string {
  const dd = String(date.getDate()).padStart(2, "0");
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const yyyy = date.getFullYear();
  return `${dd}/${mm}/${yyyy}`;
}

export function SmallGroupInlineEdit({
  initialDateIso,
  initialPhone,
  onSave,
  onCancel,
}: SmallGroupInlineEditProps) {
  const { t } = useI18n();
  const [date, setDate] = useState<Date | undefined>(parseDate(initialDateIso));
  const [phone, setPhone] = useState(initialPhone);
  const [open, setOpen] = useState(false);

  function handleSave() {
    if (!date) return;
    // Local noon — the calendar day survives any timezone round-trip.
    const iso = new Date(
      date.getFullYear(),
      date.getMonth(),
      date.getDate(),
      12, 0, 0, 0,
    ).toISOString();
    onSave({ dateIso: iso, phone });
  }

  return (
    <div className="space-y-3 rounded-xl border border-border bg-muted/30 p-3">
      <div className="space-y-1">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          {t("firstSessionDate")}
        </p>
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild>
            <Button
              variant="outline"
              className="w-full justify-start gap-2 rounded-lg text-left font-normal"
            >
              <CalendarIcon className="h-4 w-4 shrink-0" />
              {date ? formatDisplay(date) : t("pickDate")}
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-auto p-0" align="start">
            {/* Past dates are allowed: the first session may have already
             * happened — the admin back-dates it and the cycle starts there. */}
            <Calendar
              mode="single"
              selected={date}
              onSelect={(selected) => {
                if (selected) {
                  setDate(selected);
                  setOpen(false);
                }
              }}
              initialFocus
            />
          </PopoverContent>
        </Popover>
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
