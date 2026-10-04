import { signInThroughUI } from "./sign-in-helper";
import { test, expect, request as apiRequest, type Page, type APIRequestContext } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { inArray } from "drizzle-orm";
import { connectDatabase } from "../../src/db/connect";
import { focusSession, timeBlock, commitmentIdentity, weeklyPlanAmendment, amendmentCommitment, weeklyPlan, weeklyCommitment, action, goal, milestone, mutationReceipt, user } from "../../src/db/schema";
import { requireTestDatabaseURL } from "../../scripts/test-database";
const origin = "http://127.0.0.1:3101";
let stateA: Awaited<ReturnType<APIRequestContext["storageState"]>>;
let stateB: typeof stateA;
let database: ReturnType<typeof connectDatabase>;
let ownerIds: string[];
const command = (overrides = {}) => ({ mutationId: randomUUID(), title: "Launch a useful planning system", outcome: "I rely on the system each week.", ...overrides });
async function signIn(page: Page) {
  await page.goto("/sign-in");
  await page.getByLabel("Email", { exact: true }).fill(process.env.TEST_USER_A_EMAIL!);
  await page.getByLabel("Password", { exact: true }).fill(process.env.TEST_USER_A_PASSWORD!);
  await signInThroughUI(page);
  await expect(page).toHaveURL(/\/calendar$/);
  await page.getByRole("navigation",{name:"Main navigation"}).getByRole("link",{name:"Goals",exact:true}).click();
  await expect(page.getByRole("heading", { name: "Goals", exact: true })).toBeVisible();
}
async function fillGoal(page: Page, title: string, outcome: string) {
  await page.getByLabel("Title", { exact: true }).fill(title); await page.getByLabel("Outcome", { exact: true }).fill(outcome);
}
async function apiCreate(page: Page, input = command()) {
  const response = await page.request.post("/api/goals", { headers: { Origin: origin }, data: input });
  expect(response.status()).toBe(200); return (await response.json()).goal;
}
test.beforeAll(async () => {
  test.setTimeout(90000);
  const target = requireTestDatabaseURL();
  if (target.name === "execution_test") throw new Error("Goal browser tests require the runner's newly isolated database.");
  database = connectDatabase(target.url);
  const rows = await database.db.select({ id: user.id }).from(user); ownerIds = rows.map((r) => r.id);
  for (const suffix of ["A", "B"]) {
    const context = await apiRequest.newContext({ baseURL: origin });
    const login = () => context.post("/api/auth/sign-in/email", { headers: { Origin: origin }, data: { email: process.env[`TEST_USER_${suffix}_EMAIL`], password: process.env[`TEST_USER_${suffix}_PASSWORD`] } });
    let response = await login();
    if (response.status() === 429) { const retry = Number(response.headers()["retry-after"] ?? 60); await new Promise(resolve => setTimeout(resolve, (Math.max(1, retry) + 1) * 1000)); response = await login(); }
    expect(response.status()).toBe(200);
    if (suffix === "A") stateA = await context.storageState(); else stateB = await context.storageState();
    await context.dispose();
  }
});
test.beforeEach(async ({ page }) => {
  // Test-only cleanup of two provisioned users in the newly created disposable DB.
  await database.db.delete(mutationReceipt).where(inArray(mutationReceipt.ownerId, ownerIds));
  await database.db.delete(amendmentCommitment).where(inArray(amendmentCommitment.ownerId, ownerIds)); await database.db.delete(weeklyPlanAmendment).where(inArray(weeklyPlanAmendment.ownerId, ownerIds)); await database.db.delete(focusSession).where(inArray(focusSession.ownerId, ownerIds)); await database.db.delete(timeBlock).where(inArray(timeBlock.ownerId, ownerIds)); await database.db.delete(commitmentIdentity).where(inArray(commitmentIdentity.ownerId, ownerIds)); await database.db.delete(weeklyCommitment).where(inArray(weeklyCommitment.ownerId, ownerIds)); await database.db.delete(weeklyPlan).where(inArray(weeklyPlan.ownerId, ownerIds)); await database.db.delete(action).where(inArray(action.ownerId, ownerIds)); await database.db.delete(milestone).where(inArray(milestone.ownerId, ownerIds));
  await database.db.delete(goal).where(inArray(goal.ownerId, ownerIds));
  await page.context().addCookies(stateA.cookies);
});
test.afterAll(async () => { await database?.pool.end(); });

