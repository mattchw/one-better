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
import { ApplicationError } from "../../src/domain/errors";
import { provisionLocalUser } from "../../scripts/local-user";
import { requireTestDatabaseURL } from "../../scripts/test-database";
import type { Milestone } from "../../src/modules/milestones/domain";
const { db, pool } = connectDatabase(requireTestDatabaseURL().url);
const goals = goalService(goalRepository(db)); const repository = milestoneRepository(db); const service = milestoneService(repository);
const a = { userId: "" }; const b = { userId: "" };
const create = (overrides = {}) => ({ mutationId: randomUUID(), title: "Weekly planning loop is usable", successCondition: "Choose commitments against capacity and preserve the plan.", ...overrides });
const transition = (expectedVersion = 1) => ({ mutationId: randomUUID(), expectedVersion });
const newGoal = (actor = a) => goals.createGoal(actor, { mutationId: randomUUID(), title: "Use the planning loop", outcome: "I rely on it every week." });
beforeAll(async () => {
  await migrate(db, { migrationsFolder: "src/db/migrations" });
  for (const [suffix, actor] of [["A", a], ["B", b]] as const) actor.userId = (await provisionLocalUser(db, { email: process.env[`TEST_USER_${suffix}_EMAIL`], password: process.env[`TEST_USER_${suffix}_PASSWORD`], name: `Engineer ${suffix}`, timezone: "Europe/London" })).id;
});
beforeEach(async () => {
  const owners = [a.userId, b.userId];
  await db.delete(mutationReceipt).where(inArray(mutationReceipt.ownerId, owners));
  await db.delete(amendmentCommitment).where(inArray(amendmentCommitment.ownerId, owners)); await db.delete(weeklyPlanAmendment).where(inArray(weeklyPlanAmendment.ownerId, owners)); await db.delete(focusSession).where(inArray(focusSession.ownerId, owners)); await db.delete(timeBlock).where(inArray(timeBlock.ownerId, owners)); await db.delete(commitmentIdentity).where(inArray(commitmentIdentity.ownerId, owners)); await db.delete(weeklyCommitment).where(inArray(weeklyCommitment.ownerId, owners)); await db.delete(weeklyPlan).where(inArray(weeklyPlan.ownerId, owners)); await db.delete(action).where(inArray(action.ownerId, owners)); await db.delete(milestone).where(inArray(milestone.ownerId, owners)); await db.delete(goal).where(inArray(goal.ownerId, owners));
});
afterAll(() => pool.end());
it("migration creates constrained checkpoints with composite owned-parent integrity", async () => {
  await migrate(db, { migrationsFolder: "src/db/migrations" });
  const columns = await pool.query("SELECT column_name FROM information_schema.columns WHERE table_name='milestone' ORDER BY ordinal_position");
  expect(columns.rows.map((r) => r.column_name)).toEqual(["id", "owner_id", "goal_id", "title", "success_condition", "state", "version", "created_at", "updated_at", "completed_at", "archived_at", "evidence"]);
  const parent = await newGoal();
  const base = { id: randomUUID(), ownerId: a.userId, goalId: parent.id, title: "Checkpoint", successCondition: "Observable success" };
  for (const fields of [{ ownerId: b.userId }, { goalId: randomUUID() }, { title: "" }, { successCondition: " " }, { title: "😀".repeat(161) }, { version: 0 }, { state: "completed" as const }, { evidence: "Only completion permits evidence" }, { state: "archived" as const, completedAt: new Date() }]) await expect(db.insert(milestone).values({ ...base, ...fields })).rejects.toThrow();
  await db.insert(milestone).values(base);
  await expect(db.delete(goal).where(eq(goal.id, parent.id))).rejects.toThrow();
});
it("persists under exactly one owned goal with immutable identity and stable creation order", async () => {
  const parent = await newGoal(); const other = await newGoal();
  expect(await service.listMilestones(a, parent.id)).toEqual([]);
  const first = await service.createMilestone(a, parent.id, create()); const second = await service.createMilestone(a, parent.id, create({ title: "😀".repeat(160), successCondition: "😀".repeat(2000) }));
  expect(await service.listMilestones(a, other.id)).toEqual([]); expect((await service.listMilestones(a, parent.id)).map((m) => m.id)).toEqual([second.id, first.id]);
  const edited = await service.updateMilestone(a, first.id, { ...create({ title: "Edited" }), expectedVersion: 1 });
  expect(edited).toMatchObject({ id: first.id, goalId: parent.id, createdAt: first.createdAt, state: "active", version: 2 }); expect((await goals.getGoal(a, parent.id))).toEqual(parent);
  expect(await service.getMilestone(a, first.id)).toEqual(edited);
});
it("validation rejects invalid fields and move attempts without rows or receipts", async () => {
  const parent = await newGoal(); const receipts = await db.select().from(mutationReceipt);
  for (const fields of [{ title: " \t " }, { successCondition: " " }, { title: "😀".repeat(161) }, { successCondition: "x".repeat(2001) }, { ownerId: b.userId }, { goalId: randomUUID() }]) await expect(service.createMilestone(a, parent.id, create(fields))).rejects.toMatchObject({ code: "VALIDATION" });
  expect(await db.select().from(milestone)).toHaveLength(0); expect(await db.select().from(mutationReceipt)).toEqual(receipts);
});
it("simultaneous duplicate creates write one checkpoint and mismatch or aggregate reuse is rejected", async () => {
  const parent = await newGoal(); const command = create(); const results = await Promise.all(Array.from({ length: 5 }, () => service.createMilestone(a, parent.id, command)));
  for (const result of results) expect(result).toEqual(results[0]); expect(await db.select().from(milestone)).toHaveLength(1);
  await expect(service.createMilestone(a, parent.id, { ...command, successCondition: "Different" })).rejects.toMatchObject({ code: "CONFLICT", details: { kind: "MUTATION_ID" } });
  await expect(goals.createGoal(a, { mutationId: command.mutationId, title: "A goal", outcome: "Success" })).rejects.toMatchObject({ code: "CONFLICT", details: { kind: "MUTATION_ID" } });
  const goalCommand = { mutationId: randomUUID(), title: "Goal", outcome: "Goal result" }; await goals.createGoal(a, goalCommand);
  await expect(service.createMilestone(a, parent.id, { ...command, mutationId: goalCommand.mutationId })).rejects.toMatchObject({ code: "CONFLICT", details: { kind: "MUTATION_ID" } });
});
it("create/edit/complete receipts replay original snapshots after parent archival", async () => {
  const parent = await newGoal(); const command = create(); const first = await service.createMilestone(a, parent.id, command);
  const edit = { ...create({ title: "Revised checkpoint" }), expectedVersion: 1 }; const edited = await service.updateMilestone(a, first.id, edit);
  const complete = { ...transition(2), evidence: " Used it for three consecutive weeks. " }; const completed = await Promise.all([service.completeMilestone(a, first.id, complete), service.completeMilestone(a, first.id, complete)]);
  expect(completed[0]).toEqual(completed[1]); expect(completed[0]).toMatchObject({ version: 3, state: "completed", successCondition: edited.successCondition, evidence: "Used it for three consecutive weeks." }); expect(completed[0].completedAt).not.toBeNull();
  await goals.archiveGoal(a, parent.id, transition());
  expect(await service.createMilestone(a, parent.id, command)).toEqual(first); expect(await service.updateMilestone(a, first.id, edit)).toEqual(edited); expect(await service.completeMilestone(a, first.id, complete)).toEqual(completed[0]);
  await expect(service.completeMilestone(a, first.id, { ...complete, evidence: "Different proof" })).rejects.toMatchObject({ code: "CONFLICT", details: { kind: "MUTATION_ID" } });
  expect(await service.getMilestone(a, first.id)).toEqual(completed[0]);
});
it("duplicate edit/archive increment once and archive replay retains the original result", async () => {
  const parent = await newGoal(); const first = await service.createMilestone(a, parent.id, create());
  const edit = { ...create({ title: "Edited" }), expectedVersion: 1 }; const edited = await Promise.all([service.updateMilestone(a, first.id, edit), service.updateMilestone(a, first.id, edit)]);
  expect(edited[0]).toEqual(edited[1]); expect(edited[0].version).toBe(2);
  const command = transition(2); const archived = await Promise.all([service.archiveMilestone(a, first.id, command), service.archiveMilestone(a, first.id, command)]);
  expect(archived[0]).toEqual(archived[1]); expect(archived[0]).toMatchObject({ state: "archived", version: 3, id: first.id, goalId: parent.id, title: edited[0].title });
  await goals.archiveGoal(a, parent.id, transition()); expect(await service.archiveMilestone(a, first.id, command)).toEqual(archived[0]);
  await expect(service.archiveMilestone(a, first.id, { ...command, expectedVersion: 3 })).rejects.toMatchObject({ code: "CONFLICT", details: { kind: "MUTATION_ID" } });
  expect(await db.select().from(milestone)).toHaveLength(1);
});
const operations = ["edit", "complete", "archive"] as const;
for (const [left, right] of [["edit", "edit"], ["edit", "complete"], ["edit", "archive"], ["complete", "archive"], ["complete", "complete"], ["archive", "archive"]] as const) it(`concurrent ${left}/${right} with distinct IDs has one winner and a typed stale conflict`, async () => {
  const parent = await newGoal(); const first = await service.createMilestone(a, parent.id, create());
  const apply = (kind: typeof operations[number]) => kind === "edit" ? service.updateMilestone(a, first.id, { ...create({ title: randomUUID() }), expectedVersion: 1 }) : kind === "complete" ? service.completeMilestone(a, first.id, { ...transition(), evidence: "Observed" }) : service.archiveMilestone(a, first.id, transition());
  const results = await Promise.allSettled([apply(left), apply(right)]); const winners = results.filter((r) => r.status === "fulfilled"); const losers = results.filter((r) => r.status === "rejected");
  expect(winners).toHaveLength(1); expect(losers).toHaveLength(1); if (winners[0].status !== "fulfilled" || losers[0].status !== "rejected") throw new Error("Unexpected outcome");
  expect(losers[0].reason).toMatchObject({ code: "CONFLICT", details: { kind: "VERSION", current: winners[0].value } }); expect(await service.getMilestone(a, first.id)).toEqual(winners[0].value); expect((await db.select().from(mutationReceipt))).toHaveLength(3);
});
it("terminal definitions, evidence and timestamps cannot be rewritten, reopened or cross-transitioned", async () => {
  const parent = await newGoal();
  for (const state of ["completed", "archived"] as const) {
    const first = await service.createMilestone(a, parent.id, create());
    const terminal = state === "completed" ? await service.completeMilestone(a, first.id, transition()) : await service.archiveMilestone(a, first.id, transition());
    await Promise.all([service.updateMilestone(a, first.id, { ...create({ title: "Rewrite history" }), expectedVersion: 2 }), service.completeMilestone(a, first.id, { ...transition(2), evidence: "Rewrite" }), service.archiveMilestone(a, first.id, transition(2))].map((promise) => expect(promise).rejects.toMatchObject({ code: "CONFLICT", details: { kind: "TERMINAL" } })));
    expect(await service.getMilestone(a, first.id)).toEqual(terminal); expect(terminal.evidence).toBeNull();
  }
  expect(await goals.getGoal(a, parent.id)).toEqual(parent);
});
it("foreign and missing IDs cannot list/get/create/edit/complete/archive or expose current state", async () => {
  const parent = await newGoal(); const first = await service.createMilestone(a, parent.id, create());
  for (const parentId of [parent.id, randomUUID()]) {
    await expect(service.listMilestones(b, parentId)).rejects.toMatchObject({ code: "NOT_FOUND", message: "This goal is unavailable." });
    await expect(service.createMilestone(b, parentId, create())).rejects.toMatchObject({ code: "NOT_FOUND", message: "This goal is unavailable." });
  }
  for (const id of [first.id, randomUUID()]) await Promise.all([service.getMilestone(b, id), service.updateMilestone(b, id, { ...create(), expectedVersion: 1 }), service.completeMilestone(b, id, transition()), service.archiveMilestone(b, id, transition())].map((promise) => expect(promise).rejects.toMatchObject({ code: "NOT_FOUND", message: "This milestone is unavailable.", details: undefined })));
  expect(await service.getMilestone(a, first.id)).toEqual(first);
});
it("owners have separate receipt namespaces and normalized payloads replay", async () => {
  const parentA = await newGoal(); const parentB = await newGoal(b); const command = create();
  const first = await service.createMilestone(a, parentA.id, command); const second = await service.createMilestone(b, parentB.id, command); expect(first.id).not.toBe(second.id);
  expect(await service.createMilestone(a, parentA.id, { ...command, title: ` ${command.title} ` })).toEqual(first);
  const complete = { ...transition(), evidence: "   " }; await service.completeMilestone(a, first.id, complete); expect((await service.completeMilestone(a, first.id, { ...complete, evidence: null })).evidence).toBeNull();
  expect(await db.select().from(mutationReceipt).where(eq(mutationReceipt.mutationId, command.mutationId))).toHaveLength(2);
});
it("archived Goal retains all child states unchanged and rejects every new command", async () => {
  const parent = await newGoal(); const active = await service.createMilestone(a, parent.id, create()); const second = await service.createMilestone(a, parent.id, create()); const third = await service.createMilestone(a, parent.id, create());
  const completed = await service.completeMilestone(a, second.id, { ...transition(), evidence: "Observed success" }); const archived = await service.archiveMilestone(a, third.id, transition());
  const before = await service.listMilestones(a, parent.id); await goals.archiveGoal(a, parent.id, transition()); expect(await service.listMilestones(a, parent.id)).toEqual(before);
  await Promise.all([service.createMilestone(a, parent.id, create()), service.updateMilestone(a, active.id, { ...create(), expectedVersion: 1 }), service.completeMilestone(a, active.id, transition()), service.archiveMilestone(a, active.id, transition())].map((promise) => expect(promise).rejects.toMatchObject({ code: "CONFLICT", details: { kind: "GOAL_ARCHIVED" } })));
  for (const item of [active, completed, archived]) expect(await service.getMilestone(a, item.id)).toEqual(item);
});
for (const kind of ["create", ...operations] as const) it(`Goal archive racing ${kind} serializes without child changes after the parent wins`, async () => {
  const parent = await newGoal(); const first = await service.createMilestone(a, parent.id, create());
  const change = () => kind === "create" ? service.createMilestone(a, parent.id, create()) : kind === "edit" ? service.updateMilestone(a, first.id, { ...create({ title: "Changed" }), expectedVersion: 1 }) : kind === "complete" ? service.completeMilestone(a, first.id, transition()) : service.archiveMilestone(a, first.id, transition());
  const [parentResult, childResult] = await Promise.allSettled([goals.archiveGoal(a, parent.id, transition()), change()]); expect(parentResult.status).toBe("fulfilled");
  if (childResult.status === "rejected") { expect(childResult.reason).toMatchObject({ code: "CONFLICT", details: { kind: "GOAL_ARCHIVED" } }); expect(await service.getMilestone(a, first.id)).toEqual(first); expect(await service.listMilestones(a, parent.id)).toHaveLength(1); }
  else { expect(await service.getMilestone(a, childResult.value.id)).toEqual(childResult.value); }
  await expect(change()).rejects.toMatchObject({ code: "CONFLICT", details: { kind: "GOAL_ARCHIVED" } });
});
it("receipt and checkpoint roll back together and database failure stays explicit", async () => {
  const parent = await newGoal(); const mutationId = randomUUID(); const now = new Date().toISOString();
  const value: Milestone = { id: randomUUID(), goalId: parent.id, title: "Rollback", successCondition: "No partial success", state: "active", version: 1, createdAt: now, updatedAt: now, completedAt: null, archivedAt: null, evidence: null };
  await expect(repository.executeOwned(a, mutationId, "a".repeat(64), async (tx) => { await tx.insert(value); throw new ApplicationError("INTERNAL", "Injected failure"); })).rejects.toMatchObject({ code: "INTERNAL" });
  expect(await db.select().from(milestone)).toHaveLength(0); expect(await db.select().from(mutationReceipt).where(eq(mutationReceipt.mutationId, mutationId))).toHaveLength(0);
  await service.createMilestone(a, parent.id, create({ mutationId }));
  const bad = connectDatabase(requireTestDatabaseURL().url.replace(/\/execution_test_[^?]+/, `/execution_test_missing_${randomUUID().replaceAll("-", "")}`));
  try { const unavailable = milestoneService(milestoneRepository(bad.db)); await Promise.all([unavailable.listMilestones(a, parent.id), unavailable.getMilestone(a, value.id), unavailable.createMilestone(a, parent.id, create()), unavailable.updateMilestone(a, value.id, { ...create(), expectedVersion: 1 }), unavailable.completeMilestone(a, value.id, transition()), unavailable.archiveMilestone(a, value.id, transition())].map((promise) => expect(promise).rejects.toMatchObject({ code: "DATABASE_UNAVAILABLE" }))); } finally { await bad.pool.end(); }
});
