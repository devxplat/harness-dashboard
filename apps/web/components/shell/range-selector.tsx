"use client";

import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { RANGES, useRange } from "@/lib/range";

const RANGE_TOOLTIP: Record<(typeof RANGES)[number], string> = {
  "7d": "Last 7 days",
  "30d": "Last 30 days",
  "90d": "Last 90 days",
  all: "All local history",
};

export function RangeSelector() {
  const { range, setRange } = useRange();
  return (
    <div className="flex gap-1" role="group" aria-label="Time range">
      {RANGES.map((r) => (
        <Tooltip key={r}>
          <TooltipTrigger asChild>
            <Button
              size="sm"
              variant={r === range ? "default" : "outline"}
              aria-pressed={r === range}
              onClick={() => setRange(r)}
            >
              {r}
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom" sideOffset={8}>
            {RANGE_TOOLTIP[r]}
          </TooltipContent>
        </Tooltip>
      ))}
    </div>
  );
}
