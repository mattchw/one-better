import { expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { goalService, type GoalRepository, type OwnedGoalTransaction } from "../../src/modules/goals/service";
import type { OwnedGoal } from "../../src/modules/goals/domain";
const actor = { userId: randomUUID() };
const stored: OwnedGoal = { ownerId: actor.userId, id: randomUUID(), title: "An outcome", outcome: "Meaningful success", version: 1, createdAt: "2026-10-02T10:00:00.000Z", updatedAt: "2026-10-02T10:00:00.000Z", archivedAt: null };
function setup(value: OwnedGoal | null = stored) {
  const tx: OwnedGoalTransaction = { findForUpdate: vi.fn(async () => value), insert: vi.fn(async (goal) => ({ ...goal, ownerId: actor.userId })), replace: vi.fn(async (goal) => ({ ...goal, ownerId: actor.userId })) };
  const repository: GoalRepository = { listOwned: vi.fn(async () => value ? [value] : []), findOwned: vi.fn(async () => value), executeOwned: vi.fn(async (_actor, _id, _hash, apply) => apply(tx)) };
  return { tx, repository, service: goalService(repository, () => "2026-10-02T11:00:00.000Z", () => stored.id) };
}
it("validates before any persistence operation", async () => {
  const { service, repository } = setup();
  await expect(service.createGoal(actor, { title: " ", outcome: "ok", mutationId: randomUUID() })).rejects.toMatchObject({ code: "VALIDATION" });
  expect(repository.executeOwned).not.toHaveBeenCalled();
});
it("derives ownership from actor and creates version one with injected time/identity", async () => {
  const { service, tx, repository } = setup(); const mutationId = randomUUID();
  const result = await service.createGoal(actor, { title: " Go ", outcome: " Success ", mutationId });
  expect(repository.executeOwned).toHaveBeenCalledWith(actor, mutationId, expect.stringMatching(/^[a-f0-9]{64}$/), expect.any(Function));
  expect(tx.insert).toHaveBeenCalledWith(expect.objectContaining({ id: stored.id, title: "Go", outcome: "Success", version: 1, archivedAt: null }));
  expect(result).not.toHaveProperty("ownerId");
});
it("passes every read through actor scope and rejects foreign repository results", async () => {
  const { service, repository } = setup(); await service.listGoals(actor, "active"); await service.getGoal(actor, stored.id);
  expect(repository.listOwned).toHaveBeenCalledWith(actor, "active"); expect(repository.findOwned).toHaveBeenCalledWith(actor, stored.id);
  const foreign = setup({ ...stored, ownerId: randomUUID() }).service;
  await expect(foreign.getGoal(actor, stored.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
  await expect(foreign.listGoals(actor, "active")).rejects.toMatchObject({ code: "NOT_FOUND" });
});
it("returns indistinguishable missing/foreign mutation errors before a write", async () => {
  for (const value of [null, { ...stored, ownerId: randomUUID() }]) {
    const { service, tx } = setup(value);
    await expect(service.updateGoal(actor, stored.id, { mutationId: randomUUID(), expectedVersion: 1, title: "new", outcome: "new" })).rejects.toMatchObject({ code: "NOT_FOUND", message: "This goal is unavailable." });
    await expect(service.archiveGoal(actor, stored.id, { mutationId: randomUUID(), expectedVersion: 1 })).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(tx.replace).not.toHaveBeenCalled();
  }
});
it("stale edits and archives leave persistence untouched", async () => {
  const { service, tx } = setup({ ...stored, version: 2 });
  await expect(service.updateGoal(actor, stored.id, { mutationId: randomUUID(), expectedVersion: 1, title: "new", outcome: "new" })).rejects.toMatchObject({ code: "CONFLICT", details: { kind: "VERSION" } });
  await expect(service.archiveGoal(actor, stored.id, { mutationId: randomUUID(), expectedVersion: 1 })).rejects.toMatchObject({ code: "CONFLICT" });
  expect(tx.replace).not.toHaveBeenCalled();
});
it("archive preserves identity and fields and passes the expected version to persistence", async () => {
  const { service, tx } = setup(); const result = await service.archiveGoal(actor, stored.id, { mutationId: randomUUID(), expectedVersion: 1 });
  expect(result).toMatchObject({ id: stored.id, title: stored.title, outcome: stored.outcome, version: 2, archivedAt: "2026-10-02T11:00:00.000Z" });
  expect(tx.replace).toHaveBeenCalledWith(result, 1);
});
it("never reopens an archived goal even with its current version", async () => {
  const { service, tx } = setup({ ...stored, version: 2, archivedAt: stored.updatedAt });
  await expect(service.updateGoal(actor, stored.id, { mutationId: randomUUID(), expectedVersion: 2, title: "new", outcome: "new" })).rejects.toMatchObject({ code: "CONFLICT", details: { kind: "ARCHIVED" } });
  expect(tx.replace).not.toHaveBeenCalled();
});
