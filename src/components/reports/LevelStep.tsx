import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { LEVELS } from "@/lib/ennajd-taxonomy";
import { useI18n } from "@/lib/i18n";
import type { Level } from "@/types/ennajd";

interface LevelStepProps {
  value: Level | null;
  onChange: (level: Level) => void;
}

export function LevelStep({ value, onChange }: LevelStepProps) {
  const { t } = useI18n();

  return (
    <div className="animate-in fade-in slide-in-from-top-1 space-y-2 duration-300">
      <p className="text-sm font-semibold text-foreground">{t("chooseLevel")}</p>
      <ToggleGroup
        type="single"
        value={value ?? undefined}
        onValueChange={(v) => v && onChange(v as Level)}
        className="flex flex-wrap justify-start gap-2"
      >
        {LEVELS.map((lvl) => (
          <ToggleGroupItem
            key={lvl}
            value={lvl}
            className="rounded-full border border-border px-4 py-2 text-sm data-[state=on]:border-primary data-[state=on]:bg-primary data-[state=on]:text-primary-foreground"
          >
            {lvl}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
    </div>
  );
}