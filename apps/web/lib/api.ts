import { API_BASE } from "./api-base";

export async function apiGet<T>(path: string): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, { cache: "no-store" });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return (await res.json()) as T;
}

export async function apiPost<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return (await res.json()) as T;
}

export async function apiDelete<T>(path: string): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, { method: "DELETE" });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return (await res.json()) as T;
}

/** `?since=…&until=…` (omitted bounds are open). For URLs with no existing query. */
export function rangeQuery(since: string | null, until?: string | null, providers?: string[]): string {
  const p = new URLSearchParams();
  if (since) p.set("since", since);
  if (until) p.set("until", until);
  if (providers?.length) p.set("providers", providers.join(","));
  const qs = p.toString();
  return qs ? `?${qs}` : "";
}

/** Append the range to a URL that may already have query params. */
export function withRange(url: string, since: string | null, until?: string | null, providers?: string[]): string {
  const p = new URLSearchParams();
  if (since) p.set("since", since);
  if (until) p.set("until", until);
  if (providers?.length) p.set("providers", providers.join(","));
  const qs = p.toString();
  return qs ? url + (url.includes("?") ? "&" : "?") + qs : url;
}
