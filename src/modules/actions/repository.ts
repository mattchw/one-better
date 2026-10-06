import { and, desc, eq, isNull } from "drizzle-orm";
import type { Database } from "../../db/connect";
import { executeReceipt, type Transaction } from "../../db/command-receipt";
import { action, goal, milestone, user } from "../../db/schema";
import { ApplicationError } from "../../domain/errors";
import type { OwnedGoal } from "../goals/domain";
import type { OwnedMilestone } from "../milestones/domain";
import type { Actor } from "../../domain/actor";
import type { Action } from "./domain";
import type { OwnedAction } from "./domain";
import type { ActionRepository } from "./service";
const parent = (row: typeof goal.$inferSelect): OwnedGoal => ({ ...row, createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString(), archivedAt: row.archivedAt?.toISOString() ?? null });
const checkpoint = (row: typeof milestone.$inferSelect): OwnedMilestone => ({ ...row, createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString(), completedAt: row.completedAt?.toISOString() ?? null, archivedAt: row.archivedAt?.toISOString() ?? null });
const record = (row: typeof action.$inferSelect): OwnedAction => ({ ...row, createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString(), completedAt: row.completedAt?.toISOString() ?? null, archivedAt: row.archivedAt?.toISOString() ?? null });
async function operation<T>(apply: () => Promise<T>): Promise<T> {
  try { return await apply(); } catch (error) { if (error instanceof ApplicationError) throw error; throw new ApplicationError("DATABASE_UNAVAILABLE", "Cannot reach your actions. Your changes have not been confirmed. Please retry."); }
}
// Shared persistence for the existing Action lifecycle, including atomic Weekly Review Drop.
export async function replaceAction(tx: Transaction, actor: Actor, value: Action, expectedVersion: number): Promise<OwnedAction> {
  const [row] = await tx.update(action).set({ title: value.title, doneWhen: value.doneWhen, estimateMinutes: value.estimateMinutes, milestoneId: value.milestoneId, state: value.state, version: value.version, updatedAt: new Date(value.updatedAt), completedAt: value.completedAt ? new Date(value.completedAt) : null, archivedAt: value.archivedAt ? new Date(value.archivedAt) : null }).where(and(eq(action.ownerId, actor.userId), eq(action.id, value.id), value.goalId ? eq(action.goalId, value.goalId) : isNull(action.goalId), eq(action.version, expectedVersion), eq(action.state, "open"))).returning();
  if (!row) throw new ApplicationError("CONFLICT", "This action changed elsewhere. Review the latest saved version.", { kind: "VERSION" }); return record(row);
}
export function actionRepository(db: Database): ActionRepository {
  return {
    readOwned: (actor, id) => operation(() => db.transaction(async (tx) => {
      const [row] = await tx.select().from(goal).where(and(eq(goal.ownerId, actor.userId), eq(goal.id, id)));
      if (!row) return { goal: null, milestones: [], actions: [] };
      const checkpoints = await tx.select().from(milestone).where(and(eq(milestone.ownerId, actor.userId), eq(milestone.goalId, id))).orderBy(desc(milestone.createdAt), desc(milestone.id));
      const rows = await tx.select().from(action).where(and(eq(action.ownerId, actor.userId), eq(action.goalId, id))).orderBy(desc(action.createdAt), desc(action.id));
      return { goal: parent(row), milestones: checkpoints.map(checkpoint), actions: rows.map(record) };
    }, { isolationLevel: "repeatable read", accessMode: "read only" })),
    findOwned: (actor, id) => operation(async () => { const [row] = await db.select().from(action).where(and(eq(action.ownerId, actor.userId), eq(action.id, id))); return row ? record(row) : null; }),
    executeOwned: (actor, mutationId, requestHash, apply) => operation(() => executeReceipt(db, actor, mutationId, requestHash, async (tx) => {
      await tx.select({id:user.id}).from(user).where(eq(user.id,actor.userId)).for("no key update");
      const scoped = (id: string) => and(eq(action.ownerId, actor.userId), eq(action.id, id));
      return apply({
        async findOwned(id) { const [row] = await tx.select().from(action).where(scoped(id)); return row ? record(row) : null; },
        async findGoalForUpdate(id) { const [row] = await tx.select().from(goal).where(and(eq(goal.ownerId, actor.userId), eq(goal.id, id))).for("update"); return row ? parent(row) : null; },
        async findMilestoneForUpdate(goalId, id) { const [row] = await tx.select().from(milestone).where(and(eq(milestone.ownerId, actor.userId), eq(milestone.goalId, goalId), eq(milestone.id, id))).for("update"); return row ? checkpoint(row) : null; },
        async findForUpdate(id) { const [row] = await tx.select().from(action).where(scoped(id)).for("update"); return row ? record(row) : null; },
        async insert(value) { const [row] = await tx.insert(action).values({ ...value, ownerId: actor.userId, createdAt: new Date(value.createdAt), updatedAt: new Date(value.updatedAt), completedAt: null, archivedAt: null }).returning(); return record(row); },
        replace: (value, expectedVersion) => replaceAction(tx, actor, value, expectedVersion),
      });
    })),
  };
}
