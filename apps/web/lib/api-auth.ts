import { API_BASE } from "./api-base";

const STORAGE_KEY = "harness.apiKey";
const TEST_API_KEY = "test-api-key-for-harness-dashboard";

let memoryKey: string | null = null;
let bootstrapPromise: Promise<string> | null = null;

function storage(): Storage | null {
  if (typeof window === "undefined") return null;
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

function readStoredKey(): string | null {
  if (process.env.NODE_ENV === "test") return TEST_API_KEY;
  if (memoryKey) return memoryKey;
  let stored: string | undefined;
  try {
    stored = storage()?.getItem(STORAGE_KEY)?.trim();
  } catch {
    return null;
  }
  if (!stored) return null;
  memoryKey = stored;
  return stored;
}

function writeStoredKey(key: string): string {
  memoryKey = key;
  try {
    storage()?.setItem(STORAGE_KEY, key);
  } catch {
    // Keep the in-memory key for restricted browsers where sessionStorage throws.
  }
  return key;
}

export function clearApiKey(): void {
  memoryKey = null;
  bootstrapPromise = null;
  try {
    storage()?.removeItem(STORAGE_KEY);
  } catch {
    // Nothing to clear when storage is unavailable.
  }
}

export async function getApiKey(forceRefresh = false): Promise<string> {
  if (!forceRefresh) {
    const stored = readStoredKey();
    if (stored) return stored;
  } else {
    clearApiKey();
  }

  if (process.env.NODE_ENV === "test") return TEST_API_KEY;

  if (!bootstrapPromise) {
    bootstrapPromise = fetch(`${API_BASE}/api/auth/bootstrap`, { cache: "no-store" })
      .then(async (res) => {
        if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
        const body = (await res.json()) as { api_key?: string };
        const key = body.api_key?.trim();
        if (!key) throw new Error("API bootstrap did not return a key");
        return writeStoredKey(key);
      })
      .finally(() => {
        bootstrapPromise = null;
      });
  }

  return bootstrapPromise;
}

export async function authHeaders(base?: HeadersInit): Promise<Headers> {
  const headers = new Headers(base);
  headers.set("authorization", `Bearer ${await getApiKey()}`);
  return headers;
}

export async function authenticatedStreamUrl(path: "/api/stream" = "/api/stream"): Promise<string> {
  const separator = path.includes("?") ? "&" : "?";
  return `${API_BASE}${path}${separator}api_key=${encodeURIComponent(await getApiKey())}`;
}
