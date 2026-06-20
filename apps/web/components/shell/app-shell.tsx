"use client";

import { Separator } from "@/components/ui/separator";
import { SidebarInset, SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { AppSidebar } from "./app-sidebar";
import { RangeSelector } from "./range-selector";
import { ScanStatus } from "./scan-status";
import { ThemeToggle } from "./theme-toggle";

export function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <SidebarProvider>
      <AppSidebar />
      <SidebarInset>
        <header className="flex h-14 shrink-0 items-center gap-2 border-b px-4">
          <SidebarTrigger aria-label="Toggle sidebar" />
          <Separator orientation="vertical" className="h-5" />
          <span className="text-sm font-semibold">harness-dashboard</span>
          <div className="ml-auto flex items-center gap-2">
            <RangeSelector />
            <ThemeToggle />
            <ScanStatus />
          </div>
        </header>
        <div className="flex-1 space-y-6 p-4 md:p-6">{children}</div>
      </SidebarInset>
    </SidebarProvider>
  );
}
