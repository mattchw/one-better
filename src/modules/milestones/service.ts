import { createHash, randomUUID } from "node:crypto";
import type { Actor } from "../../domain/actor";
import { ApplicationError } from "../../domain/errors";
import { goalId, ownedGoal, parseCommand, type OwnedGoal } from "../goals/domain";
import { archiveMilestone, archiveMilestoneSchema, completeMilestone, completeMilestoneSchema, createMilestoneSchema, editMilestone, milestoneId, ownedMilestone, requireActiveGoal, updateMilestoneSchema, type Milestone, type OwnedMilestone } from "./domain";
export interface MilestoneTransaction {
  findOwned(id: string): Promise<OwnedMilestone | null>;
  findGoalForUpdate(id: string): Promise<OwnedGoal | null>;
  findForUpdate(id: string): Promise<OwnedMilestone | null>;
  insert(value: Milestone): Promise<OwnedMilestone>;
  replace(value: Milestone, expectedVersion: number): Promise<OwnedMilestone>;
}
export interface MilestoneRepository {
  findGoalOwned(actor: Actor, goalId: string): Promise<OwnedGoal | null>;
  listOwned(actor: Actor, goalId: string): Promise<OwnedMilestone[]>;
  findOwned(actor: Actor, id: string): Promise<OwnedMilestone | null>;
  executeOwned(actor: Actor, mutationId: string, hash: string, apply: (tx: MilestoneTransaction) => Promise<Milestone>): Promise<Milestone>;
}
const hash = (input: object) => createHash("sha256").update(JSON.stringify(input)).digest("hex");
export function milestoneService(repository: MilestoneRepository, clock = () => new Date().toISOString(), newId: () => string = randomUUID) {
  async function existing(actor: Actor, id: string, mutationId: string, requestHash: string, change: (value: Milestone) => Milestone) {
    return repository.executeOwned(actor, mutationId, requestHash, async (tx) => {
      const discovered = ownedMilestone(await tx.findOwned(id), actor.userId);
      requireActiveGoal(ownedGoal(await tx.findGoalForUpdate(discovered.goalId), actor.userId));
      const current = ownedMilestone(await tx.findForUpdate(id), actor.userId);
      if (current.goalId !== discovered.goalId) throw new ApplicationError("NOT_FOUND", "This milestone is unavailable.");
      return ownedMilestone(await tx.replace(change(current), current.version), actor.userId);
    });
  }
  return {
    async listMilestones(actor: Actor, parentId: string) {
      parentId = goalId(parentId);
      ownedGoal(await repository.findGoalOwned(actor, parentId), actor.userId);
      return (await repository.listOwned(actor, parentId)).map((m) => {
        const value = ownedMilestone(m, actor.userId);
        if (value.goalId !== parentId) throw new ApplicationError("NOT_FOUND", "This milestone is unavailable.");
        return value;
      });
    },
    async getMilestone(actor: Actor, id: string) { return ownedMilestone(await repository.findOwned(actor, milestoneId(id)), actor.userId); },
    async createMilestone(actor: Actor, parentId: string, input: unknown) {
      parentId = goalId(parentId);
      const { mutationId, title, successCondition } = parseCommand(createMilestoneSchema, input);
      return repository.executeOwned(actor, mutationId, hash({ kind: "milestone.create", goalId: parentId, title, successCondition }), async (tx) => {
        requireActiveGoal(ownedGoal(await tx.findGoalForUpdate(parentId), actor.userId));
        const now = clock();
        return ownedMilestone(await tx.insert({ id: newId(), goalId: parentId, title, successCondition, state: "active", version: 1, createdAt: now, updatedAt: now, completedAt: null, archivedAt: null, evidence: null }), actor.userId);
      });
    },
    async updateMilestone(actor: Actor, id: string, input: unknown) {
      id = milestoneId(id); const { mutationId, expectedVersion, title, successCondition } = parseCommand(updateMilestoneSchema, input);
      return existing(actor, id, mutationId, hash({ kind: "milestone.edit", id, expectedVersion, title, successCondition }), (current) => editMilestone(current, expectedVersion, { title, successCondition }, clock()));
    },
    async completeMilestone(actor: Actor, id: string, input: unknown) {
      id = milestoneId(id); const { mutationId, expectedVersion, evidence } = parseCommand(completeMilestoneSchema, input);
      return existing(actor, id, mutationId, hash({ kind: "milestone.complete", id, expectedVersion, evidence }), (current) => completeMilestone(current, expectedVersion, evidence, clock()));
    },
    async archiveMilestone(actor: Actor, id: string, input: unknown) {
      id = milestoneId(id); const { mutationId, expectedVersion } = parseCommand(archiveMilestoneSchema, input);
      return existing(actor, id, mutationId, hash({ kind: "milestone.archive", id, expectedVersion }), (current) => archiveMilestone(current, expectedVersion, clock()));
    },
  };
}
