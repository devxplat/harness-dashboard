import { expect, test } from "@playwright/test";
import { seedConfiguredFixture } from "./support";

test.beforeEach(async ({ request }) => {
  await seedConfiguredFixture(request);
});

test.describe("overview", () => {
  test("renders KPIs and the daily chart", async ({ page }) => {
    await page.goto("/");
    const main = page.getByRole("main");
    await expect(main.getByText("Est. cost")).toBeVisible();
    await expect(main.getByText("Daily tokens")).toBeVisible();
    await expect(main.locator("svg").first()).toBeVisible();
  });

  test("range selector toggles pressed state", async ({ page }) => {
    await page.goto("/");
    const sevenDay = page.getByRole("button", { name: "7d", exact: true });
    await sevenDay.click();
    await expect(sevenDay).toHaveAttribute("aria-pressed", "true");
  });

  test("refresh button is present and clickable", async ({ page }) => {
    await page.goto("/");
    const refresh = page.getByRole("button", { name: "Rescan transcripts" });
    await expect(refresh).toBeVisible();
    await refresh.click();
  });
});

test.describe("sessions", () => {
  test("lists fixture sessions, filters, and drills into detail", async ({ page }) => {
    await page.goto("/sessions/");
    const main = page.getByRole("main");
    await expect(main.getByRole("link", { name: "proj" })).toHaveCount(2);

    const filter = main.getByRole("combobox", { name: "Sessions" });
    await filter.fill("nomatch-xyz");
    await expect(main.getByText("No sessions match.")).toBeVisible();

    await filter.fill("proj");
    await main.getByRole("link", { name: "proj" }).first().click();
    await expect(page).toHaveURL(/\?id=/);
    await expect(page.getByRole("heading", { name: "Session" })).toBeVisible();
  });
});

test.describe("prompts", () => {
  test("sort toggle switches and rows render", async ({ page }) => {
    await page.goto("/prompts/");
    await expect(page.getByRole("button", { name: "By tokens" })).toBeVisible();
    await page.getByRole("button", { name: "Recent" }).click();
    await expect(page.getByRole("main").locator("tbody tr").first()).toBeVisible();
  });
});

test.describe("projects and tools", () => {
  test("projects shows the fixture project", async ({ page }) => {
    await page.goto("/projects/");
    await expect(page.getByRole("main").getByText("myproj")).toBeVisible();
  });

  test("tools shows Read and Bash", async ({ page }) => {
    await page.goto("/tools/");
    const main = page.getByRole("main");
    await expect(main.getByText("Read")).toBeVisible();
    await expect(main.getByText("Bash")).toBeVisible();
  });
});

test.describe("settings", () => {
  test("plan select updates the trigger", async ({ page }) => {
    await page.goto("/settings/");
    await page.getByRole("button", { name: /General/ }).click();
    await expect(page.getByText("Pricing plan", { exact: true })).toBeVisible();
    const combobox = page.getByRole("combobox", { name: "Pricing plan" });
    await combobox.click();
    await page.getByRole("option", { name: "pro", exact: true }).click();
    await expect(combobox).toContainText("pro");
  });
});

test.describe("skills and subagents", () => {
  test("skills shows the fixture slash command", async ({ page }) => {
    await page.goto("/skills/");
    const main = page.getByRole("main");
    await expect(main.getByText("You ran", { exact: true })).toBeVisible();
    await expect(main.getByText("review", { exact: true })).toBeVisible();
  });

  test("subagents shows by-kind main-thread spend", async ({ page }) => {
    await page.goto("/subagents/");
    const main = page.getByRole("main");
    await expect(main.getByText("By kind")).toBeVisible();
    await expect(main.getByText("main", { exact: true }).first()).toBeVisible();
  });
});

test.describe("workspaces and tips", () => {
  test("workspaces shows file-edit activity per workspace", async ({ page }) => {
    await page.goto("/workspaces/");
    const main = page.getByRole("main");
    await expect(main.getByText("File-edit calls")).toBeVisible();
    await expect(main.getByText("proj")).toBeVisible();
  });

  test("tips renders (empty for the fixture)", async ({ page }) => {
    await page.goto("/tips/");
    await expect(page.getByRole("main")).toContainText(/No tips/i);
  });
});
