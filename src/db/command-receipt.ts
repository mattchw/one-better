import type { FocusCycle } from '../modules/focus-cycles/domain';
import type { WeeklyReview } from "../modules/weekly-reviews/domain";
import type { FocusSession } from "../modules/focus/domain";
import type { DailyReflection } from "../modules/reviews/domain";
import type { FocusableHoursSchedule } from "../modules/availability/domain";
import type { TimeBlock } from "../modules/scheduling/domain";
import type { Amendment } from "../modules/amendments/domain";
import { and, eq } from "drizzle-orm";
import type { Actor } from "../domain/actor";
import { ApplicationError } from "../domain/errors";
import type { WeeklyPlan } from "../modules/planning/domain";
import type { Action } from "../modules/actions/domain";
import type { Goal } from "../modules/goals/domain";
import type { Milestone } from "../modules/milestones/domain";
import type { Database } from "./connect";
import { mutationReceipt } from "./schema";
export type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];
// The existing Goal protocol, shared by Goal, Milestone, Action and Weekly Plan commands.
export async function executeReceipt<T extends FocusCycle | Goal | Milestone | Action | WeeklyPlan | Amendment | FocusableHoursSchedule | TimeBlock | FocusSession | DailyReflection | WeeklyReview>(db: Database, actor: Actor, mutationId: string, requestHash: string, apply: (tx: Transaction) => Promise<T>): Promise<T> {
  return db.transaction(async (tx) => {
    const key = and(eq(mutationReceipt.ownerId, actor.userId), eq(mutationReceipt.mutationId, mutationId));
    await tx.insert(mutationReceipt).values({ ownerId: actor.userId, mutationId, requestHash }).onConflictDoNothing();
    const [receipt] = await tx.select().from(mutationReceipt).where(key).for("update");
    if (receipt.requestHash !== requestHash) throw new ApplicationError("CONFLICT", "This command ID was already used for a different change.", { kind: "MUTATION_ID" });
    // Matching hashes bind the command/result type. Existing Goal JSON stays unchanged.
    if (receipt.result) return receipt.result as T;
    const result = await apply(tx);
    await tx.update(mutationReceipt).set({ result }).where(key);
    return result;
  });
}
