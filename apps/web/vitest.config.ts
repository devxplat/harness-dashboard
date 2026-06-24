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
        // recharts charts: their SVG draw callbacks need a real layout (jsdom gives
        // charts zero size), so they can't be exercised by unit tests. The math is
        // unit-tested in lib/activity-grid.ts; these render as smoke tests only.
        "components/charts/activity-heatmap.tsx",
        "components/charts/daily-chart.tsx",
        "components/charts/ai-split-chart.tsx",
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
