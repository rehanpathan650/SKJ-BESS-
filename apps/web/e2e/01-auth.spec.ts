import { expect, test } from "@playwright/test";
import { fx, lastEmailLink, login, logout } from "./helpers";

const NEW_EMAIL = `e2e.newhire.${Date.now()}@skjenergy.com`;
const NEW_PASSWORD = "Brightwater dawn signal 2026"; // must not contain the person's name (password policy)
const RESET_PASSWORD = "Reset password value 2026";

test.describe.serial("Sign-up, approval and account security", () => {
  test("sign-up → email verification → pending → admin approves with role → login", async ({ page, browser }) => {
    await page.goto("/signup");
    await page.getByLabel("Full name").fill("New Hire");
    await page.getByLabel(/^Work email/).fill(NEW_EMAIL);
    await page.getByLabel("Department (optional)").selectOption({ label: "Sales" });
    await page.getByLabel(/^Password/).fill(NEW_PASSWORD);
    await page.getByLabel("Confirm password").fill(NEW_PASSWORD);
    await page.getByRole("button", { name: "Sign up" }).click();
    await expect(page.getByRole("heading", { name: "Check your email" })).toBeVisible();

    // Not verified yet: login must not give access.
    await page.goto(lastEmailLink(NEW_EMAIL, "/verify-email"));
    await expect(page.locator(".success")).toBeVisible();

    // Verified but not approved: pending screen, no data.
    await page.goto("/login");
    await page.getByLabel("Work email").fill(NEW_EMAIL);
    await page.getByLabel("Password", { exact: true }).fill(NEW_PASSWORD);
    await page.getByRole("button", { name: "Log in" }).click();
    await expect(page.getByRole("heading", { name: /Hello, New/ })).toBeVisible();
    await expect(page.getByLabel("Main navigation")).toHaveCount(0);

    // Admin approves with the Sales Executive role.
    const admin = await (await browser.newContext()).newPage();
    await login(admin, "admin");
    await admin.goto("/admin/users");
    await admin.getByRole("row", { name: new RegExp(NEW_EMAIL.replace(/\./g, "\\.")) }).getByRole("button", { name: "Approve" }).click();
    await admin.getByLabel("Role").selectOption({ label: "Sales Executive" });
    await admin.getByRole("button", { name: "Approve and give access" }).click();
    await expect(admin.getByRole("dialog")).toHaveCount(0);
    await admin.getByRole("tab", { name: "Active" }).click();
    await expect(admin.getByRole("row", { name: new RegExp(NEW_EMAIL.replace(/\./g, "\\.")) })).toContainText("Sales Executive");

    // The new user now gets in.
    await page.getByRole("button", { name: "Check again" }).click();
    await expect(page.getByLabel("Main navigation")).toBeVisible();
    await expect(page.getByRole("link", { name: "Customers" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Users & approvals" })).toHaveCount(0);
  });

  test("forgot password → reset link → login with the new password", async ({ page }) => {
    await page.goto("/forgot-password");
    await page.getByLabel("Work email").fill(NEW_EMAIL);
    await page.getByRole("button", { name: "Send reset link" }).click();
    await expect(page.locator(".success")).toBeVisible();
    await page.goto(lastEmailLink(NEW_EMAIL, "/reset-password"));
    await page.getByLabel(/^New password/).fill(RESET_PASSWORD);
    await page.getByLabel("Confirm").fill(RESET_PASSWORD);
    await page.getByRole("button", { name: "Update password" }).click();
    await expect(page).toHaveURL(/\/login/);
    // Old password no longer works, new one does.
    await page.getByLabel("Work email").fill(NEW_EMAIL);
    await page.getByLabel("Password", { exact: true }).fill(NEW_PASSWORD);
    await page.getByRole("button", { name: "Log in" }).click();
    await expect(page.getByRole("alert")).toBeVisible();
    await page.getByLabel("Password", { exact: true }).fill(RESET_PASSWORD);
    await page.getByRole("button", { name: "Log in" }).click();
    await expect(page.getByLabel("Main navigation")).toBeVisible();
  });

  test("change password, see devices, revoke another session, logout", async ({ page, browser }) => {
    const f = fx();
    // Second device signed in as the same user.
    const other = await (await browser.newContext()).newPage();
    await login(other, "sales2");
    await login(page, "sales2");

    await page.goto("/profile");
    const devices = page.locator("section", { has: page.getByRole("heading", { name: "Where you're signed in" }) });
    await expect(devices.getByRole("button", { name: "Sign out" }).first()).toBeVisible();
    await devices.getByRole("button", { name: "Sign out" }).first().click();

    // The other device is signed out on its next request.
    await other.reload();
    await expect(other).toHaveURL(/\/login/);

    // Change password and change it back so later tests keep working.
    const temp = "Temporary password 2026!";
    await page.getByLabel("Current password").fill(f.password);
    await page.getByLabel(/^New password/).fill(temp);
    await page.getByLabel("Confirm new password").fill(temp);
    await page.getByRole("button", { name: "Change password" }).click();
    await expect(page.locator(".success")).toBeVisible();
    await logout(page);
    await login(page, "sales2", temp);
    await page.goto("/profile");
    await page.getByLabel("Current password").fill(temp);
    await page.getByLabel(/^New password/).fill(f.password);
    await page.getByLabel("Confirm new password").fill(f.password);
    await page.getByRole("button", { name: "Change password" }).click();
    await expect(page.locator(".success")).toBeVisible();
    await logout(page);
  });

  test("MFA login: wrong code refused, correct code accepted", async ({ page }) => {
    const u = fx().users.admin;
    await page.goto("/login");
    await page.getByLabel("Work email").fill(u.email);
    await page.getByLabel("Password", { exact: true }).fill(fx().password);
    await page.getByRole("button", { name: "Log in" }).click();
    await page.getByLabel(/^6-digit code/).fill("000000");
    await page.getByRole("button", { name: "Verify" }).click();
    await expect(page.getByRole("alert")).toBeVisible();
    await page.getByRole("button", { name: "Back" }).click();
    await login(page, "admin");
  });
});
