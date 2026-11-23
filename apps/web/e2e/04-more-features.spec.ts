import { expect, test, type Page } from "@playwright/test";
import { fx, lastEmailLink, login, logout, runWorker, totp } from "./helpers";

const tab = (page: Page, name: RegExp | string) => page.getByRole("tab", { name }).click();

/** Opens the first project of a seeded customer that the test sales user owns. */
async function openSalesProject(page: Page, customer: string): Promise<string> {
  await page.goto("/customers");
  await page.getByRole("link", { name: customer }).click();
  await tab(page, /^Projects/);
  await page.getByRole("cell").getByRole("link").first().click();
  await expect(page).toHaveURL(/\/projects\//);
  return page.url();
}

test.describe("Layout", () => {
  test("Log out stays reachable on a short laptop screen with the longest (admin) menu", async ({ page }) => {
    await page.setViewportSize({ width: 1366, height: 600 });
    await login(page, "admin");
    const btn = page.getByRole("button", { name: "Log out" });
    await expect(btn).toBeInViewport();
    await expect(page.getByLabel("Main navigation").getByRole("link", { name: "My profile & security" })).toBeAttached();
    await logout(page);
  });
});

test.describe.serial("Account: two-step verification from the profile", () => {
  test("a user turns MFA on, needs a code to log in, then turns it off", async ({ page }) => {
    const f = fx();
    await login(page, "sales2");
    await page.goto("/profile");
    await page.getByRole("button", { name: "Set up MFA" }).click();
    await expect(page.getByAltText("MFA QR code")).toBeVisible();
    const secret = ((await page.locator(".mono").first().textContent()) ?? "").trim();
    expect(secret).toMatch(/^[A-Z2-7]{16,}$/);
    await page.getByLabel("6-digit code").fill(await totp(secret));
    await page.getByRole("button", { name: "Turn on MFA" }).click();
    await expect(page.getByRole("button", { name: "Turn off MFA" })).toBeVisible();

    await logout(page);
    await page.getByLabel("Work email").fill(f.users.sales2.email);
    await page.getByLabel("Password", { exact: true }).fill(f.password);
    await page.getByRole("button", { name: "Log in" }).click();
    await page.getByLabel(/^6-digit code/).fill(await totp(secret));
    await page.getByRole("button", { name: "Verify" }).click();
    await expect(page.getByLabel("Main navigation")).toBeVisible();

    await page.goto("/profile");
    await page.getByLabel("Password", { exact: true }).fill(f.password);
    await page.getByLabel("Current code").fill(await totp(secret));
    await page.getByRole("button", { name: "Turn off MFA" }).click();
    await expect(page.getByRole("button", { name: "Set up MFA" })).toBeVisible();
  });
});

test.describe.serial("Bills: view original, re-extract, delete", () => {
  test("sales uploads a bill, views the original, re-extracts it and deletes it", async ({ page }) => {
    await login(page, "sales");
    await page.goto("/customers");
    await page.getByRole("link", { name: "Shree Textiles Pvt Ltd" }).click();
    await tab(page, "Electricity bills");
    await page.locator('input[type="file"]').setInputFiles({ name: "march-bill.csv", mimeType: "text/csv",
      buffer: Buffer.from("Units consumed (kWh),Recorded max demand (kVA)\n98000,610\n") });
    await expect(page.getByRole("link", { name: "march-bill.csv" })).toBeVisible();
    runWorker();
    await page.getByRole("link", { name: "march-bill.csv" }).click();

    // The original is shown (or offered for download) only after the malware scan passed.
    await expect(page.getByRole("heading", { name: "Original document" })).toBeVisible();
    const download = page.waitForEvent("download");
    await page.getByRole("button", { name: "Download" }).click();
    expect((await download).suggestedFilename()).toBe("march-bill.csv");

    await page.getByRole("button", { name: "Re-extract" }).click();
    await expect(page.locator(".badge", { hasText: /queued|scanning|extracting/ }).first()).toBeVisible();
    runWorker();
    await page.reload();
    await expect(page.locator(".badge", { hasText: "needs review" }).first()).toBeVisible();

    await page.getByRole("button", { name: "Delete" }).click();
    await page.getByRole("button", { name: "Yes" }).click();
    await expect(page).not.toHaveURL(/\/bills\//);
  });
});

test.describe.serial("Configurations and proposal lifecycle", () => {
  let projectUrl = "";
  let proposalUrl = "";

  test("sales assigns the engineer, saves two configurations and compares them", async ({ page }) => {
    await login(page, "sales");
    projectUrl = await openSalesProject(page, "Thar Cement");
    await page.getByLabel("BESS engineer").selectOption({ label: "Engineer Tester" });
    await expect(page.getByLabel("BESS engineer")).not.toHaveValue("");
    await tab(page, /^Calculator/);
    for (const [name, kwh] of [["Compact 500", "500"], ["Large 1000", "1000"]]) {
      await page.getByRole("button", { name: "New configuration" }).click();
      const dlg = page.getByRole("dialog", { name: "New BESS configuration" });
      await dlg.getByLabel("Configuration name").fill(name);
      await dlg.getByLabel("Battery capacity (kWh)").fill(kwh);
      await dlg.getByRole("button", { name: "Save for validation" }).click();
      await expect(page.getByRole("button", { name })).toBeVisible();
    }
    await page.getByLabel("Select Compact 500").check();
    await page.getByLabel("Select Large 1000").check();
    await page.getByRole("button", { name: "Compare 2" }).click();
    const cmp = page.getByRole("table").filter({ hasText: "Metric" });
    await expect(cmp).toContainText("Capacity (kWh)");
    await expect(cmp).toContainText("Compact 500");
    await expect(cmp).toContainText("Large 1000");
  });

  test("engineer validates, sales generates and submits; management returns it for changes", async ({ page }) => {
    await login(page, "engineer");
    await page.goto(projectUrl);
    await tab(page, /^Calculator/);
    await page.getByRole("button", { name: "Compact 500" }).click();
    await page.getByRole("button", { name: "Approve configuration" }).click();
    await expect(page.getByRole("dialog").locator(".badge", { hasText: "approved" })).toBeVisible();
    await page.keyboard.press("Escape"); // close the configuration dialog
    await logout(page);

    await login(page, "sales");
    await page.goto(projectUrl);
    await tab(page, /^Proposals/);
    await page.getByRole("button", { name: "Compact 500" }).click();
    await expect(page).toHaveURL(/\/proposals\//);
    proposalUrl = page.url();
    await page.getByRole("button", { name: "Submit for approval" }).click();
    await expect(page.locator(".badge", { hasText: "pending approval" }).first()).toBeVisible();
    await logout(page);

    await login(page, "mgmt");
    await page.goto(proposalUrl);
    await page.getByLabel("Note (optional)").fill("Please add the DG-replacement saving.");
    await page.getByRole("button", { name: "Return for changes" }).click();
    await expect(page.locator(".badge", { hasText: "rejected" }).first()).toBeVisible();
  });

  test("sales resubmits, management approves, the customer declines; a new revision can be generated", async ({ page }) => {
    await login(page, "sales");
    await page.goto(proposalUrl);
    await expect(page.getByText(/DG-replacement/)).toBeVisible();
    await page.getByRole("button", { name: "Submit for approval" }).click();
    await expect(page.locator(".badge", { hasText: "pending approval" }).first()).toBeVisible();
    await logout(page);

    await login(page, "mgmt");
    await page.goto(proposalUrl);
    await page.getByRole("button", { name: "Approve", exact: true }).click();
    await expect(page.locator(".badge", { hasText: "approved" }).first()).toBeVisible();
    await page.getByRole("button", { name: "Customer declined" }).click();
    await page.getByRole("button", { name: "Yes" }).click();
    await expect(page.locator(".badge", { hasText: "declined" }).first()).toBeVisible();
    await logout(page);

    await login(page, "sales");
    await page.goto(projectUrl);
    await tab(page, /^Proposals/);
    await page.getByRole("button", { name: "Compact 500" }).click();
    await expect(page.getByRole("heading", { level: 1 })).toContainText("R2");
  });
});

test.describe.serial("User administration: reject, unlock, reset MFA", () => {
  test("admin rejects a verified sign-up", async ({ page }) => {
    const email = `e2e.reject.${Date.now()}@skjenergy.com`;
    await page.goto("/signup");
    await page.getByLabel("Full name").fill("Temp Contractor");
    await page.getByLabel(/^Work email/).fill(email);
    await page.getByLabel(/^Password/).fill("Copper kettle morning 2026");
    await page.getByLabel("Confirm password").fill("Copper kettle morning 2026");
    await page.getByRole("button", { name: "Sign up" }).click();
    await expect(page.getByRole("heading", { name: "Check your email" })).toBeVisible();
    await page.goto(lastEmailLink(email, "/verify-email"));
    await expect(page.locator(".success")).toBeVisible();

    await login(page, "admin");
    await page.goto("/admin/users");
    const row = page.getByRole("row", { name: new RegExp(email.replace(/\./g, "\\.")) });
    await row.getByRole("button", { name: "Reject" }).click();
    await row.getByRole("button", { name: "Yes" }).click();
    await expect(page.getByRole("row", { name: new RegExp(email.replace(/\./g, "\\.")) })).toHaveCount(0);
    await page.getByRole("tab", { name: "All users" }).click();
    await expect(page.getByRole("row", { name: new RegExp(email.replace(/\./g, "\\.")) })).toContainText("rejected");
  });

  test("five wrong passwords lock an account; admin unlocks it and the user can log in", async ({ page }) => {
    const f = fx();
    for (let i = 0; i < 5; i++) {
      await page.goto("/login");
      await page.getByLabel("Work email").fill(f.users.readonly.email);
      await page.getByLabel("Password", { exact: true }).fill(`Wrong password attempt ${i}`);
      await page.getByRole("button", { name: "Log in" }).click();
      await expect(page.getByRole("alert")).toBeVisible();
    }
    // Even the right password is refused while locked.
    await page.getByLabel("Password", { exact: true }).fill(f.password);
    await page.getByRole("button", { name: "Log in" }).click();
    await expect(page.getByRole("alert")).toBeVisible();

    await login(page, "admin");
    await page.goto("/admin/users");
    await page.getByRole("tab", { name: "All users" }).click();
    const row = page.getByRole("row", { name: /e2e\.readonly@skjenergy\.com/ });
    await expect(row.locator(".badge", { hasText: "locked" })).toBeVisible();
    await row.getByRole("button", { name: "Unlock" }).click();
    await expect(row.getByRole("button", { name: "Unlock" })).toHaveCount(0);
    await logout(page);
    await login(page, "readonly");
  });

  test("admin resets a user's MFA; that user must set it up again at next login", async ({ page }) => {
    await login(page, "admin");
    await page.goto("/admin/users");
    await page.getByRole("tab", { name: "Active" }).click();
    const row = page.getByRole("row", { name: /e2e\.finance@skjenergy\.com/ });
    await expect(row).toContainText("On");
    await row.getByRole("button", { name: "Edit" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Reset MFA" }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(page.getByRole("row", { name: /e2e\.finance@skjenergy\.com/ })).toContainText("Off");
    await logout(page);

    const f = fx();
    await page.getByLabel("Work email").fill(f.users.finance.email);
    await page.getByLabel("Password", { exact: true }).fill(f.password);
    await page.getByRole("button", { name: "Log in" }).click();
    await expect(page.getByRole("heading", { name: "Set up two-step verification" })).toBeVisible();
    await expect(page.getByLabel("Main navigation")).toHaveCount(0);
  });
});

test.describe("New quotation upload", () => {
  test("choosing a bill in the picker uploads it and moves on to checking the values", async ({ page }) => {
    await login(page, "sales");
    await page.goto("/quotations/new");
    await page.locator('input[type="file"]').setInputFiles({ name: "quote-bill.csv", mimeType: "text/csv",
      buffer: Buffer.from("Units consumed (kWh),Recorded max demand (kVA)\n98000,610\n") });
    // Regression: the picker used to be cleared before the upload read it, sending no file ("files: Field required").
    await expect(page).toHaveURL(/step=1/);
    await expect(page.getByText("Field required")).toHaveCount(0);
    await expect(page.locator('[aria-current="step"]')).toContainText("Check the values");
  });
});
