import { expect, test, type APIRequestContext } from "@playwright/test";

const API = "http://127.0.0.1:8080";

async function bootstrapApiKey(request: APIRequestContext): Promise<string> {
  const bootstrap = await request.get(`${API}/api/auth/bootstrap`);
  expect(bootstrap.ok()).toBe(true);
  expect(bootstrap.headers()["cache-control"]).toContain("no-store");
  const body = (await bootstrap.json()) as { api_key?: string };
  expect(body.api_key).toBeTruthy();
  return body.api_key ?? "";
}

test("API requires the local API key outside the bootstrap endpoint", async ({ request }) => {
  const unauthenticated = await request.get(`${API}/api/settings`);
  expect(unauthenticated.status()).toBe(401);

  const key = await bootstrapApiKey(request);

  const authenticated = await request.get(`${API}/api/settings`, {
    headers: { authorization: `Bearer ${key}` },
  });
  expect(authenticated.ok()).toBe(true);
  expect(authenticated.headers()["x-content-type-options"]).toBe("nosniff");
  expect(authenticated.headers()["x-frame-options"]).toBe("DENY");
  expect(authenticated.headers()["content-security-policy"]).toContain("frame-ancestors 'none'");

  const rejected = await request.get(`${API}/api/settings`, {
    headers: { authorization: "Bearer wrong-key-with-enough-characters" },
  });
  expect(rejected.status()).toBe(401);

  const queryRejected = await request.get(`${API}/api/settings?api_key=${encodeURIComponent(key)}`);
  expect(queryRejected.status()).toBe(401);
});

test("settings rejects invalid local path input", async ({ request }) => {
  const key = await bootstrapApiKey(request);
  const invalid = await request.post(`${API}/api/settings`, {
    headers: { authorization: `Bearer ${key}` },
    data: {
      providers: [{ id: "claude", path: "C:\\Temp\\*" }],
    },
  });

  expect(invalid.status()).toBe(400);
  await expect(invalid.json()).resolves.toEqual({
    error: "invalid local path setting",
  });
});

test("oauth callback does not reflect raw error input", async ({ request }) => {
  const res = await request.get(
    `${API}/api/integrations/google/callback?error=${encodeURIComponent("<script>alert(1)</script>")}`,
  );
  expect(res.ok()).toBe(true);
  const html = await res.text();
  expect(html).toContain("Google Calendar could not be connected");
  expect(html).not.toContain("<script>alert(1)</script>");
});
