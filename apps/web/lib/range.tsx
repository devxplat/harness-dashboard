"use client";

import { createContext, useContext, useMemo, useState } from "react";

export type Range = "7d" | "30d" | "90d" | "all";
export const RANGES: Range[] = ["7d", "30d", "90d", "all"];

/** The equal-length window immediately before `since`, for period-over-period deltas. */
export interface PreviousWindow {
  since: string;
  until: string;
}

/** Resolve a range to its `since` bound and the contiguous previous window (both from one `now`). */
function windowFor(r: Range): { since: string | null; previous: PreviousWindow | null } {
  if (r === "all") return { since: null, previous: null };
  const days = r === "7d" ? 7 : r === "30d" ? 30 : 90;
  const ms = days * 86_400_000;
  const now = Date.now();
  const since = new Date(now - ms).toISOString();
  // Previous window ends exactly where the current one starts — no overlap, equal length.
  return { since, previous: { since: new Date(now - 2 * ms).toISOString(), until: since } };
}

interface RangeCtx {
  range: Range;
  setRange: (r: Range) => void;
  since: string | null;
  previous: PreviousWindow | null;
}

const initial = windowFor("30d");
const Ctx = createContext<RangeCtx>({
  range: "30d",
  setRange: () => {},
  since: initial.since,
  previous: initial.previous,
});

export function RangeProvider({ children }: { children: React.ReactNode }) {
  const [range, setRange] = useState<Range>("30d");
  const { since, previous } = useMemo(() => windowFor(range), [range]);
  return <Ctx.Provider value={{ range, setRange, since, previous }}>{children}</Ctx.Provider>;
}

export const useRange = () => useContext(Ctx);
