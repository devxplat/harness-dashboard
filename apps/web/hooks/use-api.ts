"use client";

import { apiGet } from "@/lib/api";
import { useCallback, useEffect, useState } from "react";

export interface ApiState<T> {
  data: T | null;
  error: string | null;
  loading: boolean;
  refetch: () => void;
}

/** Fetch `path` from the Rust API. Pass `null` to skip. Re-fetches when `path` changes. */
export function useApi<T>(path: string | null): ApiState<T> {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(() => {
    if (path == null) {
      setLoading(false);
      return;
    }
    setLoading(true);
    apiGet<T>(path)
      .then((d) => {
        setData(d);
        setError(null);
      })
      .catch((e) => setError(String(e)))
      .finally(() => setLoading(false));
  }, [path]);

  useEffect(() => load(), [load]);

  return { data, error, loading, refetch: load };
}
