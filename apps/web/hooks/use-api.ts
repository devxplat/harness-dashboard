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
 * github progress ticks would otherwise trigger a refetch storm). Responses for
 * superseded paths are ignored, so slow filter changes cannot paint stale data. */
export function useApi<T>(path: string | null): ApiState<T> {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const { version } = useContext(ScanSyncContext);

  const reqId = useRef(0);
  const latestPath = useRef<string | null>(path);
  const loadedPath = useRef<string | null>(null);

  const load = useCallback((silent = false) => {
    const currentPath = latestPath.current;
    if (currentPath == null) {
      setLoading(false);
      return;
    }
    const id = ++reqId.current;
    if (!silent) setLoading(true);
    apiGet<T>(currentPath)
      .then((d) => {
        if (id !== reqId.current || currentPath !== latestPath.current) return;
        loadedPath.current = currentPath;
        setData(d);
        setError(null);
      })
      .catch((e) => {
        if (id !== reqId.current || currentPath !== latestPath.current) return;
        setError(String(e));
      })
      .finally(() => {
        if (id !== reqId.current || currentPath !== latestPath.current) return;
        setLoading(false);
      });
  }, []);

  useEffect(() => {
    latestPath.current = path;
    if (path == null) {
      setLoading(false);
      return;
    }
    if (path !== loadedPath.current) {
      setError(null);
    }
    load();
  }, [load, path]);

  // Live refresh: only when the (throttled, numeric) data version actually changes.
  const lastVersion = useRef(version);
  useEffect(() => {
    if (version === lastVersion.current) return;
    lastVersion.current = version;
    load(true);
  }, [version, load]);

  return { data, error, loading, refetch: load };
}
