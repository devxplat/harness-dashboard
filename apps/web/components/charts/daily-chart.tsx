"use client";

import {
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import type { DailyRow } from "@/lib/types";
import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts";

const config = {
  input_tokens: { label: "Input", color: "var(--chart-1)" },
  output_tokens: { label: "Output", color: "var(--chart-2)" },
  cache_create_tokens: { label: "Cache write", color: "var(--chart-3)" },
} satisfies ChartConfig;

function tick(v: number): string {
  if (v >= 1e6) return v / 1e6 + "M";
  if (v >= 1e3) return v / 1e3 + "K";
  return String(v);
}

export function DailyChart({ data }: { data: DailyRow[] }) {
  return (
    <ChartContainer config={config} className="h-64 w-full">
      <BarChart accessibilityLayer data={data}>
        <CartesianGrid vertical={false} />
        <XAxis
          dataKey="day"
          tickFormatter={(d: string) => d.slice(5)}
          tickLine={false}
          axisLine={false}
          minTickGap={16}
        />
        <YAxis tickFormatter={tick} tickLine={false} axisLine={false} width={40} />
        <ChartTooltip content={<ChartTooltipContent />} />
        <ChartLegend content={<ChartLegendContent />} />
        <Bar dataKey="input_tokens" stackId="a" fill="var(--color-input_tokens)" />
        <Bar dataKey="output_tokens" stackId="a" fill="var(--color-output_tokens)" />
        <Bar dataKey="cache_create_tokens" stackId="a" fill="var(--color-cache_create_tokens)" radius={[3, 3, 0, 0]} />
      </BarChart>
    </ChartContainer>
  );
}
