"use client";

import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useRange } from "@/lib/range";
import { addDays, format, startOfDay } from "date-fns";
import { CalendarRange } from "lucide-react";
import { useState } from "react";
import type { DateRange } from "react-day-picker";

/** Label for the trigger: the active custom window, or a prompt to pick one. */
function triggerLabel(range: string, since: string | null, until: string | null): string {
  if (range !== "custom" || !since || !until) return "Custom range";
  // `until` is the exclusive next-midnight bound; subtract a day for the inclusive end.
  return `${format(new Date(since), "MMM d")} – ${format(addDays(new Date(until), -1), "MMM d, yyyy")}`;
}

export function DateRangePicker() {
  const { range, since, until, setCustom } = useRange();
  const [open, setOpen] = useState(false);

  const selected: DateRange | undefined =
    range === "custom" && since && until
      ? { from: new Date(since), to: addDays(new Date(until), -1) }
      : undefined;

  const onSelect = (next: DateRange | undefined) => {
    if (!next?.from || !next?.to) return;
    // SQL bound is `timestamp < until`, so the exclusive end is the midnight after `to`.
    setCustom(startOfDay(next.from).toISOString(), startOfDay(addDays(next.to, 1)).toISOString());
    setOpen(false);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          size="sm"
          variant={range === "custom" ? "default" : "outline"}
          aria-label="Pick a custom date range"
        >
          <CalendarRange className="size-3.5" />
          {triggerLabel(range, since, until)}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0" align="end">
        <Calendar
          mode="range"
          numberOfMonths={2}
          defaultMonth={selected?.from ?? addDays(new Date(), -30)}
          selected={selected}
          onSelect={onSelect}
          autoFocus
        />
      </PopoverContent>
    </Popover>
  );
}
