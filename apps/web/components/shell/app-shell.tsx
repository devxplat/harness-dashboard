"use client";

import { IngestGate } from "@/components/ingest/ingest-gate";
import { OnboardingGate } from "@/components/onboarding/onboarding-gate";
import { ProviderSelectionRequired } from "@/components/provider-selection-required";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { useProviderFilter } from "@/lib/provider-filter";
import Image from "next/image";
import { usePathname } from "next/navigation";
import { AppSidebar } from "./app-sidebar";
import { DateRangePicker } from "./date-range-picker";
import { ProviderSelector } from "../provider-selector";
import { LanguageSwitcher } from "./language-switcher";
import { RangeSelector } from "./range-selector";
import { RealtimeToggle } from "./realtime-toggle";
import { ScanStatus } from "./scan-status";
import { ThemeToggle } from "./theme-toggle";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

// Screens whose data is provider-attributed (the AI-tool usage views). The selector
// is shown — and applied — only here; everywhere else its content has no provider
// dimension (git commits, surveys, settings).
const PROVIDER_SCOPED_ROUTES = new Set([
  "/",
  "/prompts",
  "/sessions",
  "/projects",
  "/tools",
  "/skills",
  "/subagents",
  "/workspaces",
  "/ai-impact",
]);

export function AppShell({ children }: { children: React.ReactNode }) {
  const { t } = useTranslation();
  const { requiresProviderSelection } = useProviderFilter();
  const [displayName, setDisplayName] = useState("");
  useEffect(() => {
    function readName() {
      setDisplayName(localStorage.getItem("harness.displayName") ?? "");
    }
    readName();
    window.addEventListener("harness.profile-saved", readName);
    return () => window.removeEventListener("harness.profile-saved", readName);
  }, []);
  const raw = usePathname() ?? "/";
  // `trailingSlash: true` (static export) makes routes look like "/onboarding/",
  // so normalize before matching — otherwise the shell would wrap onboarding.
  const pathname = raw !== "/" ? raw.replace(/\/+$/, "") : raw;

  // The onboarding wizard is a full-screen flow, outside the shell — no chrome.
  if (pathname === "/onboarding") return <>{children}</>;

  // Settings opts out of the blur gate so the user can always act on the message.
  const gated = !pathname.startsWith("/settings");

  // The provider selector only filters provider-attributed screens; on the
  // git/local screens (DORA, allocation, team, DevEx, productivity, tips) and
  // settings it would do nothing, so it's hidden there to avoid implying a filter.
  const providerScoped = PROVIDER_SCOPED_ROUTES.has(pathname);

  return (
    <SidebarProvider>
      <OnboardingGate />
      <AppSidebar />
      <SidebarInset className="md:peer-data-[variant=inset]:border">
        <header className="sticky top-0 z-10 flex w-full shrink-0 items-center gap-3 border-b bg-background px-4 py-3.5 sm:px-6 lg:rounded-t-xl">
          <div className="flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-lg border bg-background">
            <Image src="/logo.png" alt="" width={40} height={40} className="size-9" priority />
          </div>
          <div className="flex flex-col">
            <span className="text-sm font-medium">
              {displayName ? t("topbar.welcomeNamed", { name: displayName }) : t("topbar.welcome")}
            </span>
            <span className="text-xs text-muted-foreground">{t("topbar.subtitle")}</span>
          </div>
          <div className="flex flex-1 justify-center">{providerScoped ? <ProviderSelector /> : null}</div>
          <div className="flex items-center gap-2 [&_button]:shadow-sm">
            <RangeSelector />
            <DateRangePicker />
            <RealtimeToggle />
            <LanguageSwitcher />
            <ThemeToggle />
            <ScanStatus />
          </div>
        </header>
        <div className="flex-1 space-y-6 p-4 md:p-6">
          <ProviderSelectionRequired active={providerScoped && requiresProviderSelection}>
            {gated ? <IngestGate>{children}</IngestGate> : children}
          </ProviderSelectionRequired>
        </div>
      </SidebarInset>
    </SidebarProvider>
  );
}
