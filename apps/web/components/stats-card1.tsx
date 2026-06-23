import { TrendingDown, TrendingUp } from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

interface StatsCard1Props {
  title?: string;
  value?: string;
  /** `null` hides the trend row (e.g. no prior period to compare against). */
  change?: number | null;
  changeLabel?: string;
  className?: string;
}

const StatsCard1 = ({
  title = "Total Revenue",
  value = "$45,231.89",
  change = 20.1,
  changeLabel = "from last month",
  className,
}: StatsCard1Props) => {
  const isPositive = (change ?? 0) >= 0;

  return (
    <Card className={cn("w-full max-w-xs", className)}>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">
          {title}
        </CardTitle>
      </CardHeader>
      <CardContent>
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
            <span className="text-muted-foreground">{changeLabel}</span>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
};

export { StatsCard1 };
