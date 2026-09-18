import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { useI18n } from "@/lib/i18n";

interface TrackAndGroupStepProps {
  mode: "track" | "groupType";
  value: string | null;
  onChange: (value: string) => void;
  /** When false, the Small option is hidden in groupType mode (default: true). */
  allowSmall?: boolean;
}

export function TrackAndGroupStep({
  mode,
  value,
  onChange,
  allowSmall = true,
}: TrackAndGroupStepProps) {
  const { t } = useI18n();

  const options =
    mode === "track"
      ? [
          { value: "s.x", label: "s.x" },
          { value: "s.m", label: "s.m" },
        ]
      : [
          { value: "Large", label: t("large") },
          ...(allowSmall ? [{ value: "Small", label: t("small") }] : []),
        ];

  const label = mode === "track" ? t("chooseTrack") : t("chooseGroupType");

  return (
    <div className="animate-in fade-in slide-in-from-top-1 space-y-2 duration-300">
      <p className="text-sm font-semibold text-foreground">{label}</p>
      <ToggleGroup
        type="single"
        value={value ?? undefined}
        onValueChange={(v) => v && onChange(v)}
        className="flex flex-wrap justify-start gap-2"
      >
        {options.map((opt) => (
          <ToggleGroupItem
            key={opt.value}
            value={opt.value}
            className="rounded-full border border-border px-4 py-2 text-sm data-[state=on]:border-primary data-[state=on]:bg-primary data-[state=on]:text-primary-foreground"
          >
            {opt.label}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
    </div>
  );
}