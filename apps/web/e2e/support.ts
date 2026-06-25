import { expect, type APIRequestContext } from "@playwright/test";

let seeded = false;

export async function seedConfiguredFixture(request: APIRequestContext) {
  if (seeded) return;

  await request.post("/api/settings", { data: { onboarding_done: true } });
  const scan = await request.get("/api/scan");
  expect(scan.ok()).toBe(true);

  await expect
    .poll(
      async () => {
        const res = await request.get("/api/ingest");
        const data = await res.json();
        return Number(data.messages ?? 0);
      },
      { intervals: [250, 500, 1000], timeout: 15_000 },
    )
    .toBeGreaterThan(0);

  seeded = true;
}
