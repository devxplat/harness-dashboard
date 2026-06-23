"use client";

import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useRange } from "@/lib/range";
import { addDays, format, startOfDay } from "date-fns";
import { CalendarRange } from "lucide-react";
import { useState } from "react";
import type { DateRange } from "react-day-picker";

/** The active window as a calendar range — presets (since, open end) included. */
function activeWindow(since: string | null, until: string | null): DateRange | undefined {
  if (!since) return undefined;
  const from = new Date(since);
  // `until` is the exclusive next-midnight bound; subtract a day for the inclusive end.
  const to = until ? addDays(new Date(until), -1) : new Date();
  return { from, to };
}

function triggerLabel(range: string, since: string | null, until: string | null): string {
  if (range !== "custom" || !since || !until) return "Custom range";
  return `${format(new Date(since), "MMM d")} – ${format(addDays(new Date(until), -1), "MMM d, yyyy")}`;
}

function tooltipLabel(range: string, since: string | null, until: string | null): string {
  if (range !== "custom" || !since || !until) return "Select a custom date range";
  return `Custom range: ${triggerLabel(range, since, until)}. Click to change`;
}

export function DateRangePicker() {
  const { range, since, until, setCustom } = useRange();
  const [open, setOpen] = useState(false);
  // `draft` stays empty until the user starts picking, so the first click always
  // begins a fresh range. react-day-picker returns a *complete* same-day range
  // ({from:A,to:A}) on the very first click, so we count clicks rather than test
  // from/to to know when to close — and so a deliberate same-day range still works.
  const [draft, setDraft] = useState<DateRange | undefined>(undefined);
  const [picks, setPicks] = useState(0);

  const onOpenChange = (next: boolean) => {
    if (next) {
      setDraft(undefined);
      setPicks(0);
    }
    setOpen(next);
  };

  // 1st click sets the start (stays open); the 2nd click closes the range and
  // commits. react-day-picker auto-orders from/to, so start can't exceed end.
  // The range fills in with a color transition (see calendar day cells).
  const onSelect = (next: DateRange | undefined) => {
    const n = picks + 1;
    setPicks(n);
    setDraft(next);
    if (n >= 2 && next?.from && next?.to) {
      setCustom(startOfDay(next.from).toISOString(), startOfDay(addDays(next.to, 1)).toISOString());
      setOpen(false);
    }
  };

  const win = activeWindow(since, until);
  const modifiers: Record<string, DateRange> = {};
  if (picks === 0 && win) modifiers.preset = win; // show the active preset highlighted

  return (
    <Tooltip>
      <Popover open={open} onOpenChange={onOpenChange}>
        <TooltipTrigger asChild>
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
        </TooltipTrigger>
        <PopoverContent className="w-auto p-0" align="end">
          <Calendar
            mode="range"
            numberOfMonths={2}
            defaultMonth={win?.from ?? addDays(new Date(), -30)}
            selected={draft}
            onSelect={onSelect}
            modifiers={modifiers}
            modifiersClassNames={{ preset: "rdp-preset rounded-md bg-primary/20 text-foreground" }}
            autoFocus
          />
        </PopoverContent>
      </Popover>
      <TooltipContent side="bottom" sideOffset={8}>
        {tooltipLabel(range, since, until)}
      </TooltipContent>
    </Tooltip>
  );
}
