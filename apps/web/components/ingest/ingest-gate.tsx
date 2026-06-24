"use client";

// Guards data-dependent screens. Until any local data is seeded, it blurs the whole
// page and floats a single message (with a link to the integrations settings) so the
// user always knows what's missing or in progress. Once seeded, it's a no-op and the
// only ingest cue is the shared top-bar pill. Settings/onboarding opt out (so the
// user can act on the message).
import { IngestPill } from "@/components/ingest/ingest-pill";
import { Button } from "@/components/ui/button";
import { useIngest } from "@/hooks/ingest";
import { DatabaseZap } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";

export function IngestGate({ children }: { children: ReactNode }) {
  const { seeded, ingesting, loading } = useIngest();
  const { t } = useTranslation();
  // Never flash the blur before we know the status, and step aside once seeded.
  if (loading || seeded) return <>{children}</>;

  return (
    <div className="relative">
      <div className="pointer-events-none select-none blur-sm" aria-hidden>
        {children}
      </div>
      <div className="absolute inset-0 z-10 grid place-items-center p-6">
        <div
          className="max-w-md rounded-xl border bg-card/95 p-6 text-center shadow-lg backdrop-blur"
          role="status"
        >
          <div className="mx-auto mb-3 grid size-10 place-items-center rounded-lg border bg-background">
            <DatabaseZap className="size-5 text-primary" />
          </div>
          {ingesting ? (
            <>
              <h2 className="text-base font-semibold">{t("components.ingestGate.indexingTitle")}</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                {t("components.ingestGate.indexingBody")}
              </p>
              <div className="mt-3 flex justify-center">
                <IngestPill />
              </div>
            </>
          ) : (
            <>
              <h2 className="text-base font-semibold">{t("components.ingestGate.noDataTitle")}</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                {t("components.ingestGate.noDataBody")}
              </p>
            </>
          )}
          <Button asChild size="sm" className="mt-4">
            <Link href="/settings">{t("components.ingestGate.goToIntegrations")}</Link>
          </Button>
        </div>
      </div>
    </div>
  );
}
