"use client";

import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { RangeProvider } from "@/lib/range";

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <RangeProvider>
      <TooltipProvider delayDuration={200}>
        {children}
        <Toaster richColors position="bottom-right" />
      </TooltipProvider>
    </RangeProvider>
  );
}