test("sign in, empty outcome state, create, reload, independent browser, edit/cancel and soft archive", async ({ page, browser }) => {
  test.setTimeout(90000);
  await page.context().clearCookies(); await signIn(page);
  await expect(page.getByText("No active goals yet.", { exact: false })).toBeVisible();
  await page.getByRole("button", { name: "Create goal", exact: true }).click();
  await expect(page.getByLabel("Title", { exact: true })).toBeFocused();
  await fillGoal(page, "Launch One Better MVP", "I have a usable planning system\nthat I rely on every week.");
  await page.getByRole("button", { name: "Save goal", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  const card = page.locator(".goal-card"); await expect(card).toContainText("I have a usable planning system");
  const id = await card.getAttribute("data-goal-id");
  await page.reload(); await expect(page.locator(`[data-goal-id="${id}"]`)).toBeVisible();
  const independent = await browser.newContext({ storageState: stateA });
  try { const other = await independent.newPage(); await other.goto("/goals"); await expect(other.locator(`[data-goal-id="${id}"]`)).toBeVisible(); } finally { await independent.close(); }
  await page.getByRole("button", { name: "Edit Launch One Better MVP", exact: true }).click();
  await fillGoal(page, "Unsaved draft", "Should be discarded"); await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(card).toContainText("Launch One Better MVP"); await expect(page.getByRole("button", { name: "Edit Launch One Better MVP", exact: true })).toBeFocused();
  await page.getByRole("button", { name: "Edit Launch One Better MVP", exact: true }).click();
  await fillGoal(page, "Use the planning loop", "I plan and review four real weeks."); await page.getByRole("button", { name: "Save goal", exact: true }).click();
  await expect(card).toContainText("I plan and review four real weeks.");
  expect((await (await page.request.get(`/api/goals/${id}`)).json()).goal.version).toBe(2);
  await page.getByRole("button", { name: "Archive Use the planning loop", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Archive this goal?" })).toBeVisible();
  await page.getByRole("button", { name: "Cancel", exact: true }).click(); await expect(card).toBeVisible();
  await page.getByRole("button", { name: "Archive Use the planning loop", exact: true }).click(); await page.getByRole("button", { name: "Archive goal", exact: true }).click();
  await expect(page.locator(".goal-card")).toHaveCount(0);
  await page.getByRole("button", { name: "Archived", exact: true }).click(); await expect(page.locator(`[data-goal-id="${id}"]`)).toContainText("I plan and review four real weeks.");
  await page.reload(); // The selected archive view survives reload.
  await expect(page.locator(`[data-goal-id="${id}"]`)).toBeVisible(); await page.getByRole("button", { name: "Active", exact: true }).click(); await expect(page.locator(".goal-card")).toHaveCount(0); await page.reload(); await expect(page.locator(".goal-card")).toHaveCount(0);
  expect((await (await page.request.get(`/api/goals/${id}`)).json()).goal.version).toBe(3);
});

test("two-tab edit conflict retains draft and requires explicit review before saving", async ({ page }) => {
  const original = await apiCreate(page);
  await page.goto("/goals"); const other = await page.context().newPage(); await other.goto("/goals");
  for (const current of [page, other]) await current.getByRole("button", { name: `Edit ${original.title}`, exact: true }).click();
  await fillGoal(page, "Saved elsewhere", "The first version wins."); await page.getByRole("button", { name: "Save goal", exact: true }).click(); await expect(page.getByRole("dialog")).toHaveCount(0);
  await fillGoal(other, "My attempted title", "My retained draft"); await other.getByRole("button", { name: "Save goal", exact: true }).click();
  await expect(other.locator(".goals-section [role=alert]")).toContainText("changed elsewhere"); await expect(other.getByLabel("Outcome", { exact: true })).toHaveValue("My retained draft");
  await expect(other.getByRole("button", { name: "Save goal", exact: true })).toBeDisabled();
  await other.getByLabel("Outcome", { exact: true }).fill("My adjusted draft"); await expect(other.getByRole("button", { name: "Save goal", exact: true })).toBeDisabled();
  expect((await (await page.request.get(`/api/goals/${original.id}`)).json()).goal).toMatchObject({ title: "Saved elsewhere", version: 2 });
  await other.getByRole("button", { name: "Review latest saved version" }).click();
  await expect(other.getByText("Latest saved version reviewed.", { exact: false })).toBeVisible(); await expect(other.getByLabel("Outcome", { exact: true })).toHaveValue("My adjusted draft");
  await other.getByRole("button", { name: "Save goal", exact: true }).click(); await expect(other.getByRole("dialog")).toHaveCount(0);
  expect((await (await page.request.get(`/api/goals/${original.id}`)).json()).goal).toMatchObject({ title: "My attempted title", outcome: "My adjusted draft", version: 3 });
  await other.close();
});

test("stale archive needs review and an archived goal cannot be reopened by a stale editor", async ({ page }) => {
  const original = await apiCreate(page); await page.goto("/goals");
  await page.getByRole("button", { name: `Archive ${original.title}`, exact: true }).click();
  const changed = await page.request.patch(`/api/goals/${original.id}`, { headers: { Origin: origin }, data: { mutationId: randomUUID(), expectedVersion: 1, title: "A newer goal", outcome: "The latest outcome" } }); expect(changed.status()).toBe(200);
  await page.getByRole("button", { name: "Archive goal", exact: true }).click(); await expect(page.locator(".goals-section [role=alert]")).toContainText("changed elsewhere");
  expect((await (await page.request.get(`/api/goals/${original.id}`)).json()).goal.archivedAt).toBeNull();
  await page.getByRole("button", { name: "Review latest saved version" }).click(); await page.getByRole("button", { name: "Archive goal", exact: true }).click();
  await expect(page.locator(".goal-card")).toHaveCount(0);
  const second = await apiCreate(page, command({ title: "Keep identity" })); await page.reload(); await page.getByRole("button", { name: "Edit Keep identity", exact: true }).click();
  await fillGoal(page, "My unsaved edit", "Don't lose this draft");
  const archived = await page.request.post(`/api/goals/${second.id}/archive`, { headers: { Origin: origin }, data: { mutationId: randomUUID(), expectedVersion: 1 } }); expect(archived.status()).toBe(200);
  await page.getByRole("button", { name: "Save goal", exact: true }).click(); await expect(page.locator(".goals-section [role=alert]")).toContainText("Archived");
  await page.getByRole("button", { name: "Review latest saved version" }).click(); await expect(page.locator(".goals-section [role=alert]")).toContainText("now archived");
  await expect(page.getByLabel("Outcome", { exact: true })).toHaveValue("Don't lose this draft"); await expect(page.getByRole("button", { name: "Save goal", exact: true })).toBeDisabled();
  expect((await (await page.request.get(`/api/goals/${second.id}`)).json()).goal.archivedAt).not.toBeNull();
});

test("lost acknowledgement after commit retries the identical create/edit/archive commands", async ({ page }) => {
  await page.goto("/goals"); await page.getByRole("button", { name: "Create goal", exact: true }).click(); await fillGoal(page, "One logical goal", "Saved once despite a lost response.");
  const captured: string[] = [];
  async function loseNext(url: string, method: string) {
    let lost = false;
    await page.route(url, async (route) => {
      if (route.request().method() !== method) return route.continue();
      captured.push(route.request().postData()!);
      if (!lost) { lost = true; const response = await route.fetch(); expect(response.status()).toBe(200); await route.abort("failed"); }
      else await route.continue();
    });
  }
  await loseNext("**/api/goals", "POST"); await page.getByRole("button", { name: "Save goal", exact: true }).click();
  await expect(page.locator(".goals-section [role=alert]")).toContainText("may have saved"); await expect(page.getByLabel("Title", { exact: true })).toBeDisabled();
  await page.getByRole("button", { name: "Retry same change" }).click(); await expect(page.getByRole("dialog")).toHaveCount(0);
  expect(captured[0]).toBe(captured[1]); expect((await (await page.request.get("/api/goals")).json()).goals).toHaveLength(1);
  await page.unroute("**/api/goals"); const id = await page.locator(".goal-card").getAttribute("data-goal-id");
  await page.getByRole("button", { name: "Edit One logical goal", exact: true }).click(); await fillGoal(page, "Edited once", "The version increments once.");
  await loseNext(`**/api/goals/${id}`, "PATCH"); await page.getByRole("button", { name: "Save goal", exact: true }).click(); await page.getByRole("button", { name: "Retry same change" }).click(); await expect(page.getByRole("dialog")).toHaveCount(0); expect(captured[2]).toBe(captured[3]);
  expect((await (await page.request.get(`/api/goals/${id}`)).json()).goal.version).toBe(2);
  await page.unroute(`**/api/goals/${id}`); await page.getByRole("button", { name: "Archive Edited once", exact: true }).click();
  await loseNext(`**/api/goals/${id}/archive`, "POST"); await page.getByRole("button", { name: "Archive goal", exact: true }).click(); await page.getByRole("button", { name: "Retry same change" }).click(); await expect(page.getByRole("dialog")).toHaveCount(0); expect(captured[4]).toBe(captured[5]);
  expect((await (await page.request.get(`/api/goals/${id}`)).json()).goal.version).toBe(3);
});

test("server validation, Unicode limits, plain text and HTTP idempotency", async ({ page }) => {
  for (const invalid of [{ title: " " }, { outcome: " " }, { title: "😀".repeat(161) }, { outcome: "😀".repeat(2001) }, { ownerId: randomUUID() }, { targetDate: "2026-10-02" }]) {
    const response = await page.request.post("/api/goals", { headers: { Origin: origin }, data: command(invalid) }); expect(response.status()).toBe(400); expect((await response.json()).error.code).toBe("VALIDATION");
  }
  expect((await (await page.request.get("/api/goals")).json()).goals).toHaveLength(0);
  const edge = command({ title: "😀".repeat(160), outcome: "😀".repeat(2000) }); const original = await apiCreate(page, edge); expect(await apiCreate(page, edge)).toEqual(original);
  const reuse = await page.request.post("/api/goals", { headers: { Origin: origin }, data: { ...edge, outcome: "Different payload" } }); expect(reuse.status()).toBe(409);
  await apiCreate(page, command({ title: "<script>alert('x')</script>", outcome: "<img src=x onerror=alert('x')>\nPlain text" }));
  await page.goto("/goals"); await expect(page.locator(".goal-card").getByRole("heading", { name: "<script>alert('x')</script>", exact: true })).toBeVisible(); expect(await page.locator(".goal-card img,.goal-card script,.goal-preview-surface img,.goal-preview-surface script").count()).toBe(0);
  await page.getByRole("button", { name: "Create goal", exact: true }).click(); await fillGoal(page, " ", " "); await page.getByRole("button", { name: "Save goal", exact: true }).click();
  await expect(page.locator("#title-error")).toHaveText("Title is required."); await expect(page.locator("#outcome-error")).toHaveText("Outcome is required.");
  // Return a genuine server-side validation error through the live HTTP boundary.
  await fillGoal(page, "A valid draft", "A retained outcome");
  await page.route("**/api/goals", async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    const input = route.request().postDataJSON(); const response = await route.fetch({ postData: JSON.stringify({ ...input, outcome: " " }) }); await route.fulfill({ response });
  });
  await page.getByRole("button", { name: "Save goal", exact: true }).click(); await expect(page.locator("#outcome-error")).toHaveText("Outcome is required."); await expect(page.getByLabel("Outcome", { exact: true })).toHaveValue("A retained outcome");
});

test("two owners cannot infer/read/edit/archive foreign goals or share receipt namespaces", async ({ page, browser }) => {
  const input = command(); const owned = await apiCreate(page, input);
  const other = await browser.newContext({ storageState: stateB }); const pb = await other.newPage();
  try {
    await pb.goto("/goals"); await expect(pb.locator(".goal-card")).toHaveCount(0);
    const errors: unknown[] = [];
    for (const id of [owned.id, randomUUID()]) {
      for (const [method, url, data] of [["GET", `/api/goals/${id}`, undefined], ["PATCH", `/api/goals/${id}`, { mutationId: input.mutationId, expectedVersion: 1, title: "foreign", outcome: "foreign" }], ["POST", `/api/goals/${id}/archive`, { mutationId: input.mutationId, expectedVersion: 1 }]] as const) {
        const response = await pb.request.fetch(url, { method, headers: { Origin: origin }, data }); expect(response.status()).toBe(404);
        const error = (await response.json()).error; delete error.requestId; errors.push(error);
      }
    }
    expect(errors.every((e) => JSON.stringify(e) === JSON.stringify(errors[0]))).toBe(true);
    const own = await apiCreate(pb, input); expect(own.id).not.toBe(owned.id);
    expect((await (await page.request.get(`/api/goals/${owned.id}`)).json()).goal).toEqual(owned);
    const aList = await page.request.get(`/api/goals?ownerId=${(await (await pb.request.get("/api/account")).json()).user.id}`); expect((await aList.json()).goals.map((g: { id: string }) => g.id)).toEqual([owned.id]);
    await pb.reload(); await expect(pb.locator(".goal-card")).toHaveCount(1); await expect(pb.locator(`[data-goal-id="${owned.id}"]`)).toHaveCount(0);
  } finally { await other.close(); }
});

test("anonymous and cross-origin mutations fail; unsupported destructive routes and bad JSON cannot mutate", async ({ page, browser }) => {
  const owned = await apiCreate(page); const anonymous = await browser.newContext(); const pa = await anonymous.newPage();
  try {
    for (const [method, url, data] of [["GET", "/api/goals", undefined], ["POST", "/api/goals", command()], ["GET", `/api/goals/${owned.id}`, undefined], ["PATCH", `/api/goals/${owned.id}`, command({ expectedVersion: 1 })], ["POST", `/api/goals/${owned.id}/archive`, { mutationId: randomUUID(), expectedVersion: 1 }]] as const) expect((await pa.request.fetch(url, { method, headers: { Origin: origin }, data })).status()).toBe(401);
    await pa.goto("/goals"); await expect(pa).toHaveURL(/\/sign-in$/);
  } finally { await anonymous.close(); }
  for (const spoofed of ["https://evil.example.test", ""]) expect((await page.request.post("/api/goals", { headers: { Origin: spoofed }, data: command() })).status()).toBe(403);
  expect((await page.request.delete(`/api/goals/${owned.id}`, { headers: { Origin: origin } })).status()).toBe(405);
  for (const data of ["{bad", "x".repeat(32769)]) expect((await page.request.post("/api/goals", { headers: { Origin: origin, "Content-Type": "application/json" }, data })).status()).toBe(400);
  const response = await page.request.get(`/api/goals/${owned.id}`); expect(response.headers()["cache-control"]).toContain("private, no-store"); expect((await response.json()).goal).toEqual(owned);
});

test("load failure is distinct from empty; create/edit/archive failures preserve drafts and retry IDs", async ({ page }) => {
  await page.goto("/goals");
  for (const kind of ["create", "edit", "archive"] as const) {
    let id: string | undefined;
    if (kind === "create") { await page.getByRole("button", { name: "Create goal", exact: true }).click(); await fillGoal(page, "Recover safely", "Keep the outcome draft"); }
    else { id = await page.locator(".goal-card").getAttribute("data-goal-id") ?? undefined; await page.getByRole("button", { name: `${kind === "edit" ? "Edit" : "Archive"} Recover safely`, exact: true }).click(); }
    const url = kind === "create" ? "**/api/goals" : `**/api/goals/${id}${kind === "archive" ? "/archive" : ""}`;
    let failed = false; const bodies: string[] = [];
    await page.route(url, async (route) => {
      if (route.request().method() === "GET") return route.continue(); bodies.push(route.request().postData()!);
      if (!failed) { failed = true; await route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: { code: "DATABASE_UNAVAILABLE", message: "Cannot reach your goals. Please retry." } }) }); }
      else await route.continue();
    });
    await page.getByRole("button", { name: kind === "archive" ? "Archive goal" : "Save goal", exact: true }).click(); await expect(page.locator(".goals-section [role=alert]")).toContainText("Cannot reach");
    if (kind !== "archive") await expect(page.getByLabel("Outcome", { exact: true })).toHaveValue("Keep the outcome draft");
    await page.getByRole("button", { name: "Retry same change" }).click(); await expect(page.getByRole("dialog")).toHaveCount(0); expect(bodies[0]).toBe(bodies[1]); await page.unroute(url);
  }
  await page.route("**/api/goals?status=archived", (route) => route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: { code: "DATABASE_UNAVAILABLE", message: "Unavailable" } }) }));
  await page.getByRole("button", { name: "Archived", exact: true }).click(); await expect(page.locator(".goals-section [role=alert]")).toContainText("could not be refreshed"); await expect(page.getByText("Nothing archived yet.")).toHaveCount(0);
  await page.unroute("**/api/goals?status=archived"); await page.getByRole("button", { name: "Retry loading goals" }).click(); await expect(page.locator(".goal-card")).toContainText("Recover safely");
});

