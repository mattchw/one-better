import { expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { milestoneService, type MilestoneRepository, type MilestoneTransaction } from "../../src/modules/milestones/service";
import type { OwnedMilestone } from "../../src/modules/milestones/domain";
import type { OwnedGoal } from "../../src/modules/goals/domain";
const actor = { userId: randomUUID() }; const now = "2026-10-02T11:00:00.000Z";
const parent: OwnedGoal = { id: randomUUID(), ownerId: actor.userId, title: "Fitness", outcome: "Run 10 km comfortably", version: 1, createdAt: now, updatedAt: now, archivedAt: null };
const child: OwnedMilestone = { id: randomUUID(), goalId: parent.id, ownerId: actor.userId, title: "Run 5 km", successCondition: "Finish continuously", state: "active", version: 1, createdAt: now, updatedAt: now, completedAt: null, archivedAt: null, evidence: null };
function setup(value: OwnedMilestone | null = child, goal: OwnedGoal | null = parent) {
  const order: string[] = [];
  const tx: MilestoneTransaction = { findOwned: vi.fn(async () => value), findGoalForUpdate: vi.fn(async () => { order.push("parent"); return goal; }), findForUpdate: vi.fn(async () => { order.push("child"); return value; }), insert: vi.fn(async (m) => ({ ...m, ownerId: actor.userId })), replace: vi.fn(async (m) => ({ ...m, ownerId: actor.userId })) };
  const repository: MilestoneRepository = { findGoalOwned: vi.fn(async () => goal), findOwned: vi.fn(async () => value), listOwned: vi.fn(async () => value ? [value] : []), executeOwned: vi.fn(async (_actor, _id, _hash, apply) => apply(tx)) };
  return { tx, repository, order, service: milestoneService(repository, () => now, () => child.id) };
}
const create = () => ({ mutationId: randomUUID(), title: child.title, successCondition: child.successCondition });
const edit = () => ({ ...create(), expectedVersion: 1 }); const transition = () => ({ mutationId: randomUUID(), expectedVersion: 1 });
it("validates every command before persistence and refuses ownership/move fields", async () => {
  const { repository, service } = setup();
  await expect(service.createMilestone(actor, parent.id, { ...create(), successCondition: " " })).rejects.toMatchObject({ code: "VALIDATION" });
  await expect(service.updateMilestone(actor, child.id, { ...edit(), goalId: randomUUID() })).rejects.toMatchObject({ code: "VALIDATION" });
  await expect(service.completeMilestone(actor, child.id, { ...transition(), evidence: 42 })).rejects.toMatchObject({ code: "VALIDATION" });
  expect(repository.executeOwned).not.toHaveBeenCalled();
});
it("creates an actor-owned active checkpoint under a locked parent", async () => {
  const { service, tx } = setup(); const result = await service.createMilestone(actor, parent.id, create());
  expect(result).toEqual(Object.fromEntries(Object.entries(child).filter(([k]) => k !== "ownerId")));
  expect(tx.findGoalForUpdate).toHaveBeenCalledWith(parent.id); expect(tx.insert).toHaveBeenCalledWith(result);
});
it("all reads are scoped and reject foreign parent or child rows", async () => {
  const { service, repository } = setup(); await service.listMilestones(actor, parent.id); await service.getMilestone(actor, child.id);
  expect(repository.findGoalOwned).toHaveBeenCalledWith(actor, parent.id); expect(repository.listOwned).toHaveBeenCalledWith(actor, parent.id); expect(repository.findOwned).toHaveBeenCalledWith(actor, child.id);
  await expect(setup(child, { ...parent, ownerId: "foreign" }).service.listMilestones(actor, parent.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
  await expect(setup({ ...child, ownerId: "foreign" }).service.getMilestone(actor, child.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
  await expect(setup({ ...child, goalId: randomUUID() }).service.listMilestones(actor, parent.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
});
it("foreign/missing resources reject every write without persistence", async () => {
  for (const value of [null, { ...child, ownerId: "foreign" }]) {
    const { service, tx } = setup(value);
    await expect(service.updateMilestone(actor, child.id, edit())).rejects.toMatchObject({ code: "NOT_FOUND", message: "This milestone is unavailable." });
    await expect(service.completeMilestone(actor, child.id, transition())).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(service.archiveMilestone(actor, child.id, transition())).rejects.toMatchObject({ code: "NOT_FOUND" }); expect(tx.replace).not.toHaveBeenCalled();
  }
  for (const goal of [null, { ...parent, ownerId: "foreign" }]) await expect(setup(child, goal).service.createMilestone(actor, parent.id, create())).rejects.toMatchObject({ code: "NOT_FOUND" });
});
it("archived parents retain readable children and forbid all new mutations", async () => {
  const { service, tx } = setup(child, { ...parent, archivedAt: now });
  expect(await service.listMilestones(actor, parent.id)).toHaveLength(1); expect((await service.getMilestone(actor, child.id)).state).toBe("active");
  for (const promise of [service.createMilestone(actor, parent.id, create()), service.updateMilestone(actor, child.id, edit()), service.completeMilestone(actor, child.id, transition()), service.archiveMilestone(actor, child.id, transition())]) await expect(promise).rejects.toMatchObject({ code: "CONFLICT", details: { kind: "GOAL_ARCHIVED" } });
  expect(tx.insert).not.toHaveBeenCalled(); expect(tx.replace).not.toHaveBeenCalled();
});
it("locks parent before child, uses versions and never replaces the parent", async () => {
  const { service, tx, order } = setup(); const result = await service.completeMilestone(actor, child.id, { ...transition(), evidence: " Ran 5 km " });
  expect(order).toEqual(["parent", "child"]); expect(result).toMatchObject({ version: 2, evidence: "Ran 5 km", state: "completed", goalId: parent.id }); expect(tx.replace).toHaveBeenCalledWith(result, 1);
  expect(parent.version).toBe(1);
});
it("stale and terminal writes never reach replace", async () => {
  for (const value of [{ ...child, version: 2 }, { ...child, state: "completed" as const, completedAt: now }, { ...child, state: "archived" as const, archivedAt: now }]) {
    const { service, tx } = setup(value);
    for (const promise of [service.updateMilestone(actor, child.id, edit()), service.completeMilestone(actor, child.id, transition()), service.archiveMilestone(actor, child.id, transition())]) await expect(promise).rejects.toMatchObject({ code: "CONFLICT" });
    expect(tx.replace).not.toHaveBeenCalled();
  }
});
it("successful receipt replay bypasses current parent/child checks", async () => {
  const { service, repository, tx } = setup(null, null);
  const { ownerId: _owner, ...snapshot } = child; void _owner;
  vi.mocked(repository.executeOwned).mockResolvedValue(snapshot);
  expect(await service.updateMilestone(actor, child.id, edit())).toEqual(snapshot);
  expect(tx.findGoalForUpdate).not.toHaveBeenCalled(); expect(tx.findOwned).not.toHaveBeenCalled();
});
