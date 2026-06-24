"use client";

import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useProviderFilter } from "@/lib/provider-filter";
import { PROVIDERS } from "@/lib/providers";
import { cn } from "@/lib/utils";

export function ProviderSelector() {
  const { selected, available, toggle } = useProviderFilter();
  return (
    <div className="flex items-center gap-1.5 rounded-lg border bg-background p-1">
      {PROVIDERS.map((provider) => {
        const active = selected.includes(provider.id);
        const enabled = available.includes(provider.id);
        const Icon = provider.Icon;
        return (
          <Tooltip key={provider.id}>
            <TooltipTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-pressed={active}
                aria-label={provider.label}
                disabled={!enabled}
                className={cn(
                  // Logos are 10% larger; hovering grows enabled ones another 10%.
                  "size-9 border transition-transform duration-200 ease-out",
                  enabled && "hover:scale-110",
                  active ? "opacity-100" : "opacity-45",
                  !enabled && "cursor-not-allowed opacity-25",
                )}
                style={{
                  color: provider.color,
                  backgroundColor: active ? provider.bg : "transparent",
                  borderColor: active ? provider.border : "transparent",
                }}
                onClick={() => toggle(provider.id)}
              >
                <Icon className="size-[1.1rem]" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom" sideOffset={8}>
              {!enabled
                ? `${provider.label} not discovered`
                : `${provider.label} ${active ? "included" : "excluded"}`}
            </TooltipContent>
          </Tooltip>
        );
      })}
    </div>
  );
}
