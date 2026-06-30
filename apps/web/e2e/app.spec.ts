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

  test("requires at least one selected vendor on provider-scoped views", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("main").getByText("Est. cost")).toBeVisible();

    const activeProviderButtons = page.locator('header button[aria-pressed="true"]:has(img)');
    await expect(activeProviderButtons.first()).toBeVisible();
    while ((await activeProviderButtons.count()) > 0) {
      await activeProviderButtons.first().click();
    }

    await expect(page.getByText("Select at least one vendor")).toBeVisible();
    await expect(page.getByText("Vendor selector is above this content")).toBeVisible();

    await page.goto("/sessions/");
    await expect(page.getByText("Select at least one vendor")).toBeVisible();

    const availableProvider = page.locator("header button:has(img):not([disabled])").first();
    await availableProvider.click();
    await expect(page.getByText("Select at least one vendor")).toHaveCount(0);
    await expect(page.getByRole("main").getByRole("link", { name: "proj" })).toHaveCount(2);
  });

  test("shows skeleton while vendor filter changes", async ({ page }) => {
    await page.addInitScript(() => {
      window.localStorage.setItem("harness.providerFilter.selected", JSON.stringify(["claude"]));
    });
    await page.route("**/api/settings", async (route) => {
      const response = await route.fetch();
      const body = await response.json();
      body.providers = body.providers.map((provider: { id: string }) =>
        provider.id === "codex" ? { ...provider, enabled: true, discovered: true } : provider,
      );
      await route.fulfill({ response, json: body });
    });
    let delayOverview = false;
    await page.route("**/api/overview**", async (route) => {
      if (delayOverview) await page.waitForTimeout(700);
      await route.continue();
    });

    await page.goto("/");
    const main = page.getByRole("main");
    await expect(main.getByText("Est. cost")).toBeVisible();
    await expect(main.locator('[data-slot="skeleton"]')).toHaveCount(0);

    delayOverview = true;
    const codex = page.getByRole("button", { name: "Codex" });
    await expect(codex).toHaveAttribute("aria-pressed", "false");
    await codex.click();
    await expect(main.locator('[data-slot="skeleton"]').first()).toBeVisible();
    await expect(main.locator('[data-slot="skeleton"]')).toHaveCount(0);

    await expect(codex).toHaveAttribute("aria-pressed", "true");
    await codex.click();
    await expect(main.locator('[data-slot="skeleton"]').first()).toBeVisible();
    await expect(main.locator('[data-slot="skeleton"]')).toHaveCount(0);
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
    await expect(page.getByText("Context window")).toBeVisible();
    await expect(page.getByText("Plan usage", { exact: true })).toBeVisible();
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

  test("plans usage shows provider catalog and Claude snapshot setup", async ({ page }) => {
    await page.goto("/settings/");
    await page.getByRole("button", { name: /Plans & Usage/ }).click();
    const main = page.getByRole("main");
    await expect(main.getByText(/Plan catalog checked/)).toBeVisible();
    await expect(main.getByText("Claude Status Line snapshot")).toBeVisible();
    await expect(main.getByText("harness-dashboard statusline-snapshot")).toBeVisible();
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
