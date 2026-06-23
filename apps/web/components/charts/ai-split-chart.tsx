"use client";

// AI-assisted vs by-hand commits per day — a stacked bar chart over the backend's
// ai_split(Day) rows. Same ChartContainer treatment as daily-chart; excluded from
// coverage like the other recharts charts (jsdom gives charts no layout — the
// underlying counts come from lib/productivity-grid, which is unit-tested).
import {
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import type { AiSplitRow } from "@/lib/types";
import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts";

const config = {
  ai_commits: { label: "AI-assisted", color: "var(--chart-1)" },
  human_commits: { label: "By hand", color: "var(--chart-3)" },
} satisfies ChartConfig;

export function AiSplitChart({ data }: { data: AiSplitRow[] }) {
  return (
    <ChartContainer config={config} className="h-64 w-full">
      <BarChart accessibilityLayer data={data} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" vertical={false} />
        <XAxis
          dataKey="key"
          tickFormatter={(d: string) => (d.length >= 10 ? d.slice(5) : d)}
          tickLine={false}
          axisLine={false}
          tickMargin={8}
          minTickGap={16}
          fontSize={12}
        />
        <YAxis allowDecimals={false} tickLine={false} axisLine={false} width={32} fontSize={12} />
        <ChartTooltip content={<ChartTooltipContent />} />
        <ChartLegend content={<ChartLegendContent />} />
        <Bar dataKey="ai_commits" stackId="a" fill="var(--color-ai_commits)" radius={[0, 0, 4, 4]} />
        <Bar dataKey="human_commits" stackId="a" fill="var(--color-human_commits)" radius={[4, 4, 0, 0]} />
      </BarChart>
    </ChartContainer>
  );
}
