"use client";

import { createContext, useContext, useMemo, useState } from "react";

export type Range = "7d" | "30d" | "90d" | "all";
export const RANGES: Range[] = ["7d", "30d", "90d", "all"];

function sinceFor(r: Range): string | null {
  if (r === "all") return null;
  const days = r === "7d" ? 7 : r === "30d" ? 30 : 90;
  return new Date(Date.now() - days * 86_400_000).toISOString();
}

interface RangeCtx {
  range: Range;
  setRange: (r: Range) => void;
  since: string | null;
}

const Ctx = createContext<RangeCtx>({ range: "30d", setRange: () => {}, since: sinceFor("30d") });

export function RangeProvider({ children }: { children: React.ReactNode }) {
  const [range, setRange] = useState<Range>("30d");
  const since = useMemo(() => sinceFor(range), [range]);
  return <Ctx.Provider value={{ range, setRange, since }}>{children}</Ctx.Provider>;
}

export const useRange = () => useContext(Ctx);
