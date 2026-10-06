import { z } from "zod";
import { ApplicationError } from "../../domain/errors";
import { boundedText } from "../goals/domain";
import { addDays, capacitySummary, currentWeek, sourceGuardSchema, type PlanningSource, type SourceGuard, type WeeklyPlan } from "../planning/domain";
import { effectivePlan, type Amendment } from "../amendments/domain";
import { intervalMilliseconds, localDayRange, type DailyReflection } from "../reviews/domain";
import type { TimeBlock } from "../scheduling/domain";
import type { FocusSession } from "../focus/domain";
import type { ReviewAnalytics } from "./analytics";
export type Decision = { commitmentId: string; actionId: string; kind: "carry" | "defer" | "drop"; proposedBudgetMinutes: number | null; source: SourceGuard };
export type WeeklyReview = { id: string; planId: string; status: "draft" | "finalized"; note: string; version: number; createdAt: string; updatedAt: string; finalizedAt: string | null; decisions: Decision[] };
export const decisionSchema = z.strictObject({ commitmentId: z.uuid(), actionId: z.uuid(), kind: z.enum(["carry", "defer", "drop"]), proposedBudgetMinutes: z.number().int().min(1).max(10080).nullable(), source: sourceGuardSchema }).refine(d => (d.kind === "carry") === (d.proposedBudgetMinutes !== null), "Carry needs a fresh positive budget; Defer and Drop have no budget.");
const noteSchema = z.preprocess(v => typeof v === "string" && !v.trim() ? "" : v, z.union([z.literal(""), boundedText("Weekly reflection", 4000)]));
export const saveReviewSchema = z.strictObject({ mutationId: z.uuid(), planId: z.uuid(), reviewId: z.uuid().nullable(), expectedVersion: z.number().int().min(0).max(2147483646), note: noteSchema, decisions: z.array(decisionSchema).max(500) }).refine(v => (v.reviewId === null) === (v.expectedVersion === 0), "Review identity and version must agree.").refine(v => new Set(v.decisions.map(d => d.commitmentId)).size === v.decisions.length, "Choose each logical commitment once.");
export const finalizeReviewSchema = z.strictObject({ mutationId: z.uuid(), expectedVersion: z.number().int().min(1).max(2147483646), confirmArchive: z.boolean() });
export function requireReviewable(plan: WeeklyPlan, timezone: string, now: string) {
  if (plan.state !== "committed" || plan.weekStartDate >= currentWeek(now, timezone)) throw new ApplicationError("CONFLICT", "Review a committed plan after its local week has fully finished.", { kind: "WEEK_UNFINISHED" });
}
export function requireReviewDraft(review: WeeklyReview, version: number) {
  if (review.version !== version) throw new ApplicationError("CONFLICT", "This weekly review changed elsewhere. Review the latest saved note and decisions.", { kind: "REVIEW_VERSION", current: review });
  if (review.status !== "draft") throw new ApplicationError("CONFLICT", "This finalized weekly review is read-only.", { kind: "REVIEW_FINALIZED", current: review });
}
export function localWeekRange(week: string, timezone: string) { return { start: localDayRange(week, timezone).start, end: localDayRange(addDays(week, 7), timezone).start }; }
export function commitmentHistory(plan: WeeklyPlan, amendments: Amendment[]) {
  const versions = [{ sequenceNumber: 0, createdAt: plan.committedAt!, commitments: effectivePlan(plan, []).commitments }, ...[...amendments].sort((a,b) => a.sequenceNumber-b.sequenceNumber)];
  const union = new Map<string, { commitment: typeof versions[0]["commitments"][0]; firstSequence: number; firstAppearance: string; firstBudgetMinutes: number; latestBudgetMinutes: number; dropped: boolean; inFinalPlan: boolean }>();
  for (const version of versions) {
    const present = new Set(version.commitments.map(c => c.id));
    for (const [id, entry] of union) { if (entry.inFinalPlan && !present.has(id)) entry.dropped = true; entry.inFinalPlan = present.has(id); }
    for (const c of version.commitments) { const entry = union.get(c.id); if (entry) { entry.latestBudgetMinutes = c.budgetMinutes; entry.inFinalPlan = true; } else union.set(c.id, { commitment: structuredClone(c), firstSequence: version.sequenceNumber, firstAppearance: version.createdAt, firstBudgetMinutes: c.budgetMinutes, latestBudgetMinutes: c.budgetMinutes, dropped: false, inFinalPlan: true }); }
  }
  return [...union.values()].sort((a,b) => a.firstSequence-b.firstSequence || a.commitment.snapshot.action.title.localeCompare(b.commitment.snapshot.action.title) || a.commitment.id.localeCompare(b.commitment.id));
}
export function dailyContext(week: string, reflections: DailyReflection[], finalizedAt: string | null) {
  return Array.from({length:7}, (_,i) => { const date = addDays(week,i), r = reflections.find(r => r.localDate === date); if (r?.status === "finalized" && (!finalizedAt || Date.parse(r.finalizedAt!) <= Date.parse(finalizedAt))) return { date, state: "finalized" as const, reflection: r }; return { date, state: !finalizedAt && r?.status === "draft" ? "unfinished" as const : "missing" as const, reflection: null }; });
}
export function deriveWeek(plan: WeeklyPlan, amendments: Amendment[], timezone: string, now: string, blocks: TimeBlock[], sessions: FocusSession[], sources: PlanningSource[], reflections: DailyReflection[], review: WeeklyReview | null) {
  const range = localWeekRange(plan.weekStartDate, timezone), effective = effectivePlan(plan, amendments);
  const commitments = commitmentHistory(plan, amendments).map(entry => {
    const ownedBlocks = blocks.filter(b => b.commitmentId === entry.commitment.id);
    const contributions = ownedBlocks.flatMap(block => sessions.filter(s => s.timeBlockId === block.id).map(session => ({ session, recordedMilliseconds: intervalMilliseconds(session.startedAt, session.endedAt ?? now, range) }))).filter(s => s.recordedMilliseconds > 0);
    return { ...entry, source: sources.find(s => s.actionId === entry.commitment.actionId) ?? null, blocks: ownedBlocks, sessions: contributions, scheduledMilliseconds: ownedBlocks.filter(b => b.state === "planned").reduce((n,b) => n + Date.parse(b.end)-Date.parse(b.start),0), recordedMilliseconds: contributions.reduce((n,s) => n+s.recordedMilliseconds,0) };
  });
  const lineage = new Set(commitments.map(c => c.commitment.id));
  const otherWork = blocks.filter(b => !lineage.has(b.commitmentId)).flatMap(block => {
    const contributions = sessions.filter(s => s.timeBlockId === block.id).map(session => ({session,recordedMilliseconds:intervalMilliseconds(session.startedAt,session.endedAt??now,range)})).filter(s => s.recordedMilliseconds > 0);
    return contributions.length ? [{block,sessions:contributions,recordedMilliseconds:contributions.reduce((n,s)=>n+s.recordedMilliseconds,0)}] : [];
  });
  return { plan, amendments, effective, timezone, range, commitments, otherWork, originalSummary: capacitySummary(plan), finalSummary: capacitySummary(effective), scheduledMilliseconds: commitments.reduce((n,c) => n+c.scheduledMilliseconds,0), recordedMilliseconds: commitments.reduce((n,c) => n+c.recordedMilliseconds,0) + otherWork.reduce((n,c)=>n+c.recordedMilliseconds,0), daily: dailyContext(plan.weekStartDate, reflections, review?.finalizedAt ?? null), review };
}
export type WeeklyFacts = ReturnType<typeof deriveWeek>;
export type ReviewWorkspace = { habit?:import("../reviews/habit").HabitProgress; weekStartDate: string; currentWeekStartDate: string; timezone: string; weeks: { id: string; weekStartDate: string }[]; state: "ready" | "uncommitted" | "unfinished"; facts: WeeklyFacts | null; analytics?: ReviewAnalytics };
export type CarryIntent = { reviewId: string; commitmentId: string; actionId: string; context: WeeklyFacts["commitments"][0]["commitment"]["snapshot"]; priorBudgetMinutes: number; proposedBudgetMinutes: number; eligible: boolean };
export function validateDecisions(plan: WeeklyPlan, amendments: Amendment[], decisions: Decision[], sources: PlanningSource[], complete: boolean) {
  const entries = commitmentHistory(plan, amendments);
  for (const d of decisions) {
    const entry = entries.find(c => c.commitment.id === d.commitmentId);
    if (!entry || entry.commitment.actionId !== d.actionId) throw new ApplicationError("NOT_FOUND", "This review commitment is unavailable.");
    const source = sources.find(s => s.actionId === d.actionId);
    if (!source?.eligible || Object.keys(d.source).some(k => d.source[k as keyof SourceGuard] !== source.source[k as keyof SourceGuard])) throw new ApplicationError("CONFLICT", "A selected Action or its parent changed. Review the latest source before saving or finishing.", { kind: "REVIEW_SOURCE" });
    const sameAction = decisions.filter(v => v.actionId === d.actionId);
    if (sameAction.some(v => v.kind !== d.kind)) throw new ApplicationError("VALIDATION", "This Action appears in multiple commitment histories. Choose the same decision for each; Drop archives the entire Action.");
  }
  if (complete && entries.some(c => sources.find(s => s.actionId === c.commitment.actionId)?.eligible && !decisions.some(d => d.commitmentId === c.commitment.id))) throw new ApplicationError("VALIDATION", "Choose Carry, Defer or Drop for every actionable commitment.", { kind: "DECISIONS_REQUIRED" });
}
