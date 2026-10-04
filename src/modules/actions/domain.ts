import { z } from "zod";
import { ApplicationError } from "../../domain/errors";
import { boundedText, parseCommand, type Goal } from "../goals/domain";
import type { Milestone } from "../milestones/domain";
export type ActionState = "open" | "completed" | "archived";
export type Action = {
  id: string; goalId: string; milestoneId: string | null; title: string; doneWhen: string | null; estimateMinutes: number | null;
  state: ActionState; version: number; createdAt: string; updatedAt: string; completedAt: string | null; archivedAt: string | null;
};
export type OwnedAction = Action & { ownerId: string };
export const MAX_ESTIMATE_MINUTES = 10080;
const doneWhen = z.preprocess((value) => typeof value === "string" && !value.trim() ? null : value, boundedText("Done condition", 2000).nullable()).optional().transform((value) => value ?? null);
export const actionFieldsSchema = z.object({
  title: boundedText("Title", 160), doneWhen,
  estimateMinutes: z.number({ error: "Estimate must be a whole number of minutes." }).int({ error: "Estimate must be a whole number of minutes." }).min(1, "Estimate must be at least 1 minute.").max(MAX_ESTIMATE_MINUTES, "Estimate must be 10,080 minutes or fewer.").nullable().optional().transform((value) => value ?? null),
  milestoneId: z.uuid({ error: "Choose a valid milestone." }).nullable().optional().transform((value) => value ?? null),
}).strict();
export type ActionFields = z.infer<typeof actionFieldsSchema>;
export const createActionSchema = actionFieldsSchema.extend({ mutationId: z.uuid() });
export const updateActionSchema = createActionSchema.extend({ expectedVersion: z.number().int().min(1).max(2147483646) });
export const transitionActionSchema = z.object({ mutationId: z.uuid(), expectedVersion: z.number().int().min(1).max(2147483646) }).strict();
export const actionStateSchema = z.enum(["open", "completed", "archived"]);
export const actionId = (value: unknown) => parseCommand(z.uuid(), value);
export function ownedAction(value: OwnedAction | null, ownerId: string): Action {
  if (!value || value.ownerId !== ownerId) throw new ApplicationError("NOT_FOUND", "This action is unavailable.");
  const { ownerId: _owner, ...result } = value; void _owner; return result;
}
export type ActionMutability = { editable: boolean; kind: "GOAL_ARCHIVED" | "MILESTONE_TERMINAL" | "TERMINAL" | null; message: string | null };
export type ActionView = { action: Action; milestone: Milestone | null; mutability: ActionMutability };
export function actionMutability(value: Action, parent: Goal, checkpoint: Milestone | null): ActionMutability {
  if (value.goalId !== parent.id || (value.milestoneId ? !checkpoint || checkpoint.id !== value.milestoneId || checkpoint.goalId !== parent.id : checkpoint !== null)) throw new ApplicationError("NOT_FOUND", "This action is unavailable.");
  if (value.state !== "open") return { editable: false, kind: "TERMINAL", message: `This action is ${value.state} and is kept as read-only history.` };
  if (parent.archivedAt) return { editable: false, kind: "GOAL_ARCHIVED", message: "This goal is archived. Its actions are kept unchanged as read-only history." };
  if (checkpoint && checkpoint.state !== "active") return { editable: false, kind: "MILESTONE_TERMINAL", message: `Its milestone is ${checkpoint.state}. This action remains open as read-only history.` };
  return { editable: true, kind: null, message: null };
}
export function requireActionGoal(parent: Goal) {
  if (parent.archivedAt) throw new ApplicationError("CONFLICT", "This goal is archived. Its actions are kept unchanged as read-only history.", { kind: "GOAL_ARCHIVED" });
}
export function requireAssignableMilestone(parent: Goal, checkpoint: Milestone | null) {
  if (checkpoint && (checkpoint.goalId !== parent.id || checkpoint.state !== "active")) throw new ApplicationError("VALIDATION", "Choose an active milestone from this goal.", { fields: { milestoneId: "Choose an active milestone from this goal." } });
}
export function requireActionMutable(value: Action, expected: number, parent: Goal, checkpoint: Milestone | null) {
  if (value.version !== expected) throw new ApplicationError("CONFLICT", "This action changed elsewhere. Review the latest saved version before trying again.", { kind: "VERSION", current: value });
  const status = actionMutability(value, parent, checkpoint);
  if (!status.editable) throw new ApplicationError("CONFLICT", status.message!, { kind: status.kind, current: value });
}
export function editAction(value: Action, expected: number, fields: ActionFields, parent: Goal, currentMilestone: Milestone | null, destination: Milestone | null, now: string): Action {
  requireActionMutable(value, expected, parent, currentMilestone);
  const normalized = parseCommand(actionFieldsSchema, fields);
  if (normalized.milestoneId !== (destination?.id ?? null)) throw new ApplicationError("NOT_FOUND", "This milestone is unavailable.");
  requireAssignableMilestone(parent, destination);
  return { ...value, ...normalized, version: value.version + 1, updatedAt: now };
}
export function completeAction(value: Action, expected: number, parent: Goal, checkpoint: Milestone | null, now: string): Action {
  requireActionMutable(value, expected, parent, checkpoint);
  return { ...value, state: "completed", completedAt: now, updatedAt: now, version: value.version + 1 };
}
export function archiveAction(value: Action, expected: number, parent: Goal, checkpoint: Milestone | null, now: string): Action {
  requireActionMutable(value, expected, parent, checkpoint);
  return { ...value, state: "archived", archivedAt: now, updatedAt: now, version: value.version + 1 };
}
