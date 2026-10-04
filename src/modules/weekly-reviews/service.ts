import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import type { Actor } from "../../domain/actor";
import { ApplicationError } from "../../domain/errors";
import { parseCommand } from "../goals/domain";
import { weekSchema, type PlanningSource, type WeeklyPlan } from "../planning/domain";
import type { Amendment } from "../amendments/domain";
import { finalizeReviewSchema, requireReviewable, requireReviewDraft, saveReviewSchema, validateDecisions, type CarryIntent, type ReviewWorkspace, type WeeklyReview } from "./domain";
export interface WeeklyReviewTransaction {
  timezone: string;
  get(id: string): Promise<WeeklyReview>;
  byPlan(id: string): Promise<WeeklyReview | null>;
  plan(id: string): Promise<WeeklyPlan>;
  history(id: string): Promise<Amendment[]>;
  sources(ids: string[]): Promise<PlanningSource[]>;
  archive(id: string, expectedVersion: number, now: string): Promise<void>;
  insert(review: WeeklyReview): Promise<WeeklyReview>;
  update(review: WeeklyReview, expectedVersion: number): Promise<WeeklyReview>;
}
export interface WeeklyReviewRepository {
  workspace(actor: Actor, now: string, week?: string): Promise<ReviewWorkspace>;
  get(actor: Actor, id: string): Promise<WeeklyReview>;
  carries(actor: Actor, week: string): Promise<CarryIntent[]>;
  execute(actor: Actor, mutationId: string, hash: string, apply: (tx: WeeklyReviewTransaction) => Promise<WeeklyReview>): Promise<WeeklyReview>;
}
const hash = (v: object) => createHash("sha256").update(JSON.stringify(v)).digest("hex");
function requireClock(review: WeeklyReview, now: string) { if (Date.parse(now) < Date.parse(review.updatedAt)) throw new ApplicationError("CONFLICT", "The server clock moved before the last save. Retry when it has recovered."); }
export function weeklyReviewService(repository: WeeklyReviewRepository, clock = () => new Date().toISOString(), newId: () => string = randomUUID) {
  return {
    workspace: (actor: Actor, week?: string) => repository.workspace(actor, clock(), week === undefined ? undefined : parseCommand(weekSchema,week)),
    get: (actor: Actor, id: string) => repository.get(actor,parseCommand(z.uuid(),id)),
    carries: (actor: Actor, week: string) => repository.carries(actor,parseCommand(weekSchema,week)),
    async save(actor: Actor, input: unknown) {
      const {mutationId,...fields} = parseCommand(saveReviewSchema,input); fields.decisions.sort((a,b) => a.commitmentId.localeCompare(b.commitmentId));
      return repository.execute(actor,mutationId,hash({kind:"weekly-review.save",...fields}),async tx => {
        const identity = fields.reviewId ? await tx.get(fields.reviewId) : null;
        if (identity && identity.planId !== fields.planId) throw new ApplicationError("CONFLICT","A weekly review cannot change its plan.");
        const plan = await tx.plan(fields.planId), now = clock(); requireReviewable(plan,tx.timezone,now);
        const current = identity ?? await tx.byPlan(plan.id);
        if (current) { requireReviewDraft(current,fields.expectedVersion); requireClock(current,now); }
        const amendments = await tx.history(plan.id), sources = await tx.sources(fields.decisions.map(d => d.actionId));
        validateDecisions(plan,amendments,fields.decisions,sources,false);
        return current ? tx.update({...current,note:fields.note,decisions:fields.decisions,version:current.version+1,updatedAt:now},current.version) : tx.insert({id:newId(),planId:plan.id,status:"draft",note:fields.note,decisions:fields.decisions,version:1,createdAt:now,updatedAt:now,finalizedAt:null});
      });
    },
    async finalize(actor: Actor, id: string, input: unknown) {
      id = parseCommand(z.uuid(),id); const {mutationId,...fields} = parseCommand(finalizeReviewSchema,input);
      return repository.execute(actor,mutationId,hash({kind:"weekly-review.finalize",id,...fields}),async tx => {
        const current = await tx.get(id), plan = await tx.plan(current.planId), now = clock();
        requireReviewDraft(current,fields.expectedVersion); requireReviewable(plan,tx.timezone,now); requireClock(current,now);
        if (!current.note.trim()) throw new ApplicationError("VALIDATION","Write and save a weekly reflection before finishing.");
        const amendments = await tx.history(plan.id);
        const ids = [...plan.commitments,...amendments.flatMap(a=>a.commitments)].map(c=>c.actionId);
        const sources = await tx.sources([...new Set(ids)]);
        validateDecisions(plan,amendments,current.decisions,sources,true);
        const drops = [...new Map(current.decisions.filter(d=>d.kind==="drop").map(d=>[d.actionId,d])).values()];
        if (drops.length && !fields.confirmArchive) throw new ApplicationError("VALIDATION","Confirm archival of the Drop Actions. Archived Actions cannot currently be restored.");
        for (const d of drops) await tx.archive(d.actionId,d.source.actionVersion,now);
        return tx.update({...current,status:"finalized",version:current.version+1,updatedAt:now,finalizedAt:now},current.version);
      });
    },
  };
}
