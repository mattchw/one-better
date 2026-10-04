import { afterAll, beforeAll, beforeEach, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { and, eq, inArray, sql } from "drizzle-orm";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { connectDatabase } from "../../src/db/connect";
import { focusSession, timeBlock, commitmentIdentity, weeklyPlanAmendment, amendmentCommitment, weeklyPlan, weeklyCommitment, action, goal, milestone, mutationReceipt } from "../../src/db/schema";
import { ApplicationError } from "../../src/domain/errors";
import { goalRepository } from "../../src/modules/goals/repository";
import { goalService } from "../../src/modules/goals/service";
import { provisionLocalUser } from "../../scripts/local-user";
import { requireTestDatabaseURL } from "../../scripts/test-database";
const { db, pool } = connectDatabase(requireTestDatabaseURL().url);
const repository = goalRepository(db); const service = goalService(repository);
const a = { userId: "" }; const b = { userId: "" };
const create = (overrides = {}) => ({ mutationId: randomUUID(), title: "Build a reliable planning system", outcome: "I use the system every week.", ...overrides });
beforeAll(async () => {
  await migrate(db, { migrationsFolder: "src/db/migrations" });
  for (const [suffix, actor] of [["A", a], ["B", b]] as const) {
    actor.userId = (await provisionLocalUser(db, { email: process.env[`TEST_USER_${suffix}_EMAIL`], password: process.env[`TEST_USER_${suffix}_PASSWORD`], name: `Engineer ${suffix}`, timezone: "Europe/London" })).id;
  }
});
beforeEach(async () => {
  await db.delete(mutationReceipt).where(inArray(mutationReceipt.ownerId, [a.userId, b.userId]));
  await db.delete(amendmentCommitment).where(inArray(amendmentCommitment.ownerId, [a.userId, b.userId])); await db.delete(weeklyPlanAmendment).where(inArray(weeklyPlanAmendment.ownerId, [a.userId, b.userId])); await db.delete(focusSession).where(inArray(focusSession.ownerId, [a.userId, b.userId])); await db.delete(timeBlock).where(inArray(timeBlock.ownerId, [a.userId, b.userId])); await db.delete(commitmentIdentity).where(inArray(commitmentIdentity.ownerId, [a.userId, b.userId])); await db.delete(weeklyCommitment).where(inArray(weeklyCommitment.ownerId, [a.userId, b.userId])); await db.delete(weeklyPlan).where(inArray(weeklyPlan.ownerId, [a.userId, b.userId])); await db.delete(action).where(inArray(action.ownerId, [a.userId, b.userId])); await db.delete(milestone).where(inArray(milestone.ownerId, [a.userId, b.userId]));
  await db.delete(goal).where(inArray(goal.ownerId, [a.userId, b.userId]));
});
afterAll(() => pool.end());
it("migration creates a minimal constrained schema without altering auth history", async () => {
  await migrate(db, { migrationsFolder: "src/db/migrations" });
  const columns = await pool.query("SELECT column_name, data_type FROM information_schema.columns WHERE table_name='goal' ORDER BY ordinal_position");
  expect(columns.rows.map((r) => r.column_name)).toEqual(["id", "owner_id", "title", "outcome", "version", "created_at", "updated_at", "archived_at"]);
  expect(columns.rows.slice(-3).every((r) => r.data_type === "timestamp with time zone")).toBe(true);
  for (const input of [{ title: "", outcome: "valid", version: 1 }, { title: "x".repeat(161), outcome: "valid", version: 1 }, { title: "valid", outcome: "x".repeat(2001), version: 1 }, { title: "valid", outcome: "valid", version: 0 }]) {
    await expect(db.insert(goal).values({ id: randomUUID(), ownerId: a.userId, ...input })).rejects.toThrow();
  }
});
it("persists actor-owned goals with stable ordering, duplicate titles and Unicode limits", async () => {
  const first = await service.createGoal(a, create());
  const second = await service.createGoal(a, create());
  const unicode = await service.createGoal(a, create({ title: "😀".repeat(160), outcome: "😀".repeat(2000) }));
  const rows = await db.select().from(goal); expect(rows).toHaveLength(3); expect(rows.every((r) => r.ownerId === a.userId)).toBe(true);
  const before = (await service.listGoals(a, "active")).map((g) => g.id);
  expect(before).toEqual([unicode.id, second.id, first.id]);
  await service.updateGoal(a, first.id, { mutationId: randomUUID(), expectedVersion: 1, title: "Edited", outcome: "Same intent" });
  expect((await service.listGoals(a, "active")).map((g) => g.id)).toEqual(before);
  expect(await service.getGoal(a, unicode.id)).toEqual(unicode);
});
it("validation prevents goals and receipts from being written", async () => {
  for (const invalid of [{ title: " \t " }, { outcome: " " }, { title: "😀".repeat(161) }, { outcome: "x".repeat(2001) }, { ownerId: b.userId }, { targetDate: "2026-10-02" }]) {
    await expect(service.createGoal(a, create(invalid))).rejects.toMatchObject({ code: "VALIDATION" });
  }
  expect(await db.select().from(goal)).toHaveLength(0); expect(await db.select().from(mutationReceipt)).toHaveLength(0);
});
it("simultaneous duplicate creates return one original result and one persisted receipt", async () => {
  const command = create(); const results = await Promise.all(Array.from({ length: 5 }, () => service.createGoal(a, command)));
  expect(results.every((g) => JSON.stringify(g) === JSON.stringify(results[0]))).toBe(true);
  expect(await db.select().from(goal)).toHaveLength(1); expect(await db.select().from(mutationReceipt)).toHaveLength(1);
  await expect(service.createGoal(a, { ...command, outcome: "Different" })).rejects.toMatchObject({ code: "CONFLICT", details: { kind: "MUTATION_ID" } });
});
it("receipt replay returns the original create/edit snapshot after newer edits/archive", async () => {
  const command = create(); const first = await service.createGoal(a, command);
  const edit = { mutationId: randomUUID(), expectedVersion: 1, title: "New title", outcome: "New success" };
  const updated = await service.updateGoal(a, first.id, edit);
  expect(updated.version).toBe(2);
  const archive = { mutationId: randomUUID(), expectedVersion: 2 };
  const archived = await service.archiveGoal(a, first.id, archive);
  expect(await service.createGoal(a, command)).toEqual(first);
  expect(await service.updateGoal(a, first.id, edit)).toEqual(updated);
  expect(await service.archiveGoal(a, first.id, archive)).toEqual(archived);
  expect((await service.getGoal(a, first.id)).version).toBe(3);
  await expect(service.archiveGoal(a, first.id, { mutationId: command.mutationId, expectedVersion: 3 })).rejects.toMatchObject({ code: "CONFLICT", details: { kind: "MUTATION_ID" } });
});
it("concurrent edits of one version have exactly one winner and preserve its state", async () => {
  const first = await service.createGoal(a, create());
  const commands = ["First", "Second"].map((title) => ({ mutationId: randomUUID(), expectedVersion: 1, title, outcome: `${title} succeeds` }));
  const results = await Promise.allSettled(commands.map((c) => service.updateGoal(a, first.id, c)));
  const winners = results.filter((r) => r.status === "fulfilled"); const losers = results.filter((r) => r.status === "rejected");
  expect(winners).toHaveLength(1); expect(losers).toHaveLength(1);
  if (winners[0].status !== "fulfilled" || losers[0].status !== "rejected") throw new Error("Unexpected result");
  expect(losers[0].reason).toMatchObject({ code: "CONFLICT", details: { kind: "VERSION", current: winners[0].value } });
  expect(await service.getGoal(a, first.id)).toEqual(winners[0].value);
  expect(await db.select().from(mutationReceipt)).toHaveLength(2);
});
it("concurrent duplicate edits and archives increment the version once each", async () => {
  const first = await service.createGoal(a, create());
  const edit = { mutationId: randomUUID(), expectedVersion: 1, title: "Edited", outcome: "New" };
  const edited = await Promise.all([service.updateGoal(a, first.id, edit), service.updateGoal(a, first.id, edit)]);
  expect(edited[0]).toEqual(edited[1]); expect(edited[0].version).toBe(2);
  const archive = { mutationId: randomUUID(), expectedVersion: 2 };
  const archived = await Promise.all([service.archiveGoal(a, first.id, archive), service.archiveGoal(a, first.id, archive)]);
  expect(archived[0]).toEqual(archived[1]); expect(archived[0].version).toBe(3);
});
it("stale archive cannot overwrite a newer edit; archive retains identity and immutable fields", async () => {
  const first = await service.createGoal(a, create());
  const updated = await service.updateGoal(a, first.id, { mutationId: randomUUID(), expectedVersion: 1, title: "Current", outcome: "Current outcome" });
  await expect(service.archiveGoal(a, first.id, { mutationId: randomUUID(), expectedVersion: 1 })).rejects.toMatchObject({ code: "CONFLICT" });
  expect(await service.getGoal(a, first.id)).toEqual(updated);
  const archived = await service.archiveGoal(a, first.id, { mutationId: randomUUID(), expectedVersion: 2 });
  expect(archived).toMatchObject({ id: first.id, title: updated.title, outcome: updated.outcome, createdAt: first.createdAt });
  expect(await service.listGoals(a, "active")).toEqual([]); expect(await service.listGoals(a, "archived")).toEqual([archived]);
  for (const expectedVersion of [1, 3]) await expect(service.updateGoal(a, first.id, { mutationId: randomUUID(), expectedVersion, title: "Reopen", outcome: "No" })).rejects.toMatchObject({ code: "CONFLICT" });
  expect(await db.select().from(goal).where(eq(goal.id, first.id))).toHaveLength(1);
});
it("simultaneous edit/archive cannot lose an edit or reactivate an archived goal", async () => {
  const first = await service.createGoal(a, create());
  const results = await Promise.allSettled([
    service.updateGoal(a, first.id, { mutationId: randomUUID(), expectedVersion: 1, title: "Edit", outcome: "Saved edit" }),
    service.archiveGoal(a, first.id, { mutationId: randomUUID(), expectedVersion: 1 }),
  ]);
  expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  expect(results.filter((r) => r.status === "rejected")).toHaveLength(1);
  const winner = results.find((r) => r.status === "fulfilled");
  if (winner?.status !== "fulfilled") throw new Error("No winner");
  expect(await service.getGoal(a, first.id)).toEqual(winner.value);
});
it("isolates list/get/edit/archive and command namespaces for two owners", async () => {
  const command = create(); const first = await service.createGoal(a, command);
  expect(await service.listGoals(b, "active")).toEqual([]); expect(await service.listGoals(b, "archived")).toEqual([]);
  for (const id of [first.id, randomUUID()]) {
    await expect(service.getGoal(b, id)).rejects.toMatchObject({ code: "NOT_FOUND", message: "This goal is unavailable." });
    await expect(service.updateGoal(b, id, { mutationId: command.mutationId, expectedVersion: 1, title: "Foreign", outcome: "Foreign" })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(service.archiveGoal(b, id, { mutationId: command.mutationId, expectedVersion: 1 })).rejects.toMatchObject({ code: "NOT_FOUND" });
  }
  const own = await service.createGoal(b, command); expect(own.id).not.toBe(first.id);
  expect(await service.getGoal(a, first.id)).toEqual(first);
  expect(await db.select().from(mutationReceipt).where(eq(mutationReceipt.mutationId, command.mutationId))).toHaveLength(2);
  expect((await db.select().from(goal).where(and(eq(goal.ownerId, b.userId), eq(goal.id, own.id))))[0].ownerId).toBe(b.userId);
});
it("rolls back receipt and goal together; a failed command can be retried", async () => {
  const mutationId = randomUUID(); const id = randomUUID();
  await expect(repository.executeOwned(a, mutationId, "a".repeat(64), async (tx) => {
    await tx.insert({ id, title: "Rollback", outcome: "Rollback", version: 1, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), archivedAt: null });
    throw new ApplicationError("INTERNAL", "Injected transaction failure");
  })).rejects.toMatchObject({ code: "INTERNAL" });
  expect(await db.select().from(goal)).toHaveLength(0); expect(await db.select().from(mutationReceipt)).toHaveLength(0);
  expect((await service.createGoal(a, create({ mutationId }))).version).toBe(1);
});
it("database failures are sanitized and cannot become an empty list", async () => {
  const bad = connectDatabase(requireTestDatabaseURL().url.replace(/\/execution_test_[^?]+/, `/execution_test_missing_${randomUUID().replaceAll("-", "")}`));
  try {
    const unavailable = goalService(goalRepository(bad.db));
    await expect(unavailable.listGoals(a, "active")).rejects.toMatchObject({ code: "DATABASE_UNAVAILABLE" });
    await expect(unavailable.createGoal(a, create())).rejects.toMatchObject({ code: "DATABASE_UNAVAILABLE" });
    await expect(unavailable.updateGoal(a, randomUUID(), { ...create(), expectedVersion: 1 })).rejects.toMatchObject({ code: "DATABASE_UNAVAILABLE" });
    await expect(unavailable.archiveGoal(a, randomUUID(), { mutationId: randomUUID(), expectedVersion: 1 })).rejects.toMatchObject({ code: "DATABASE_UNAVAILABLE" });
  }
  finally { await bad.pool.end(); }
  expect((await db.execute(sql`select count(*) from goal`)).rows[0].count).toBe("0");
});
