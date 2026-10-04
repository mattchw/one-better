import { afterAll, beforeAll, beforeEach, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { connectDatabase } from "../../src/db/connect";
import { focusSession, timeBlock, commitmentIdentity, weeklyPlanAmendment, amendmentCommitment, action, goal, milestone, mutationReceipt, user, weeklyCommitment, weeklyPlan } from "../../src/db/schema";
import { goalRepository } from "../../src/modules/goals/repository";
import { goalService } from "../../src/modules/goals/service";
import { milestoneRepository } from "../../src/modules/milestones/repository";
import { milestoneService } from "../../src/modules/milestones/service";
import { actionRepository } from "../../src/modules/actions/repository";
import { actionService } from "../../src/modules/actions/service";
import { planRepository } from "../../src/modules/planning/repository";
import { planService } from "../../src/modules/planning/service";
import type { WeeklyPlan } from "../../src/modules/planning/domain";
import { ApplicationError } from "../../src/domain/errors";
import { provisionLocalUser } from "../../scripts/local-user";
import { requireTestDatabaseURL } from "../../scripts/test-database";
const { db, pool } = connectDatabase(requireTestDatabaseURL().url);
const goals = goalService(goalRepository(db)), milestones = milestoneService(milestoneRepository(db)), actions = actionService(actionRepository(db));
const repository = planRepository(db); const clock = () => "2026-10-02T12:00:00.000Z"; const service = planService(repository, clock);
const a = { userId: "" }, b = { userId: "" };
const create = (extra = {}) => ({ mutationId: randomUUID(), weekStartDate: "2026-09-28", provisionalCapacityMinutes: 720, reserveMinutes: 180, ...extra });
const transition = (expectedVersion = 2) => ({ mutationId: randomUUID(), expectedVersion });
beforeAll(async () => { await migrate(db, { migrationsFolder: "src/db/migrations" }); for (const [suffix, actor] of [["A", a], ["B", b]] as const) actor.userId = (await provisionLocalUser(db, { email: process.env[`TEST_USER_${suffix}_EMAIL`], password: process.env[`TEST_USER_${suffix}_PASSWORD`], name: `Engineer ${suffix}`, timezone: "Europe/London" })).id; });
beforeEach(async () => { const owners = [a.userId, b.userId]; await db.delete(mutationReceipt).where(inArray(mutationReceipt.ownerId, owners)); await db.delete(amendmentCommitment).where(inArray(amendmentCommitment.ownerId, owners)); await db.delete(weeklyPlanAmendment).where(inArray(weeklyPlanAmendment.ownerId, owners)); await db.delete(focusSession).where(inArray(focusSession.ownerId, owners)); await db.delete(timeBlock).where(inArray(timeBlock.ownerId, owners)); await db.delete(commitmentIdentity).where(inArray(commitmentIdentity.ownerId, owners)); await db.delete(weeklyCommitment).where(inArray(weeklyCommitment.ownerId, owners)); await db.delete(weeklyPlan).where(inArray(weeklyPlan.ownerId, owners)); await db.delete(action).where(inArray(action.ownerId, owners)); await db.delete(milestone).where(inArray(milestone.ownerId, owners)); await db.delete(goal).where(inArray(goal.ownerId, owners)); await db.update(user).set({ timezone: "Europe/London" }).where(inArray(user.id, owners)); });
afterAll(() => pool.end());
async function fixture(actor = a) {
  const parent = await goals.createGoal(actor, { mutationId: randomUUID(), title: "Useful One Better", outcome: "I plan small meaningful weeks." });
  const first = await milestones.createMilestone(actor, parent.id, { mutationId: randomUUID(), title: "Planning loop usable", successCondition: "Plan one real week." });
  const second = await milestones.createMilestone(actor, parent.id, { mutationId: randomUUID(), title: "Second active context", successCondition: "Keep reassignment explicit." });
  const plain = await actions.createAction(actor, parent.id, { mutationId: randomUUID(), title: "Build capacity editor", doneWhen: "Capacity saves", estimateMinutes: 120 });
  const linked = await actions.createAction(actor, parent.id, { mutationId: randomUUID(), title: "Implement planning persistence", milestoneId: first.id, estimateMinutes: 240, doneWhen: "Restart keeps baseline" });
  const third = await actions.createAction(actor, parent.id, { mutationId: randomUUID(), title: "Test planning flow", milestoneId: second.id, estimateMinutes: 45 });
  const candidates = await service.candidates(actor);
  const selections = [plain, linked, third].map((v, i) => ({ actionId: v.id, source: candidates.find((c) => c.actionId === v.id)!.source, budgetMinutes: [180, 120, 90][i] }));
  return { parent, first, second, plain, linked, third, selections };
}
const save = (plan: WeeklyPlan, commitments: Awaited<ReturnType<typeof fixture>>["selections"], extra = {}) => ({ mutationId: randomUUID(), expectedVersion: plan.version, provisionalCapacityMinutes: plan.provisionalCapacityMinutes, reserveMinutes: plan.reserveMinutes, commitments, ...extra });
async function draft() { const context = await fixture(); const created = await service.create(a, create()); const value = await service.save(a, created.id, save(created, context.selections)); return { ...context, created, value }; }
const error = async (promise: Promise<unknown>) => { try { await promise; throw new Error("Expected rejection"); } catch (value) { expect(value).toBeInstanceOf(ApplicationError); const e = value as ApplicationError; return { code: e.code, message: e.message, details: e.details }; } };
async function oneWinner(calls: Promise<WeeklyPlan>[]) { const results = await Promise.allSettled(calls); expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1); expect(results.filter((r) => r.status === "rejected")).toHaveLength(1); const failure = results.find((r) => r.status === "rejected") as PromiseRejectedResult; expect(failure.reason).toMatchObject({ code: "CONFLICT" }); return (results.find((r) => r.status === "fulfilled") as PromiseFulfilledResult<WeeklyPlan>).value; }
it("migration alone creates owned Plan/Commitment schema and constrains week, lifecycle, capacity and version", async () => {
  const columns = await pool.query("SELECT column_name FROM information_schema.columns WHERE table_name='weekly_plan' ORDER BY ordinal_position"); expect(columns.rows.map((r) => r.column_name)).toEqual(["id", "owner_id", "week_start_date", "timezone", "state", "provisional_capacity_minutes", "reserve_minutes", "version", "created_at", "updated_at", "committed_at"]);
  const base = { id: randomUUID(), ownerId: a.userId, weekStartDate: "2026-09-28", timezone: "Europe/London", provisionalCapacityMinutes: 720, reserveMinutes: 180, createdAt: new Date(), updatedAt: new Date() };
  for (const fields of [{ ownerId: randomUUID() }, { weekStartDate: "2026-10-02" }, { provisionalCapacityMinutes: 0 }, { provisionalCapacityMinutes: 10081 }, { reserveMinutes: -1 }, { reserveMinutes: 720 }, { version: 0 }, { state: "committed" as const }, { state: "closed" }, { state: "draft", committedAt: new Date() }]) await expect(db.insert(weeklyPlan).values({ ...base, ...fields } as typeof weeklyPlan.$inferInsert)).rejects.toThrow();
});
it("database owner/week uniqueness supports separate owners and concurrent attempts have one winner", async () => {
  const first = await oneWinner([service.create(a, create()), service.create(a, create())]); expect(first.version).toBe(1); const other = await service.create(b, create()); expect(other.id).not.toBe(first.id);
  const rows = await db.select().from(weeklyPlan); expect(rows).toHaveLength(2); await expect(db.insert(weeklyPlan).values({ ...rows[0], id: randomUUID() })).rejects.toThrow();
});
it("current/future creation, historical viewing and no new past plans use existing IANA timezone", async () => {
  const plan = await service.create(a, create()); await service.create(a, create({ weekStartDate: "2026-10-05" })); await expect(service.create(a, create({ weekStartDate: "2026-09-21" }))).rejects.toMatchObject({ code: "VALIDATION" });
  const later = planService(repository, () => "2026-10-12T12:00:00Z"); const history = await later.workspace(a, plan.weekStartDate); expect(history.canCreate).toBe(false); expect(history.view?.plan).toEqual(plan); expect(history.savedWeeks).toHaveLength(2);
});
it("DST-sensitive local Monday and stored timezone survive account timezone changes without rekeying", async () => {
  const dst = planService(repository, () => "2026-03-29T23:30:00Z"); expect((await dst.workspace(a)).currentWeekStartDate).toBe("2026-03-30"); const plan = await dst.create(a, create({ weekStartDate: "2026-03-30" }));
  await db.update(user).set({ timezone: "America/Los_Angeles" }).where(eq(user.id, a.userId)); expect((await dst.get(a, plan.id)).plan).toEqual(plan); await expect(dst.create(a, create({ weekStartDate: plan.weekStartDate }))).rejects.toMatchObject({ details: { kind: "WEEK_EXISTS" } });
});
it("server rejects capacity/reserve, week, duplicate, budget, owner and snapshot inputs without receipts", async () => {
  for (const fields of [{ provisionalCapacityMinutes: 0 }, { provisionalCapacityMinutes: 1.5 }, { provisionalCapacityMinutes: "720" }, { reserveMinutes: -1 }, { reserveMinutes: 720 }, { weekStartDate: "2026-10-02" }, { timezone: "Asia/Tokyo" }, { ownerId: b.userId }]) await expect(service.create(a, create(fields))).rejects.toMatchObject({ code: "VALIDATION" }); expect(await db.select().from(mutationReceipt)).toHaveLength(0);
  const { value, selections } = await draft(); const before = await db.select().from(mutationReceipt);
  for (const commitments of [[...selections, selections[0]], [{ ...selections[0], budgetMinutes: 0 }], [{ ...selections[0], budgetMinutes: 1.5 }], [{ ...selections[0], budgetMinutes: 10081 }], [{ ...selections[0], snapshot: {} }]]) await expect(service.save(a, value.id, save(value, commitments))).rejects.toMatchObject({ code: "VALIDATION" }); expect(await db.select().from(mutationReceipt)).toEqual(before);
});
it("only owned effectively mutable sources appear; Goal-only and active Milestone work are eligible", async () => {
  const f = await fixture(); await fixture(b); expect(await service.candidates(a)).toHaveLength(3);
  await actions.completeAction(a, f.plain.id, transition(1)); await milestones.completeMilestone(a, f.first.id, transition(1)); expect((await service.candidates(a)).map((s) => s.actionId)).toEqual([f.third.id]); await goals.archiveGoal(a, f.parent.id, transition(1)); expect(await service.candidates(a)).toEqual([]);
});
it("Goal-level and Milestone commitments persist independent budgets, stable identities and unchanged sources", async () => {
  const { value, plain, linked, selections } = await draft(); expect(value.commitments).toHaveLength(3); expect(value).not.toHaveProperty("ownerId"); expect((await service.get(a, value.id)).summary).toEqual({ usableMinutes: 540, totalMinutes: 390, remainingMinutes: 150 });
  expect((await actions.getAction(a, plain.id)).action).toEqual(plain); expect((await actions.getAction(a, linked.id)).action).toEqual(linked); const updated = await service.save(a, value.id, save(value, [{ ...selections[0], budgetMinutes: 210 }])); expect(updated.commitments[0]).toMatchObject({ id: value.commitments.find((c) => c.actionId === plain.id)!.id, budgetMinutes: 210, snapshot: null }); expect(updated.commitments[0].createdAt).toBe(value.commitments.find((c) => c.actionId === plain.id)!.createdAt);
});
it("DB commitments enforce owned Plan and Action references, duplicate prevention and budget bounds", async () => {
  const { value } = await draft(); const rows = await db.select().from(weeklyCommitment); const base = rows[0]; const foreign = await fixture(b); const foreignPlan = await service.create(b, create());
  for (const fields of [{ ownerId: b.userId }, { planId: foreignPlan.id }, { actionId: foreign.plain.id }, { planId: randomUUID() }, { actionId: randomUUID() }, { budgetMinutes: 0 }, { budgetMinutes: 10081 }, { source: {} }, { snapshot: {} }]) await expect(db.insert(weeklyCommitment).values({ ...base, id: randomUUID(), ...fields } as typeof weeklyCommitment.$inferInsert)).rejects.toThrow();
  await expect(db.insert(weeklyCommitment).values({ ...base, id: randomUUID() })).rejects.toThrow(); await expect(db.delete(weeklyPlan).where(eq(weeklyPlan.id, value.id))).rejects.toThrow(); await expect(db.delete(action).where(eq(action.id, base.actionId))).rejects.toThrow();
});
it("an Action can be chosen in another week without a new source lifecycle or estimate change", async () => {
  const { plain, selections } = await draft(); const future = await service.create(a, create({ weekStartDate: "2026-10-05" })); const next = await service.save(a, future.id, save(future, [selections[0]])); expect(next.commitments[0].actionId).toBe(plain.id); expect((await actions.getAction(a, plain.id)).action).toEqual(plain);
});
it("full Draft edits change capacity, reserve, selections and budgets; zero selections remain valid Draft", async () => {
  const { value, selections } = await draft(); const next = await service.save(a, value.id, save(value, [selections[1]], { provisionalCapacityMinutes: 600, reserveMinutes: 240 })); expect(next).toMatchObject({ version: 3, provisionalCapacityMinutes: 600, reserveMinutes: 240, commitments: [{ actionId: selections[1].actionId }] }); const empty = await service.save(a, value.id, save(next, [])); expect(empty.commitments).toEqual([]); expect((await service.get(a, value.id)).plan).toEqual(empty);
});
it.each(["edit/edit", "remove/budget", "capacity/selection"])("%s race persists exactly one full aggregate winner", async (scenario) => {
  const { value, selections } = await draft(); const left = save(value, scenario === "remove/budget" ? [] : selections, { provisionalCapacityMinutes: 600 }); const right = save(value, scenario === "capacity/selection" ? [selections[1]] : [{ ...selections[0], budgetMinutes: 210 }]);
  const winner = await oneWinner([service.save(a, value.id, left), service.save(a, value.id, right)]); expect((await service.get(a, value.id)).plan).toEqual(winner); expect(winner.version).toBe(3); expect(await db.select().from(weeklyCommitment)).toHaveLength(winner.commitments.length);
});
it("save/commit race cannot mix Draft edits with a committed baseline", async () => {
  const { value, selections } = await draft(); const winner = await oneWinner([service.save(a, value.id, save(value, [selections[0]], { reserveMinutes: 120 })), service.commit(a, value.id, transition())]); expect((await service.get(a, value.id)).plan).toEqual(winner); expect(winner.commitments.every((c) => (c.snapshot !== null) === (winner.state === "committed"))).toBe(true);
});
it("distinct competing commit commands have one version winner and no duplicate baseline", async () => {
  const { value } = await draft(); const winner = await oneWinner([service.commit(a, value.id, transition()), service.commit(a, value.id, transition())]); expect(winner.state).toBe("committed"); expect(winner.version).toBe(3); expect(await db.select().from(weeklyPlan)).toHaveLength(1); expect(await db.select().from(weeklyCommitment)).toHaveLength(3);
});
it("simultaneous retries of the same creation/save/commit each replay one result", async () => {
  const context = await fixture(); const input = create(); const [first, replay] = await Promise.all([service.create(a, input), service.create(a, input)]); expect(replay).toEqual(first);
  const update = save(first, context.selections); const [saved, saveReplay] = await Promise.all([service.save(a, first.id, update), service.save(a, first.id, update)]); expect(saveReplay).toEqual(saved);
  const command = transition(); const [committed, commitReplay] = await Promise.all([service.commit(a, first.id, command), service.commit(a, first.id, command)]); expect(commitReplay).toEqual(committed); expect(committed.version).toBe(3);
});
it("all receipts return original results after later commit/parent changes and finished-week clock", async () => {
  const f = await fixture(); const creation = create(); const created = await service.create(a, creation); const update = save(created, f.selections); const saved = await service.save(a, created.id, update); const committing = transition(); const committed = await service.commit(a, created.id, committing); await goals.archiveGoal(a, f.parent.id, transition(1));
  const later = planService(repository, () => "2027-01-01T12:00:00Z"); expect(await later.create(a, creation)).toEqual(created); expect(await later.save(a, created.id, update)).toEqual(saved); expect(await later.commit(a, created.id, committing)).toEqual(committed); expect((await later.get(a, created.id)).plan).toEqual(committed);
  expect(await service.save(a, created.id, { ...update, commitments: [...update.commitments].reverse() })).toEqual(saved);
});
it("changed payload/version/kind/Plan cannot reuse mutation ID; owner namespace remains independent", async () => {
  const input = create(); const created = await service.create(a, input); await expect(service.create(a, { ...input, reserveMinutes: 120 })).rejects.toMatchObject({ details: { kind: "MUTATION_ID" } }); const f = await fixture();
  await expect(service.save(a, created.id, { ...save(created, f.selections), mutationId: input.mutationId })).rejects.toMatchObject({ details: { kind: "MUTATION_ID" } }); expect(await service.create(b, input)).not.toEqual(created);
  const saving = save(created, f.selections); const saved = await service.save(a, created.id, saving); for (const fields of [{ expectedVersion: 2 }, { reserveMinutes: 120 }, { commitments: [] }]) await expect(service.save(a, created.id, { ...saving, ...fields })).rejects.toMatchObject({ details: { kind: "MUTATION_ID" } });
  const future = await service.create(a, create({ weekStartDate: "2026-10-05" })); await expect(service.save(a, future.id, saving)).rejects.toMatchObject({ details: { kind: "MUTATION_ID" } }); await expect(service.commit(a, saved.id, { mutationId: saving.mutationId, expectedVersion: 2 })).rejects.toMatchObject({ details: { kind: "MUTATION_ID" } });
});
it.each(["empty", "over capacity"])("%s commit is rejected while Draft and receipt/rows remain unchanged", async (scenario) => {
  const { value, selections } = await draft(); const current = await service.save(a, value.id, save(value, scenario === "empty" ? [] : [{ ...selections[0], budgetMinutes: 600 }])); const before = await db.select().from(mutationReceipt); const command = transition(current.version);
  await expect(service.commit(a, value.id, command)).rejects.toMatchObject({ code: "VALIDATION", details: { kind: scenario === "empty" ? "EMPTY" : "OVER_CAPACITY" } }); expect((await service.get(a, value.id)).plan).toEqual(current); expect(await db.select().from(mutationReceipt)).toEqual(before);
});
it.each(["Action complete", "Action archive", "Goal archive", "Milestone complete", "Milestone archive", "active Milestone move", "Action edit", "Goal edit", "Milestone edit"])("%s after selection blocks commit without rewriting selections or snapshots", async (scenario) => {
  const f = await draft();
  if (scenario === "Action complete") await actions.completeAction(a, f.linked.id, transition(1));
  if (scenario === "Action archive") await actions.archiveAction(a, f.linked.id, transition(1));
  if (scenario === "Goal archive") await goals.archiveGoal(a, f.parent.id, transition(1));
  if (scenario === "Milestone complete") await milestones.completeMilestone(a, f.first.id, transition(1));
  if (scenario === "Milestone archive") await milestones.archiveMilestone(a, f.first.id, transition(1));
  if (scenario === "active Milestone move" || scenario === "Action edit") await actions.updateAction(a, f.linked.id, { mutationId: randomUUID(), expectedVersion: 1, title: "Changed Action", milestoneId: scenario === "active Milestone move" ? f.second.id : f.first.id, estimateMinutes: 90 });
  if (scenario === "Goal edit") await goals.updateGoal(a, f.parent.id, { mutationId: randomUUID(), expectedVersion: 1, title: "Changed Goal", outcome: "Changed outcome" });
  if (scenario === "Milestone edit") await milestones.updateMilestone(a, f.first.id, { mutationId: randomUUID(), expectedVersion: 1, title: "Changed Milestone", successCondition: "Changed condition" });
  const receipts = await db.select().from(mutationReceipt); await expect(service.commit(a, f.value.id, transition())).rejects.toMatchObject({ code: "CONFLICT", details: { kind: "SOURCES", issues: expect.arrayContaining([expect.objectContaining({ actionId: f.linked.id })]) } }); expect((await service.get(a, f.value.id)).plan).toEqual(f.value); expect(await db.select().from(mutationReceipt)).toEqual(receipts);
});
it("explicitly reviewed active source changes can be saved and committed; removing terminal work is deliberate", async () => {
  const f = await draft(); await actions.updateAction(a, f.linked.id, { mutationId: randomUUID(), expectedVersion: 1, title: "Reviewed new context", milestoneId: f.second.id }); const candidates = await service.candidates(a); const reviewed = f.selections.map((s) => ({ ...s, source: candidates.find((c) => c.actionId === s.actionId)!.source })); const saved = await service.save(a, f.value.id, save(f.value, reviewed)); const committed = await service.commit(a, saved.id, transition(3)); expect(committed.commitments.find((c) => c.actionId === f.linked.id)?.snapshot?.milestone?.id).toBe(f.second.id);
});
it("commit atomically freezes every context field, budget, capacity, reserve and timestamp", async () => {
  const f = await draft(); const beforeSources = await service.candidates(a); const committed = await service.commit(a, f.value.id, transition()); expect(committed).toMatchObject({ state: "committed", version: 3, provisionalCapacityMinutes: 720, reserveMinutes: 180, committedAt: clock() });
  for (const c of committed.commitments) { expect(c.snapshot).toEqual(beforeSources.find((s) => s.actionId === c.actionId)!.context); expect(c.budgetMinutes).toBe(f.selections.find((s) => s.actionId === c.actionId)!.budgetMinutes); expect(c.updatedAt).toBe(committed.committedAt); }
  expect(committed.commitments.find((c) => c.actionId === f.plain.id)?.snapshot?.milestone).toBeNull(); expect((await service.get(a, committed.id)).sources).toEqual([]);
});
it("failure after complete aggregate write rolls back Plan, every snapshot and the receipt", async () => {
  const { value } = await draft(); const receipts = await db.select().from(mutationReceipt); const rows = await db.select().from(weeklyCommitment);
  const failing = planService({ ...repository, executeOwned: (actor, id, hash, apply) => repository.executeOwned(actor, id, hash, (tx) => apply({ ...tx, replace: async (plan, version) => { await tx.replace(plan, version); throw new ApplicationError("VALIDATION", "Injected failure after aggregate write"); } })) }, clock);
  await expect(failing.commit(a, value.id, transition())).rejects.toMatchObject({ code: "VALIDATION" }); expect((await service.get(a, value.id)).plan).toEqual(value); expect(await db.select().from(weeklyCommitment)).toEqual(rows); expect(await db.select().from(mutationReceipt)).toEqual(receipts);
});
it("committed aggregate rejects every new save and commit, even same-version valid inputs", async () => {
  const { value, selections } = await draft(); const committed = await service.commit(a, value.id, transition()); for (const commitments of [[], selections, [{ ...selections[0], budgetMinutes: 1 }]]) await expect(service.save(a, value.id, save(committed, commitments, { reserveMinutes: 0 }))).rejects.toMatchObject({ code: "CONFLICT", details: { kind: "COMMITTED" } }); await expect(service.commit(a, value.id, transition(committed.version))).rejects.toMatchObject({ details: { kind: "COMMITTED" } }); expect((await service.get(a, value.id)).plan).toEqual(committed);
});
it("Action edits/completion/archive and Goal/Milestone edits/terminal transitions never alter baseline", async () => {
  const f = await draft(); const committed = await service.commit(a, f.value.id, transition());
  await actions.updateAction(a, f.plain.id, { mutationId: randomUUID(), expectedVersion: 1, title: "Renamed after commitment", doneWhen: "Different condition", estimateMinutes: 10, milestoneId: f.second.id }); await actions.completeAction(a, f.plain.id, transition(2)); await actions.archiveAction(a, f.third.id, transition(1));
  await milestones.updateMilestone(a, f.first.id, { mutationId: randomUUID(), expectedVersion: 1, title: "Renamed checkpoint", successCondition: "Different evidence" }); await milestones.completeMilestone(a, f.first.id, transition(2)); await milestones.archiveMilestone(a, f.second.id, transition(1));
  await goals.updateGoal(a, f.parent.id, { mutationId: randomUUID(), expectedVersion: 1, title: "Renamed Goal", outcome: "New outcome" }); await goals.archiveGoal(a, f.parent.id, transition(2));
  const history = await service.get(a, committed.id); expect(history.plan).toEqual(committed); expect(history.sources).toEqual([]); expect(history.plan.commitments.map((c) => c.snapshot?.action.title)).toContain(f.plain.title); expect(history.plan.commitments.find((c) => c.actionId === f.plain.id)?.snapshot?.action.estimateMinutes).toBe(120);
});
it("foreign/missing plans and source IDs have indistinguishable responses and no writes or leakage", async () => {
  const f = await draft(); const bPlan = await service.create(b, create()); const foreign = await fixture(b); expect((await service.workspace(b)).savedWeeks).toHaveLength(1); expect((await service.workspace(b)).view?.plan.id).toBe(bPlan.id); expect((await service.candidates(b)).every((s) => s.context.goal.id === foreign.parent.id)).toBe(true);
  for (const id of [f.value.id, randomUUID()]) { const read = await error(service.get(b, id)); const update = await error(service.save(b, id, save(bPlan, []))); const commit = await error(service.commit(b, id, transition(1))); for (const response of [read, update, commit]) expect(response).toEqual({ code: "NOT_FOUND", message: "This weekly plan is unavailable.", details: undefined }); }
  for (const id of [f.plain.id, randomUUID()]) expect(await error(service.save(b, bPlan.id, save(bPlan, [{ ...f.selections[0], actionId: id }])))).toEqual({ code: "NOT_FOUND", message: "One or more selected Actions are unavailable.", details: { issues: [{ actionId: id, kind: "UNAVAILABLE", message: "This Action is unavailable. Remove this commitment or choose another Action." }] } }); expect((await service.get(a, f.value.id)).plan).toEqual(f.value);
});
it("source mutation racing commit has a serialized outcome and never snapshots terminal work", async () => {
  const f = await draft(); const results = await Promise.allSettled([service.commit(a, f.value.id, transition()), actions.completeAction(a, f.linked.id, transition(1))]); expect(results[1].status).toBe("fulfilled"); const current = (await service.get(a, f.value.id)).plan;
  if (results[0].status === "fulfilled") { expect(current.state).toBe("committed"); expect(current.commitments.find((c) => c.actionId === f.linked.id)?.snapshot?.action.title).toBe(f.linked.title); } else { expect(results[0].reason).toMatchObject({ code: "CONFLICT", details: { kind: "SOURCES" } }); expect(current).toEqual(f.value); }
});
it("opposite selections across Plans/Goals lock deterministically without deadlock or source changes", async () => {
  const first = await fixture(); const second = await fixture(); const p1 = await service.create(a, create()); const p2 = await service.create(a, create({ weekStartDate: "2026-10-05" })); const selections = [first.selections[0], second.selections[1]];
  const saved = await Promise.all([service.save(a, p1.id, save(p1, selections)), service.save(a, p2.id, save(p2, [...selections].reverse()))]); const committed = await Promise.all(saved.map((p) => service.commit(a, p.id, transition(2)))); expect(committed.every((p) => p.state === "committed")).toBe(true);
});
