import { z } from "zod";
import { ApplicationError } from "../../domain/errors";

export type Goal = {
  id: string; title: string; outcome: string; version: number;
  createdAt: string; updatedAt: string; archivedAt: string | null;
};
export type OwnedGoal = Goal & { ownerId: string };
export type GoalFields = Pick<Goal, "title" | "outcome">;
export type GoalStatus = "active" | "archived";
export const codePointLength = (value: string) => Array.from(value).length;
export const boundedText = (label: string, max: number) => z.string({ error: `${label} is required.` }).trim()
  .refine((v) => codePointLength(v) >= 1, `${label} is required.`)
  .refine((v) => codePointLength(v) <= max, `${label} must be ${max} characters or fewer.`)
  .refine((v) => v.isWellFormed(), `${label} must contain valid Unicode.`)
  .refine((v) => !v.includes("\0"), `${label} cannot contain a null character.`);
export const goalFieldsSchema = z.object({ title: boundedText("Title", 160), outcome: boundedText("Outcome", 2000) }).strict();
const operation = z.uuid({ error: "A valid mutation ID is required." });
const version = z.number().int().min(1).max(2147483646);
export const createGoalSchema = goalFieldsSchema.extend({ mutationId: operation });
export const updateGoalSchema = createGoalSchema.extend({ expectedVersion: version });
export const archiveGoalSchema = z.object({ mutationId: operation, expectedVersion: version }).strict();
export type CreateGoalCommand = z.infer<typeof createGoalSchema>;
export type UpdateGoalCommand = z.infer<typeof updateGoalSchema>;
export type ArchiveGoalCommand = z.infer<typeof archiveGoalSchema>;

export function parseCommand<T>(schema: z.ZodType<T>, input: unknown): T {
  const parsed = schema.safeParse(input);
  if (parsed.success) return parsed.data;
  const fields: Record<string, string> = {};
  for (const issue of parsed.error.issues) fields[String(issue.path[0] ?? "form")] ??= issue.message;
  throw new ApplicationError("VALIDATION", "Check the highlighted fields.", { fields });
}
export function goalId(input: unknown) { return parseCommand(z.uuid({ error: "A valid Goal ID is required." }), input); }
export function unavailableGoal(): never { throw new ApplicationError("NOT_FOUND", "This goal is unavailable."); }
export function ownedGoal(goal: OwnedGoal | null, ownerId: string): Goal {
  if (!goal || goal.ownerId !== ownerId) unavailableGoal();
  const { ownerId: _owner, ...result } = goal; // Ownership stays server-side.
  void _owner;
  return result;
}
export function requireMutable(goal: Goal, expectedVersion: number) {
  if (goal.version !== expectedVersion) throw new ApplicationError("CONFLICT", "This goal changed elsewhere. Review the latest saved version before trying again.", { kind: "VERSION", current: goal });
  if (goal.archivedAt) throw new ApplicationError("CONFLICT", "This goal is archived and cannot be changed.", { kind: "ARCHIVED", current: goal });
}
export function editGoal(goal: Goal, expectedVersion: number, fields: GoalFields, now: string): Goal {
  requireMutable(goal, expectedVersion);
  return { ...goal, ...parseCommand(goalFieldsSchema, fields), version: goal.version + 1, updatedAt: now };
}
export function softArchiveGoal(goal: Goal, expectedVersion: number, now: string): Goal {
  requireMutable(goal, expectedVersion);
  return { ...goal, archivedAt: now, updatedAt: now, version: goal.version + 1 };
}
