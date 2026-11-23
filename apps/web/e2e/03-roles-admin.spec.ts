import { expect, test } from "@playwright/test";
import { login, type Who } from "./helpers";

/** What each role must (and must not) see in the navigation. The API enforces the same rules; this checks the UI. */
const NAV: Record<Who, { show: string[]; hide: string[] }> = {
  admin: { show: ["Customers", "BESS calculator", "Proposals", "Users & approvals", "Roles & permissions", "Pricing & assumptions", "Security"], hide: [] },
  it: { show: ["Users & approvals", "Roles & permissions", "Security"], hide: ["BESS calculator", "Proposals", "Pricing & assumptions"] },
  mgmt: { show: ["Customers", "BESS calculator", "Proposals", "Users & approvals", "Pricing & assumptions"], hide: [] },
  engineer: { show: ["Customers", "BESS calculator", "Proposals"], hide: ["Users & approvals", "Pricing & assumptions", "Security"] },
  sales: { show: ["Customers", "BESS calculator", "Proposals"], hide: ["Users & approvals", "Pricing & assumptions", "Security"] },
  sales2: { show: ["Customers"], hide: ["Users & approvals"] },
  finance: { show: ["BESS calculator", "Proposals", "Pricing & assumptions"], hide: ["Users & approvals", "Security"] },
  readonly: { show: ["Customers", "Proposals"], hide: ["BESS calculator", "Users & approvals", "Pricing & assumptions", "Security"] },
};

test.describe("Every role sees only what it is allowed to", () => {
  for (const who of ["admin", "it", "mgmt", "engineer", "sales", "finance", "readonly"] as Who[]) {
    test(`navigation for ${who}`, async ({ page }) => {
      await login(page, who);
      const navEl = page.getByLabel("Main navigation");
      for (const name of NAV[who].show) await expect(navEl.getByRole("link", { name, exact: true })).toBeVisible();
      for (const name of NAV[who].hide) await expect(navEl.getByRole("link", { name, exact: true })).toHaveCount(0);
      // Dashboard always loads with KPIs.
      await expect(page.getByText("Open pipeline")).toBeVisible();
    });
  }

  test("read-only user is refused confidential pricing even by direct URL", async ({ page }) => {
    await login(page, "readonly");
    await page.goto("/admin/pricing");
    await expect(page.getByRole("alert")).toBeVisible();
    await expect(page.getByRole("button", { name: "Save assumptions" })).toHaveCount(0);
  });

  test("sales cannot open the user administration API", async ({ page }) => {
    await login(page, "sales");
    const r = await page.request.get("/api/v1/users");
    expect(r.status()).toBe(403);
  });
});

test.describe.serial("Administration", () => {
  test("admin creates, edits and deletes a custom role", async ({ page }) => {
    await login(page, "admin");
    await page.goto("/admin/roles");
    await page.getByRole("button", { name: /New role/ }).click();
    const dlg = page.getByRole("dialog");
    await dlg.getByLabel("Name").fill("Site Surveyor");
    await dlg.getByLabel("Description").fill("Reads customers during site visits.");
    await dlg.getByRole("checkbox", { name: /^customers\.view(?!_)/ }).check();
    await dlg.getByRole("button", { name: "Save role" }).click();
    const card = page.locator("section, .card", { hasText: "Site Surveyor" }).first();
    await expect(card).toBeVisible();
    await card.getByRole("button", { name: "Delete" }).click();
    await card.getByRole("button", { name: "Yes" }).click();
    await expect(page.getByText("Site Surveyor")).toHaveCount(0);
  });

  test("finance updates pricing assumptions (audited)", async ({ page }) => {
    await login(page, "finance");
    await page.goto("/admin/pricing");
    const margin = page.getByLabel(/margin/i).first();
    await margin.fill("19");
    await page.getByRole("button", { name: "Save assumptions" }).click();
    await expect(page.locator(".success")).toBeVisible();
  });

  test("security dashboard, audit log and audit integrity check", async ({ page }) => {
    await login(page, "it");
    await page.goto("/security");
    await expect(page.getByRole("heading", { name: "Security alerts" })).toBeVisible();
    await page.getByRole("tab", { name: "Audit log" }).click();
    await expect(page.getByText("login.success").first()).toBeVisible();
    await page.getByRole("tab", { name: "Login activity" }).click();
    await page.getByRole("tab", { name: "Active sessions" }).click();
    await expect(page.getByRole("button", { name: "Revoke" }).first()).toBeVisible();
    await page.getByRole("button", { name: "Verify audit integrity" }).click();
    await expect(page.getByText(/intact/i)).toBeVisible();
  });

  test("admin disables and re-enables an account", async ({ page }) => {
    await login(page, "admin");
    await page.goto("/admin/users");
    await page.getByRole("tab", { name: "Active" }).click();
    const row = page.getByRole("row", { name: /e2e\.readonly@skjenergy\.com/ });
    await row.getByRole("button", { name: "Disable" }).click();
    await row.getByRole("button", { name: "Yes" }).click();
    await page.getByRole("tab", { name: "All users" }).click();
    const row2 = page.getByRole("row", { name: /e2e\.readonly@skjenergy\.com/ });
    await expect(row2).toContainText("disabled");
    await row2.getByRole("button", { name: "Enable" }).click();
    await expect(row2).toContainText("active");
  });

  test("theme switch and phone-width layout work", async ({ page }) => {
    await login(page, "sales");
    await page.getByRole("button", { name: "Dark" }).click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    await page.getByRole("button", { name: "Match system" }).click();
    await page.setViewportSize({ width: 390, height: 844 });
    await page.getByRole("button", { name: "Open menu" }).click();
    await page.getByLabel("Main navigation").getByRole("link", { name: "Projects", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Projects", level: 1 })).toBeVisible();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow).toBeLessThanOrEqual(1);
  });
});
