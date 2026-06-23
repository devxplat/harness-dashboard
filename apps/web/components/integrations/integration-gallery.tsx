"use client";

// A browsable list of integrations you can add (visual base: shadcnblocks
// integration10 — an icon, name, description and a Connect button per row), styled
// to match our IntegrationCard. Each Connect hands control back to the parent panel,
// which swaps in that integration's connect flow.
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { ReactNode } from "react";

export interface GalleryItem {
  id: string;
  name: string;
  description: string;
  icon: ReactNode;
  onConnect: () => void;
}

export function IntegrationGallery({
  items,
  className,
}: {
  items: GalleryItem[];
  className?: string;
}) {
  if (items.length === 0) {
    return (
      <p className="rounded-xl border border-dashed p-8 text-center text-sm text-muted-foreground">
        Every available integration is already connected.
      </p>
    );
  }
  return (
    <div className={cn("space-y-3", className)}>
      {items.map((it) => (
        <div
          key={it.id}
          className="flex flex-col items-start justify-between gap-4 rounded-xl border bg-card px-5 py-4 shadow-sm transition-colors hover:bg-muted/40 sm:flex-row sm:items-center"
        >
          <div className="flex w-full items-center gap-4 sm:w-auto">
            <span className="flex size-10 shrink-0 items-center justify-center rounded-lg border bg-background text-foreground">
              {it.icon}
            </span>
            <div className="min-w-0">
              <h3 className="font-medium">{it.name}</h3>
              <p className="text-sm text-muted-foreground">{it.description}</p>
            </div>
          </div>
          <Button
            variant="outline"
            size="sm"
            aria-label={`Connect ${it.name}`}
            onClick={it.onConnect}
            className="w-full sm:w-auto"
          >
            Connect
          </Button>
        </div>
      ))}
    </div>
  );
}
