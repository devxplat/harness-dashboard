"use client";

import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { IngestProvider } from "@/hooks/ingest";
import { ScanSyncProvider } from "@/hooks/scan-sync";
import { ProviderFilterProvider } from "@/lib/provider-filter";
import { RangeProvider } from "@/lib/range";
import { ThemeProvider } from "next-themes";

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <ThemeProvider attribute="class" defaultTheme="dark" enableSystem disableTransitionOnChange>
      <ScanSyncProvider>
        <IngestProvider>
          <RangeProvider>
            <ProviderFilterProvider>
              <TooltipProvider delayDuration={200}>
                {children}
                <Toaster richColors position="bottom-right" />
              </TooltipProvider>
            </ProviderFilterProvider>
          </RangeProvider>
        </IngestProvider>
      </ScanSyncProvider>
    </ThemeProvider>
  );
}
