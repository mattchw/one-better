import { createHash, randomUUID } from "node:crypto";
import type { Actor } from "../../domain/actor";
import { ApplicationError } from "../../domain/errors";
import { parseCommand } from "../goals/domain";
import { reserveForBudget } from "../availability/domain";
import { z } from "zod";
import { firstTaskSchema, quickCommitSchema, commitPlanSchema, createPlanSchema, currentWeek, ownedPlan, planningView, requireDraft, savePlanSchema, sourceIssues, weekSchema, capacitySummary, type OwnedPlan, type PlanningSource, type PlanningView, type WeeklyPlan, type WeekWorkspace } from "./domain";
export interface PlanTransaction {
  firstTaskSource?(title: string, minutes: number, now: string, goal?: { id: string; version: number }): Promise<PlanningSource>;
  timezone(): Promise<string>;
  sparePercent?(): Promise<number>;
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
    async firstTask(actor: Actor, input: unknown) {
      const { mutationId, ...fields } = parseCommand(firstTaskSchema, input);
      return repository.executeOwned(actor, mutationId, hash({ kind: "weekly-plan.first-task", ...fields }), async tx => {
        if (!tx.firstTaskSource) throw new ApplicationError("DATABASE_UNAVAILABLE", "Your first task could not be confirmed. Please retry.");
        const now = clock();
        // This owned source creation locks the account before the Plan, matching
        // local schedule writers. Any later validation failure rolls it all back.
        const source = await tx.firstTaskSource(fields.title, fields.budgetMinutes, now, fields.goal);
        const existing = fields.planId ? ownedPlan(await tx.findForUpdate(fields.planId), actor.userId) : null;
        if (existing) {
          requireDraft(existing, fields.expectedVersion!);
          if (existing.weekStartDate !== fields.weekStartDate || existing.commitments.length) throw new ApplicationError("CONFLICT", "This week already has choices. Reload it before adding work.");
        }
        const timezone = existing?.timezone ?? await tx.timezone();
        if (fields.weekStartDate < currentWeek(now, timezone)) throw new ApplicationError("VALIDATION", "Add work to the current week or a future week.");
        // A small first plan commits only the requested task, with 25% reserve.
        const reserve = reserveForBudget(fields.budgetMinutes, await tx.sparePercent?.() ?? 25);
        let plan = existing ?? ownedPlan(await tx.insert({ id: newId(), weekStartDate: fields.weekStartDate, timezone,
          provisionalCapacityMinutes: fields.budgetMinutes + reserve, reserveMinutes: reserve, state: "draft", version: 1,
          commitments: [], createdAt: now, updatedAt: now, committedAt: null }), actor.userId);
        // An empty onboarding draft has no commitments to displace. Selecting
        // the first task's duration establishes its provisional budget; it does
        // not assert that Calendar-open time exists or bypass placement checks.
        if (plan.provisionalCapacityMinutes - plan.reserveMinutes < fields.budgetMinutes) {
          const adjustedReserve = Math.min(Math.max(plan.reserveMinutes, reserve), 10080 - fields.budgetMinutes);
          plan = { ...plan, reserveMinutes: adjustedReserve, provisionalCapacityMinutes: fields.budgetMinutes + adjustedReserve };
        }
        const commitment = { id: newId(), planId: plan.id, actionId: source.actionId, budgetMinutes: fields.budgetMinutes,
          source: source.source, snapshot: structuredClone(source.context), createdAt: now, updatedAt: now };
        return ownedPlan(await tx.replace({ ...plan, commitments: [commitment], state: "committed", version: plan.version + 1,
          committedAt: now, updatedAt: now }, plan.version), actor.userId);
      });
    },
    async quickCommit(actor: Actor, input: unknown) {
      const { mutationId, ...fields } = parseCommand(quickCommitSchema, input);
      fields.commitments.sort((a, b) => a.actionId.localeCompare(b.actionId));
      return repository.executeOwned(actor, mutationId, hash({ kind: "weekly-plan.quick-commit", ...fields }), async tx => {
        const now = clock();
        const existing = fields.planId ? ownedPlan(await tx.findForUpdate(fields.planId), actor.userId) : null;
        if (existing) {
          requireDraft(existing, fields.expectedVersion!);
          if (existing.weekStartDate !== fields.weekStartDate) throw new ApplicationError("CONFLICT", "Review the selected week again.");
        }
        const timezone = existing?.timezone ?? await tx.timezone();
        if (fields.weekStartDate < currentWeek(now, timezone)) throw new ApplicationError("VALIDATION", "Plan the current week or a future week.");
        const total = fields.commitments.reduce((n,c)=>n+c.budgetMinutes,0);
        if(total>10080)throw new ApplicationError('VALIDATION','Choose less than one week of task time.');
        const reserveMinutes = fields.reserveMinutes ?? Math.min(reserveForBudget(total,await tx.sparePercent?.() ?? 25),10080-total);
        const provisionalCapacityMinutes = fields.provisionalCapacityMinutes ?? total+reserveMinutes;
        if (capacitySummary({...fields,provisionalCapacityMinutes,reserveMinutes}).remainingMinutes < 0) throw new ApplicationError("VALIDATION", "Your choices exceed the focus time to commit.", { kind: "OVER_CAPACITY" });
        const sources = await tx.lockSources(fields.commitments.map(c => c.actionId));
        requireSources(fields.commitments, sources);
        // All work and the receipt share one transaction. No empty draft or partial
        // selection is left behind if source validation or baseline insertion fails.
        const plan = existing ?? ownedPlan(await tx.insert({ id: newId(), weekStartDate: fields.weekStartDate,
          timezone, state: "draft", version: 1, commitments: [],
          reserveMinutes, createdAt: now, updatedAt: now, committedAt: null, provisionalCapacityMinutes }), actor.userId);
        const commitments = fields.commitments.map(c => {
          const previous = plan.commitments.find(v => v.actionId === c.actionId);
          return { ...c, id: previous?.id ?? newId(), planId: plan.id, createdAt: previous?.createdAt ?? now, updatedAt: now,
            snapshot: structuredClone(sources.find(v => v.actionId === c.actionId)!.context) };
        });
        return ownedPlan(await tx.replace({ ...plan, commitments, provisionalCapacityMinutes,
          reserveMinutes, state: "committed", committedAt: now, updatedAt: now, version: plan.version + 1 }, plan.version), actor.userId);
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