test("keyboard-only create/edit/archive flow and narrow viewport remain operable", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 }); await page.goto("/goals");
  await page.getByRole("button", { name: "Create goal", exact: true }).focus(); await page.keyboard.press("Enter"); await expect(page.getByLabel("Title", { exact: true })).toBeFocused();
  await page.keyboard.type("Build emergency savings"); await page.keyboard.press("Tab"); await page.keyboard.type("I have six months of expenses held in accessible savings.");
  await page.keyboard.press("Tab"); await page.keyboard.press("Tab"); await page.keyboard.press("Enter");
  await expect(page.locator(".goal-card")).toContainText("six months");
  await page.getByRole("button", { name: "Edit Build emergency savings", exact: true }).focus(); await page.keyboard.press("Enter"); await page.keyboard.press("Escape"); await expect(page.getByRole("button", { name: "Edit Build emergency savings", exact: true })).toBeFocused();
  await page.keyboard.press("Tab"); await page.keyboard.press("Enter"); await expect(page.getByRole("button", { name: "Cancel", exact: true })).toBeFocused(); await page.keyboard.press("Tab"); await expect(page.getByRole("button", { name: "Archive goal", exact: true })).toBeFocused(); await page.keyboard.press("Enter");
  await expect(page.locator(".goal-card")).toHaveCount(0); await page.getByRole("button", { name: "Archived", exact: true }).focus(); await page.keyboard.press("Enter"); await expect(page.locator(".goal-card")).toContainText("Build emergency savings");
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
});
