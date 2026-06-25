import { API_BASE } from "./api-base";
import { authHeaders, clearApiKey, getApiKey } from "./api-auth";

export async function apiGet<T>(path: string): Promise<T> {
  const res = await apiFetch(path, { cache: "no-store" });
  return (await res.json()) as T;
}

export async function apiPost<T>(path: string, body: unknown): Promise<T> {
  const res = await apiFetch(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return (await res.json()) as T;
}

export async function apiDelete<T>(path: string): Promise<T> {
  const res = await apiFetch(path, { method: "DELETE" });
  return (await res.json()) as T;
}

async function apiFetch(path: string, init: RequestInit, retry = true): Promise<Response> {
  await getApiKey();
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: await authHeaders(init.headers),
  });
  if (res.status === 401 && retry) {
    clearApiKey();
    await getApiKey(true);
    return apiFetch(path, init, false);
  }
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res;
}

/** `?since=…&until=…` (omitted bounds are open). For URLs with no existing query. */
export function rangeQuery(
  since: string | null,
  until?: string | null,
  providers?: string[],
): string {
  const p = new URLSearchParams();
  if (since) p.set("since", since);
  if (until) p.set("until", until);
  if (providers?.length) p.set("providers", providers.join(","));
  const qs = p.toString();
  return qs ? `?${qs}` : "";
}

/** Append the range to a URL that may already have query params. */
export function withRange(
  url: string,
  since: string | null,
  until?: string | null,
  providers?: string[],
): string {
  const p = new URLSearchParams();
  if (since) p.set("since", since);
  if (until) p.set("until", until);
  if (providers?.length) p.set("providers", providers.join(","));
  const qs = p.toString();
  return qs ? url + (url.includes("?") ? "&" : "?") + qs : url;
}
