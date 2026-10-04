import { z } from "zod";
import { ApplicationError } from "../../domain/errors";
import { actionMutability, type Action } from "../actions/domain";
import type { Goal } from "../goals/domain";
import type { Milestone } from "../milestones/domain";

// Dates identify local calendar weeks. UTC here is only a calendar arithmetic tool.
export function calendarDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || value < "2000-01-01" || value > "9999-12-31") return false;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}
export function addDays(value: string, days: number): string {
  if (!calendarDate(value)) throw new ApplicationError("VALIDATION", "Choose a valid calendar date.");
  const date = new Date(`${value}T00:00:00Z`); date.setUTCDate(date.getUTCDate() + days); return date.toISOString().slice(0, 10);
}
export function mondayOf(value: string): string {
  if (!calendarDate(value)) throw new ApplicationError("VALIDATION", "Choose a valid calendar date.");
  return addDays(value, -((new Date(`${value}T00:00:00Z`).getUTCDay() + 6) % 7));
}
export function currentWeek(now: string, timezone: string): string {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date(now));
  const part = (name: string) => parts.find((p) => p.type === name)!.value;
  return mondayOf(`${part("year")}-${part("month")}-${part("day")}`);
}
export const weekSchema = z.string().refine((v) => calendarDate(v) && mondayOf(v) === v, "Choose a Monday-start week (YYYY-MM-DD).");
const minutes = z.number().int("Use whole minutes.").min(1, "Use at least 1 minute.").max(10080, "Use 10,080 minutes or fewer.");
const version = z.number().int().min(1).max(2147483646);
export const sourceGuardSchema = z.object({ actionVersion: version, goalId: z.uuid(), goalVersion: version, milestoneId: z.uuid().nullable(), milestoneVersion: version.nullable() }).strict().refine((v) => (v.milestoneId === null) === (v.milestoneVersion === null), "Milestone identity and version must agree.");
export type SourceGuard = z.infer<typeof sourceGuardSchema>;
const selection = z.object({ actionId: z.uuid(), budgetMinutes: minutes, source: sourceGuardSchema }).strict();
const capacityFields = { provisionalCapacityMinutes: minutes, reserveMinutes: z.number().int("Use whole minutes.").min(0).max(10079) };
const reserveValid = (v: { provisionalCapacityMinutes: number; reserveMinutes: number }) => v.reserveMinutes < v.provisionalCapacityMinutes;
export const createPlanSchema = z.object({ mutationId: z.uuid(), weekStartDate: weekSchema, ...capacityFields }).strict().refine(reserveValid, { message: "Reserve must be less than weekly capacity.", path: ["reserveMinutes"] });
export const savePlanSchema = z.object({ mutationId: z.uuid(), expectedVersion: version, ...capacityFields, carry: z.strictObject({ reviewId: z.uuid(), commitmentId: z.uuid() }).optional(), commitments: z.array(selection).max(50, "Choose at most 50 commitments.") }).strict().refine(reserveValid, { message: "Reserve must be less than weekly capacity.", path: ["reserveMinutes"] }).refine((v) => new Set(v.commitments.map((c) => c.actionId)).size === v.commitments.length, { message: "An Action may be selected only once per week.", path: ["commitments"] });
export const commitPlanSchema = z.object({ mutationId: z.uuid(), expectedVersion: version }).strict();
export type PlanSelection = z.infer<typeof selection>;
export type PlanningSnapshot = {
  action: Pick<Action, "id" | "title" | "doneWhen" | "estimateMinutes">;
  goal: Pick<Goal, "id" | "title" | "outcome">;
  milestone: Pick<Milestone, "id" | "title" | "successCondition"> | null;
};
export type WeeklyCommitment = { id: string; planId: string; actionId: string; budgetMinutes: number; source: SourceGuard; snapshot: PlanningSnapshot | null; createdAt: string; updatedAt: string };
export type WeeklyPlan = { id: string; weekStartDate: string; timezone: string; state: "draft" | "committed"; provisionalCapacityMinutes: number; reserveMinutes: number; version: number; createdAt: string; updatedAt: string; committedAt: string | null; commitments: WeeklyCommitment[] };
export type OwnedPlan = WeeklyPlan & { ownerId: string };
export type PlanningSource = { actionId: string; source: SourceGuard; context: PlanningSnapshot; eligible: boolean; reason: string | null };
export type SourceIssue = { actionId: string; kind: "UNAVAILABLE" | "INELIGIBLE" | "CHANGED"; message: string };
export function planningSource(action: Action, goal: Goal, milestone: Milestone | null): PlanningSource {
  const status = actionMutability(action, goal, milestone);
  return { actionId: action.id, source: { actionVersion: action.version, goalId: goal.id, goalVersion: goal.version, milestoneId: milestone?.id ?? null, milestoneVersion: milestone?.version ?? null }, context: { action: { id: action.id, title: action.title, doneWhen: action.doneWhen, estimateMinutes: action.estimateMinutes }, goal: { id: goal.id, title: goal.title, outcome: goal.outcome }, milestone: milestone ? { id: milestone.id, title: milestone.title, successCondition: milestone.successCondition } : null }, eligible: status.editable, reason: status.message };
}
export function sourceIssues(selections: Pick<PlanSelection, "actionId" | "source">[], sources: PlanningSource[]): SourceIssue[] {
  return selections.flatMap<SourceIssue>((c) => {
    const live = sources.find((s) => s.actionId === c.actionId);
    if (!live) return [{ actionId: c.actionId, kind: "UNAVAILABLE" as const, message: "This Action is unavailable. Remove this commitment or choose another Action." }];
    if (!live.eligible) return [{ actionId: c.actionId, kind: "INELIGIBLE" as const, message: `${live.reason} Remove this commitment before committing the week.` }];
    const changed = (Object.keys(c.source) as (keyof SourceGuard)[]).some((key) => c.source[key] !== live.source[key]);
    return changed ? [{ actionId: c.actionId, kind: "CHANGED" as const, message: "The Action or its Goal/Milestone context changed. Review the latest source, then save your draft again." }] : [];
  });
}
export function capacitySummary(plan: Pick<WeeklyPlan, "provisionalCapacityMinutes" | "reserveMinutes"> & { commitments: Pick<WeeklyCommitment, "budgetMinutes">[] }) {
  const usableMinutes = plan.provisionalCapacityMinutes - plan.reserveMinutes;
  const totalMinutes = plan.commitments.reduce((sum, c) => sum + c.budgetMinutes, 0);
  return { usableMinutes, totalMinutes, remainingMinutes: usableMinutes - totalMinutes };
}
export function ownedPlan(value: OwnedPlan | null, ownerId: string): WeeklyPlan {
  if (!value || value.ownerId !== ownerId) throw new ApplicationError("NOT_FOUND", "This weekly plan is unavailable.");
  const { ownerId: _owner, ...result } = value; void _owner; return result;
}
export function requireDraft(plan: WeeklyPlan, expectedVersion: number) {
  if (plan.version !== expectedVersion) throw new ApplicationError("CONFLICT", "This plan changed elsewhere. Review the latest saved draft before retrying.", { kind: "VERSION", current: plan });
  if (plan.state !== "draft") throw new ApplicationError("CONFLICT", "This committed baseline is immutable. Use Amend plan to change the Current Plan.", { kind: "COMMITTED", current: plan });
}
export type PlanningView = { plan: WeeklyPlan; sources: PlanningSource[]; summary: ReturnType<typeof capacitySummary>; issues: SourceIssue[]; canCommit: boolean };
export function planningView(plan: WeeklyPlan, sources: PlanningSource[]): PlanningView {
  const summary = capacitySummary(plan);
  const issues = plan.state === "draft" ? sourceIssues(plan.commitments, sources) : [];
  return { plan, sources: plan.state === "draft" ? sources : [], summary, issues, canCommit: plan.state === "draft" && plan.commitments.length > 0 && summary.remainingMinutes >= 0 && !issues.length };
}
export type WeekWorkspace = { weekStartDate: string; currentWeekStartDate: string; timezone: string; canCreate: boolean; view: PlanningView | null; savedWeeks: { id: string; weekStartDate: string; state: WeeklyPlan["state"] }[] };
