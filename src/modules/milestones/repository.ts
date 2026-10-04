import { and, desc, eq } from "drizzle-orm";
import type { Database } from "../../db/connect";
import { executeReceipt } from "../../db/command-receipt";
import { goal, milestone } from "../../db/schema";
import { ApplicationError } from "../../domain/errors";
import type { OwnedGoal } from "../goals/domain";
import type { OwnedMilestone } from "./domain";
import type { MilestoneRepository } from "./service";
const parent = (row: typeof goal.$inferSelect): OwnedGoal => ({ ...row, createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString(), archivedAt: row.archivedAt?.toISOString() ?? null });
const record = (row: typeof milestone.$inferSelect): OwnedMilestone => ({ ...row, createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString(), completedAt: row.completedAt?.toISOString() ?? null, archivedAt: row.archivedAt?.toISOString() ?? null });
async function operation<T>(apply: () => Promise<T>): Promise<T> {
  try { return await apply(); } catch (error) {
    if (error instanceof ApplicationError) throw error;
    throw new ApplicationError("DATABASE_UNAVAILABLE", "Cannot reach your milestones. Your changes have not been confirmed. Please retry.");
  }
}
export function milestoneRepository(db: Database): MilestoneRepository {
  return {
    findGoalOwned: (actor, id) => operation(async () => { const [row] = await db.select().from(goal).where(and(eq(goal.ownerId, actor.userId), eq(goal.id, id))); return row ? parent(row) : null; }),
    listOwned: (actor, id) => operation(async () => (await db.select().from(milestone).where(and(eq(milestone.ownerId, actor.userId), eq(milestone.goalId, id))).orderBy(desc(milestone.createdAt), desc(milestone.id))).map(record)),
    findOwned: (actor, id) => operation(async () => { const [row] = await db.select().from(milestone).where(and(eq(milestone.ownerId, actor.userId), eq(milestone.id, id))); return row ? record(row) : null; }),
    executeOwned: (actor, mutationId, requestHash, apply) => operation(() => executeReceipt(db, actor, mutationId, requestHash, async (tx) => {
      const scoped = (id: string) => and(eq(milestone.ownerId, actor.userId), eq(milestone.id, id));
      return apply({
        async findOwned(id) { const [row] = await tx.select().from(milestone).where(scoped(id)); return row ? record(row) : null; },
        async findGoalForUpdate(id) { const [row] = await tx.select().from(goal).where(and(eq(goal.ownerId, actor.userId), eq(goal.id, id))).for("update"); return row ? parent(row) : null; },
        async findForUpdate(id) { const [row] = await tx.select().from(milestone).where(scoped(id)).for("update"); return row ? record(row) : null; },
        async insert(value) { const [row] = await tx.insert(milestone).values({ ...value, ownerId: actor.userId, createdAt: new Date(value.createdAt), updatedAt: new Date(value.updatedAt), completedAt: null, archivedAt: null }).returning(); return record(row); },
        async replace(value, expectedVersion) {
          const [row] = await tx.update(milestone).set({ title: value.title, successCondition: value.successCondition, state: value.state, version: value.version, updatedAt: new Date(value.updatedAt), completedAt: value.completedAt ? new Date(value.completedAt) : null, archivedAt: value.archivedAt ? new Date(value.archivedAt) : null, evidence: value.evidence })
            .where(and(scoped(value.id), eq(milestone.goalId, value.goalId), eq(milestone.version, expectedVersion), eq(milestone.state, "active"))).returning();
          if (!row) throw new ApplicationError("CONFLICT", "This milestone changed elsewhere. Review the latest saved version.", { kind: "VERSION" });
          return record(row);
        },
      });
    })),
  };
}
