import { expect, test } from "@playwright/test";
import { seedConfiguredFixture } from "./support";

test.beforeEach(async ({ request }) => {
  await seedConfiguredFixture(request);
});

const NAV: Array<[label: string, heading: string]> = [
  ["Overview", "Overview"],
  ["Prompts", "Prompts"],
  ["Sessions", "Sessions"],
  ["Projects", "Projects"],
  ["Tools", "Tools"],
  ["Skills", "Skills"],
  ["Subagents", "Subagents"],
  ["Workspaces", "Workspaces"],
  ["Tips", "Tips"],
  ["Settings", "Settings"],
];

test("sidebar links navigate to every view", async ({ page }) => {
  await page.goto("/");
  for (const [label, heading] of NAV) {
    await page.getByRole("link", { name: label, exact: true }).click();
    await expect(page.getByRole("heading").first()).toContainText(heading);
  }
});
