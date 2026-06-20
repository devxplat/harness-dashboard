import { rmSync } from "node:fs";
import { join } from "node:path";

// Start every e2e run from a clean database so the fixture scan is deterministic.
export default function globalSetup() {
  for (const ext of ["", "-wal", "-shm"]) {
    try {
      rmSync(join(process.cwd(), `.tmp-e2e.db${ext}`), { force: true });
    } catch {
      /* ignore */
    }
  }
}
