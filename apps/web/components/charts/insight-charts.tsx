"use client";

import {
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import type {
  AiAdoptionDayRow,
  AiCorrelationSeriesRow,
  AiLinesRow,
  AllocationPeriodRow,
  AllocationRow,
  DeploymentTimelineRow,
  DoraTrendRow,
  LeadTimeBucketRow,
  PrCorrelationRow,
  PrCycleTimeRow,
  PrSizeBucketRow,
  ProductivityPeriodRow,
  SurveyTrendRow,
  WarmupBucketRow,
} from "@/lib/types";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ComposedChart,
  Line,
  Pie,
  PieChart,
  XAxis,
  YAxis,
} from "recharts";

const productivityConfig = {
  commits: { label: "Commits", color: "var(--chart-1)" },
  messages: { label: "Assistant messages", color: "var(--chart-2)" },
  pr_count: { label: "PRs", color: "var(--chart-4)" },
} satisfies ChartConfig;

const focusConfig = {
  focus_minutes: { label: "Focus minutes", color: "var(--chart-1)" },
  flow_minutes: { label: "Flow minutes", color: "var(--chart-2)" },
  meeting_minutes: { label: "Meeting minutes", color: "var(--chart-5)" },
} satisfies ChartConfig;

const warmupConfig = {
  count: { label: "Meetings", color: "var(--chart-4)" },
} satisfies ChartConfig;

const prConfig = {
  pr_count: { label: "PRs", color: "var(--chart-1)" },
  ai_overlap_prs: { label: "AI-overlap PRs", color: "var(--chart-2)" },
  commits: { label: "Commits", color: "var(--chart-4)" },
} satisfies ChartConfig;

const doraTrendConfig = {
  commits: { label: "Commits", color: "var(--chart-1)" },
  deploys: { label: "Deploys", color: "var(--chart-2)" },
  avg_lead_hours: { label: "Avg lead hours", color: "var(--chart-4)" },
} satisfies ChartConfig;

const leadConfig = {
  pull_requests: { label: "Pull requests", color: "var(--chart-1)" },
} satisfies ChartConfig;

const deployConfig = {
  deployments: { label: "Deployments", color: "var(--chart-2)" },
  failures: { label: "Failure proxy", color: "var(--chart-5)" },
} satisfies ChartConfig;

const aiLinesConfig = {
  ai_lines: { label: "AI lines", color: "var(--chart-1)" },
  human_lines: { label: "By hand", color: "var(--chart-3)" },
} satisfies ChartConfig;

const aiCorrelationConfig = {
  commits: { label: "Commits", color: "var(--chart-1)" },
  ai_commits: { label: "AI commits", color: "var(--chart-2)" },
  output_tokens: { label: "Output tokens", color: "var(--chart-4)" },
} satisfies ChartConfig;

const aiAdoptionConfig = {
  sessions: { label: "Sessions", color: "var(--chart-1)" },
} satisfies ChartConfig;

function periodTick(value: string): string {
  return value.length >= 10 ? value.slice(5) : value;
}

