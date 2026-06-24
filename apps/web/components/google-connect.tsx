"use client";

// Google Calendar connect/sync control. The OAuth flow is a loopback redirect: the
// server returns an auth URL, the user signs in in a new tab, Google redirects back
// to the server callback which stores the (encrypted) tokens.
import { Button } from "@/components/ui/button";
import { apiDelete, apiGet, apiPost } from "@/lib/api";
import { formatDateShort } from "@/lib/format";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

export function GoogleConnect({
  connected,
  lastSync,
  onChange,
}: {
  connected: boolean;
  lastSync: string | null;
  onChange: () => void;
}) {
  const { t } = useTranslation();
  const [busy, setBusy] = useState(false);

  async function start() {
    setBusy(true);
    try {
      const r = await apiGet<{ auth_url: string }>("/api/integrations/google/start");
      window.open(r.auth_url, "_blank", "noopener,noreferrer");
      toast.info(t("components.googleConnect.finishSignIn"));
    } catch {
      toast.error(t("components.googleConnect.couldNotStart"));
    } finally {
      setBusy(false);
    }
  }

  async function sync() {
    setBusy(true);
    const p = apiPost<{ events: number }>("/api/integrations/google/sync", {});
    toast.promise(p, {
      loading: t("components.googleConnect.syncingCalendar"),
      success: (r) => t("components.googleConnect.syncedEvents", { count: r.events }),
      error: t("components.googleConnect.syncFailed"),
    });
    try {
      await p;
      onChange();
    } catch {
      /* reported */
    } finally {
      setBusy(false);
    }
  }

  async function disconnect() {
    setBusy(true);
    const p = apiDelete("/api/integrations/google");
    toast.promise(p, {
      loading: t("components.googleConnect.disconnect"),
      success: t("components.googleConnect.disconnect"),
      error: t("components.googleConnect.syncFailed"),
    });
    try {
      await p;
      onChange();
    } catch {
      /* reported */
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-2">
      {connected ? (
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" onClick={sync} disabled={busy}>
            {t("components.googleConnect.syncNow")}
          </Button>
          <Button size="sm" variant="outline" onClick={disconnect} disabled={busy}>
            {t("components.googleConnect.disconnect")}
          </Button>
          {lastSync ? (
            <span className="text-xs text-muted-foreground">
              {t("components.googleConnect.lastSynced", { date: formatDateShort(lastSync) })}
            </span>
          ) : null}
        </div>
      ) : (
        <Button size="sm" onClick={start} disabled={busy}>
          {t("components.googleConnect.connectCalendar")}
        </Button>
      )}
      <p className="text-xs text-muted-foreground">
        {t("components.googleConnect.oauthNote")}
      </p>
    </div>
  );
}
