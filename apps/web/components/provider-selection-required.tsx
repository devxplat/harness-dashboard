"use client";

import { Card, CardContent } from "@/components/ui/card";
import { ArrowUp, Filter } from "lucide-react";
import { useTranslation } from "react-i18next";

export function ProviderSelectionRequired({
  active,
  children,
}: {
  active: boolean;
  children: React.ReactNode;
}) {
  const { t } = useTranslation();
  if (!active) return <>{children}</>;

  return (
    <div className="relative min-h-[calc(100vh-8rem)]">
      <div aria-hidden="true" className="pointer-events-none select-none opacity-35 blur-sm">
        {children}
      </div>
      <div className="absolute inset-0 z-10 flex items-start justify-center px-4 pt-12">
        <Card className="max-w-md border-primary/30 bg-background/95 shadow-xl backdrop-blur">
          <CardContent className="space-y-4 p-6 text-center">
            <div className="mx-auto flex size-12 items-center justify-center rounded-full border bg-muted">
              <Filter className="size-5 text-primary" />
            </div>
            <div className="space-y-2">
              <p className="text-base font-semibold">
                {t("components.providerSelection.title", {
                  defaultValue: "Select at least one vendor",
                })}
              </p>
              <p className="text-sm text-muted-foreground">
                {t("components.providerSelection.description", {
                  defaultValue:
                    "Use the vendor selector in the topbar to choose which AI provider data should be shown here.",
                })}
              </p>
            </div>
            <div className="flex items-center justify-center gap-2 text-sm font-medium text-primary">
              <ArrowUp className="size-4" aria-hidden="true" />
              {t("components.providerSelection.hint", {
                defaultValue: "Vendor selector is above this content",
              })}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
