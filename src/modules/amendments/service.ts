import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import type { Actor } from "../../domain/actor";
import { ApplicationError } from "../../domain/errors";
import { parseCommand } from "../goals/domain";
import { capacitySummary, ownedPlan, sourceIssues, type OwnedPlan, type PlanningSource } from "../planning/domain";
import { amendSchema, canAmend, effectivePlan, planDifference, type Amendment, type AmendmentHistory } from "./domain";
export interface AmendmentTransaction {
  timezone(): Promise<string>;
  findForUpdate(id: string): Promise<OwnedPlan | null>;
  history(id: string): Promise<Amendment[]>;
  lockSources(ids: string[]): Promise<PlanningSource[]>;
  append(amendment: Amendment, expectedVersion: number): Promise<Amendment>;
}
export interface AmendmentRepository {
  read(actor: Actor, id: string, now: string): Promise<AmendmentHistory>;
  get(actor: Actor, id: string): Promise<Amendment>;
  executeOwned(actor: Actor, mutationId: string, hash: string, apply: (tx: AmendmentTransaction) => Promise<Amendment>): Promise<Amendment>;
}
export function amendmentService(repository: AmendmentRepository, clock = () => new Date().toISOString(), newId = randomUUID) {
  return {
    history: (actor: Actor, id: string) => repository.read(actor, parseCommand(z.uuid(), id), clock()),
    get: (actor: Actor, id: string) => repository.get(actor, parseCommand(z.uuid(), id)),
    async confirm(actor: Actor, id: string, input: unknown) {
      id = parseCommand(z.uuid(), id); const { mutationId, ...fields } = parseCommand(amendSchema, input);
      fields.commitments.sort((a,b) => a.actionId.localeCompare(b.actionId));
      const hash = createHash("sha256").update(JSON.stringify({ kind: "weekly-plan.amend", id, ...fields })).digest("hex");
      return repository.executeOwned(actor, mutationId, hash, async tx => {
        const baseline = ownedPlan(await tx.findForUpdate(id), actor.userId);
        if (baseline.version !== fields.expectedVersion) throw new ApplicationError("CONFLICT", "The Current Plan changed elsewhere. Review it and start again before confirming.", { kind: "EFFECTIVE_VERSION" });
        const now = clock();
        if (!canAmend(baseline, now, await tx.timezone())) throw new ApplicationError("CONFLICT", "Only current or future committed weeks can be amended.", { kind: "READ_ONLY_WEEK" });
        const amendments = await tx.history(id); const previous = effectivePlan(baseline, amendments);
        const additions = fields.commitments.filter(c => !previous.commitments.some(p => p.actionId === c.actionId));
        if (additions.some(c => !c.source) || fields.commitments.some(c => c.source && previous.commitments.some(p => p.actionId === c.actionId))) throw new ApplicationError("VALIDATION", "Only newly added Actions require reviewed source data.");
        const sources = await tx.lockSources(additions.map(c => c.actionId));
        const issues = sourceIssues(additions.map(c => ({ actionId: c.actionId, source: c.source! })), sources);
        if (issues.some(i => i.kind === "UNAVAILABLE")) throw new ApplicationError("NOT_FOUND", "One or more selected Actions are unavailable.");
        if (issues.length) throw new ApplicationError("CONFLICT", "A newly added Action changed or is no longer eligible. Remove it and review the current eligible Actions before adding it again.", { kind: "SOURCES", issues });
        const commitments = fields.commitments.map(c => {
          const existing = previous.commitments.find(p => p.actionId === c.actionId);
          if (existing) return { ...structuredClone(existing), budgetMinutes: c.budgetMinutes };
          const source = sources.find(s => s.actionId === c.actionId)!;
          return { id: newId(), actionId: c.actionId, budgetMinutes: c.budgetMinutes, source: structuredClone(source.source), snapshot: structuredClone(source.context) };
        });
        const next = { provisionalCapacityMinutes: fields.provisionalCapacityMinutes, reserveMinutes: fields.reserveMinutes, commitments };
        if (capacitySummary(next).remainingMinutes < 0) throw new ApplicationError("VALIDATION", "This amendment is over capacity. Explicitly adjust budgets, capacity or reserve.", { kind: "OVER_CAPACITY" });
        if (!planDifference(previous, next).changed) throw new ApplicationError("VALIDATION", "Change a planning decision before confirming. A reason alone is not an amendment.", { kind: "NO_CHANGE" });
        return tx.append({ ...next, id: newId(), planId: id, sequenceNumber: (amendments.at(-1)?.sequenceNumber ?? 0) + 1, reason: fields.reason, version: baseline.version + 1, createdAt: now }, baseline.version);
      });
    },
  };
}
