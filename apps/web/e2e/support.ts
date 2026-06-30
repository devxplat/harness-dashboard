import { expect, type APIRequestContext } from "@playwright/test";

let seeded = false;
let apiKey: string | null = null;

async function authHeaders(request: APIRequestContext) {
  if (!apiKey) {
    const res = await request.get("/api/auth/bootstrap");
    expect(res.ok()).toBe(true);
    const body = (await res.json()) as { api_key?: string };
    expect(body.api_key).toBeTruthy();
    apiKey = body.api_key ?? null;
  }
  return { authorization: `Bearer ${apiKey}` };
}

export async function seedConfiguredFixture(request: APIRequestContext) {
  if (seeded) return;

  const headers = await authHeaders(request);
  const settings = await request.post("/api/settings", {
    headers,
    data: { onboarding_done: true },
  });
  expect(settings.ok()).toBe(true);
  const scan = await request.get("/api/scan", { headers });
  expect(scan.ok()).toBe(true);

  await expect
    .poll(
      async () => {
        const res = await request.get("/api/ingest", { headers });
        const data = await res.json();
        return Number(data.messages ?? 0);
      },
      { intervals: [250, 500, 1000], timeout: 15_000 },
    )
    .toBeGreaterThan(0);

  seeded = true;
}
