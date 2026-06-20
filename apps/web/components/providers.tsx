"use client";

import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ScanSyncProvider } from "@/hooks/scan-sync";
import { RangeProvider } from "@/lib/range";
import { ThemeProvider } from "next-themes";

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <ThemeProvider attribute="class" defaultTheme="dark" enableSystem disableTransitionOnChange>
      <ScanSyncProvider>
        <RangeProvider>
          <TooltipProvider delayDuration={200}>
            {children}
            <Toaster richColors position="bottom-right" />
          </TooltipProvider>
        </RangeProvider>
      </ScanSyncProvider>
    </ThemeProvider>
  );
}
