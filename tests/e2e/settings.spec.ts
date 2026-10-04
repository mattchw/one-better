import { test, expect } from "@playwright/test";
import { signInThroughUI } from "./sign-in-helper";

test("settings sidebar retains unsaved hours and shows only the signed-in account across responsive views", async ({ page, browser }) => {
  await page.goto("/sign-in");
  await page.getByLabel("Email", { exact: true }).fill(process.env.TEST_USER_A_EMAIL!);
  await page.getByLabel("Password", { exact: true }).fill(process.env.TEST_USER_A_PASSWORD!);
  await signInThroughUI(page);
  await page.goto("/settings");
  await expect(page).toHaveURL(/\/availability$/);
  const before = await (await page.request.get("/api/weekly-plans")).json();
  const account = (await (await page.request.get("/api/account")).json()).user;
  const saved = (await (await page.request.get("/api/focusable-hours")).json()).schedule;
  // A blank window is deliberately incomplete; switching sections must let the
  // user retain it without writing hours or changing weekly plan facts.
  await page.getByRole("button", { name: "Add Sunday window" }).click();
  await page.getByLabel("Sunday window 1 start", { exact: true }).fill("10:00");
  const dialog = page.waitForEvent("dialog");
  const click = page.getByRole("navigation", { name: "Settings sections" }).getByRole("link", { name: /^Account/ }).click();
  const warning = await dialog;
  expect(warning.type()).toBe("beforeunload");
  await warning.dismiss(); await click;
  await expect(page).toHaveURL(/\/availability$/);
  await expect(page.getByLabel("Sunday window 1 start", { exact: true })).toHaveValue("10:00");
  expect((await (await page.request.get("/api/focusable-hours")).json()).schedule).toEqual(saved);
  await page.getByRole("button", { name: "Discard unsaved hours" }).click();
  await expect(page.getByRole("button", { name: "Save Focusable Hours", exact: true })).toBeDisabled();
  await page.getByRole("navigation", { name: "Settings sections" }).getByRole("link", { name: /^Account/ }).press("Enter");
  await expect(page).toHaveURL(/\/settings\/account$/);
  const profile = page.getByRole("region", { name: "Account", exact: true });
  await expect(profile).toContainText(account.name);
  await expect(profile).toContainText(account.email);
  await expect(profile).toContainText(account.timezone);
  await expect(profile.locator("input, select")).toHaveCount(0);
  await expect(page.getByRole("navigation", { name: "Settings sections" }).getByRole("link", { name: /^Account/ })).toHaveAttribute("aria-current", "page");
  for (const width of [1024, 390]) {
    await page.setViewportSize({ width, height: 844 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
  await page.getByRole("navigation", { name: "Settings sections" }).getByRole("link", { name: /^Integrations/ }).click();
  await expect(page.getByRole("heading", { name: "Integrations", exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(await (await page.request.get("/api/weekly-plans")).json()).toEqual(before);
  const anonymous = await browser.newContext();
  const guest = await anonymous.newPage();
  await guest.goto("http://127.0.0.1:3101/settings/account");
  await expect(guest).toHaveURL(/\/sign-in$/);
  await anonymous.close();
});
