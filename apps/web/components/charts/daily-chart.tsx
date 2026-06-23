"use client";

// Visual harvested from @shadcnblocks/chart-card9 (gradient stacked area),
// rewired onto real DailyRow data with K/M and day-axis formatters.
import {
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import { PROVIDERS, providerMeta } from "@/lib/providers";
import type { DailyRow } from "@/lib/types";
import { Area, AreaChart, CartesianGrid, XAxis, YAxis } from "recharts";

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
  const activeProviders = Array.from(new Set(data.map((d) => d.provider ?? "claude")));
  const multiProvider = activeProviders.length > 1;
  const chartData = multiProvider
    ? Array.from(
        data.reduce((map, d) => {
          const row = map.get(d.day) ?? { day: d.day };
          row[d.provider] =
            ((row[d.provider] as number | undefined) ?? 0) +
            d.input_tokens +
            d.output_tokens +
            d.cache_create_tokens;
          map.set(d.day, row);
          return map;
        }, new Map<string, Record<string, string | number>>()),
      ).map(([, row]) => row)
    : Array.from(
        data.reduce((map, d) => {
          const row =
            map.get(d.day) ??
            ({
              day: d.day,
              input_tokens: 0,
              output_tokens: 0,
              cache_create_tokens: 0,
            } as Record<string, string | number>);
          row.input_tokens = (row.input_tokens as number) + d.input_tokens;
          row.output_tokens = (row.output_tokens as number) + d.output_tokens;
          row.cache_create_tokens = (row.cache_create_tokens as number) + d.cache_create_tokens;
          map.set(d.day, row);
          return map;
        }, new Map<string, Record<string, string | number>>()),
      ).map(([, row]) => row);
  const chartConfig = multiProvider
    ? Object.fromEntries(
        PROVIDERS.filter((p) => activeProviders.includes(p.id)).map((p) => [
          p.id,
          { label: p.shortLabel, color: p.color },
        ]),
      )
    : config;

  return (
    <ChartContainer config={chartConfig} className="h-64 w-full">
      <AreaChart accessibilityLayer data={chartData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
        <defs>
          <linearGradient id="fillInput" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--color-input_tokens)" stopOpacity={0.4} />
            <stop offset="100%" stopColor="var(--color-input_tokens)" stopOpacity={0.1} />
          </linearGradient>
          <linearGradient id="fillOutput" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--color-output_tokens)" stopOpacity={0.4} />
            <stop offset="100%" stopColor="var(--color-output_tokens)" stopOpacity={0.1} />
          </linearGradient>
          <linearGradient id="fillCacheWrite" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--color-cache_create_tokens)" stopOpacity={0.4} />
            <stop offset="100%" stopColor="var(--color-cache_create_tokens)" stopOpacity={0.1} />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 3" vertical={false} />
        <XAxis
          dataKey="day"
          tickFormatter={(d: string) => d.slice(5)}
          tickLine={false}
          axisLine={false}
          tickMargin={8}
          minTickGap={16}
          fontSize={12}
        />
        <YAxis tickFormatter={tick} tickLine={false} axisLine={false} width={40} fontSize={12} />
        <ChartTooltip content={<ChartTooltipContent />} />
        <ChartLegend content={<ChartLegendContent />} />
        {multiProvider ? (
          activeProviders.map((id) => {
            const meta = providerMeta(id);
            return (
              <Area
                key={id}
                type="monotone"
                dataKey={id}
                stackId="provider"
                stroke={meta.color}
                fill={meta.color}
                fillOpacity={0.24}
                strokeWidth={2}
              />
            );
          })
        ) : (
          <>
            <Area
              type="monotone"
              dataKey="input_tokens"
              stackId="a"
              stroke="var(--color-input_tokens)"
              fill="url(#fillInput)"
              strokeWidth={2}
            />
            <Area
              type="monotone"
              dataKey="output_tokens"
              stackId="a"
              stroke="var(--color-output_tokens)"
              fill="url(#fillOutput)"
              strokeWidth={2}
            />
            <Area
              type="monotone"
              dataKey="cache_create_tokens"
              stackId="a"
              stroke="var(--color-cache_create_tokens)"
              fill="url(#fillCacheWrite)"
              strokeWidth={2}
            />
          </>
        )}
      </AreaChart>
    </ChartContainer>
  );
}
