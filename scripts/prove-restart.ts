import { spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import assert from "node:assert/strict";
import { setTimeout as delay } from "node:timers/promises";
import { requireTestDatabaseURL } from "./test-database";
import { randomUUID } from "node:crypto";
import { chromium } from "@playwright/test";
import type { Goal } from "../src/modules/goals/domain";
import type { Action } from "../src/modules/actions/domain";
import { addDays, type WeeklyPlan, type WeekWorkspace, type PlanningSource, type PlanningView } from "../src/modules/planning/domain";
import type { Amendment, AmendmentHistory } from "../src/modules/amendments/domain";
import type { Milestone } from "../src/modules/milestones/domain";

requireTestDatabaseURL();
await import("./prepare-test-db");
const origin = "http://127.0.0.1:3102";
let child: ChildProcess | undefined;
let log = "";
async function start(databaseURL = process.env.DATABASE_URL, expectedHealth = 200) {
  log = "";
  child = spawn(process.execPath, ["node_modules/next/dist/bin/next", "start", "--hostname", "127.0.0.1", "--port", "3102"], { env: { ...process.env, NODE_ENV: "production", BETTER_AUTH_URL: origin, DATABASE_URL: databaseURL }, stdio: ["ignore", "pipe", "pipe"] });
  child.stdout?.on("data", (data) => { log += data.toString(); });
  child.stderr?.on("data", (data) => { log += data.toString(); });
  child.on("error", () => { log = "Unable to start production process."; });
  for (let attempt = 0; attempt < 120; attempt++) {
    if (child.exitCode !== null) throw new Error("Production process exited before readiness.");
    if (!log.includes("Ready")) { await delay(250); continue; }
    try { if ((await fetch(`${origin}/api/health`)).status === expectedHealth) return; } catch { /* Wait for the owned process. */ }
    await delay(250);
  }
  throw new Error("Production process did not become healthy.");
}
async function stop() {
  if (child && child.exitCode === null) { const exited = once(child, "exit"); child.kill("SIGTERM"); await exited; }
  child = undefined;
}
try {
  await start();
  assert.equal((await fetch(`${origin}/api/account`)).status, 401);
  const signedIn = await fetch(`${origin}/api/auth/sign-in/email`, { method: "POST", headers: { "Content-Type": "application/json", Origin: origin }, body: JSON.stringify({ email: process.env.TEST_USER_A_EMAIL, password: process.env.TEST_USER_A_PASSWORD }) });
  assert.equal(signedIn.status, 200, "Production-process sign-in must succeed.");
  const cookie = signedIn.headers.getSetCookie().map((value) => value.split(";")[0]).join("; ");
  const read = async () => {
    const response = await fetch(`${origin}/api/account`, { headers: { cookie } });
    assert.equal(response.status, 200); return await response.json() as { user: { id: string; email: string } };
  };
  const goalCommand = { mutationId: randomUUID(), title: `Restart proof ${randomUUID().slice(0, 8)}`, outcome: "My saved outcome and identity survive an application process restart." };
  const mutate = async (url: string, command: object, method = "POST") => {
    const response = await fetch(`${origin}${url}`, { method, headers: { cookie, Origin: origin, "Content-Type": "application/json" }, body: JSON.stringify(command) });
    assert.equal(response.status, 200); return (await response.json() as { goal: Goal }).goal;
  };
  const goalBefore = await mutate("/api/goals", goalCommand);
  const mutateMilestone = async (url: string, command: object, method = "POST") => {
    const response = await fetch(`${origin}${url}`, { method, headers: { cookie, Origin: origin, "Content-Type": "application/json" }, body: JSON.stringify(command) });
    assert.equal(response.status, 200); return (await response.json() as { milestone: Milestone }).milestone;
  };
  const milestoneCommand = { mutationId: randomUUID(), title: "Restart retains checkpoints", successCondition: "The declared condition and every lifecycle state survive two process restarts." };
  const milestoneURL = `/api/goals/${goalBefore.id}/milestones`;
  const active = await mutateMilestone(milestoneURL, milestoneCommand);
  const first = await mutateMilestone(milestoneURL, { ...milestoneCommand, mutationId: randomUUID(), title: "Completed history persists" });
  const second = await mutateMilestone(milestoneURL, { ...milestoneCommand, mutationId: randomUUID(), title: "Archived history persists" });
  const actionURL = `/api/goals/${goalBefore.id}/actions`;
  const mutateAction = async (url: string, command: object, method = "POST") => {
    const response = await fetch(`${origin}${url}`, { method, headers: { cookie, Origin: origin, "Content-Type": "application/json" }, body: JSON.stringify(command) });
    assert.equal(response.status, 200); return (await response.json() as { action: Action }).action;
  };
  const readActions = async () => {
    const response = await fetch(`${origin}${actionURL}`, { headers: { cookie } }); assert.equal(response.status, 200);
    return (await response.json() as { actions: { action: Action; mutability: { editable: boolean } }[] }).actions;
  };
  const actionCreate = { mutationId: randomUUID(), title: "Open work remains historical", milestoneId: first.id, doneWhen: "Retain what actually happened", estimateMinutes: 45 };
  const openAction = await mutateAction(actionURL, actionCreate);
  const actionSecondCreate = { ...actionCreate, mutationId: randomUUID(), title: "Completed work survives", milestoneId: active.id, estimateMinutes: 120 };
  const actionSecond = await mutateAction(actionURL, actionSecondCreate);
  const actionThirdCreate = { ...actionCreate, mutationId: randomUUID(), title: "Archived work survives", milestoneId: second.id, estimateMinutes: 30 };
  const actionThird = await mutateAction(actionURL, actionThirdCreate);
  const readJSON = async <T>(url: string): Promise<T> => { const response = await fetch(`${origin}${url}`, { headers: { cookie } }); assert.equal(response.status, 200); return response.json() as Promise<T>; };
  const mutatePlan = async (url: string, command: object, method = "POST") => { const response = await fetch(`${origin}${url}`, { method, headers: { cookie, Origin: origin, "Content-Type": "application/json" }, body: JSON.stringify(command) }); assert.equal(response.status, 200); return (await response.json() as { plan: WeeklyPlan }).plan; };
  const workspace = await readJSON<WeekWorkspace>("/api/weekly-plans"); let week = workspace.currentWeekStartDate;
  const used = new Set(workspace.savedWeeks.map((p) => p.weekStartDate)); while (used.has(week) || used.has(addDays(week, 7))) week = addDays(week, 7);
  const planCreate = { mutationId: randomUUID(), weekStartDate: week, provisionalCapacityMinutes: 720, reserveMinutes: 180 };
  const planCreated = await mutatePlan("/api/weekly-plans", planCreate);
  const sources = (await readJSON<{ candidates: PlanningSource[] }>("/api/weekly-plans/candidates")).candidates;
  const selection = (value: Action, budgetMinutes: number) => ({ actionId: value.id, budgetMinutes, source: sources.find((s) => s.actionId === value.id)!.source });
  const planSave = { mutationId: randomUUID(), expectedVersion: 1, provisionalCapacityMinutes: 720, reserveMinutes: 180, commitments: [selection(actionSecond, 180), selection(actionThird, 120)] };
  const draftBefore = await mutatePlan(`/api/weekly-plans/${planCreated.id}`, planSave, "PATCH");
  const otherCreate = { ...planCreate, mutationId: randomUUID(), weekStartDate: addDays(week, 7), provisionalCapacityMinutes: 600, reserveMinutes: 120 };
  const otherCreated = await mutatePlan("/api/weekly-plans", otherCreate);
  const otherSave = { mutationId: randomUUID(), expectedVersion: 1, provisionalCapacityMinutes: 600, reserveMinutes: 120, commitments: [selection(openAction, 60)] };
  const otherDraft = await mutatePlan(`/api/weekly-plans/${otherCreated.id}`, otherSave, "PATCH");
  const before = await read(); await stop(); await start(); const after = await read();
  assert.deepEqual(after, before);
  assert.equal(after.user.email, process.env.TEST_USER_A_EMAIL);
  const shell = await fetch(`${origin}/goals`, { headers: { cookie } });
  assert.equal(shell.status, 200); assert.ok((await shell.text()).includes(goalBefore.title));
  const goalAfter = await fetch(`${origin}/api/goals/${goalBefore.id}`, { headers: { cookie } });
  assert.deepEqual((await goalAfter.json() as { goal: Goal }).goal, goalBefore);
  assert.deepEqual(await mutate("/api/goals", goalCommand), goalBefore, "Create receipt must survive process restart.");
  const readMilestones = async () => {
    const response = await fetch(`${origin}${milestoneURL}`, { headers: { cookie } });
    assert.equal(response.status, 200); return (await response.json() as { milestones: Milestone[] }).milestones;
  };
  assert.deepEqual((await readMilestones()).find((m) => m.id === active.id), active);
  assert.deepEqual(await mutateMilestone(milestoneURL, milestoneCommand), active, "Milestone create receipt persists.");
  for (const value of [openAction, actionSecond, actionThird]) assert.deepEqual((await readActions()).find((view) => view.action.id === value.id)?.action, value);
  assert.deepEqual(await mutateAction(actionURL, actionCreate), openAction, "Action create receipt survives restart.");
  assert.deepEqual((await readJSON<PlanningView>(`/api/weekly-plans/${planCreated.id}`)).plan, draftBefore, "Draft and selections survive actual process restart.");
  assert.deepEqual((await readJSON<PlanningView>(`/api/weekly-plans/${otherCreated.id}`)).plan, otherDraft);
  assert.deepEqual(await mutatePlan("/api/weekly-plans", planCreate), planCreated);
  assert.deepEqual(await mutatePlan(`/api/weekly-plans/${planCreated.id}`, planSave, "PATCH"), draftBefore);
  const planCommit = { mutationId: randomUUID(), expectedVersion: 2 };
  const baseline = await mutatePlan(`/api/weekly-plans/${planCreated.id}/commit`, planCommit);
  assert.equal(baseline.state, "committed"); assert.equal(baseline.commitments.find((c) => c.actionId === actionSecond.id)?.snapshot?.action.estimateMinutes, 120);
  const amendmentURL = `/api/weekly-plans/${baseline.id}/amendments`;
  const mutateAmendment = async (command: object) => { const response = await fetch(`${origin}${amendmentURL}`, { method: "POST", headers: { cookie, Origin: origin, "Content-Type": "application/json" }, body: JSON.stringify(command) }); assert.equal(response.status, 200); return (await response.json() as { amendment: Amendment }).amendment; };
  const amendmentCommand = { mutationId: randomUUID(), expectedVersion: baseline.version, reason: "Support work reduced available focus time", provisionalCapacityMinutes: 600, reserveMinutes: 120, commitments: baseline.commitments.map(c => ({ actionId: c.actionId, budgetMinutes: c.actionId === actionSecond.id ? 150 : c.budgetMinutes })) };
  const amendmentOne = await mutateAmendment(amendmentCommand);
  const actionEdit = { mutationId: randomUUID(), expectedVersion: 1, title: "Edited and reassigned work survives", doneWhen: "Reviewed definition", estimateMinutes: 90, milestoneId: second.id };
  const editedAction = await mutateAction(`/api/actions/${actionSecond.id}`, actionEdit, "PATCH");
  const actionComplete = { mutationId: randomUUID(), expectedVersion: 2 };
  const completedAction = await mutateAction(`/api/actions/${actionSecond.id}/complete`, actionComplete);
  const actionArchive = { mutationId: randomUUID(), expectedVersion: 1 };
  const archivedAction = await mutateAction(`/api/actions/${actionThird.id}/archive`, actionArchive);
  assert.equal(completedAction.estimateMinutes, 90); assert.equal(archivedAction.estimateMinutes, 30);
  const milestoneEdit = { mutationId: randomUUID(), expectedVersion: 1, title: first.title, successCondition: "The edited condition is retained in trustworthy completed history." };
  const editedMilestone = await mutateMilestone(`/api/milestones/${first.id}`, milestoneEdit, "PATCH");
  const completeCommand = { mutationId: randomUUID(), expectedVersion: 2, evidence: "Verified in production after restarting the application." };
  const completed = await mutateMilestone(`/api/milestones/${first.id}/complete`, completeCommand);
  const archiveMilestoneCommand = { mutationId: randomUUID(), expectedVersion: 1 };
  const archivedMilestone = await mutateMilestone(`/api/milestones/${second.id}/archive`, archiveMilestoneCommand);
  const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH });
  try {
    const context = await browser.newContext();
    await context.addCookies(cookie.split("; ").map((value) => { const split = value.indexOf("="); return { name: value.slice(0, split), value: value.slice(split + 1), url: origin, httpOnly: true, sameSite: "Lax" as const }; }));
    const page = await context.newPage(); await page.goto(`${origin}/goals`);
    const card = page.locator(`[data-goal-id="${goalBefore.id}"]`);
    await card.waitFor(); await card.getByText("Next actions", { exact: true }).click();
    assert.ok((await card.innerText()).includes(goalBefore.outcome));
    const edit = { mutationId: randomUUID(), expectedVersion: 1, title: goalBefore.title, outcome: "The edited outcome persists too." };
    const edited = await mutate(`/api/goals/${goalBefore.id}`, edit, "PATCH");
    assert.equal(edited.version, 2); assert.deepEqual(await mutate(`/api/goals/${goalBefore.id}`, edit, "PATCH"), edited);
    const archive = { mutationId: randomUUID(), expectedVersion: 2 };
    const archived = await mutate(`/api/goals/${goalBefore.id}/archive`, archive);
    assert.equal(archived.version, 3);
    const amendmentTwoCommand = { ...amendmentCommand, mutationId: randomUUID(), expectedVersion: amendmentOne.version, reason: "Drop remaining prototype work to protect recovery", reserveMinutes: 180, commitments: [{ actionId: actionSecond.id, budgetMinutes: 150 }] };
    const amendmentTwo = await mutateAmendment(amendmentTwoCommand);
    const amendmentHistoryBefore = await readJSON<AmendmentHistory>(amendmentURL);
    assert.deepEqual(amendmentHistoryBefore.amendments, [amendmentOne, amendmentTwo]);
    await stop(); await start();
    assert.deepEqual(await mutate(`/api/goals/${goalBefore.id}/archive`, archive), archived, "Archive receipt must survive another restart.");
    assert.deepEqual(await mutate(`/api/goals/${goalBefore.id}`, edit, "PATCH"), edited, "Edit replay returns the original snapshot after archive/restart.");
    assert.deepEqual(await mutateMilestone(milestoneURL, milestoneCommand), active);
    assert.deepEqual(await mutateMilestone(`/api/milestones/${first.id}`, milestoneEdit, "PATCH"), editedMilestone);
    assert.deepEqual(await mutateMilestone(`/api/milestones/${first.id}/complete`, completeCommand), completed);
    assert.deepEqual(await mutateMilestone(`/api/milestones/${second.id}/archive`, archiveMilestoneCommand), archivedMilestone);
    assert.deepEqual(await mutateAction(actionURL, actionCreate), openAction);
    assert.deepEqual(await mutateAction(actionURL, actionSecondCreate), actionSecond);
    assert.deepEqual(await mutateAction(`/api/actions/${actionSecond.id}`, actionEdit, "PATCH"), editedAction);
    assert.deepEqual(await mutateAction(`/api/actions/${actionSecond.id}/complete`, actionComplete), completedAction);
    assert.deepEqual(await mutateAction(`/api/actions/${actionThird.id}/archive`, actionArchive), archivedAction);
    assert.deepEqual((await readJSON<PlanningView>(`/api/weekly-plans/${baseline.id}`)).plan, { ...baseline, version: amendmentTwo.version }, "Immutable snapshots survive source changes and the second restart.");
    assert.deepEqual((await readJSON<PlanningView>(`/api/weekly-plans/${otherDraft.id}`)).plan, otherDraft, "The second Draft remains unchanged beneath now-terminal sources.");
    assert.deepEqual(await mutatePlan("/api/weekly-plans", planCreate), planCreated);
    assert.deepEqual(await mutatePlan(`/api/weekly-plans/${baseline.id}`, planSave, "PATCH"), draftBefore);
    assert.deepEqual(await mutatePlan(`/api/weekly-plans/${baseline.id}/commit`, planCommit), baseline);
    assert.deepEqual(await mutatePlan("/api/weekly-plans", otherCreate), otherCreated);
    assert.deepEqual(await mutatePlan(`/api/weekly-plans/${otherDraft.id}`, otherSave, "PATCH"), otherDraft);
    assert.deepEqual(await mutateAmendment(amendmentCommand), amendmentOne, "Original first-amendment result replays after later amendment, terminal sources and process restart.");
    assert.deepEqual(await mutateAmendment(amendmentTwoCommand), amendmentTwo);
    assert.deepEqual(await readJSON<AmendmentHistory>(amendmentURL), amendmentHistoryBefore, "Both immutable snapshots, reasons, sequences and Current Plan survive actual process restart.");
    assert.deepEqual((await readJSON<{ amendment: Amendment }>(`/api/weekly-plan-amendments/${amendmentOne.id}`)).amendment, amendmentOne);
    const persistedActions = await readActions(); assert.equal(persistedActions.length, 3);
    for (const value of [openAction, completedAction, archivedAction]) { const view = persistedActions.find((view) => view.action.id === value.id)!; assert.deepEqual(view.action, value); assert.equal(view.mutability.editable, false); }
    const persisted = await readMilestones();
    for (const value of [active, completed, archivedMilestone]) assert.deepEqual(persisted.find((m) => m.id === value.id), value);
    await page.goto(`${origin}/goals/${goalBefore.id}`);
    await page.getByText("Its milestones are kept as read-only history.", { exact: false }).waitFor();
    const checkpoint = page.locator(`[data-milestone-id="${active.id}"]`); await checkpoint.waitFor();
    assert.equal(await checkpoint.getByRole("button").count(), 0);
    await page.getByRole("button", { name: "Completed", exact: true }).click();
    await page.locator(`[data-milestone-id="${completed.id}"]`).waitFor(); assert.ok((await page.locator(`[data-milestone-id="${completed.id}"]`).innerText()).includes(completed.evidence!));
    await page.getByRole("button", { name: "Archived", exact: true }).click(); await page.locator(`[data-milestone-id="${archivedMilestone.id}"]`).waitFor();
    const openCard = page.locator(`[data-action-id="${openAction.id}"]`); await openCard.waitFor(); assert.equal(await openCard.getByRole("button").count(), 0); assert.ok((await openCard.innerText()).includes("read-only history"));
    await page.getByRole("button", { name: "Completed actions", exact: true }).click(); const doneCard = page.locator(`[data-action-id="${completedAction.id}"]`); await doneCard.waitFor(); assert.ok((await doneCard.innerText()).includes("1h 30m")); assert.equal(await doneCard.getByRole("button").count(), 0);
    await page.getByRole("button", { name: "Archived actions", exact: true }).click(); await page.locator(`[data-action-id="${archivedAction.id}"]`).waitFor(); await page.reload(); await page.locator(`[data-action-id="${archivedAction.id}"]`).waitFor();
    await page.goto(`${origin}/planning?week=${baseline.weekStartDate}`);
    await page.getByRole("heading", { name: "Committed · 2 amendments", exact: true }).waitFor();
    assert.ok((await page.locator(".commitment-list").first().innerText()).includes(actionSecond.title));
    assert.equal(await page.getByRole("button", { name: "Save draft", exact: true }).count(), 0);
    await page.reload(); await page.getByRole("heading", { name: "Committed · 2 amendments", exact: true }).waitFor();
    await page.locator("[data-original-plan] summary").click();
    const originalPlan = page.locator("[data-original-plan]"); await originalPlan.locator(".commitment-card").first().waitFor(); assert.ok((await originalPlan.innerText()).includes(actionThird.title)); assert.match(await originalPlan.innerText(), /Weekly capacity\s*12h/);
    const firstAmendment = page.locator('[data-amendment-sequence="1"]'); assert.ok((await firstAmendment.innerText()).includes(amendmentOne.reason)); await firstAmendment.getByText("Inspect full snapshot").click(); await firstAmendment.locator(".commitment-card").first().waitFor(); assert.ok((await firstAmendment.innerText()).includes(actionThird.title));
    assert.equal(await page.locator(".amendment-history-entry").count(), 2);
    await page.goto(`${origin}/planning?week=${otherDraft.weekStartDate}`); await page.locator(`[data-selected-action="${openAction.id}"]`).waitFor();
    assert.equal(await page.getByLabel("This week’s budget in minutes").inputValue(), "60");
    await page.goto(`${origin}/goals`); assert.equal(await card.count(), 0);
    await page.getByRole("button", { name: "Archived", exact: true }).click(); await card.waitFor();
    await card.getByText("Next actions", { exact: true }).click();
    assert.ok((await card.innerText()).includes(edited.outcome));
  } finally { await browser.close(); }
  await stop();
  const unavailableURL = new URL(process.env.DATABASE_URL!);
  unavailableURL.pathname = `/execution_test_unavailable${Date.now()}`;
  await start(unavailableURL.toString(), 503);
  const unavailable = await fetch(`${origin}/api/account`, { headers: { cookie } });
  assert.equal(unavailable.status, 503, "Database failure must remain distinct from an empty or anonymous account.");
  assert.equal((await fetch(`${origin}/api/goals`, { headers: { cookie } })).status, 503);
  for (const [method, url, command] of [["POST", "/api/goals", goalCommand], ["PATCH", `/api/goals/${goalBefore.id}`, { ...goalCommand, expectedVersion: 1 }], ["POST", `/api/goals/${goalBefore.id}/archive`, { mutationId: randomUUID(), expectedVersion: 1 }]] as const) {
    assert.equal((await fetch(`${origin}${url}`, { method, headers: { cookie, Origin: origin, "Content-Type": "application/json" }, body: JSON.stringify(command) })).status, 503);
  }
  for (const [method, url, command] of [["GET", milestoneURL, undefined], ["GET", `/api/milestones/${active.id}`, undefined], ["POST", milestoneURL, milestoneCommand], ["PATCH", `/api/milestones/${active.id}`, { ...milestoneCommand, expectedVersion: 1 }], ["POST", `/api/milestones/${active.id}/complete`, { mutationId: randomUUID(), expectedVersion: 1 }], ["POST", `/api/milestones/${active.id}/archive`, { mutationId: randomUUID(), expectedVersion: 1 }]] as const) {
    assert.equal((await fetch(`${origin}${url}`, { method, headers: { cookie, Origin: origin, "Content-Type": "application/json" }, body: command ? JSON.stringify(command) : undefined })).status, 503);
  }
  for (const [method, url, command] of [["GET", actionURL, undefined], ["GET", `/api/actions/${openAction.id}`, undefined], ["POST", actionURL, actionCreate], ["PATCH", `/api/actions/${openAction.id}`, { ...actionEdit, expectedVersion: 1 }], ["POST", `/api/actions/${openAction.id}/complete`, actionArchive], ["POST", `/api/actions/${openAction.id}/archive`, actionArchive]] as const) {
    assert.equal((await fetch(`${origin}${url}`, { method, headers: { cookie, Origin: origin, "Content-Type": "application/json" }, body: command ? JSON.stringify(command) : undefined })).status, 503);
  }
  for (const [method, url, command] of [["GET", "/api/weekly-plans", undefined], ["GET", "/api/weekly-plans/candidates", undefined], ["GET", `/api/weekly-plans/${baseline.id}`, undefined], ["POST", "/api/weekly-plans", planCreate], ["PATCH", `/api/weekly-plans/${baseline.id}`, planSave], ["POST", `/api/weekly-plans/${baseline.id}/commit`, planCommit]] as const) assert.equal((await fetch(`${origin}${url}`, { method, headers: { cookie, Origin: origin, "Content-Type": "application/json" }, body: command ? JSON.stringify(command) : undefined })).status, 503);
  for (const [method, url, command] of [["GET", amendmentURL, undefined], ["POST", amendmentURL, amendmentCommand], ["GET", `/api/weekly-plan-amendments/${amendmentOne.id}`, undefined]] as const) assert.equal((await fetch(`${origin}${url}`, { method, headers: { cookie, Origin: origin, "Content-Type": "application/json" }, body: command ? JSON.stringify(command) : undefined })).status, 503);
  const planningRecovery = await fetch(`${origin}/planning`, { headers: { cookie } }); assert.ok((await planningRecovery.text()).includes("Planning could not be loaded."));
  const recovery = await fetch(`${origin}/goals`, { headers: { cookie } });
  assert.ok((await recovery.text()).includes("Let’s reconnect."));
  console.log("PASS: real authenticated production boot; same User/session/Goal after restart; create/edit/archive receipt persistence; Goal and Milestone Active/Completed/Archived history after two restarts; all four Milestone and Action receipts replay original snapshots under terminal parents; all Action states/associations/estimates survive; two Weekly Drafts survive the first actual restart, committed frozen context and another Draft survive the second; all three Plan receipts replay original results despite source terminal transitions; two immutable full-plan amendments and original baseline survive actual restart and browser reload; both amendment receipts return original results after later amendment and terminal source changes; original and amendment snapshots inspected in production browser; unavailable database gives 503 on every planning read/mutation and explicit recovery.");
} catch (error) {
  console.error(error instanceof Error ? error.message : "Restart proof failed.");
  if (log.includes("EADDRINUSE")) console.error("Port 3102 is in use; no external process was stopped.");
  process.exitCode = 1;
} finally { await stop(); }
