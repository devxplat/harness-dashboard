"use client";

import { Button } from "@/components/ui/button";
import { RANGES, useRange } from "@/lib/range";

export function RangeSelector() {
  const { range, setRange } = useRange();
  return (
    <div className="flex gap-1" role="group" aria-label="Time range">
      {RANGES.map((r) => (
        <Button
          key={r}
          size="sm"
          variant={r === range ? "default" : "outline"}
          aria-pressed={r === range}
          onClick={() => setRange(r)}
        >
          {r}
        </Button>
      ))}
    </div>
  );
}
