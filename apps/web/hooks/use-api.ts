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
 * changes, and silently re-fetches (no loading flash) on each server scan. */
export function useApi<T>(path: string | null): ApiState<T> {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const version = useContext(ScanSyncContext);

  const load = useCallback(
    (silent = false) => {
      if (path == null) {
        setLoading(false);
        return;
      }
      if (!silent) setLoading(true);
      apiGet<T>(path)
        .then((d) => {
          setData(d);
          setError(null);
        })
        .catch((e) => setError(String(e)))
        .finally(() => setLoading(false));
    },
    [path],
  );

  useEffect(() => load(), [load]);

  // Live refresh: when a scan completes, re-fetch in the background (keep the
  // current data on screen instead of flashing the loading state).
  const lastVersion = useRef(version);
  useEffect(() => {
    if (version === lastVersion.current) return;
    lastVersion.current = version;
    load(true);
  }, [version, load]);

  return { data, error, loading, refetch: load };
}
