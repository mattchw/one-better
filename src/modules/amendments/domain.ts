import { z } from "zod";
import { ApplicationError } from "../../domain/errors";
import { boundedText } from "../goals/domain";
import { capacitySummary, currentWeek, sourceGuardSchema, type WeeklyPlan, type PlanningSnapshot, type SourceGuard } from "../planning/domain";
export type AmendmentCommitment = { id: string; actionId: string; budgetMinutes: number; source: SourceGuard; snapshot: PlanningSnapshot };
export type EffectivePlan = { provisionalCapacityMinutes: number; reserveMinutes: number; commitments: AmendmentCommitment[] };
export type Amendment = EffectivePlan & { id: string; planId: string; sequenceNumber: number; reason: string; version: number; createdAt: string };
export type AmendmentHistory = { baseline: WeeklyPlan; amendments: Amendment[]; effective: EffectivePlan; canAmend: boolean };
export const amendSchema = z.object({ mutationId: z.uuid(), expectedVersion: z.number().int().min(1).max(2147483646), reason: boundedText("Reason", 500), provisionalCapacityMinutes: z.number().int().min(0).max(10080), reserveMinutes: z.number().int().min(0).max(10079), commitments: z.array(z.object({ actionId: z.uuid(), budgetMinutes: z.number().int().min(1).max(10080), source: sourceGuardSchema.optional() }).strict()).max(50) }).strict().refine(v => v.provisionalCapacityMinutes === 0 ? v.reserveMinutes === 0 && v.commitments.length === 0 : v.reserveMinutes < v.provisionalCapacityMinutes, { message: "Reserve must be less than capacity. Zero capacity requires zero reserve and no commitments.", path: ["reserveMinutes"] }).refine(v => new Set(v.commitments.map(c => c.actionId)).size === v.commitments.length, { message: "Choose each Action only once.", path: ["commitments"] });
export function effectivePlan(baseline: WeeklyPlan, amendments: Amendment[]): EffectivePlan {
  const latest = amendments.reduce<Amendment | null>((last, a) => !last || a.sequenceNumber > last.sequenceNumber ? a : last, null);
  return structuredClone(latest ? { provisionalCapacityMinutes: latest.provisionalCapacityMinutes, reserveMinutes: latest.reserveMinutes, commitments: latest.commitments } : { provisionalCapacityMinutes: baseline.provisionalCapacityMinutes, reserveMinutes: baseline.reserveMinutes, commitments: baseline.commitments.map(c => {
    if (!c.snapshot) throw new ApplicationError("CONFLICT", "Commit the original plan before amending it.");
    return { id: c.id, actionId: c.actionId, budgetMinutes: c.budgetMinutes, source: c.source, snapshot: c.snapshot };
  }) });
}
export function planDifference(previous: EffectivePlan, next: EffectivePlan) {
  const ordered = (v: AmendmentCommitment[]) => [...v].sort((a, b) => a.actionId.localeCompare(b.actionId));
  const added = ordered(next.commitments.filter(c => !previous.commitments.some(p => p.actionId === c.actionId)));
  const dropped = ordered(previous.commitments.filter(c => !next.commitments.some(n => n.actionId === c.actionId)));
  const budgets = ordered(next.commitments).flatMap(c => { const p = previous.commitments.find(p => p.actionId === c.actionId); return p && p.budgetMinutes !== c.budgetMinutes ? [{ actionId: c.actionId, title: p.snapshot.action.title, previous: p.budgetMinutes, next: c.budgetMinutes }] : []; });
  const capacity = previous.provisionalCapacityMinutes === next.provisionalCapacityMinutes ? null : { previous: previous.provisionalCapacityMinutes, next: next.provisionalCapacityMinutes };
  const reserve = previous.reserveMinutes === next.reserveMinutes ? null : { previous: previous.reserveMinutes, next: next.reserveMinutes };
  return { capacity, reserve, added, dropped, budgets, changed: !!capacity || !!reserve || !!added.length || !!dropped.length || !!budgets.length, previousSummary: capacitySummary(previous), nextSummary: capacitySummary(next) };
}
export function canAmend(plan: WeeklyPlan, now: string, userTimezone: string) { return plan.state === "committed" && plan.weekStartDate >= currentWeek(now, userTimezone); }
export function amendmentHistory(baseline: WeeklyPlan, amendments: Amendment[], now: string, timezone: string): AmendmentHistory { return { baseline, amendments: [...amendments].sort((a,b) => a.sequenceNumber - b.sequenceNumber), effective: effectivePlan(baseline, amendments), canAmend: canAmend(baseline, now, timezone) }; }
