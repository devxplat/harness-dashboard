"use client";

import { apiGet } from "@/lib/api";
import { ScanSyncContext } from "@/hooks/scan-sync";
import { useCallback, useContext, useEffect, useRef, useState } from "react";

export interface ApiState<T> {
  data: T | null;
  error: string | null;
  loading: boolean;
  refetch: () => void;
}

/** Fetch `path` from the Rust API. Pass `null` to skip. Re-fetches when `path`
 * changes and (silently) when the data `version` bumps after a scan.
 *
 * Keys the live refetch on the numeric `version` only — NOT the whole ScanSync
 * context object, which the provider recreates on every render (scanning /
 * github progress ticks would otherwise trigger a refetch storm). And keeps at
 * most one request in flight per hook: a refetch that arrives mid-flight is
 * coalesced into a single trailing fetch, and responses for a superseded path are
 * ignored — so a slow endpoint can never pile up. */
export function useApi<T>(path: string | null): ApiState<T> {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const { version } = useContext(ScanSyncContext);

  const reqId = useRef(0);
  const inFlight = useRef(false);
  const pending = useRef(false);
  const hasData = useRef(false);

  const load = useCallback(
    (silent = false) => {
      if (path == null) {
        setLoading(false);
        return;
      }
      if (inFlight.current) {
        pending.current = true; // coalesce concurrent triggers into one trailing fetch
        return;
      }
      inFlight.current = true;
      const id = ++reqId.current;
      if (!silent && !hasData.current) setLoading(true);
      apiGet<T>(path)
        .then((d) => {
          if (id !== reqId.current) return; // superseded by a newer request
          hasData.current = true;
          setData(d);
          setError(null);
        })
        .catch((e) => {
          if (id !== reqId.current) return;
          setError(String(e));
        })
        .finally(() => {
          if (id !== reqId.current) return;
          inFlight.current = false;
          setLoading(false);
          if (pending.current) {
            pending.current = false;
            load(true);
          }
        });
    },
    [path],
  );

  useEffect(() => load(), [load]);

  // Live refresh: only when the (throttled, numeric) data version actually changes.
  const lastVersion = useRef(version);
  useEffect(() => {
    if (version === lastVersion.current) return;
    lastVersion.current = version;
    load(true);
  }, [version, load]);

  return { data, error, loading, refetch: load };
}
