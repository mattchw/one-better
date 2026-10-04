import { z } from "zod";
import { ApplicationError } from "../../domain/errors";
import { boundedText, parseCommand, type Goal } from "../goals/domain";
export type MilestoneState = "active" | "completed" | "archived";
export type Milestone = {
  id: string; goalId: string; title: string; successCondition: string; state: MilestoneState;
  version: number; createdAt: string; updatedAt: string; completedAt: string | null; archivedAt: string | null; evidence: string | null;
};
export type OwnedMilestone = Milestone & { ownerId: string };
export const milestoneFieldsSchema = z.object({ title: boundedText("Title", 160), successCondition: boundedText("Success condition", 2000) }).strict();
const mutationId = z.uuid();
const expectedVersion = z.number().int().min(1).max(2147483646);
export const createMilestoneSchema = milestoneFieldsSchema.extend({ mutationId });
export const updateMilestoneSchema = createMilestoneSchema.extend({ expectedVersion });
export const archiveMilestoneSchema = z.object({ mutationId, expectedVersion }).strict();
export const evidenceSchema = z.preprocess((value) => typeof value === "string" && !value.trim() ? null : value, boundedText("Evidence", 2000).nullable()).optional().transform((value) => value ?? null);
export const completeMilestoneSchema = archiveMilestoneSchema.extend({ evidence: evidenceSchema });
export function milestoneId(input: unknown) { return parseCommand(z.uuid(), input); }
export function ownedMilestone(value: OwnedMilestone | null, ownerId: string): Milestone {
  if (!value || value.ownerId !== ownerId) throw new ApplicationError("NOT_FOUND", "This milestone is unavailable.");
  const { ownerId: _owner, ...result } = value; void _owner; return result;
}
export function requireActiveGoal(goal: Goal) {
  if (goal.archivedAt) throw new ApplicationError("CONFLICT", "This goal is archived. Its milestones are historical and cannot be changed.", { kind: "GOAL_ARCHIVED" });
}
export function requireActiveMilestone(value: Milestone, expected: number) {
  if (value.version !== expected) throw new ApplicationError("CONFLICT", "This milestone changed elsewhere. Review the latest saved version before trying again.", { kind: "VERSION", current: value });
  if (value.state !== "active") throw new ApplicationError("CONFLICT", `This milestone is ${value.state} and cannot be changed.`, { kind: "TERMINAL", current: value });
}
export function editMilestone(value: Milestone, expected: number, input: unknown, now: string): Milestone {
  requireActiveMilestone(value, expected);
  return { ...value, ...parseCommand(milestoneFieldsSchema, input), version: value.version + 1, updatedAt: now };
}
export function completeMilestone(value: Milestone, expected: number, evidence: string | null, now: string): Milestone {
  requireActiveMilestone(value, expected);
  const note = parseCommand(evidenceSchema, evidence);
  return { ...value, state: "completed", evidence: note, completedAt: now, version: value.version + 1, updatedAt: now };
}
export function archiveMilestone(value: Milestone, expected: number, now: string): Milestone {
  requireActiveMilestone(value, expected);
  return { ...value, state: "archived", archivedAt: now, version: value.version + 1, updatedAt: now };
}
