import { and, desc, eq, isNotNull, isNull } from "drizzle-orm";
import type { Database } from "../../db/connect";
import { executeReceipt } from "../../db/command-receipt";
import { goal } from "../../db/schema";
import { ApplicationError } from "../../domain/errors";
import type { OwnedGoal } from "./domain";
import type { GoalRepository } from "./service";

function record(row: typeof goal.$inferSelect): OwnedGoal {
  return { ...row, createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString(), archivedAt: row.archivedAt?.toISOString() ?? null };
}
async function databaseOperation<T>(operation: () => Promise<T>): Promise<T> {
  try { return await operation(); }
  catch (error) {
    if (error instanceof ApplicationError) throw error;
    throw new ApplicationError("DATABASE_UNAVAILABLE", "Cannot reach your goals. Your changes have not been confirmed. Please retry.");
  }
}
export function goalRepository(db: Database): GoalRepository {
  return {
    listOwned: (actor, status) => databaseOperation(async () => (await db.select().from(goal)
      .where(and(eq(goal.ownerId, actor.userId), status === "active" ? isNull(goal.archivedAt) : isNotNull(goal.archivedAt)))
      .orderBy(desc(goal.createdAt), desc(goal.id))).map(record)),
    findOwned: (actor, id) => databaseOperation(async () => {
      const [row] = await db.select().from(goal).where(and(eq(goal.ownerId, actor.userId), eq(goal.id, id))).limit(1);
      return row ? record(row) : null;
    }),
    executeOwned: (actor, mutationId, requestHash, apply) => databaseOperation(() => executeReceipt(db, actor, mutationId, requestHash, async (tx) => {
      const scoped = (id: string) => and(eq(goal.ownerId, actor.userId), eq(goal.id, id));
      const result = await apply({
        async findForUpdate(id) {
          const [row] = await tx.select().from(goal).where(scoped(id)).for("update");
          return row ? record(row) : null;
        },
        async insert(value) {
          const [row] = await tx.insert(goal).values({ ...value, ownerId: actor.userId, createdAt: new Date(value.createdAt), updatedAt: new Date(value.updatedAt), archivedAt: null }).returning();
          return record(row);
        },
        async replace(value, expectedVersion) {
          const [row] = await tx.update(goal).set({ title: value.title, outcome: value.outcome, version: value.version, updatedAt: new Date(value.updatedAt), archivedAt: value.archivedAt ? new Date(value.archivedAt) : null })
            .where(and(scoped(value.id), eq(goal.version, expectedVersion), isNull(goal.archivedAt))).returning();
          if (!row) throw new ApplicationError("CONFLICT", "This goal changed elsewhere. Review the latest saved version.", { kind: "VERSION" });
          return record(row);
        },
      });
      return result;
    })),
  };
}
