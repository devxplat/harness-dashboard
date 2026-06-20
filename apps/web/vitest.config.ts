import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { "@": fileURLToPath(new URL(".", import.meta.url)) },
  },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./vitest.setup.ts"],
    include: ["**/*.test.{ts,tsx}"],
    exclude: ["node_modules/**", "out/**", ".next/**", "e2e/**"],
    coverage: {
      provider: "v8",
      reporter: ["text", "json", "html"],
      include: ["lib/**", "components/**", "hooks/**", "app/**"],
      exclude: [
        "components/ui/**",
        "lib/utils.ts",
        "lib/test-utils.tsx",
        "app/layout.tsx",
        "**/*.d.ts",
        "**/*.test.{ts,tsx}",
      ],
      thresholds: { lines: 98, statements: 98, functions: 90, branches: 88 },
    },
  },
});
