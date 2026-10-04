import { createHash, randomUUID } from "node:crypto";
import type { Actor } from "../../domain/actor";
import { ApplicationError } from "../../domain/errors";
import { goalId, ownedGoal, parseCommand, type Goal, type OwnedGoal } from "../goals/domain";
import { ownedMilestone, type Milestone, type OwnedMilestone } from "../milestones/domain";
import { actionId, actionMutability, actionStateSchema, archiveAction, completeAction, createActionSchema, editAction, ownedAction, requireActionGoal, requireAssignableMilestone, transitionActionSchema, updateActionSchema, type Action, type ActionState, type ActionView, type OwnedAction } from "./domain";
export interface ActionTransaction {
  findOwned(id: string): Promise<OwnedAction | null>;
  findGoalForUpdate(id: string): Promise<OwnedGoal | null>;
  findMilestoneForUpdate(goalId: string, id: string): Promise<OwnedMilestone | null>;
  findForUpdate(id: string): Promise<OwnedAction | null>;
  insert(value: Action): Promise<OwnedAction>;
  replace(value: Action, expectedVersion: number): Promise<OwnedAction>;
}
export type OwnedActionContext = { goal: OwnedGoal | null; milestones: OwnedMilestone[]; actions: OwnedAction[] };
export interface ActionRepository {
  readOwned(actor: Actor, goalId: string): Promise<OwnedActionContext>;
  findOwned(actor: Actor, id: string): Promise<OwnedAction | null>;
  executeOwned(actor: Actor, mutationId: string, hash: string, apply: (tx: ActionTransaction) => Promise<Action>): Promise<Action>;
}
export type ActionCatalog = { goal: Goal; actions: ActionView[]; assignableMilestones: Milestone[]; canCreate: boolean };
const hash = (value: object) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
function checkpoint(value: OwnedMilestone | null, actor: Actor, parentId: string) {
  const result = ownedMilestone(value, actor.userId);
  if (result.goalId !== parentId) throw new ApplicationError("NOT_FOUND", "This milestone is unavailable.");
  return result;
}
export function actionService(repository: ActionRepository, clock = () => new Date().toISOString(), newId: () => string = randomUUID) {
  async function catalog(actor: Actor, parentId: string): Promise<ActionCatalog> {
    const context = await repository.readOwned(actor, parentId);
    const parent = ownedGoal(context.goal, actor.userId);
    const milestones = context.milestones.map((m) => checkpoint(m, actor, parent.id));
    return { goal: parent, canCreate: !parent.archivedAt, assignableMilestones: parent.archivedAt ? [] : milestones.filter((m) => m.state === "active"), actions: context.actions.map((row) => {
      const value = ownedAction(row, actor.userId);
      if (value.goalId !== parent.id) throw new ApplicationError("NOT_FOUND", "This action is unavailable.");
      const linked = value.milestoneId ? milestones.find((m) => m.id === value.milestoneId) ?? null : null;
      return { action: value, milestone: linked, mutability: actionMutability(value, parent, linked) };
    }) };
  }
  async function existing(actor: Actor, id: string, mutationId: string, requestHash: string, destinationId: string | null | undefined, change: (value: Action, parent: Goal, current: Milestone | null, destination: Milestone | null) => Action) {
    return repository.executeOwned(actor, mutationId, requestHash, async (tx) => {
      const discovered = ownedAction(await tx.findOwned(id), actor.userId);
      const parent = ownedGoal(await tx.findGoalForUpdate(discovered.goalId), actor.userId);
      // All Action/Milestone writers hold this Goal lock. Re-read the current association after acquiring it.
      const peek = ownedAction(await tx.findOwned(id), actor.userId);
      if (peek.goalId !== parent.id) throw new ApplicationError("NOT_FOUND", "This action is unavailable.");
      const destination = destinationId === undefined ? peek.milestoneId : destinationId;
      const ids = [...new Set([peek.milestoneId, destination].filter((value): value is string => Boolean(value)))].sort();
      const checkpoints = new Map<string, Milestone>();
      for (const checkpointId of ids) checkpoints.set(checkpointId, checkpoint(await tx.findMilestoneForUpdate(parent.id, checkpointId), actor, parent.id));
      const current = ownedAction(await tx.findForUpdate(id), actor.userId);
      if (current.goalId !== peek.goalId || current.milestoneId !== peek.milestoneId) throw new ApplicationError("NOT_FOUND", "This action is unavailable.");
      const next = change(current, parent, current.milestoneId ? checkpoints.get(current.milestoneId)! : null, destination ? checkpoints.get(destination)! : null);
      return ownedAction(await tx.replace(next, current.version), actor.userId);
    });
  }
  return {
    async listActions(actor: Actor, parentId: string, state?: ActionState) {
      parentId = goalId(parentId); if (state !== undefined) state = parseCommand(actionStateSchema, state);
      const result = await catalog(actor, parentId);
      return state ? { ...result, actions: result.actions.filter((view) => view.action.state === state) } : result;
    },
    async getAction(actor: Actor, id: string): Promise<ActionView> {
      const value = ownedAction(await repository.findOwned(actor, actionId(id)), actor.userId);
      const result = (await catalog(actor, value.goalId)).actions.find((view) => view.action.id === value.id);
      if (!result) throw new ApplicationError("NOT_FOUND", "This action is unavailable.");
      return result;
    },
    async createAction(actor: Actor, parentId: string, input: unknown) {
      parentId = goalId(parentId); const { mutationId, ...fields } = parseCommand(createActionSchema, input);
      return repository.executeOwned(actor, mutationId, hash({ kind: "action.create", goalId: parentId, ...fields }), async (tx) => {
        const parent = ownedGoal(await tx.findGoalForUpdate(parentId), actor.userId); requireActionGoal(parent);
        const linked = fields.milestoneId ? checkpoint(await tx.findMilestoneForUpdate(parentId, fields.milestoneId), actor, parentId) : null;
        requireAssignableMilestone(parent, linked);
        const now = clock();
        return ownedAction(await tx.insert({ id: newId(), goalId: parentId, ...fields, state: "open", version: 1, createdAt: now, updatedAt: now, completedAt: null, archivedAt: null }), actor.userId);
      });
    },
    async updateAction(actor: Actor, id: string, input: unknown) {
      id = actionId(id); const { mutationId, expectedVersion, ...fields } = parseCommand(updateActionSchema, input);
      return existing(actor, id, mutationId, hash({ kind: "action.edit", id, expectedVersion, ...fields }), fields.milestoneId, (current, parent, linked, destination) => editAction(current, expectedVersion, fields, parent, linked, destination, clock()));
    },
    async completeAction(actor: Actor, id: string, input: unknown) {
      id = actionId(id); const { mutationId, expectedVersion } = parseCommand(transitionActionSchema, input);
      return existing(actor, id, mutationId, hash({ kind: "action.complete", id, expectedVersion }), undefined, (current, parent, linked) => completeAction(current, expectedVersion, parent, linked, clock()));
    },
    async archiveAction(actor: Actor, id: string, input: unknown) {
      id = actionId(id); const { mutationId, expectedVersion } = parseCommand(transitionActionSchema, input);
      return existing(actor, id, mutationId, hash({ kind: "action.archive", id, expectedVersion }), undefined, (current, parent, linked) => archiveAction(current, expectedVersion, parent, linked, clock()));
    },
  };
}
