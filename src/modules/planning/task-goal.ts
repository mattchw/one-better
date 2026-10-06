import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import type { Transaction } from '../../db/command-receipt';
import { goal } from '../../db/schema';
import type { Actor } from '../../domain/actor';
import { ownedGoal, requireMutable } from '../goals/domain';

export const taskGoalSchema = z.strictObject({ id: z.uuid(), version: z.number().int().min(1).max(2147483646) });
export type TaskGoal = z.infer<typeof taskGoalSchema>;

// Call inside the task transaction, after locking the account. Goal selection
// is owner scoped and version checked; a failed add leaves no orphan Action.
export async function taskGoal(tx: Transaction, actor: Actor, now: string, selected?: TaskGoal) {
  if (selected) {
    const [parent] = await tx.select().from(goal).where(and(eq(goal.ownerId, actor.userId), eq(goal.id, selected.id))).for('update');
    const value = ownedGoal(parent ? { ...parent, createdAt: parent.createdAt.toISOString(), updatedAt: parent.updatedAt.toISOString(), archivedAt: parent.archivedAt?.toISOString() ?? null } : null, actor.userId);
    requireMutable(value, selected.version);
    return parent;
  }
  return null;
}
