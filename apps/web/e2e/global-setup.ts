import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";

const WEB_ROOT = join(__dirname, "..");
const FIXTURE_ROOT = join(WEB_ROOT, "e2e", "fixture");

function removeDbFamily(root: string) {
  for (const ext of ["", "-wal", "-shm"]) {
    try {
      rmSync(join(root, `.tmp-e2e.db${ext}`), { force: true });
    } catch {
      /* ignore */
    }
  }
}

// Start every e2e run from a clean database so the fixture scan is deterministic.
export default function globalSetup() {
  removeDbFamily(process.cwd());
  removeDbFamily(WEB_ROOT);
  rmSync(join(FIXTURE_ROOT, "home"), { force: true, recursive: true });
  rmSync(join(FIXTURE_ROOT, "empty"), { force: true, recursive: true });
  rmSync(join(FIXTURE_ROOT, "appdata"), { force: true, recursive: true });
  mkdirSync(join(FIXTURE_ROOT, "empty"), { recursive: true });
  mkdirSync(join(FIXTURE_ROOT, "appdata"), { recursive: true });
}
