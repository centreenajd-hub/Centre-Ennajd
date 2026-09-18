import { useMemo, useState } from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useEnnajdState } from "@/hooks/use-ennajd-state";
import {
  getPricableCombosForLevel,
  getPricableCombosForLevelTrack,
  isTrackRequired,
} from "@/lib/ennajd-taxonomy";
import { useI18n } from "@/lib/i18n";
import type { GroupType, Level, Subject, Track } from "@/types/ennajd";

interface PricingTableProps {
  level: Level;
  track: Track | null;
}

export function PricingTable({ level, track }: PricingTableProps) {
  const { t } = useI18n();
  const prices = useEnnajdState((s) => s.prices);
  const setPrice = useEnnajdState((s) => s.setPrice);
  const [drafts, setDrafts] = useState<Record<string, string>>({});

  const trackRequired = isTrackRequired(level);

  const combos = useMemo(() => {
    if (trackRequired) {
      if (!track) return [];
      return getPricableCombosForLevelTrack(level, track);
    }
    return getPricableCombosForLevel(level).map((c) => ({ ...c, track: null as Track | null }));
  }, [level, track, trackRequired]);

  function comboKey(subject: Subject, comboTrack: Track | null, groupType: GroupType | null) {
    return `${level}__${comboTrack ?? "none"}__${subject}__${groupType ?? "none"}`;
  }

  function getPrice(subject: Subject, comboTrack: Track | null, groupType: GroupType | null) {
    return prices.find(
      (p) =>
        p.level === level &&
        p.subject === subject &&
        p.track === comboTrack &&
        p.groupType === groupType,
    )?.price;
  }

  function handleSave(subject: Subject, comboTrack: Track | null, groupType: GroupType | null) {
    const key = comboKey(subject, comboTrack, groupType);
    const draft = drafts[key];
    if (draft === undefined) return;
    const numeric = Number(draft);
    if (Number.isNaN(numeric) || numeric < 0) {
      toast.error(t("invalidCombination"));
      return;
    }
    setPrice({ level, subject, track: comboTrack, groupType, price: numeric });
    toast.success(t("priceSaved"));
    setDrafts((d) => {
      const next = { ...d };
      delete next[key];
      return next;
    });
  }

  if (combos.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-border bg-card/50 py-16 text-center text-muted-foreground">
        {t("noResults")}
      </div>
    );
  }

  return (
    <div className="overflow-x-auto rounded-2xl border border-border">
          <Table className="min-w-[560px]">
            <TableHeader>
          <TableRow className="bg-muted/50">
            <TableHead>{t("subject")}</TableHead>
            {trackRequired && <TableHead>{t("chooseTrack")}</TableHead>}
            <TableHead>{t("groupType")}</TableHead>
            <TableHead>{t("priceInMad")}</TableHead>
            <TableHead className="text-end">{t("save")}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {combos.map(({ subject, track: comboTrack, groupType }) => {
            const key = comboKey(subject, comboTrack, groupType);
            const current = getPrice(subject, comboTrack, groupType);
            const value = drafts[key] ?? (current !== undefined ? String(current) : "");
            return (
              <TableRow key={key}>
                <TableCell className="font-medium">{subject}</TableCell>
                {trackRequired && (
                  <TableCell>
                    {comboTrack ? (
                      <Badge variant="outline" className="rounded-full">
                        {comboTrack}
                      </Badge>
                    ) : (
                      "—"
                    )}
                  </TableCell>
                )}
                <TableCell>
                  {groupType ? (
                    <Badge
                      className="rounded-full"
                      variant={groupType === "Small" ? "default" : "outline"}
                    >
                      {groupType === "Small" ? t("small") : t("large")}
                    </Badge>
                  ) : (
                    "—"
                  )}
                </TableCell>
                <TableCell>
                  <Input
                    type="number"
                    min={0}
                    className="w-28 rounded-lg"
                    value={value}
                    onChange={(e) =>
                      setDrafts((d) => ({ ...d, [key]: e.target.value }))
                    }
                    placeholder="0"
                  />
                </TableCell>
                <TableCell className="text-end">
                  <Button
                    size="sm"
                    variant="secondary"
                    className="rounded-lg"
                    disabled={drafts[key] === undefined}
                    onClick={() => handleSave(subject, comboTrack, groupType)}
                  >
                    {t("save")}
                  </Button>
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
