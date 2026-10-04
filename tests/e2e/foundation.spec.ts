import { test, expect, type Page } from "@playwright/test";
import { signInThroughUI } from "./sign-in-helper";
async function signIn(page: Page, suffix = "A") {
  await page.goto("/sign-in");
  await page.getByLabel("Email", { exact: true }).fill(process.env[`TEST_USER_${suffix}_EMAIL`]!);
  await page.getByLabel("Password", { exact: true }).fill(process.env[`TEST_USER_${suffix}_PASSWORD`]!);
  await signInThroughUI(page);
  await expect(page).toHaveURL(/\/calendar$/);
  await expect(page.getByRole("region", { name: "Week calendar", exact: true })).toBeVisible();
}

test("anonymous requests cannot read the account context or protected shell", async ({ page, request }) => {
  const response = await request.get("/api/account");
  expect(response.status()).toBe(401);
  expect(await response.json()).toMatchObject({ error: { code: "UNAUTHENTICATED" } });
  await page.goto("/"); await expect(page).toHaveURL(/\/sign-in$/);
});
test("sign-in, database-backed identity, hard reload, and sign-out", async ({ page }) => {
  await signIn(page);
  const identity = (await (await page.request.get("/api/account")).json()).user.id;
  const account = await page.request.get("/api/account?userId=ignored-browser-input");
  expect(account.status()).toBe(200);
  expect(await account.json()).toMatchObject({ user: { id: identity, email: process.env.TEST_USER_A_EMAIL, timezone: "Europe/London" } });
  expect(account.headers()["cache-control"]).toContain("no-store");
  await page.reload(); expect((await (await page.request.get("/api/account")).json()).user.id).toBe(identity);
  await page.getByLabel("Account menu", { exact: true }).click();
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await expect(page).toHaveURL(/\/sign-in$/);
  expect((await page.request.get("/api/account")).status()).toBe(401);
});
test("independent browsers resolve distinct owned accounts", async ({ browser }) => {
  const a = await browser.newContext(); const b = await browser.newContext();
  try {
    const pa = await a.newPage(); const pb = await b.newPage(); await signIn(pa, "A"); await signIn(pb, "B");
    const aid = (await (await pa.request.get("/api/account")).json()).user.id; const bid = (await (await pb.request.get("/api/account")).json()).user.id;
    expect(aid).not.toBe(bid);
    const response = await pa.request.get(`/api/account?userId=${bid}`);
    expect(await response.json()).toMatchObject({ user: { id: aid, email: process.env.TEST_USER_A_EMAIL } });
    await expect(pa.getByText(process.env.TEST_USER_B_EMAIL!, { exact: true })).toHaveCount(0);
  } finally { await a.close(); await b.close(); }
});

test("quiet header keeps settings direct and account actions keyboard reachable on desktop and mobile", async ({ page }) => {
  await signIn(page);
  for (const size of [{ width: 1280, height: 720 }, { width: 390, height: 844 }]) {
    await page.setViewportSize(size);
    const menu = page.getByLabel("Account menu", { exact: true });
    await expect(page.locator(".app-header").getByRole("link", { name: "Settings", exact: true })).toBeInViewport();
    await expect(page.getByRole("button", { name: "Sign out", exact: true })).toBeHidden();
    await menu.focus(); await menu.press("Enter");
    await expect(page.getByRole("navigation", { name: "More destinations" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Sign out", exact: true })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(menu).toBeFocused();
    await expect(page.locator(".account-menu")).not.toHaveAttribute("open");
    await menu.click(); await page.locator(".app-header").click({ position: { x: 4, y: 4 } });
    await expect(page.locator(".account-menu")).not.toHaveAttribute("open");
  }
  await page.locator(".app-header").getByRole("link", { name: "Settings", exact: true }).click();
  await expect(page.getByRole("navigation", { name: "Settings sections" })).toBeVisible();
  await expect(page.locator(".header-settings-link")).toHaveAttribute("aria-current", "page");
});
test("incorrect credentials fail clearly and narrow layouts stay usable", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 }); await page.goto("/sign-in");
  await page.getByLabel("Email", { exact: true }).fill(process.env.TEST_USER_A_EMAIL!);
  await page.getByLabel("Password", { exact: true }).fill("incorrect-password");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.locator("#sign-in-error")).toHaveText("Sign-in failed. Check your email and password.");
  await expect(page.getByRole("button", { name: "Sign in", exact: true })).toBeEnabled();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  expect(overflow).toBe(false);
});
