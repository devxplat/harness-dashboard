"use client";

import { useId } from "react";
import { TrendingDown, TrendingUp } from "lucide-react";
import { Area, AreaChart, ResponsiveContainer } from "recharts";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

interface StatsCard2Props {
  title?: string;
  value?: string;
  data?: { value: number }[];
  /** Sparkline stroke/fill color (any CSS color or var). */
  color?: string;
  /** Period-over-period change (percent). `null`/undefined hides the trend row. */
  change?: number | null;
  changeLabel?: string;
  className?: string;
}

const defaultData = [
  { value: 186 },
  { value: 305 },
  { value: 237 },
  { value: 273 },
  { value: 209 },
  { value: 314 },
  { value: 290 },
];

const StatsCard2 = ({
  title = "Active Users",
  value = "2,350",
  data = defaultData,
  color = "var(--chart-1)",
  change = null,
  changeLabel,
  className,
}: StatsCard2Props) => {
  // Unique per instance so multiple sparklines on one page don't share a gradient.
  const gradientId = useId();
  const isPositive = (change ?? 0) >= 0;
  return (
    <Card className={cn("w-full max-w-xs", className)}>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">
          {title}
        </CardTitle>
      </CardHeader>
      <CardContent className="pb-4">
        <div className="text-3xl font-bold">{value}</div>
        {change != null ? (
          <div className="mt-1 flex items-center gap-1 text-sm">
            {isPositive ? (
              <TrendingUp className="size-4 text-green-500" />
            ) : (
              <TrendingDown className="size-4 text-red-500" />
            )}
            <span className={isPositive ? "text-green-500" : "text-red-500"}>
              {isPositive ? "+" : ""}
              {change}%
            </span>
            {changeLabel ? <span className="text-muted-foreground">{changeLabel}</span> : null}
          </div>
        ) : null}
        <div className="mt-3 h-16">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={data}>
              <defs>
                <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={color} stopOpacity={0.3} />
                  <stop offset="100%" stopColor={color} stopOpacity={0} />
                </linearGradient>
              </defs>
              <Area
                type="monotone"
                dataKey="value"
                stroke={color}
                strokeWidth={2}
                fill={`url(#${gradientId})`}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </CardContent>
    </Card>
  );
};

export { StatsCard2 };
