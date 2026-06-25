import { defineConfig, devices } from "@playwright/test";
import { join } from "node:path";

const API_PORT = 8080;
const APP_PORT = 4173;
const APP = `http://127.0.0.1:${APP_PORT}`;
const WEB_ROOT = __dirname;
const FIXTURE_ROOT = join(WEB_ROOT, "e2e", "fixture");
const FIXTURE_PROJECTS = join(FIXTURE_ROOT, "projects");
const RUN_ROOT = join(WEB_ROOT, ".tmp-e2e", `${Date.now()}-${process.pid}`);
const FIXTURE_HOME = join(RUN_ROOT, "home");
const FIXTURE_EMPTY = join(RUN_ROOT, "empty");
const FIXTURE_APPDATA = join(RUN_ROOT, "appdata");
const E2E_DB = join(RUN_ROOT, "harness.db");

// OS-correct path to the debug binary (backslashes + .exe on Windows).
const SERVER_BIN = join(
  "..",
  "..",
  "target",
  "debug",
  process.platform === "win32" ? "harness-dashboard.exe" : "harness-dashboard",
);

const q = (value: string) => JSON.stringify(value);

const isolatedProviderEnv = {
  APPDATA: FIXTURE_APPDATA,
  ANTIGRAVITY_TRANSCRIPTS_DIR: join(FIXTURE_EMPTY, "antigravity"),
  CLAUDE_DIR: join(FIXTURE_HOME, ".claude"),
  CLAUDE_PROJECTS_DIR: FIXTURE_PROJECTS,
  CODEX_SESSIONS_DIR: join(FIXTURE_EMPTY, "codex-sessions"),
  COPILOT_HOME: join(FIXTURE_EMPTY, "copilot"),
  COPILOT_OTEL_DB: join(FIXTURE_EMPTY, "copilot", "agent-traces.db"),
  CURSOR_STATE_DB: join(FIXTURE_EMPTY, "cursor", "state.vscdb"),
  GEMINI_CHATS_DIR: join(FIXTURE_EMPTY, "gemini-chats"),
  HOME: FIXTURE_HOME,
  OPENCODE_DATA_DIR: join(FIXTURE_EMPTY, "opencode"),
  OPENCODE_RUN_LOGS_DIR: join(FIXTURE_EMPTY, "opencode-runs"),
  USERPROFILE: FIXTURE_HOME,
};

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
      command: `${q(SERVER_BIN)} --dev --no-open --port ${API_PORT} --db ${q(E2E_DB)} --projects-dir ${q(FIXTURE_PROJECTS)}`,
      env: isolatedProviderEnv,
      url: `http://127.0.0.1:${API_PORT}/api/overview`,
      reuseExistingServer: false,
      timeout: 60_000,
    },
    {
      command: `node e2e/static-server.mjs out ${APP_PORT}`,
      url: APP,
      reuseExistingServer: false,
      timeout: 30_000,
    },
  ],
});
