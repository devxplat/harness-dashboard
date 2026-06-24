"use client";

import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { RANGES, useRange } from "@/lib/range";
import { useTranslation } from "react-i18next";

export function RangeSelector() {
  const { t } = useTranslation();
  const { range, setRange } = useRange();
  return (
    <div className="flex gap-1" role="group" aria-label={t("topbar.customRange")}>
      {RANGES.map((r) => (
        <Tooltip key={r}>
          <TooltipTrigger asChild>
            <Button
              size="sm"
              variant={r === range ? "default" : "outline"}
              aria-pressed={r === range}
              onClick={() => setRange(r)}
            >
              {r === "all" ? t("range.all") : r}
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom" sideOffset={8}>
            {t(`rangeLabel.${r}`)}
          </TooltipContent>
        </Tooltip>
      ))}
    </div>
  );
}
