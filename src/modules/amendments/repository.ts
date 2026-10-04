import { and, asc, eq } from "drizzle-orm";
import type { Database } from "../../db/connect";
import { executeReceipt, type Transaction } from "../../db/command-receipt";
import { amendmentCommitment, weeklyPlanAmendment, weeklyPlan, commitmentIdentity } from "../../db/schema";
import type { Actor } from "../../domain/actor";
import { ApplicationError } from "../../domain/errors";
import { ownedPlan } from "../planning/domain";
import { lockSources, operation, readPlan, timezone } from "../planning/repository";
import { amendmentHistory, type Amendment } from "./domain";
import type { AmendmentRepository } from "./service";
async function readAmendment(tx: Transaction, actor: Actor, row: typeof weeklyPlanAmendment.$inferSelect): Promise<Amendment> {
  const { ownerId: _owner, ...record } = row; void _owner;
  const rows = await tx.select().from(amendmentCommitment).where(and(eq(amendmentCommitment.ownerId, actor.userId), eq(amendmentCommitment.amendmentId, row.id))).orderBy(asc(amendmentCommitment.actionId));
  return { ...record, createdAt: row.createdAt.toISOString(), commitments: rows.map(({ ownerId: _owner, amendmentId: _parent, ...c }) => { void _owner; void _parent; return c; }) };
}
export async function history(tx: Transaction, actor: Actor, id: string) {
  const rows = await tx.select().from(weeklyPlanAmendment).where(and(eq(weeklyPlanAmendment.ownerId, actor.userId), eq(weeklyPlanAmendment.planId, id))).orderBy(asc(weeklyPlanAmendment.sequenceNumber));
  const result: Amendment[] = []; for (const row of rows) result.push(await readAmendment(tx, actor, row)); return result;
}
export function amendmentRepository(db: Database): AmendmentRepository {
  return {
    read: (actor, id, now) => operation(() => db.transaction(async tx => {
      const [row] = await tx.select().from(weeklyPlan).where(and(eq(weeklyPlan.ownerId, actor.userId), eq(weeklyPlan.id, id)));
      const plan = ownedPlan(row ? await readPlan(tx, actor, row) : null, actor.userId);
      if (plan.state !== "committed") throw new ApplicationError("CONFLICT", "Commit the original plan before amending it.");
      return amendmentHistory(plan, await history(tx, actor, id), now, await timezone(tx, actor));
    }, { isolationLevel: "repeatable read", accessMode: "read only" })),
    get: (actor, id) => operation(() => db.transaction(async tx => {
      const [row] = await tx.select().from(weeklyPlanAmendment).where(and(eq(weeklyPlanAmendment.ownerId, actor.userId), eq(weeklyPlanAmendment.id, id)));
      if (!row) throw new ApplicationError("NOT_FOUND", "This amendment is unavailable."); return readAmendment(tx, actor, row);
    }, { isolationLevel: "repeatable read", accessMode: "read only" })),
    executeOwned: (actor, mutationId, hash, apply) => operation(() => executeReceipt(db, actor, mutationId, hash, tx => apply({
      timezone: () => timezone(tx, actor),
      findForUpdate: async id => {
        const [row] = await tx.select().from(weeklyPlan).where(and(eq(weeklyPlan.ownerId, actor.userId), eq(weeklyPlan.id, id))).for("update");
        return row ? readPlan(tx, actor, row) : null;
      },
      history: id => history(tx, actor, id), lockSources: ids => lockSources(tx, actor, ids),
      append: async (amendment, expectedVersion) => {
        // Content and baseline timestamps never change. Only concurrency metadata advances.
        const [row] = await tx.update(weeklyPlan).set({ version: amendment.version }).where(and(eq(weeklyPlan.ownerId, actor.userId), eq(weeklyPlan.id, amendment.planId), eq(weeklyPlan.version, expectedVersion), eq(weeklyPlan.state, "committed"))).returning();
        if (!row) throw new ApplicationError("CONFLICT", "The Current Plan changed elsewhere. Review it before confirming.", { kind: "EFFECTIVE_VERSION" });
        const { commitments, ...record } = amendment;
        await tx.insert(weeklyPlanAmendment).values({ ...record, ownerId: actor.userId, createdAt: new Date(record.createdAt) });
        if (commitments.length) await tx.insert(amendmentCommitment).values(commitments.map(c => ({ ...c, amendmentId: amendment.id, ownerId: actor.userId })));
        if (commitments.length) await tx.insert(commitmentIdentity).values(commitments.map(c=>({id:c.id,ownerId:actor.userId,planId:amendment.planId}))).onConflictDoNothing();
        return readAmendment(tx, actor, { ...record, ownerId: actor.userId, createdAt: new Date(record.createdAt) });
      },
    }))),
  };
}
