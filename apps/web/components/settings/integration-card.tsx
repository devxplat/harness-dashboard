"use client";

// One integration row in the Integrations settings section — icon, name, a
// connected/not-connected badge, and the integration's own config as children.
// Visual base: shadcnblocks settings-integrations8 (the integration list item).
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";

export function IntegrationCard({
  icon,
  name,
  description,
  connected,
  statusText,
  children,
}: {
  icon: ReactNode;
  name: string;
  description: string;
  connected: boolean;
  /** Optional richer status (e.g. "Connected as octocat") shown when connected. */
  statusText?: string | null;
  children: ReactNode;
}) {
  const { t } = useTranslation();
  return (
    <div className="rounded-xl border bg-card">
      <div className="flex items-center gap-3 border-b p-4">
        <div className="flex size-10 shrink-0 items-center justify-center rounded-lg border bg-background text-foreground">
          {icon}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="font-medium">{name}</h3>
            {connected ? (
              <Badge
                variant="secondary"
                className="bg-emerald-100 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-400"
              >
                <span className="mr-1 size-1.5 rounded-full bg-current" aria-hidden />
                {t("components.integrations.connected")}
              </Badge>
            ) : (
              <Badge variant="outline" className="text-muted-foreground">
                {t("components.integrations.notConnected")}
              </Badge>
            )}
          </div>
          <p className={cn("truncate text-xs text-muted-foreground", connected && "text-foreground/70")}>
            {(connected && statusText) || description}
          </p>
        </div>
      </div>
      <div className="p-4">{children}</div>
    </div>
  );
}
