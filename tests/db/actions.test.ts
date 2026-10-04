import { afterAll, beforeAll, beforeEach, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { connectDatabase } from "../../src/db/connect";
import { focusSession, timeBlock, commitmentIdentity, weeklyPlanAmendment, amendmentCommitment, weeklyPlan, weeklyCommitment, action, goal, milestone, mutationReceipt } from "../../src/db/schema";
import { goalRepository } from "../../src/modules/goals/repository";
import { goalService } from "../../src/modules/goals/service";
import { milestoneRepository } from "../../src/modules/milestones/repository";
import { milestoneService } from "../../src/modules/milestones/service";
import { actionRepository } from "../../src/modules/actions/repository";
import { actionService } from "../../src/modules/actions/service";
import { ApplicationError } from "../../src/domain/errors";
import { provisionLocalUser } from "../../scripts/local-user";
import { requireTestDatabaseURL } from "../../scripts/test-database";
const { db, pool } = connectDatabase(requireTestDatabaseURL().url);
const goals = goalService(goalRepository(db)); const milestones = milestoneService(milestoneRepository(db)); const repository = actionRepository(db); const service = actionService(repository);
const a = { userId: "" }; const b = { userId: "" };
const create = (overrides = {}) => ({ mutationId: randomUUID(), title: "Draft planning wireframe", ...overrides });
const transition = (expectedVersion = 1) => ({ mutationId: randomUUID(), expectedVersion });
const newGoal = (actor = a) => goals.createGoal(actor, { mutationId: randomUUID(), title: "Use the planning loop", outcome: "I rely on it every week." });
const newMilestone = (goalId: string, actor = a) => milestones.createMilestone(actor, goalId, { mutationId: randomUUID(), title: "Flow demonstrated", successCondition: "One real user completes the flow." });
beforeAll(async () => { await migrate(db, { migrationsFolder: "src/db/migrations" }); for (const [suffix, actor] of [["A", a], ["B", b]] as const) actor.userId = (await provisionLocalUser(db, { email: process.env[`TEST_USER_${suffix}_EMAIL`], password: process.env[`TEST_USER_${suffix}_PASSWORD`], name: `Engineer ${suffix}`, timezone: "Europe/London" })).id; });
beforeEach(async () => { const owners = [a.userId, b.userId]; await db.delete(mutationReceipt).where(inArray(mutationReceipt.ownerId, owners)); await db.delete(amendmentCommitment).where(inArray(amendmentCommitment.ownerId, owners)); await db.delete(weeklyPlanAmendment).where(inArray(weeklyPlanAmendment.ownerId, owners)); await db.delete(focusSession).where(inArray(focusSession.ownerId, owners)); await db.delete(timeBlock).where(inArray(timeBlock.ownerId, owners)); await db.delete(commitmentIdentity).where(inArray(commitmentIdentity.ownerId, owners)); await db.delete(weeklyCommitment).where(inArray(weeklyCommitment.ownerId, owners)); await db.delete(weeklyPlan).where(inArray(weeklyPlan.ownerId, owners)); await db.delete(action).where(inArray(action.ownerId, owners)); await db.delete(milestone).where(inArray(milestone.ownerId, owners)); await db.delete(goal).where(inArray(goal.ownerId, owners)); });
afterAll(() => pool.end());
it("migration enforces owned exact Goal/Milestone integrity, bounded fields and lifecycle", async () => {
  await migrate(db, { migrationsFolder: "src/db/migrations" }); const parent = await newGoal(); const other = await newGoal(); const m = await newMilestone(parent.id); const cross = await newMilestone(other.id);
  const columns = await pool.query("SELECT column_name FROM information_schema.columns WHERE table_name='action' ORDER BY ordinal_position"); expect(columns.rows.map((r) => r.column_name)).toEqual(["id", "owner_id", "goal_id", "milestone_id", "title", "done_when", "estimate_minutes", "state", "version", "created_at", "updated_at", "completed_at", "archived_at"]);
  const base = { id: randomUUID(), ownerId: a.userId, goalId: parent.id, title: "Draft" };
  for (const fields of [{ ownerId: b.userId }, { goalId: randomUUID() }, { goalId: null }, { milestoneId: cross.id }, { milestoneId: randomUUID() }, { title: " " }, { title: "😀".repeat(161) }, { doneWhen: "" }, { doneWhen: "😀".repeat(2001) }, { estimateMinutes: 0 }, { estimateMinutes: 10081 }, { estimateMinutes: 1.5 }, { version: 0 }, { state: "completed" as const }, { state: "archived" as const, completedAt: new Date() }]) await expect(db.insert(action).values({ ...base, ...fields } as typeof action.$inferInsert)).rejects.toThrow();
  await db.insert(action).values({ ...base, milestoneId: m.id }); await expect(db.delete(goal).where(eq(goal.id, parent.id))).rejects.toThrow(); await expect(db.delete(milestone).where(eq(milestone.id, m.id))).rejects.toThrow();
});
it("persists Goal-only and milestone-linked work without modifying parents or estimates", async () => {
  const parent = await newGoal(); const m = await newMilestone(parent.id); expect((await service.listActions(a, parent.id)).actions).toEqual([]);
  const first = await service.createAction(a, parent.id, create()); const second = await service.createAction(a, parent.id, create({ milestoneId: m.id, doneWhen: "Ready to review", estimateMinutes: 120 }));
  expect(first).toMatchObject({ goalId: parent.id, milestoneId: null, doneWhen: null, estimateMinutes: null, version: 1, state: "open" });
  const view = await service.getAction(a, second.id); expect(view).toMatchObject({ action: second, milestone: m, mutability: { editable: true } }); expect(view.action).not.toHaveProperty("ownerId");
  expect((await service.listActions(a, parent.id)).actions.map((v) => v.action.id)).toEqual([second.id, first.id]); expect(await goals.getGoal(a, parent.id)).toEqual(parent); expect(await milestones.getMilestone(a, m.id)).toEqual(m);
});
it("rejects standalone, unknown fields and invalid text/estimate with no receipt side effects", async () => {
  const parent = await newGoal(); const receipts = await db.select().from(mutationReceipt);
  for (const fields of [{ title: " " }, { title: "\ud800" }, { title: "x".repeat(161) }, { doneWhen: 1 }, { doneWhen: "\0" }, { doneWhen: "😀".repeat(2001) }, { estimateMinutes: 0 }, { estimateMinutes: -1 }, { estimateMinutes: 1.5 }, { estimateMinutes: "60" }, { estimateMinutes: 10081 }, { ownerId: b.userId }, { goalId: parent.id }]) await expect(service.createAction(a, parent.id, create(fields))).rejects.toMatchObject({ code: "VALIDATION" });
  for (const id of [null, "", undefined]) await expect(service.createAction(a, id as unknown as string, create())).rejects.toMatchObject({ code: "VALIDATION" });
  await expect(service.createAction(a, randomUUID(), create())).rejects.toMatchObject({ code: "NOT_FOUND" }); expect(await db.select().from(action)).toHaveLength(0); expect(await db.select().from(mutationReceipt)).toEqual(receipts);
});
it("invalid milestone assignments stay indistinguishable for missing/foreign/cross-Goal IDs", async () => {
  const parent = await newGoal(); const other = await newGoal(); const foreignGoal = await newGoal(b); const cross = await newMilestone(other.id); const foreign = await newMilestone(foreignGoal.id, b); const first = await service.createAction(a, parent.id, create());
  for (const milestoneId of [cross.id, foreign.id, randomUUID()]) { await expect(service.createAction(a, parent.id, create({ milestoneId }))).rejects.toMatchObject({ code: "NOT_FOUND", message: "This milestone is unavailable.", details: undefined }); await expect(service.updateAction(a, first.id, { ...create({ milestoneId }), expectedVersion: 1 })).rejects.toMatchObject({ code: "NOT_FOUND", message: "This milestone is unavailable.", details: undefined }); }
  expect((await service.getAction(a, first.id)).action).toEqual(first);
});
it("supports A → null → B and A → B while Goal identity and creation remain immutable", async () => {
  const parent = await newGoal(); const m1 = await newMilestone(parent.id); const m2 = await newMilestone(parent.id); const first = await service.createAction(a, parent.id, create({ milestoneId: m1.id, estimateMinutes: 60 }));
  const detached = await service.updateAction(a, first.id, { ...create(), expectedVersion: 1 }); expect(detached.milestoneId).toBeNull();
  const linked = await service.updateAction(a, first.id, { ...create({ milestoneId: m2.id, estimateMinutes: 90, doneWhen: "Reviewed" }), expectedVersion: 2 }); expect(linked).toMatchObject({ goalId: parent.id, milestoneId: m2.id, estimateMinutes: 90, version: 3, createdAt: first.createdAt });
  const moved = await service.updateAction(a, first.id, { ...create({ milestoneId: m1.id }), expectedVersion: 3 }); expect(moved.milestoneId).toBe(m1.id);
  await expect(service.updateAction(a, first.id, { ...create(), expectedVersion: 4, goalId: randomUUID() })).rejects.toMatchObject({ code: "VALIDATION" });
});
it("duplicate create/edit/complete/archive write once and all original snapshots replay after Goal/Milestone history", async () => {
  const parent = await newGoal(); const m = await newMilestone(parent.id); const command = create({ milestoneId: m.id, estimateMinutes: 120, doneWhen: "Reviewed" }); const duplicate = await Promise.all(Array.from({ length: 5 }, () => service.createAction(a, parent.id, command))); const first = duplicate[0]; for (const value of duplicate) expect(value).toEqual(first); expect(await db.select().from(action)).toHaveLength(1);
  const edit = { ...create({ milestoneId: null, estimateMinutes: 45, doneWhen: "Draft reviewed", title: "Edited once" }), expectedVersion: 1 }; const edits = await Promise.all([service.updateAction(a, first.id, edit), service.updateAction(a, first.id, edit)]); expect(edits[0]).toEqual(edits[1]); expect(edits[0].version).toBe(2);
  const completion = transition(2); const completions = await Promise.all([service.completeAction(a, first.id, completion), service.completeAction(a, first.id, completion)]); expect(completions[0]).toEqual(completions[1]); expect(completions[0]).toMatchObject({ state: "completed", version: 3, estimateMinutes: 45 }); expect(completions[0].completedAt).not.toBeNull();
  const otherCommand = create({ milestoneId: m.id, estimateMinutes: 30 }); const second = await service.createAction(a, parent.id, otherCommand); const archival = transition(); const archives = await Promise.all([service.archiveAction(a, second.id, archival), service.archiveAction(a, second.id, archival)]); expect(archives[0]).toEqual(archives[1]); expect(archives[0]).toMatchObject({ state: "archived", version: 2, estimateMinutes: 30 }); expect(archives[0].archivedAt).not.toBeNull();
  await milestones.completeMilestone(a, m.id, transition()); await goals.archiveGoal(a, parent.id, transition());
  expect(await service.createAction(a, parent.id, command)).toEqual(first); expect(await service.createAction(a, parent.id, otherCommand)).toEqual(second); expect(await service.updateAction(a, first.id, edit)).toEqual(edits[0]); expect(await service.completeAction(a, first.id, completion)).toEqual(completions[0]); expect(await service.archiveAction(a, second.id, archival)).toEqual(archives[0]); expect(await db.select().from(action)).toHaveLength(2);
});
it("same mutation IDs reject changed payload, target, version and aggregate kinds", async () => {
  const parent = await newGoal(); const m = await newMilestone(parent.id); const input = create(); const first = await service.createAction(a, parent.id, input); const other = await newGoal();
  for (const change of [{ title: "Other" }, { doneWhen: "Changed" }, { estimateMinutes: 1 }, { milestoneId: m.id }]) await expect(service.createAction(a, parent.id, { ...input, ...change })).rejects.toMatchObject({ code: "CONFLICT", details: { kind: "MUTATION_ID" } });
  await expect(service.createAction(a, other.id, input)).rejects.toMatchObject({ code: "CONFLICT", details: { kind: "MUTATION_ID" } });
  await expect(goals.createGoal(a, { mutationId: input.mutationId, title: "Goal", outcome: "Outcome" })).rejects.toMatchObject({ code: "CONFLICT", details: { kind: "MUTATION_ID" } });
  await expect(milestones.createMilestone(a, parent.id, { mutationId: input.mutationId, title: "Milestone", successCondition: "Outcome" })).rejects.toMatchObject({ code: "CONFLICT", details: { kind: "MUTATION_ID" } });
  const goalCommand = { mutationId: randomUUID(), title: "Goal", outcome: "Result" }; await goals.createGoal(a, goalCommand); await expect(service.createAction(a, parent.id, create({ mutationId: goalCommand.mutationId }))).rejects.toMatchObject({ code: "CONFLICT", details: { kind: "MUTATION_ID" } });
  const milestoneCommand = { mutationId: randomUUID(), title: "M", successCondition: "Observed" }; await milestones.createMilestone(a, parent.id, milestoneCommand); await expect(service.createAction(a, parent.id, create({ mutationId: milestoneCommand.mutationId }))).rejects.toMatchObject({ code: "CONFLICT", details: { kind: "MUTATION_ID" } });
  const edit = { ...create({ title: "Edited" }), expectedVersion: 1 }; await service.updateAction(a, first.id, edit); await expect(service.updateAction(a, first.id, { ...edit, expectedVersion: 2 })).rejects.toMatchObject({ code: "CONFLICT", details: { kind: "MUTATION_ID" } });
  const completed = transition(2); await service.completeAction(a, first.id, completed); await expect(service.archiveAction(a, first.id, completed)).rejects.toMatchObject({ code: "CONFLICT", details: { kind: "MUTATION_ID" } });
});
it("separate owner receipt namespaces and normalized equivalent payloads replay safely", async () => {
  const parentA = await newGoal(); const parentB = await newGoal(b); const input = create(); const first = await service.createAction(a, parentA.id, input); const second = await service.createAction(b, parentB.id, input); expect(first.id).not.toBe(second.id);
  expect(await service.createAction(a, parentA.id, { ...input, title: ` ${input.title} `, doneWhen: " ", estimateMinutes: null, milestoneId: null })).toEqual(first); expect(await db.select().from(mutationReceipt).where(eq(mutationReceipt.mutationId, input.mutationId))).toHaveLength(2);
});
type Kind = "edit" | "reassign" | "complete" | "archive";
for (const [left, right] of [["edit", "edit"], ["edit", "complete"], ["edit", "archive"], ["complete", "archive"], ["reassign", "edit"], ["reassign", "complete"], ["reassign", "reassign"], ["complete", "complete"], ["archive", "archive"]] as const) it(`competing ${left}/${right} have exactly one version winner and typed current snapshot`, async () => {
  const parent = await newGoal(); const m = await newMilestone(parent.id); const first = await service.createAction(a, parent.id, create({ estimateMinutes: 60 }));
  const apply = (kind: Kind) => kind === "edit" || kind === "reassign" ? service.updateAction(a, first.id, { ...create({ title: randomUUID(), milestoneId: kind === "reassign" ? m.id : null, estimateMinutes: 60 }), expectedVersion: 1 }) : kind === "complete" ? service.completeAction(a, first.id, transition()) : service.archiveAction(a, first.id, transition());
  const results = await Promise.allSettled([apply(left), apply(right)]); const winners = results.filter((r) => r.status === "fulfilled"); const losers = results.filter((r) => r.status === "rejected"); expect(winners).toHaveLength(1); expect(losers).toHaveLength(1);
  if (winners[0].status !== "fulfilled" || losers[0].status !== "rejected") throw new Error("Unexpected race"); expect(losers[0].reason).toMatchObject({ code: "CONFLICT", details: { kind: "VERSION", current: winners[0].value } }); expect((await service.getAction(a, first.id)).action).toEqual(winners[0].value); expect(await db.select().from(mutationReceipt)).toHaveLength(4);
});
for (const terminal of ["completed", "archived"] as const) it(`${terminal} Action definition/association/estimate is immutable and cannot reopen or cross-transition`, async () => {
  const parent = await newGoal(); const first = await service.createAction(a, parent.id, create({ estimateMinutes: 120 })); const value = terminal === "completed" ? await service.completeAction(a, first.id, transition()) : await service.archiveAction(a, first.id, transition());
  await Promise.all([service.updateAction(a, first.id, { ...create({ estimateMinutes: 20 }), expectedVersion: 2 }), service.completeAction(a, first.id, transition(2)), service.archiveAction(a, first.id, transition(2))].map((promise) => expect(promise).rejects.toMatchObject({ code: "CONFLICT", details: { kind: "TERMINAL", current: value } })));
  await Promise.all([service.completeAction(a, first.id, transition()), service.archiveAction(a, first.id, transition())].map((promise) => expect(promise).rejects.toMatchObject({ code: "CONFLICT", details: { kind: "VERSION", current: value } }))); expect((await service.getAction(a, first.id)).action).toEqual(value); expect(await goals.getGoal(a, parent.id)).toEqual(parent);
});
for (const terminal of ["completed", "archived"] as const) it(`Milestone ${terminal} retains all associated Action rows exactly and prevents escape by detachment`, async () => {
  const parent = await newGoal(); const m = await newMilestone(parent.id); const dest = await newMilestone(parent.id); const input = create({ milestoneId: m.id, estimateMinutes: 90 }); const open = await service.createAction(a, parent.id, input); const second = await service.createAction(a, parent.id, create({ milestoneId: m.id, estimateMinutes: 120 })); const third = await service.createAction(a, parent.id, create({ milestoneId: m.id, estimateMinutes: 30 })); await service.completeAction(a, second.id, transition()); await service.archiveAction(a, third.id, transition());
  const before = await db.select().from(action); if (terminal === "completed") await milestones.completeMilestone(a, m.id, transition()); else await milestones.archiveMilestone(a, m.id, transition()); expect(await db.select().from(action)).toEqual(before);
  const catalog = await service.listActions(a, parent.id); expect(catalog.actions).toHaveLength(3); expect(catalog.actions.every((v) => !v.mutability.editable)).toBe(true); expect(catalog.assignableMilestones.map((m) => m.id)).toEqual([dest.id]);
  await Promise.all([service.updateAction(a, open.id, { ...create(), expectedVersion: 1 }), service.updateAction(a, open.id, { ...create({ milestoneId: dest.id }), expectedVersion: 1 }), service.completeAction(a, open.id, transition()), service.archiveAction(a, open.id, transition())].map((promise) => expect(promise).rejects.toMatchObject({ code: "CONFLICT", details: { kind: "MILESTONE_TERMINAL" } })));
  const unlinked = await service.createAction(a, parent.id, create()); await Promise.all([service.createAction(a, parent.id, create({ milestoneId: m.id })), service.updateAction(a, unlinked.id, { ...create({ milestoneId: m.id }), expectedVersion: 1 })].map((promise) => expect(promise).rejects.toMatchObject({ code: "VALIDATION", details: { fields: { milestoneId: "Choose an active milestone from this goal." } } }))); expect(await service.createAction(a, parent.id, input)).toEqual(open);
});
it("Goal archival retains all Action rows, states and estimates; every new mutation is read-only", async () => {
  const parent = await newGoal(); const m = await newMilestone(parent.id); const first = await service.createAction(a, parent.id, create({ milestoneId: m.id, estimateMinutes: 30 })); const second = await service.createAction(a, parent.id, create()); const third = await service.createAction(a, parent.id, create()); await service.completeAction(a, second.id, transition()); await service.archiveAction(a, third.id, transition()); const before = await db.select().from(action); await goals.archiveGoal(a, parent.id, transition()); expect(await db.select().from(action)).toEqual(before);
  const result = await service.listActions(a, parent.id); expect(result).toMatchObject({ canCreate: false, assignableMilestones: [] }); expect(result.actions.every((v) => !v.mutability.editable)).toBe(true);
  await Promise.all([service.createAction(a, parent.id, create()), service.updateAction(a, first.id, { ...create(), expectedVersion: 1 }), service.completeAction(a, first.id, transition()), service.archiveAction(a, first.id, transition())].map((promise) => expect(promise).rejects.toMatchObject({ code: "CONFLICT", details: { kind: "GOAL_ARCHIVED" } })));
});
it("two-owner isolation blocks every route-equivalent operation with safe missing/foreign errors", async () => {
  const parent = await newGoal(); const first = await service.createAction(a, parent.id, create());
  for (const id of [parent.id, randomUUID()]) await Promise.all([service.listActions(b, id), service.createAction(b, id, create())].map((promise) => expect(promise).rejects.toMatchObject({ code: "NOT_FOUND", message: "This goal is unavailable.", details: undefined })));
  for (const id of [first.id, randomUUID()]) await Promise.all([service.getAction(b, id), service.updateAction(b, id, { ...create(), expectedVersion: 1 }), service.completeAction(b, id, transition()), service.archiveAction(b, id, transition())].map((promise) => expect(promise).rejects.toMatchObject({ code: "NOT_FOUND", message: "This action is unavailable.", details: undefined }))); expect((await service.getAction(a, first.id)).action).toEqual(first);
});
for (const parentKind of ["goal", "completed", "archived"] as const) for (const kind of ["create", "edit", "reassign", "complete", "archive"] as const) it(`${parentKind} parent transition serializes with ${kind} without post-terminal child changes`, async () => {
  const parent = await newGoal(); const m = await newMilestone(parent.id); const dest = await newMilestone(parent.id); const first = await service.createAction(a, parent.id, create({ milestoneId: m.id }));
  const change = () => kind === "create" ? service.createAction(a, parent.id, create({ milestoneId: m.id })) : kind === "edit" || kind === "reassign" ? service.updateAction(a, first.id, { ...create({ milestoneId: kind === "reassign" ? dest.id : m.id }), expectedVersion: 1 }) : kind === "complete" ? service.completeAction(a, first.id, transition()) : service.archiveAction(a, first.id, transition());
  const parentChange = () => parentKind === "goal" ? goals.archiveGoal(a, parent.id, transition()) : parentKind === "completed" ? milestones.completeMilestone(a, m.id, transition()) : milestones.archiveMilestone(a, m.id, transition());
  const [p, c] = await Promise.allSettled([parentChange(), change()]); expect(p.status).toBe("fulfilled"); if (c.status === "rejected") { expect(c.reason).toMatchObject({ code: parentKind !== "goal" && kind === "create" ? "VALIDATION" : "CONFLICT" }); expect((await service.getAction(a, first.id)).action).toEqual(first); } else expect((await service.getAction(a, c.value.id)).action).toEqual(c.value);
  // Fresh versions still cannot escape a terminal linked parent; a reassignment which won beforehand remains valid.
  const latest = (await service.getAction(a, first.id)).action;
  if (latest.milestoneId === m.id || parentKind === "goal") await expect(service.updateAction(a, first.id, { ...create(), expectedVersion: latest.version })).rejects.toMatchObject({ code: "CONFLICT" });
});
it("transaction rollback removes Action and receipt; every unavailable DB operation fails explicitly", async () => {
  const parent = await newGoal(); const first = await service.createAction(a, parent.id, create()); const input = randomUUID();
  await expect(repository.executeOwned(a, input, "a".repeat(64), async (tx) => { await tx.insert({ ...first, id: randomUUID() }); throw new ApplicationError("INTERNAL", "Injected failure"); })).rejects.toMatchObject({ code: "INTERNAL" }); expect(await db.select().from(action)).toHaveLength(1); expect(await db.select().from(mutationReceipt).where(eq(mutationReceipt.mutationId, input))).toHaveLength(0);
  const badURL = new URL(requireTestDatabaseURL().url); badURL.pathname = `/execution_test_missing_${randomUUID().replaceAll("-", "")}`; const bad = connectDatabase(badURL.toString());
  try { const unavailable = actionService(actionRepository(bad.db)); await Promise.all([unavailable.listActions(a, parent.id), unavailable.getAction(a, first.id), unavailable.createAction(a, parent.id, create()), unavailable.updateAction(a, first.id, { ...create(), expectedVersion: 1 }), unavailable.completeAction(a, first.id, transition()), unavailable.archiveAction(a, first.id, transition())].map((promise) => expect(promise).rejects.toMatchObject({ code: "DATABASE_UNAVAILABLE" }))); } finally { await bad.pool.end(); }
});
