import { createHash, randomUUID } from "node:crypto";
import type { Actor } from "../../domain/actor";
import { ApplicationError } from "../../domain/errors";
import { parseCommand } from "../goals/domain";
import { z } from "zod";
import { commitPlanSchema, createPlanSchema, currentWeek, ownedPlan, planningView, requireDraft, savePlanSchema, sourceIssues, weekSchema, capacitySummary, type OwnedPlan, type PlanningSource, type PlanningView, type WeeklyPlan, type WeekWorkspace } from "./domain";
export interface PlanTransaction {
  timezone(): Promise<string>;
  validateCarry?(proof: { reviewId: string; commitmentId: string }, plan: WeeklyPlan, selections: { actionId: string }[]): Promise<void>;
  insert(plan: WeeklyPlan): Promise<OwnedPlan>;
  findForUpdate(id: string): Promise<OwnedPlan | null>;
  lockSources(actionIds: string[]): Promise<PlanningSource[]>;
  replace(plan: WeeklyPlan, expectedVersion: number): Promise<OwnedPlan>;
}
export interface PlanRepository {
  workspace(actor: Actor, week: string | undefined, now: string): Promise<WeekWorkspace>;
  read(actor: Actor, id: string): Promise<{ plan: OwnedPlan | null; sources: PlanningSource[] }>;
  candidates(actor: Actor): Promise<PlanningSource[]>;
  executeOwned(actor: Actor, mutationId: string, hash: string, apply: (tx: PlanTransaction) => Promise<WeeklyPlan>): Promise<WeeklyPlan>;
}
const hash = (v: object) => createHash("sha256").update(JSON.stringify(v)).digest("hex");
function requireSources(selections: Parameters<typeof sourceIssues>[0], sources: PlanningSource[]) {
  const issues = sourceIssues(selections, sources);
  // Foreign and missing sources have exactly the same response, without source contents.
  if (issues.some((i) => i.kind === "UNAVAILABLE")) throw new ApplicationError("NOT_FOUND", "One or more selected Actions are unavailable.", { issues: issues.filter((i) => i.kind === "UNAVAILABLE") });
  if (issues.length) throw new ApplicationError("CONFLICT", "Review the selected commitments before continuing.", { kind: "SOURCES", issues });
}
export function planService(repository: PlanRepository, clock = () => new Date().toISOString(), newId: () => string = randomUUID) {
  return {
    async workspace(actor: Actor, week?: string) { return repository.workspace(actor, week === undefined ? undefined : parseCommand(weekSchema, week), clock()); },
    async candidates(actor: Actor) { return (await repository.candidates(actor)).filter((s) => s.eligible); },
    async get(actor: Actor, id: string): Promise<PlanningView> { const result = await repository.read(actor, parseCommand(z.uuid(), id)); return planningView(ownedPlan(result.plan, actor.userId), result.sources); },
    async create(actor: Actor, input: unknown) {
      const { mutationId, ...fields } = parseCommand(createPlanSchema, input);
      return repository.executeOwned(actor, mutationId, hash({ kind: "weekly-plan.create", ...fields }), async (tx) => {
        const timezone = await tx.timezone(); const now = clock();
        if (fields.weekStartDate < currentWeek(now, timezone)) throw new ApplicationError("VALIDATION", "New plans can only be created for the current week or a future week.", { fields: { weekStartDate: "This week has already finished." } });
        return ownedPlan(await tx.insert({ id: newId(), ...fields, timezone, state: "draft", version: 1, commitments: [], createdAt: now, updatedAt: now, committedAt: null }), actor.userId);
      });
    },
    async save(actor: Actor, id: string, input: unknown) {
      id = parseCommand(z.uuid(), id); const { mutationId, ...fields } = parseCommand(savePlanSchema, input);
      fields.commitments.sort((a, b) => a.actionId.localeCompare(b.actionId));
      return repository.executeOwned(actor, mutationId, hash({ kind: "weekly-plan.save", id, ...fields }), async (tx) => {
        const plan = ownedPlan(await tx.findForUpdate(id), actor.userId); requireDraft(plan, fields.expectedVersion);
        if (fields.carry) { if (!tx.validateCarry) throw new ApplicationError("NOT_FOUND", "This carry-forward intent is unavailable."); await tx.validateCarry(fields.carry, plan, fields.commitments); }
        const sources = await tx.lockSources(fields.commitments.map((c) => c.actionId)); requireSources(fields.commitments, sources);
        const now = clock(); const commitments = fields.commitments.map((c) => { const existing = plan.commitments.find((v) => v.actionId === c.actionId); return { ...c, id: existing?.id ?? newId(), planId: id, snapshot: null, createdAt: existing?.createdAt ?? now, updatedAt: now }; });
        return ownedPlan(await tx.replace({ ...plan, provisionalCapacityMinutes: fields.provisionalCapacityMinutes, reserveMinutes: fields.reserveMinutes, commitments, version: plan.version + 1, updatedAt: now }, plan.version), actor.userId);
      });
    },
    async commit(actor: Actor, id: string, input: unknown) {
      id = parseCommand(z.uuid(), id); const { mutationId, expectedVersion } = parseCommand(commitPlanSchema, input);
      return repository.executeOwned(actor, mutationId, hash({ kind: "weekly-plan.commit", id, expectedVersion }), async (tx) => {
        const plan = ownedPlan(await tx.findForUpdate(id), actor.userId); requireDraft(plan, expectedVersion);
        if (!plan.commitments.length) throw new ApplicationError("VALIDATION", "Choose at least one meaningful commitment before committing this week.", { kind: "EMPTY" });
        if (capacitySummary(plan).remainingMinutes < 0) throw new ApplicationError("VALIDATION", "This draft is over capacity. Reduce commitments or deliberately revise capacity/reserve before committing.", { kind: "OVER_CAPACITY" });
        const sources = await tx.lockSources(plan.commitments.map((c) => c.actionId)); requireSources(plan.commitments, sources);
        const now = clock();
        const commitments = plan.commitments.map((c) => ({ ...c, snapshot: structuredClone(sources.find((s) => s.actionId === c.actionId)!.context), updatedAt: now }));
        return ownedPlan(await tx.replace({ ...plan, commitments, state: "committed", committedAt: now, updatedAt: now, version: plan.version + 1 }, plan.version), actor.userId);
      });
    },
  };
}
