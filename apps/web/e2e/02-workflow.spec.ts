import { expect, test, type Page } from "@playwright/test";
import { login, logout, runWorker } from "./helpers";

const CUSTOMER = `Playwright Foods ${Date.now()}`;
const PROJECT = "Playwright BESS";
let customerUrl = "";
let projectUrl = "";
let proposalUrl = "";

const tab = (page: Page, name: RegExp | string) => page.getByRole("tab", { name }).click();
const section = (page: Page, heading: string) => page.locator("section", { has: page.getByRole("heading", { name: heading, exact: true }) });

test.describe.serial("Customer → project → bill → configuration → validation → proposal", () => {
  test("sales creates a customer from the dashboard shortcut, edits it and adds a note", async ({ page }) => {
    await login(page, "sales");
    await page.getByRole("link", { name: "Add a customer" }).click();
    const dlg = page.getByRole("dialog", { name: "New customer" });
    await dlg.getByLabel("Customer name").fill(CUSTOMER);
    await dlg.getByLabel("Industry").fill("Food processing");
    await dlg.getByLabel("DISCOM").fill("MSEDCL");
    await dlg.getByRole("button", { name: "Create customer" }).click();
    await expect(page.getByRole("heading", { name: CUSTOMER, level: 1 })).toBeVisible();
    customerUrl = page.url();

    await page.getByRole("button", { name: "Edit" }).click();
    await page.getByRole("dialog").getByLabel("Contact person").fill("Asha Rao");
    await page.getByRole("dialog").getByRole("button", { name: "Save" }).click();
    await expect(page.getByText("Asha Rao")).toBeVisible();

    await tab(page, "Notes");
    await page.getByPlaceholder(/Add a note/).fill("Site visit booked for Monday.");
    await page.getByRole("button", { name: "Add note" }).click();
    await expect(page.getByText("Site visit booked for Monday.")).toBeVisible();

    // Search finds it.
    await page.goto("/customers");
    await page.getByPlaceholder(/Search by name/).fill(CUSTOMER.split(" ")[2]);
    await expect(page.getByRole("link", { name: CUSTOMER })).toBeVisible();
  });

  test("another sales user cannot see this customer", async ({ page }) => {
    await login(page, "sales2");
    await page.goto(customerUrl);
    await expect(page.getByRole("alert")).toBeVisible();
    await expect(page.getByRole("heading", { name: CUSTOMER })).toHaveCount(0);
    await page.goto("/customers");
    await page.getByPlaceholder(/Search by name/).fill(CUSTOMER.split(" ")[2]);
    await expect(page.getByRole("link", { name: CUSTOMER })).toHaveCount(0);
  });

  test("management assigns sales2 to the team, then removes them", async ({ page }) => {
    await login(page, "mgmt");
    await page.goto(customerUrl);
    await tab(page, "Team");
    const team = section(page, "People assigned to this customer");
    await team.locator("select").selectOption({ label: "Sales2 Tester (Sales Executive)" });
    await team.getByRole("button", { name: "Assign" }).click();
    await expect(team.getByRole("row", { name: /Sales2 Tester/ })).toBeVisible();
    await team.getByRole("row", { name: /Sales2 Tester/ }).getByRole("button", { name: "Remove" }).click();
    await expect(team.getByRole("row", { name: /Sales2 Tester/ })).toHaveCount(0);
  });

  test("sales creates a project with an engineer, updates the stage and uploads a CSV bill", async ({ page }) => {
    await login(page, "sales");
    await page.goto(customerUrl);
    await page.getByRole("button", { name: "New project" }).click();
    const dlg = page.getByRole("dialog", { name: "New project" });
    await dlg.getByLabel("Project name").fill(PROJECT);
    await dlg.getByLabel("Estimated value (₹)").fill("25000000");
    await dlg.getByLabel("Target capacity (kWh)").fill("1000");
    await dlg.getByLabel("BESS engineer").selectOption({ label: "Engineer Tester (BESS Engineer)" });
    await dlg.getByRole("button", { name: "Create project" }).click();
    await expect(page.getByRole("heading", { name: PROJECT, level: 1 })).toBeVisible();
    projectUrl = page.url();

    await page.getByLabel("Stage").selectOption("site_survey");
    await expect(page.getByText("Site survey").first()).toBeVisible();

    await tab(page, /^Bills/);
    const csv = "Consumer name,Units consumed (kWh),Recorded max demand (kVA)\nPlaywright Foods,152000,950\n";
    await page.locator('input[type="file"]').setInputFiles({ name: "bill-2026-10.csv", mimeType: "text/csv", buffer: Buffer.from(csv) });
    await expect(page.getByRole("cell", { name: "bill-2026-10.csv" })).toBeVisible();

    runWorker(); // malware scan + extraction (the test API has AI switched off)
    await page.reload();
    await tab(page, /^Bills/);
    await page.getByRole("link", { name: "bill-2026-10.csv" }).click();
    await expect(page.getByRole("heading", { name: "Extracted values" })).toBeVisible();
    await page.getByLabel("Units consumed (kWh)").fill("152000");
    await page.getByLabel("Recorded max demand (kVA)").fill("950");
    await page.getByLabel("Bill month (YYYY-MM)").fill("2026-10");
    await page.getByRole("button", { name: "Confirm values" }).click();
    await expect(page.locator(".success")).toContainText("confirmed");

    // The automatic estimate appears on the bill as soon as it has values, and on the project's bill tab.
    const est = page.locator("section", { has: page.getByRole("heading", { name: "Automatic estimate" }) });
    await expect(est).toContainText("Suggested battery");
    await expect(est).toContainText("kWh");
    await expect(est).toContainText("from confirmed bills");
    await expect(est).not.toContainText("Gross margin"); // confidential, hidden from sales
    await page.goto(projectUrl);
    await tab(page, /^Bills/);
    await expect(page.getByRole("heading", { name: "Automatic estimate" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Save as configuration" })).toBeVisible();
  });

  test("sales saves a configuration; confidential cost is hidden from sales", async ({ page }) => {
    await login(page, "sales");
    await page.goto(projectUrl);
    await tab(page, /^Calculator/);
    await page.getByRole("button", { name: "New configuration" }).click();
    const dlg = page.getByRole("dialog", { name: "New BESS configuration" });
    await dlg.getByLabel("Configuration name").fill("Option A");
    await dlg.getByRole("button", { name: "Preview" }).click();
    await expect(dlg.getByRole("heading", { name: "Payback" })).toBeVisible();
    await expect(dlg.getByText("Confidential: cost and margin")).toHaveCount(0);
    await dlg.getByRole("button", { name: "Save for validation" }).click();
    await expect(page.getByRole("button", { name: "Option A" })).toBeVisible();
  });

  test("finance sees the confidential cost and margin", async ({ page }) => {
    await login(page, "finance");
    await page.goto("/calculator");
    await page.getByRole("button", { name: "Calculate" }).click();
    await expect(page.getByRole("heading", { name: "Confidential: cost and margin" })).toBeVisible();
  });

  test("engineer validates the configuration", async ({ page }) => {
    await login(page, "engineer");
    await page.goto(projectUrl);
    await tab(page, /^Calculator/);
    await page.getByRole("button", { name: "Option A" }).click();
    await page.getByPlaceholder("Engineering notes").fill("Site suits a 500 kWh / 250 kW container.");
    await page.getByRole("button", { name: "Approve configuration" }).click();
    await expect(page.getByRole("dialog").locator(".badge", { hasText: "approved" })).toBeVisible();
  });

  test("sales generates the proposal and submits it for approval", async ({ page }) => {
    await login(page, "sales");
    await page.goto(projectUrl);
    await tab(page, /^Proposals/);
    await page.getByRole("button", { name: "Option A" }).click();
    await expect(page).toHaveURL(/\/proposals\//);
    proposalUrl = page.url();
    await page.getByRole("button", { name: "Submit for approval" }).click();
    await expect(page.locator(".badge", { hasText: "pending approval" }).first()).toBeVisible();
  });

  test("management approves from the dashboard shortcut", async ({ page }) => {
    await login(page, "mgmt");
    await page.getByRole("link", { name: /Approve proposals/ }).click();
    await expect(page).toHaveURL(/status=pending_approval/);
    await page.goto(proposalUrl);
    await page.getByRole("button", { name: "Approve", exact: true }).click();
    await expect(page.locator(".badge", { hasText: "approved" }).first()).toBeVisible();
  });

  test("sales downloads the PDF, creates and revokes a share link, marks it sent", async ({ page }) => {
    await login(page, "sales");
    await page.goto(proposalUrl);
    const download = page.waitForEvent("download");
    await page.getByRole("button", { name: "Download PDF" }).click();
    expect((await download).suggestedFilename()).toMatch(/SKJ-Proposal-R\d+\.pdf/);

    await page.getByRole("button", { name: "Mark as sent" }).click();
    await expect(page.locator(".badge", { hasText: "sent" }).first()).toBeVisible();

    // (Creating a share link on an approved proposal also marks it sent.)
    await page.getByLabel("Recipient (for the log)").fill("CFO, Playwright Foods");
    await page.getByRole("button", { name: "Create link" }).click();
    await expect(page.getByText(/Link \(shown once\)/)).toBeVisible();
    const link = (await page.locator(".success .mono").textContent()) ?? "";
    expect(link).toMatch(/^http/);
    const row = page.getByRole("row", { name: /CFO, Playwright Foods/ });
    await row.getByRole("button", { name: "Revoke" }).click();
    await expect(row).toContainText(/revoked/i);

    await page.getByRole("button", { name: "Customer accepted" }).click();
    await expect(page.locator(".badge", { hasText: "accepted" }).first()).toBeVisible();
  });

  test("the sales user's notifications include the approval", async ({ page }) => {
    await login(page, "sales");
    await page.goto("/notifications");
    await expect(page.getByText(/approved/i).first()).toBeVisible();
    await page.getByRole("button", { name: "Mark all as read" }).click();
  });

  test("admin deletes the customer (only Super Admin can)", async ({ page }) => {
    await login(page, "sales");
    await page.goto(customerUrl);
    await expect(page.getByRole("button", { name: "Delete customer" })).toHaveCount(0);
    await logout(page);
    await login(page, "admin");
    await page.goto(customerUrl);
    await page.getByRole("button", { name: "Delete customer" }).click();
    await page.getByRole("button", { name: "Yes" }).click();
    await expect(page).toHaveURL(/\/customers$/);
  });
});
