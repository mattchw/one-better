import {fixtureSignIn} from "./sign-in-helper";
import { test, expect, type Page, type BrowserContext } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { inArray } from "drizzle-orm";
import { connectDatabase } from "../../src/db/connect";
import { focusSession, timeBlock, commitmentIdentity, weeklyPlanAmendment, amendmentCommitment, action, goal, milestone, mutationReceipt, user, weeklyCommitment, weeklyPlan } from "../../src/db/schema";
import { createAuthentication } from "../../src/server/auth-factory";
import { requireTestDatabaseURL } from "../../scripts/test-database";
const origin = "http://127.0.0.1:3101";
let database: ReturnType<typeof connectDatabase>; let ownerIds: string[];
const cookies: Record<string, Parameters<BrowserContext["addCookies"]>[0]> = {};
async function mutate(page: Page, path: string, input: object, method = "POST") { const response = await page.request.fetch(path, { method, headers: { Origin: origin }, data: input }); expect(response.status(), await response.text()).toBe(200); return response.json(); }
async function fixture(page: Page) {
  const parent = (await mutate(page, "/api/goals", { mutationId: randomUUID(), title: "A useful One Better system", outcome: "I choose meaningful work without filling every minute." })).goal;
  const first = (await mutate(page, `/api/goals/${parent.id}/milestones`, { mutationId: randomUUID(), title: "Weekly planning usable", successCondition: "One realistic week is deliberately planned." })).milestone;
  const second = (await mutate(page, `/api/goals/${parent.id}/milestones`, { mutationId: randomUUID(), title: "Next useful outcome", successCondition: "Context moves are explicit." })).milestone;
  const values = [];
  for (const [title, estimateMinutes, milestoneId] of [["Build capacity editor", 120, null], ["Implement planning persistence", 240, first.id], ["Test planning flow", 45, second.id]] as const) values.push((await mutate(page, `/api/goals/${parent.id}/actions`, { mutationId: randomUUID(), title, estimateMinutes, milestoneId, doneWhen: "The chosen outcome can be demonstrated." })).action);
  const workspace = await (await page.request.get("/api/weekly-plans")).json(); const candidates = (await (await page.request.get("/api/weekly-plans/candidates")).json()).candidates;
  const selections = values.map((v, i) => ({ actionId: v.id, source: candidates.find((c: { actionId: string }) => c.actionId === v.id).source, budgetMinutes: [180, 120, 90][i] }));
  return { parent, first, second, values, selections, week: workspace.currentWeekStartDate };
}
test.beforeAll(async () => {test.setTimeout(90000);
  const target = requireTestDatabaseURL(); if (target.name === "execution_test") throw new Error("Planning browser tests require a new isolated database.");
  database = connectDatabase(target.url); ownerIds = (await database.db.select({ id: user.id }).from(user)).map((row) => row.id);
  const auth = createAuthentication(database.db, { secret: process.env.BETTER_AUTH_SECRET!, baseURL: origin });
  for (const suffix of ["A", "B"]) { const response = await fixtureSignIn(()=>auth.handler(new Request(`${origin}/api/auth/sign-in/email`, { method: "POST", headers: { Origin: origin, "Content-Type": "application/json" }, body: JSON.stringify({ email: process.env[`TEST_USER_${suffix}_EMAIL`], password: process.env[`TEST_USER_${suffix}_PASSWORD`] }) }))); expect(response.status).toBe(200); cookies[suffix] = response.headers.getSetCookie().map((value) => { const pair = value.split(";")[0], index = pair.indexOf("="); return { name: pair.slice(0, index), value: pair.slice(index + 1), url: origin, httpOnly: true, sameSite: "Lax" as const }; }); }
});
test.beforeEach(async ({ page }) => { await database.db.delete(mutationReceipt).where(inArray(mutationReceipt.ownerId, ownerIds)); await database.db.delete(amendmentCommitment).where(inArray(amendmentCommitment.ownerId, ownerIds)); await database.db.delete(weeklyPlanAmendment).where(inArray(weeklyPlanAmendment.ownerId, ownerIds)); await database.db.delete(focusSession).where(inArray(focusSession.ownerId, ownerIds)); await database.db.delete(timeBlock).where(inArray(timeBlock.ownerId, ownerIds)); await database.db.delete(commitmentIdentity).where(inArray(commitmentIdentity.ownerId, ownerIds)); await database.db.delete(weeklyCommitment).where(inArray(weeklyCommitment.ownerId, ownerIds)); await database.db.delete(weeklyPlan).where(inArray(weeklyPlan.ownerId, ownerIds)); await database.db.delete(action).where(inArray(action.ownerId, ownerIds)); await database.db.delete(milestone).where(inArray(milestone.ownerId, ownerIds)); await database.db.delete(goal).where(inArray(goal.ownerId, ownerIds)); await page.context().addCookies(cookies.A); });
test.afterAll(async () => { await database?.pool.end(); });
test("HTTP owner isolation, anonymous rejection, exact Origin, strict inputs and no destructive endpoint", async ({ page, browser }) => {
  const f = await fixture(page); const plan = (await mutate(page, "/api/weekly-plans", { mutationId: randomUUID(), weekStartDate: f.week, provisionalCapacityMinutes: 720, reserveMinutes: 180 })).plan;
  const foreign = await browser.newContext(); await foreign.addCookies(cookies.B); const anonymous = await browser.newContext();
  try { for (const context of [foreign, anonymous]) { for (const [method, path, data] of [["GET", `/api/weekly-plans/${plan.id}`, undefined], ["PATCH", `/api/weekly-plans/${plan.id}`, { mutationId: randomUUID(), expectedVersion: 1, provisionalCapacityMinutes: 600, reserveMinutes: 120, commitments: [] }], ["POST", `/api/weekly-plans/${plan.id}/commit`, { mutationId: randomUUID(), expectedVersion: 1 }]] as const) { const response = await context.request.fetch(path, { method, headers: { Origin: origin }, data }); expect(response.status()).toBe(context === anonymous ? 401 : 404); expect((await response.json()).error).not.toHaveProperty("current"); } }
    expect((await (await foreign.request.get("/api/weekly-plans")).json()).savedWeeks).toEqual([]); expect((await (await foreign.request.get("/api/weekly-plans/candidates")).json()).candidates).toEqual([]);
  } finally { await foreign.close(); await anonymous.close(); }
  expect((await page.request.post("/api/weekly-plans", { headers: { Origin: "https://wrong.example" }, data: {} })).status()).toBe(403); expect((await page.request.post("/api/weekly-plans", { headers: { Origin: origin }, data: { mutationId: randomUUID(), weekStartDate: f.week, provisionalCapacityMinutes: 720, reserveMinutes: 180, ownerId: ownerIds[0] } })).status()).toBe(400); expect((await page.request.delete(`/api/weekly-plans/${plan.id}`, { headers: { Origin: origin } })).status()).toBe(405);
});
