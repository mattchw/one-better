import { test, expect } from "@playwright/test";
import { signInThroughUI } from "./sign-in-helper";

test("appearance persists across pages, follows system changes, and remains usable without storage", async ({ page, context, browser }) => {
  test.setTimeout(90000);
  await page.emulateMedia({ colorScheme: "dark" });
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.goto("/sign-in");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await page.getByLabel("Email", { exact: true }).fill(process.env.TEST_USER_A_EMAIL!);
  await page.getByLabel("Password", { exact: true }).fill(process.env.TEST_USER_A_PASSWORD!);
  await signInThroughUI(page);
  const before = await (await page.request.get("/api/weekly-plans")).json();
  await page.goto("/settings/appearance");
  await expect(page.getByRole("heading", { name: "Appearance", exact: true })).toBeVisible();
  await page.getByRole("radio", { name: /^Dark/ }).check();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.reload();
  await expect(page.getByRole("radio", { name: /^Dark/ })).toBeChecked();
  // The shared header changes the same saved preference as Settings.
  await page.getByRole("button", {name:"Switch to light mode"}).click();
  await expect(page.getByRole("radio", {name:/^Light/})).toBeChecked();
  await page.goto("/goals");
  await page.getByRole("button", {name:"Switch to dark mode"}).click();
  await page.goto("/settings/appearance");
  await expect(page.getByRole("radio", {name:/^Dark/})).toBeChecked();
  const colours = await page.locator(".settings-content").evaluate(el => {
    const style = getComputedStyle(el);
    return { background: style.backgroundColor, text: style.color };
  });
  const luminance = (rgb: string) => {
    const channels = rgb.match(/[\d.]+/g)!.slice(0, 3).map(Number).map(n => n / 255).map(n => n <= .04045 ? n / 12.92 : ((n + .055) / 1.055) ** 2.4);
    return channels[0] * .2126 + channels[1] * .7152 + channels[2] * .0722;
  };
  const background = luminance(colours.background), text = luminance(colours.text);
  expect(background).toBeLessThan(.1);
  expect((text + .05) / (background + .05)).toBeGreaterThanOrEqual(4.5);
  await page.screenshot({ path: ".cache/theme-settings-dark.png", fullPage: true });
  for (const path of ["/calendar", "/goals", "/focus", "/review", "/settings/account", "/availability", "/integrations"]) {
    await page.goto(path);
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    await expect(page.getByRole("navigation", { name: "Main navigation" })).toBeVisible();
  }
  await page.screenshot({ path: ".cache/theme-integrations-dark.png", fullPage: true });
  await page.goto("/settings/appearance");
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: ".cache/theme-settings-dark-mobile.png", fullPage: true });
  await page.getByRole("radio", { name: /^Light/ }).check();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await page.screenshot({ path: ".cache/theme-settings-light-mobile.png", fullPage: true });
  await page.getByRole("radio", { name: /^System/ }).check();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.emulateMedia({ colorScheme: "light" });
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await page.reload();
  await expect(page.getByRole("radio", { name: /^System/ })).toBeChecked();
  const other = await context.newPage();
  await other.goto("/settings/appearance");
  await page.getByRole("radio", { name: /^Dark/ }).check();
  await expect(other.locator("html")).toHaveAttribute("data-theme", "dark");
  await expect(other.getByRole("radio", { name: /^Dark/ })).toBeChecked();
  await other.close();
  expect(await (await page.request.get("/api/weekly-plans")).json()).toEqual(before);
  expect(errors).toEqual([]);

  const blocked = await browser.newContext({ storageState: await context.storageState() });
  await blocked.addInitScript(() => {
    Object.defineProperty(window, "localStorage", { get() { throw new DOMException("Blocked", "SecurityError"); } });
  });
  const restricted = await blocked.newPage();
  const restrictedErrors: string[] = [];
  restricted.on("pageerror", error => restrictedErrors.push(error.message));
  await restricted.goto("http://127.0.0.1:3101/settings/appearance");
  await restricted.getByRole("radio", { name: /^Dark/ }).check();
  await expect(restricted.locator("html")).toHaveAttribute("data-theme", "dark");
  await expect(restricted.getByRole("status")).toContainText("Theme applied for this visit");
  expect(restrictedErrors).toEqual([]);
  await blocked.close();
});
