import { expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { actionService, type ActionRepository, type ActionTransaction } from "../../src/modules/actions/service";
import type { OwnedAction } from "../../src/modules/actions/domain";
import type { OwnedGoal } from "../../src/modules/goals/domain";
import type { OwnedMilestone } from "../../src/modules/milestones/domain";
const actor = { userId: "owner" }; const now = "2026-10-02T12:00:00.000Z";
const parent: OwnedGoal = { id: randomUUID(), ownerId: actor.userId, title: "Fitness", outcome: "Run comfortably", version: 1, createdAt: now, updatedAt: now, archivedAt: null };
const m: OwnedMilestone = { id: randomUUID(), goalId: parent.id, ownerId: actor.userId, title: "Continuous run", successCondition: "Finish without walking", state: "active", version: 1, createdAt: now, updatedAt: now, completedAt: null, archivedAt: null, evidence: null };
const child: OwnedAction = { id: randomUUID(), ownerId: actor.userId, goalId: parent.id, milestoneId: m.id, title: "Run 5 km", doneWhen: null, estimateMinutes: 45, state: "open", version: 1, createdAt: now, updatedAt: now, completedAt: null, archivedAt: null };
const create = () => ({ mutationId: randomUUID(), title: child.title, estimateMinutes: 45, milestoneId: m.id }); const edit = () => ({ ...create(), expectedVersion: 1 }); const transition = () => ({ mutationId: randomUUID(), expectedVersion: 1 });
function setup(value: OwnedAction | null = child, goal: OwnedGoal | null = parent, checkpoints: OwnedMilestone[] = [m]) {
  const order: string[] = [];
  const tx: ActionTransaction = { findOwned: vi.fn(async () => value), findGoalForUpdate: vi.fn(async () => { order.push("goal"); return goal; }), findMilestoneForUpdate: vi.fn(async (_g, id) => { order.push(id); return checkpoints.find((item) => item.id === id) ?? null; }), findForUpdate: vi.fn(async () => { order.push("action"); return value; }), insert: vi.fn(async (item) => ({ ...item, ownerId: actor.userId })), replace: vi.fn(async (item) => ({ ...item, ownerId: actor.userId })) };
  const repository: ActionRepository = { readOwned: vi.fn(async () => ({ goal, milestones: checkpoints, actions: value ? [value] : [] })), findOwned: vi.fn(async () => value), executeOwned: vi.fn(async (_actor, _id, _hash, apply) => apply(tx)) };
  return { tx, order, repository, service: actionService(repository, () => now, () => child.id) };
}
it("validates all commands before persistence and disallows standalone/move/owner inputs", async () => {
  const { service, repository } = setup();
  for (const goalId of [undefined, "", "not-a-goal"]) await expect(service.createAction(actor, goalId as string, create())).rejects.toMatchObject({ code: "VALIDATION" });
  await expect(service.createAction(actor, parent.id, { ...create(), estimateMinutes: 0 })).rejects.toMatchObject({ code: "VALIDATION" });
  await expect(service.updateAction(actor, child.id, { ...edit(), goalId: randomUUID() })).rejects.toMatchObject({ code: "VALIDATION" });
  await expect(service.completeAction(actor, child.id, { ...transition(), ownerId: "foreign" })).rejects.toMatchObject({ code: "VALIDATION" }); expect(repository.executeOwned).not.toHaveBeenCalled();
});
it("creates under locked Goal and exact same-Goal active milestone without exposing owner", async () => {
  const { service, tx, order } = setup(); const result = await service.createAction(actor, parent.id, create()); expect(result).not.toHaveProperty("ownerId"); expect(result).toMatchObject({ state: "open", goalId: parent.id, milestoneId: m.id, version: 1 });
  expect(order).toEqual(["goal", m.id]); expect(tx.findMilestoneForUpdate).toHaveBeenCalledWith(parent.id, m.id);
  for (const checkpoint of [null, { ...m, ownerId: "foreign" }, { ...m, goalId: randomUUID() }]) await expect(setup(child, parent, checkpoint ? [checkpoint] : []).service.createAction(actor, parent.id, create())).rejects.toMatchObject({ code: "NOT_FOUND" });
});
it("consistent owned catalog centralizes editability and selectors; terminal records remain visible", async () => {
  const { service, repository } = setup(child, parent, [{ ...m, state: "completed" }]); const result = await service.listActions(actor, parent.id); expect(result.actions[0]).toMatchObject({ action: { state: "open" }, mutability: { editable: false, kind: "MILESTONE_TERMINAL" } }); expect(result.assignableMilestones).toEqual([]); expect(result.canCreate).toBe(true);
  expect(repository.readOwned).toHaveBeenCalledWith(actor, parent.id); expect((await service.getAction(actor, child.id)).action.id).toBe(child.id);
  expect((await setup(child, { ...parent, archivedAt: now }).service.listActions(actor, parent.id)).canCreate).toBe(false);
});
it("foreign/missing resources reject all reads and commands without leaking snapshots", async () => {
  for (const value of [null, { ...child, ownerId: "foreign" }]) { const { service, tx } = setup(value);
    await Promise.all([service.getAction(actor, child.id), service.updateAction(actor, child.id, edit()), service.completeAction(actor, child.id, transition()), service.archiveAction(actor, child.id, transition())].map((promise) => expect(promise).rejects.toMatchObject({ code: "NOT_FOUND", message: "This action is unavailable." }))); expect(tx.replace).not.toHaveBeenCalled();
  }
  for (const goal of [null, { ...parent, ownerId: "foreign" }]) { const { service } = setup(child, goal); await expect(service.listActions(actor, parent.id)).rejects.toMatchObject({ code: "NOT_FOUND" }); await expect(service.createAction(actor, parent.id, create())).rejects.toMatchObject({ code: "NOT_FOUND" }); }
});
it("serializes Goal then sorted current/destination milestones then Action for reassignment", async () => {
  const dest = { ...m, id: randomUUID() }; const { service, order, tx } = setup(child, parent, [m, dest]); const result = await service.updateAction(actor, child.id, { ...edit(), milestoneId: dest.id });
  expect(order).toEqual(["goal", ...[m.id, dest.id].sort(), "action"]); expect(tx.replace).toHaveBeenCalledWith(result, 1); expect(result).toMatchObject({ version: 2, goalId: parent.id, milestoneId: dest.id });
});
it("parent terminal and stale versions prevent replacement including attempted detachment", async () => {
  for (const context of [setup(child, { ...parent, archivedAt: now }), setup(child, parent, [{ ...m, state: "completed" }]), setup(child, parent, [{ ...m, state: "archived" }]), setup({ ...child, version: 2 })]) {
    await Promise.all([context.service.updateAction(actor, child.id, { ...edit(), milestoneId: null }), context.service.completeAction(actor, child.id, transition()), context.service.archiveAction(actor, child.id, transition())].map((promise) => expect(promise).rejects.toMatchObject({ code: "CONFLICT" }))); expect(context.tx.replace).not.toHaveBeenCalled();
  }
});
it("receipt replay of all four commands precedes current resource checks", async () => {
  const { service, repository, tx } = setup(null, null); const { ownerId: _owner, ...snapshot } = child; void _owner; vi.mocked(repository.executeOwned).mockResolvedValue(snapshot);
  for (const promise of [service.createAction(actor, parent.id, create()), service.updateAction(actor, child.id, edit()), service.completeAction(actor, child.id, transition()), service.archiveAction(actor, child.id, transition())]) expect(await promise).toEqual(snapshot); expect(tx.findOwned).not.toHaveBeenCalled(); expect(tx.findGoalForUpdate).not.toHaveBeenCalled();
});
it("normalized equivalent payloads use the same hash and Action kinds cannot collide", async () => {
  const { service, repository } = setup(); const input = create(); await service.createAction(actor, parent.id, input); await service.createAction(actor, parent.id, { ...input, title: ` ${input.title} `, doneWhen: " " });
  const calls = vi.mocked(repository.executeOwned).mock.calls; expect(calls[0][2]).toBe(calls[1][2]);
  await service.updateAction(actor, child.id, edit()); await service.completeAction(actor, child.id, transition()); await service.archiveAction(actor, child.id, transition()); expect(new Set(vi.mocked(repository.executeOwned).mock.calls.map((call) => call[2])).size).toBe(4);
});
