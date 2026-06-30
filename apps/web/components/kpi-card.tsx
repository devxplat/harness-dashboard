import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatPct } from "@/lib/format";
import type { LucideIcon } from "lucide-react";
import { TrendingDown, TrendingUp } from "lucide-react";
import { useTranslation } from "react-i18next";

// Trend row harvested from @shadcnblocks/stats-card1, rendered muted (not
// green/red) — for a usage dashboard "more cost/tokens" is neither good nor bad.
export function KpiCard({
  label,
  value,
  hint,
  icon: Icon,
  delta,
}: {
  label: string;
  value: string;
  hint?: string;
  icon?: LucideIcon;
  /** Period-over-period change as a fraction (0.2 = +20%); null/undefined hides the row. */
  delta?: number | null;
}) {
  const { t } = useTranslation();
  return (
    <Card className="transition-all duration-200 hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-md">
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">{label}</CardTitle>
        {Icon ? <Icon className="size-4 text-muted-foreground" /> : null}
      </CardHeader>
      <CardContent>
        <div className="text-2xl font-semibold tabular-nums">{value}</div>
        {delta != null ? (
          <div className="mt-1 flex items-center gap-1 text-xs text-muted-foreground">
            {delta >= 0 ? (
              <TrendingUp className="size-3.5" aria-hidden />
            ) : (
              <TrendingDown className="size-3.5" aria-hidden />
            )}
            <span className="tabular-nums">{formatPct(delta)}</span>
            <span>{t("components.kpi.vsPrev")}</span>
          </div>
        ) : null}
        {hint ? <p className="mt-1 text-xs text-muted-foreground">{hint}</p> : null}
      </CardContent>
    </Card>
  );
}
