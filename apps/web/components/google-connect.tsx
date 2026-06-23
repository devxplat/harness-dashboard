"use client";

// Google Calendar connect/sync control. The OAuth flow is a loopback redirect: the
// server returns an auth URL, the user signs in in a new tab, Google redirects back
// to the server callback which stores the (encrypted) tokens.
import { Button } from "@/components/ui/button";
import { apiDelete, apiGet, apiPost } from "@/lib/api";
import { formatDateShort } from "@/lib/format";
import { useState } from "react";
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
  const [busy, setBusy] = useState(false);

  async function start() {
    setBusy(true);
    try {
      const r = await apiGet<{ auth_url: string }>("/api/integrations/google/start");
      window.open(r.auth_url, "_blank", "noopener,noreferrer");
      toast.info("Finish sign-in in the opened tab, then click Sync.");
    } catch {
      toast.error("Could not start sign-in — set GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET");
    } finally {
      setBusy(false);
    }
  }

  async function sync() {
    setBusy(true);
    const p = apiPost<{ events: number }>("/api/integrations/google/sync", {});
    toast.promise(p, {
      loading: "Syncing calendar…",
      success: (r) => `Synced ${r.events} calendar events`,
      error: "Calendar sync failed",
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
      loading: "Disconnecting…",
      success: "Google disconnected",
      error: "Could not disconnect",
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
            Sync now
          </Button>
          <Button size="sm" variant="outline" onClick={disconnect} disabled={busy}>
            Disconnect
          </Button>
          {lastSync ? (
            <span className="text-xs text-muted-foreground">
              Last synced {formatDateShort(lastSync)}
            </span>
          ) : null}
        </div>
      ) : (
        <Button size="sm" onClick={start} disabled={busy}>
          Connect Google Calendar
        </Button>
      )}
      <p className="text-xs text-muted-foreground">
        OAuth via a loopback redirect; requires GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET on the
        server. Tokens are stored encrypted at rest and used only to read event times.
      </p>
    </div>
  );
}