/** Daily AI-vs-by-hand churn (lines = insertions + deletions), stacked. */
export function AiLinesChart({ data }: { data: AiLinesRow[] }) {
  const rows = data.map((d) => ({
    day: d.day,
    ai_lines: d.ai_insertions + d.ai_deletions,
    human_lines: d.human_insertions + d.human_deletions,
  }));
  return (
    <ChartContainer config={aiLinesConfig} className="h-72 w-full">
      <BarChart data={rows} margin={{ top: 10, right: 12, left: 0, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" vertical={false} />
        <XAxis dataKey="day" tickFormatter={periodTick} tickLine={false} axisLine={false} tickMargin={8} />
        <YAxis allowDecimals={false} tickLine={false} axisLine={false} width={42} />
        <ChartTooltip content={<ChartTooltipContent />} />
        <ChartLegend content={<ChartLegendContent />} />
        <Bar dataKey="ai_lines" stackId="lines" fill="var(--color-ai_lines)" />
        <Bar dataKey="human_lines" stackId="lines" fill="var(--color-human_lines)" radius={[4, 4, 0, 0]} />
      </BarChart>
    </ChartContainer>
  );
}

/** Dual-axis: daily commits/AI-commits (left) vs output tokens (right). */
export function AiCorrelationChart({ data }: { data: AiCorrelationSeriesRow[] }) {
  return (
    <ChartContainer config={aiCorrelationConfig} className="h-72 w-full">
      <ComposedChart data={data} margin={{ top: 10, right: 12, left: 0, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" vertical={false} />
        <XAxis dataKey="day" tickFormatter={periodTick} tickLine={false} axisLine={false} tickMargin={8} />
        <YAxis yAxisId="left" allowDecimals={false} tickLine={false} axisLine={false} width={36} />
        <YAxis yAxisId="right" orientation="right" tickLine={false} axisLine={false} width={48} />
        <ChartTooltip content={<ChartTooltipContent />} />
        <ChartLegend content={<ChartLegendContent />} />
        <Bar yAxisId="left" dataKey="commits" fill="var(--color-commits)" radius={[4, 4, 0, 0]} />
        <Bar yAxisId="left" dataKey="ai_commits" fill="var(--color-ai_commits)" radius={[4, 4, 0, 0]} />
        <Line
          yAxisId="right"
          type="monotone"
          dataKey="output_tokens"
          stroke="var(--color-output_tokens)"
          strokeWidth={2}
          dot={false}
        />
      </ComposedChart>
    </ChartContainer>
  );
}

/** Daily AI sessions (adoption trend). */
export function AiAdoptionChart({ data }: { data: AiAdoptionDayRow[] }) {
  return (
    <ChartContainer config={aiAdoptionConfig} className="h-64 w-full">
      <BarChart data={data} margin={{ top: 10, right: 12, left: 0, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" vertical={false} />
        <XAxis dataKey="day" tickFormatter={periodTick} tickLine={false} axisLine={false} tickMargin={8} />
        <YAxis allowDecimals={false} tickLine={false} axisLine={false} width={34} />
        <ChartTooltip content={<ChartTooltipContent />} />
        <Bar dataKey="sessions" fill="var(--color-sessions)" radius={[4, 4, 0, 0]} />
      </BarChart>
    </ChartContainer>
  );
}

export function ProductivityPeriodChart({ data }: { data: ProductivityPeriodRow[] }) {
  return (
    <ChartContainer config={productivityConfig} className="h-72 w-full">
      <ComposedChart data={data} margin={{ top: 10, right: 12, left: 0, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" vertical={false} />
        <XAxis dataKey="period" tickFormatter={periodTick} tickLine={false} axisLine={false} tickMargin={8} />
        <YAxis allowDecimals={false} tickLine={false} axisLine={false} width={36} />
        <ChartTooltip content={<ChartTooltipContent />} />
        <ChartLegend content={<ChartLegendContent />} />
        <Bar dataKey="commits" fill="var(--color-commits)" radius={[4, 4, 0, 0]} />
        <Bar dataKey="messages" fill="var(--color-messages)" radius={[4, 4, 0, 0]} />
        <Line type="monotone" dataKey="pr_count" stroke="var(--color-pr_count)" strokeWidth={2} dot={false} />
      </ComposedChart>
    </ChartContainer>
  );
}

export function FocusTrendChart({ data }: { data: ProductivityPeriodRow[] }) {
  return (
    <ChartContainer config={focusConfig} className="h-72 w-full">
      <ComposedChart data={data} margin={{ top: 10, right: 12, left: 0, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" vertical={false} />
        <XAxis dataKey="period" tickFormatter={periodTick} tickLine={false} axisLine={false} tickMargin={8} />
        <YAxis allowDecimals={false} tickLine={false} axisLine={false} width={42} />
        <ChartTooltip content={<ChartTooltipContent />} />
        <ChartLegend content={<ChartLegendContent />} />
        <Bar dataKey="focus_minutes" fill="var(--color-focus_minutes)" radius={[4, 4, 0, 0]} />
        <Bar dataKey="meeting_minutes" fill="var(--color-meeting_minutes)" radius={[4, 4, 0, 0]} />
        <Line
          type="monotone"
          dataKey="flow_minutes"
          stroke="var(--color-flow_minutes)"
          strokeWidth={2}
          dot={false}
          connectNulls
        />
      </ComposedChart>
    </ChartContainer>
  );
}

export function WarmupBucketChart({ data }: { data: WarmupBucketRow[] }) {
  return (
    <ChartContainer config={warmupConfig} className="h-64 w-full">
      <BarChart data={data} margin={{ top: 10, right: 12, left: 0, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" vertical={false} />
        <XAxis dataKey="bucket" tickLine={false} axisLine={false} tickMargin={8} />
        <YAxis allowDecimals={false} tickLine={false} axisLine={false} width={34} />
        <ChartTooltip content={<ChartTooltipContent />} />
        <Bar dataKey="count" fill="var(--color-count)" radius={[4, 4, 0, 0]} />
      </BarChart>
    </ChartContainer>
  );
}

export function PrImpactChart({ data }: { data: PrCorrelationRow[] }) {
  const rows = data.slice(0, 10).map((row) => ({
    ...row,
    repo_label: row.repo_key.split(/[\\/]/).filter(Boolean).at(-1) ?? row.repo_key,
  }));
  return (
    <ChartContainer config={prConfig} className="h-72 w-full">
      <BarChart data={rows} margin={{ top: 10, right: 12, left: 0, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" vertical={false} />
        <XAxis dataKey="repo_label" tickLine={false} axisLine={false} tickMargin={8} minTickGap={18} />
        <YAxis allowDecimals={false} tickLine={false} axisLine={false} width={34} />
        <ChartTooltip content={<ChartTooltipContent labelKey="repo_key" />} />
        <ChartLegend content={<ChartLegendContent />} />
        <Bar dataKey="pr_count" fill="var(--color-pr_count)" radius={[4, 4, 0, 0]} />
        <Bar dataKey="ai_overlap_prs" fill="var(--color-ai_overlap_prs)" radius={[4, 4, 0, 0]} />
        <Bar dataKey="commits" fill="var(--color-commits)" radius={[4, 4, 0, 0]} />
      </BarChart>
    </ChartContainer>
  );
}

export function DoraTrendChart({ data }: { data: DoraTrendRow[] }) {
  return (
    <ChartContainer config={doraTrendConfig} className="h-72 w-full">
      <BarChart data={data} margin={{ top: 10, right: 12, left: 0, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" vertical={false} />
        <XAxis dataKey="period" tickFormatter={periodTick} tickLine={false} axisLine={false} tickMargin={8} />
        <YAxis allowDecimals={false} tickLine={false} axisLine={false} width={40} />
        <ChartTooltip content={<ChartTooltipContent />} />
        <ChartLegend content={<ChartLegendContent />} />
        <Bar dataKey="commits" fill="var(--color-commits)" radius={[4, 4, 0, 0]} />
        <Bar dataKey="deploys" fill="var(--color-deploys)" radius={[4, 4, 0, 0]} />
      </BarChart>
    </ChartContainer>
  );
}

export function DoraLeadTimeTrendChart({ data }: { data: DoraTrendRow[] }) {
  return (
    <ChartContainer config={doraTrendConfig} className="h-64 w-full">
      <ComposedChart data={data} margin={{ top: 10, right: 12, left: 0, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" vertical={false} />
        <XAxis dataKey="period" tickFormatter={periodTick} tickLine={false} axisLine={false} tickMargin={8} />
        <YAxis allowDecimals={false} tickLine={false} axisLine={false} width={40} />
        <ChartTooltip content={<ChartTooltipContent />} />
        <Line
          type="monotone"
          dataKey="avg_lead_hours"
          stroke="var(--color-avg_lead_hours)"
          strokeWidth={2}
          dot={false}
          connectNulls
        />
      </ComposedChart>
    </ChartContainer>
  );
}

export function LeadTimeDistributionChart({ data }: { data: LeadTimeBucketRow[] }) {
  return (
    <ChartContainer config={leadConfig} className="h-64 w-full">
      <BarChart data={data} margin={{ top: 10, right: 12, left: 0, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" vertical={false} />
        <XAxis dataKey="bucket" tickLine={false} axisLine={false} tickMargin={8} />
        <YAxis allowDecimals={false} tickLine={false} axisLine={false} width={34} />
        <ChartTooltip content={<ChartTooltipContent />} />
        <Bar dataKey="pull_requests" fill="var(--color-pull_requests)" radius={[4, 4, 0, 0]} />
      </BarChart>
    </ChartContainer>
  );
}

const allocationConfig = {
  feature: { label: "Feature", color: "var(--chart-1)" },
  fix: { label: "Fix", color: "var(--chart-2)" },
  ktlo: { label: "KTLO", color: "var(--chart-3)" },
  chore: { label: "Chore", color: "var(--chart-4)" },
  other: { label: "Other", color: "var(--chart-5)" },
} satisfies ChartConfig;

const ALLOC_KEYS = ["feature", "fix", "ktlo", "chore", "other"] as const;

/** Commit share per investment category (donut). */
export function AllocationDonutChart({ data }: { data: AllocationRow[] }) {
  const rows = data.map((d) => ({ name: d.category, value: d.commits }));
  return (
    <ChartContainer config={allocationConfig} className="mx-auto aspect-square h-72">
      <PieChart>
        <ChartTooltip content={<ChartTooltipContent nameKey="name" />} />
        <Pie data={rows} dataKey="value" nameKey="name" innerRadius={60} outerRadius={100} paddingAngle={2}>
          {rows.map((r) => (
            <Cell key={r.name} fill={`var(--color-${r.name})`} />
          ))}
        </Pie>
        <ChartLegend content={<ChartLegendContent nameKey="name" />} />
      </PieChart>
    </ChartContainer>
  );
}

/** Category mix over time (stacked area). */
export function AllocationTrendChart({ data }: { data: AllocationPeriodRow[] }) {
  return (
    <ChartContainer config={allocationConfig} className="h-72 w-full">
      <AreaChart data={data} margin={{ top: 10, right: 12, left: 0, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" vertical={false} />
        <XAxis dataKey="period" tickFormatter={periodTick} tickLine={false} axisLine={false} tickMargin={8} />
        <YAxis allowDecimals={false} tickLine={false} axisLine={false} width={34} />
        <ChartTooltip content={<ChartTooltipContent />} />
        <ChartLegend content={<ChartLegendContent />} />
        {ALLOC_KEYS.map((k) => (
          <Area
            key={k}
            type="monotone"
            dataKey={k}
            stackId="alloc"
            stroke={`var(--color-${k})`}
            fill={`var(--color-${k})`}
            fillOpacity={0.55}
          />
        ))}
      </AreaChart>
    </ChartContainer>
  );
}

const sentimentConfig = {
  avg_flow: { label: "Flow", color: "var(--chart-1)" },
  avg_satisfaction: { label: "Satisfaction", color: "var(--chart-2)" },
  commits: { label: "Commits", color: "var(--chart-4)" },
} satisfies ChartConfig;

/** DevEx sentiment (1–5, left axis) overlaid on daily commits (right axis). */
export function SentimentTrendChart({ data }: { data: SurveyTrendRow[] }) {
  return (
    <ChartContainer config={sentimentConfig} className="h-72 w-full">
      <ComposedChart data={data} margin={{ top: 10, right: 12, left: 0, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" vertical={false} />
        <XAxis dataKey="period" tickFormatter={periodTick} tickLine={false} axisLine={false} tickMargin={8} />
        <YAxis yAxisId="left" domain={[0, 5]} tickLine={false} axisLine={false} width={28} />
        <YAxis yAxisId="right" orientation="right" allowDecimals={false} tickLine={false} axisLine={false} width={36} />
        <ChartTooltip content={<ChartTooltipContent />} />
        <ChartLegend content={<ChartLegendContent />} />
        <Bar yAxisId="left" dataKey="avg_flow" fill="var(--color-avg_flow)" radius={[4, 4, 0, 0]} />
        <Bar yAxisId="left" dataKey="avg_satisfaction" fill="var(--color-avg_satisfaction)" radius={[4, 4, 0, 0]} />
        <Line
          yAxisId="right"
          type="monotone"
          dataKey="commits"
          stroke="var(--color-commits)"
          strokeWidth={2}
          dot={false}
          connectNulls
        />
      </ComposedChart>
    </ChartContainer>
  );
}

const cycleConfig = {
  pickupHours: { label: "Pickup", color: "var(--chart-2)" },
  reviewHours: { label: "Review", color: "var(--chart-4)" },
} satisfies ChartConfig;

const sizeConfig = {
  pull_requests: { label: "Pull requests", color: "var(--chart-1)" },
} satisfies ChartConfig;

/** Horizontal stacked cycle-time stages per repo (pickup → review; coding/merge n/a). */
export function PrCycleTimeChart({ data }: { data: PrCycleTimeRow[] }) {
  return (
    <ChartContainer config={cycleConfig} className="h-72 w-full">
      <BarChart
        layout="vertical"
        data={data}
        margin={{ top: 10, right: 12, left: 0, bottom: 0 }}
      >
        <CartesianGrid strokeDasharray="3 3" horizontal={false} />
        <XAxis type="number" tickLine={false} axisLine={false} tickMargin={8} />
        <YAxis
          type="category"
          dataKey="repo_key"
          width={120}
          tickLine={false}
          axisLine={false}
          tickFormatter={(v: string) => v.split(/[\\/]/).filter(Boolean).at(-1) ?? v}
        />
        <ChartTooltip content={<ChartTooltipContent />} />
        <ChartLegend content={<ChartLegendContent />} />
        <Bar dataKey="pickupHours" stackId="cycle" fill="var(--color-pickupHours)" />
        <Bar dataKey="reviewHours" stackId="cycle" fill="var(--color-reviewHours)" radius={[0, 4, 4, 0]} />
      </BarChart>
    </ChartContainer>
  );
}

/** PR size distribution by churn (insertions + deletions). */
export function PrSizeHistogramChart({ data }: { data: PrSizeBucketRow[] }) {
  return (
    <ChartContainer config={sizeConfig} className="h-64 w-full">
      <BarChart data={data} margin={{ top: 10, right: 12, left: 0, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" vertical={false} />
        <XAxis dataKey="bucket" tickLine={false} axisLine={false} tickMargin={8} />
        <YAxis allowDecimals={false} tickLine={false} axisLine={false} width={34} />
        <ChartTooltip content={<ChartTooltipContent />} />
        <Bar dataKey="pull_requests" fill="var(--color-pull_requests)" radius={[4, 4, 0, 0]} />
      </BarChart>
    </ChartContainer>
  );
}

export function DeploymentTimelineChart({ data }: { data: DeploymentTimelineRow[] }) {
  return (
    <ChartContainer config={deployConfig} className="h-64 w-full">
      <BarChart data={data} margin={{ top: 10, right: 12, left: 0, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" vertical={false} />
        <XAxis dataKey="period" tickFormatter={periodTick} tickLine={false} axisLine={false} tickMargin={8} />
        <YAxis allowDecimals={false} tickLine={false} axisLine={false} width={34} />
        <ChartTooltip content={<ChartTooltipContent />} />
        <ChartLegend content={<ChartLegendContent />} />
        <Bar dataKey="deployments" stackId="deploys" fill="var(--color-deployments)" radius={[0, 0, 4, 4]} />
        <Bar dataKey="failures" stackId="deploys" fill="var(--color-failures)" radius={[4, 4, 0, 0]} />
      </BarChart>
    </ChartContainer>
  );
}
