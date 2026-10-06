import { isLegacyGeneralGoal } from '../planning/general';
import { createHash, randomUUID } from "node:crypto";
import type { Actor } from "../../domain/actor";
import { archiveGoalSchema, createGoalSchema, editGoal, goalId, ownedGoal, parseCommand, softArchiveGoal, updateGoalSchema, type Goal, type GoalStatus, type OwnedGoal } from "./domain";

export interface OwnedGoalTransaction {
  findForUpdate(id: string): Promise<OwnedGoal | null>;
  insert(goal: Goal): Promise<OwnedGoal>;
  replace(goal: Goal, expectedVersion: number): Promise<OwnedGoal>;
}
export interface GoalRepository {
  listOwned(actor: Actor, status: GoalStatus): Promise<OwnedGoal[]>;
  findOwned(actor: Actor, id: string): Promise<OwnedGoal | null>;
  executeOwned(actor: Actor, mutationId: string, hash: string, apply: (tx: OwnedGoalTransaction) => Promise<Goal>): Promise<Goal>;
}
const hash = (command: object) => createHash("sha256").update(JSON.stringify(command)).digest("hex");
export function goalService(repository: GoalRepository, clock = () => new Date().toISOString(), newId: () => string = randomUUID) {
  return {
    async listGoals(actor: Actor, status: GoalStatus) {
      return (await repository.listOwned(actor, status)).filter(g => !isLegacyGeneralGoal(g)).map((g) => ownedGoal(g, actor.userId));
    },
    async getGoal(actor: Actor, id: string) { return ownedGoal(await repository.findOwned(actor, goalId(id)), actor.userId); },
    async createGoal(actor: Actor, input: unknown) {
      const { mutationId, title, outcome } = parseCommand(createGoalSchema, input);
      return repository.executeOwned(actor, mutationId, hash({ kind: "create", title, outcome }), async (tx) => {
        const now = clock();
        return ownedGoal(await tx.insert({ id: newId(), title, outcome, version: 1, createdAt: now, updatedAt: now, archivedAt: null }), actor.userId);
      });
    },
    async updateGoal(actor: Actor, id: string, input: unknown) {
      id = goalId(id);
      const { mutationId, expectedVersion, title, outcome } = parseCommand(updateGoalSchema, input);
      return repository.executeOwned(actor, mutationId, hash({ kind: "edit", id, expectedVersion, title, outcome }), async (tx) => {
        const current = ownedGoal(await tx.findForUpdate(id), actor.userId);
        return ownedGoal(await tx.replace(editGoal(current, expectedVersion, { title, outcome }, clock()), expectedVersion), actor.userId);
      });
    },
    async archiveGoal(actor: Actor, id: string, input: unknown) {
      id = goalId(id);
      const { mutationId, expectedVersion } = parseCommand(archiveGoalSchema, input);
      return repository.executeOwned(actor, mutationId, hash({ kind: "archive", id, expectedVersion }), async (tx) => {
        const current = ownedGoal(await tx.findForUpdate(id), actor.userId);
        return ownedGoal(await tx.replace(softArchiveGoal(current, expectedVersion, clock()), expectedVersion), actor.userId);
      });
    },
  };
}
