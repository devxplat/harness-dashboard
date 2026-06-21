"use client";

import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import Image from "next/image";
import { AppSidebar } from "./app-sidebar";
import { DateRangePicker } from "./date-range-picker";
import { RangeSelector } from "./range-selector";
import { RealtimeToggle } from "./realtime-toggle";
import { ScanStatus } from "./scan-status";
import { ThemeToggle } from "./theme-toggle";

export function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <SidebarProvider>
      <AppSidebar />
      <SidebarInset className="md:peer-data-[variant=inset]:border">
        <header className="sticky top-0 z-10 flex w-full shrink-0 items-center gap-3 border-b bg-background px-4 py-3.5 sm:px-6 lg:rounded-t-xl">
          <div className="flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-lg border bg-background">
            <Image src="/logo.png" alt="" width={40} height={40} className="size-9" priority />
          </div>
          <div className="flex flex-col">
            <span className="text-sm font-medium">Welcome back 👋</span>
            <span className="text-xs text-muted-foreground">Your Claude Code usage</span>
          </div>
          <div className="ml-auto flex items-center gap-2 [&_button]:shadow-sm">
            <RangeSelector />
            <DateRangePicker />
            <RealtimeToggle />
            <ThemeToggle />
            <ScanStatus />
          </div>
        </header>
        <div className="flex-1 space-y-6 p-4 md:p-6">{children}</div>
      </SidebarInset>
    </SidebarProvider>
  );
}
