"use client";

import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { PROVIDERS, providerMeta } from "@/lib/providers";
import { cn } from "@/lib/utils";

export function ProviderBadge({
  provider,
  className,
  compact = false,
}: {
  provider: string | null | undefined;
  className?: string;
  compact?: boolean;
}) {
  const meta = providerMeta(provider);
  const Icon = meta.Icon;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[11px] font-medium leading-none",
        className,
      )}
      style={{ color: meta.color, backgroundColor: meta.bg, borderColor: meta.border }}
    >
      <Icon className="size-3" />
      {compact ? meta.shortLabel : meta.label}
    </span>
  );
}

export function ProviderBlips({
  providers,
  className,
}: {
  providers: (string | null | undefined)[];
  className?: string;
}) {
  const ordered = PROVIDERS.map((p) => p.id).filter((id) => providers.includes(id));

  return (
    <TooltipProvider delayDuration={120}>
      <span className={cn("flex items-center -space-x-1", className)}>
        {ordered.map((provider) => {
          const meta = providerMeta(provider);
          const Icon = meta.Icon;
          return (
            <Tooltip key={provider}>
              <TooltipTrigger asChild>
                <span
                  tabIndex={0}
                  aria-label={meta.label}
                  className="group grid size-7 place-items-center rounded-full border bg-background shadow-sm transition-transform duration-150 ease-out hover:z-10 hover:-translate-y-0.5 hover:scale-110 focus-visible:z-10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  style={{ borderColor: meta.border, backgroundColor: meta.bg }}
                >
                  <Icon className="size-4 object-contain transition-transform duration-150 ease-out group-hover:rotate-6 group-focus-visible:rotate-6" />
                </span>
              </TooltipTrigger>
              <TooltipContent side="top">{meta.label}</TooltipContent>
            </Tooltip>
          );
        })}
      </span>
    </TooltipProvider>
  );
}
