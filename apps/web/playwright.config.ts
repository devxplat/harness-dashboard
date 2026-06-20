import { defineConfig, devices } from "@playwright/test";
import { join } from "node:path";

const API_PORT = 8080;
const APP_PORT = 4173;
const APP = `http://127.0.0.1:${APP_PORT}`;

// OS-correct path to the debug binary (backslashes + .exe on Windows).
const SERVER_BIN = join(
  "..",
  "..",
  "target",
  "debug",
  process.platform === "win32" ? "harness-dashboard.exe" : "harness-dashboard",
);

// Two servers: the Rust API scanning the deterministic fixture, and a static
// file server for the prebuilt Next export (`out/`). Run `pnpm build` first.
export default defineConfig({
  testDir: "./e2e",
  globalSetup: "./e2e/global-setup.ts",
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: [["list"]],
  use: { baseURL: APP, trace: "on-first-retry" },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: [
    {
      command: `"${SERVER_BIN}" --dev --no-open --port ${API_PORT} --db ./.tmp-e2e.db --projects-dir ./e2e/fixture/projects`,
      url: `http://127.0.0.1:${API_PORT}/api/overview`,
      reuseExistingServer: false,
      timeout: 60_000,
    },
    {
      command: `python -m http.server ${APP_PORT} -d out`,
      url: APP,
      reuseExistingServer: false,
      timeout: 30_000,
    },
  ],
});
