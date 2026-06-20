"use client";

import { createContext, useContext, useMemo, useState } from "react";

export type Range = "7d" | "30d" | "90d" | "all" | "custom";
/** Presets shown as buttons; "custom" is set via the date picker. */
export const RANGES: Exclude<Range, "custom">[] = ["7d", "30d", "90d", "all"];

/** The equal-length window immediately before `since`, for period-over-period deltas. */
export interface PreviousWindow {
  since: string;
  until: string;
}

interface Resolved {
  since: string | null;
  until: string | null;
  previous: PreviousWindow | null;
}

function presetWindow(r: Exclude<Range, "custom">): Resolved {
  if (r === "all") return { since: null, until: null, previous: null };
  const days = r === "7d" ? 7 : r === "30d" ? 30 : 90;
  const ms = days * 86_400_000;
  const now = Date.now();
  const since = new Date(now - ms).toISOString();
  // Previous window ends exactly where the current one starts — equal length, no overlap.
  return { since, until: null, previous: { since: new Date(now - 2 * ms).toISOString(), until: since } };
}

function customWindow(c: { since: string; until: string }): Resolved {
  const s = new Date(c.since).getTime();
  const u = new Date(c.until).getTime();
  const len = Math.max(0, u - s);
  return {
    since: c.since,
    until: c.until,
    previous: len > 0 ? { since: new Date(s - len).toISOString(), until: c.since } : null,
  };
}

interface RangeCtx {
  range: Range;
  setRange: (r: Exclude<Range, "custom">) => void;
  /** Switch to a custom window (ISO timestamps). */
  setCustom: (since: string, until: string) => void;
  since: string | null;
  until: string | null;
  previous: PreviousWindow | null;
}

const initial = presetWindow("30d");
const Ctx = createContext<RangeCtx>({
  range: "30d",
  setRange: () => {},
  setCustom: () => {},
  since: initial.since,
  until: initial.until,
  previous: initial.previous,
});

export function RangeProvider({ children }: { children: React.ReactNode }) {
  const [range, setRangeState] = useState<Range>("30d");
  const [custom, setCustomState] = useState<{ since: string; until: string } | null>(null);

  const setRange = (r: Exclude<Range, "custom">) => setRangeState(r);
  const setCustom = (since: string, until: string) => {
    setCustomState({ since, until });
    setRangeState("custom");
  };

  const { since, until, previous } = useMemo<Resolved>(() => {
    if (range === "custom" && custom) return customWindow(custom);
    return presetWindow(range === "custom" ? "30d" : range);
  }, [range, custom]);

  return (
    <Ctx.Provider value={{ range, setRange, setCustom, since, until, previous }}>
      {children}
    </Ctx.Provider>
  );
}

export const useRange = () => useContext(Ctx);
