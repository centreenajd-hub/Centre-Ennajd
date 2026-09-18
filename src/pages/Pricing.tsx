import { useState } from "react";

import { PricingTable } from "@/components/pricing/PricingTable";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { isTrackRequired, LEVELS } from "@/lib/ennajd-taxonomy";
import { useI18n } from "@/lib/i18n";
import type { Level, Track } from "@/types/ennajd";

export default function Pricing() {
  const { t } = useI18n();
  const [level, setLevel] = useState<Level>("T.C");
  const [track, setTrack] = useState<Track | null>(null);

  const trackRequired = isTrackRequired(level);

  function handleLevelChange(newLevel: Level) {
    setLevel(newLevel);
    setTrack(isTrackRequired(newLevel) ? "s.x" : null);
  }

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">{t("pricing")}</h1>
        <p className="text-sm text-muted-foreground">{t("basePrice")}</p>
      </div>

      <div className="w-full sm:w-56">
        <Select value={level} onValueChange={handleLevelChange}>
          <SelectTrigger className="rounded-lg">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {LEVELS.map((lvl) => (
              <SelectItem key={lvl} value={lvl}>
                {lvl}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {trackRequired && (
        <div className="animate-in fade-in slide-in-from-top-1 space-y-2 duration-300">
          <p className="text-sm font-semibold text-foreground">{t("chooseTrack")}</p>
          <ToggleGroup
            type="single"
            value={track ?? undefined}
            onValueChange={(v) => v && setTrack(v as Track)}
            className="flex flex-wrap justify-start gap-2"
          >
            <ToggleGroupItem
              value="s.x"
              className="rounded-full border border-border px-4 py-2 text-sm data-[state=on]:border-primary data-[state=on]:bg-primary data-[state=on]:text-primary-foreground"
            >
              s.x
            </ToggleGroupItem>
            <ToggleGroupItem
              value="s.m"
              className="rounded-full border border-border px-4 py-2 text-sm data-[state=on]:border-primary data-[state=on]:bg-primary data-[state=on]:text-primary-foreground"
            >
              s.m
            </ToggleGroupItem>
          </ToggleGroup>
        </div>
      )}

      <PricingTable level={level} track={trackRequired ? track : null} />
    </div>
  );
}
