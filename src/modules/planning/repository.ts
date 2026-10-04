import { and, asc, desc, eq, inArray } from "drizzle-orm";
import type { Database } from "../../db/connect";
import { executeReceipt, type Transaction } from "../../db/command-receipt";
import { action, goal, milestone, user, weeklyCommitment, weeklyPlan, commitmentIdentity, weeklyReview, weeklyReviewDecision } from "../../db/schema";
import type { Actor } from "../../domain/actor";
import { ApplicationError } from "../../domain/errors";
import { timezoneSchema } from "../../domain/timezone";
import { addDays, currentWeek, planningSource, planningView, ownedPlan, type OwnedPlan, type PlanningSource, type WeeklyPlan } from "./domain";
import type { PlanRepository } from "./service";
const instantFields = <T extends { createdAt: Date; updatedAt: Date }>(row: T) => ({ ...row, createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString() });
export async function operation<T>(apply: () => Promise<T>): Promise<T> {
  try { return await apply(); } catch (error) { if (error instanceof ApplicationError) throw error; throw new ApplicationError("DATABASE_UNAVAILABLE", "Cannot reach your weekly plans. Your changes have not been confirmed. Please retry."); }
}
export async function timezone(tx: Transaction, actor: Actor) {
  const [row] = await tx.select({ timezone: user.timezone }).from(user).where(eq(user.id, actor.userId));
  if (!row) throw new ApplicationError("UNAUTHENTICATED", "Sign in again to continue."); return timezoneSchema.parse(row.timezone);
}
export async function readPlan(tx: Transaction, actor: Actor, row: typeof weeklyPlan.$inferSelect): Promise<OwnedPlan> {
  const rows = await tx.select().from(weeklyCommitment).where(and(eq(weeklyCommitment.ownerId, actor.userId), eq(weeklyCommitment.planId, row.id))).orderBy(asc(weeklyCommitment.actionId));
  return { ...instantFields(row), committedAt: row.committedAt?.toISOString() ?? null, commitments: rows.map((r) => { const { ownerId: _owner, ...value } = instantFields(r); void _owner; return value; }) };
}
export async function sources(tx: Transaction, actor: Actor, ids?: string[]): Promise<PlanningSource[]> {
  if (ids && !ids.length) return [];
  const rows = await tx.select({ a: action, g: goal, m: milestone }).from(action)
    .innerJoin(goal, and(eq(goal.id, action.goalId), eq(goal.ownerId, action.ownerId)))
    .leftJoin(milestone, and(eq(milestone.id, action.milestoneId), eq(milestone.ownerId, action.ownerId), eq(milestone.goalId, action.goalId)))
    .where(and(eq(action.ownerId, actor.userId), ids ? inArray(action.id, ids) : undefined)).orderBy(asc(goal.title), asc(action.title), asc(action.id));
  return rows.map(({ a, g, m }) => planningSource(
    { ...instantFields(a), completedAt: a.completedAt?.toISOString() ?? null, archivedAt: a.archivedAt?.toISOString() ?? null },
    { ...instantFields(g), archivedAt: g.archivedAt?.toISOString() ?? null },
    m ? { ...instantFields(m), completedAt: m.completedAt?.toISOString() ?? null, archivedAt: m.archivedAt?.toISOString() ?? null } : null,
  ));
}
// Existing source writers lock Goal -> sorted Milestones -> Action. Holding sorted
// Goals stabilizes Action associations; Plan locks never occur in source writers.
export async function lockSources(tx: Transaction, actor: Actor, ids: string[]) {
  if (!ids.length) return [];
  const scope = and(eq(action.ownerId, actor.userId), inArray(action.id, ids));
  const discovered = await tx.select({ goalId: action.goalId }).from(action).where(scope);
  const goalIds = [...new Set(discovered.map((a) => a.goalId))].sort();
  if (goalIds.length) await tx.select().from(goal).where(and(eq(goal.ownerId, actor.userId), inArray(goal.id, goalIds))).orderBy(asc(goal.id)).for("update");
  const current = await tx.select({ milestoneId: action.milestoneId }).from(action).where(scope);
  const milestoneIds = [...new Set(current.flatMap((a) => a.milestoneId ? [a.milestoneId] : []))].sort();
  if (milestoneIds.length) await tx.select().from(milestone).where(and(eq(milestone.ownerId, actor.userId), inArray(milestone.id, milestoneIds))).orderBy(asc(milestone.id)).for("update");
  await tx.select().from(action).where(scope).orderBy(asc(action.id)).for("update");
  return sources(tx, actor, ids);
}
export function planRepository(db: Database): PlanRepository {
  return {
    workspace: (actor, week, now) => operation(() => db.transaction(async (tx) => {
      const zone = await timezone(tx, actor); const current = currentWeek(now, zone); const selected = week ?? current;
      const all = await tx.select().from(weeklyPlan).where(eq(weeklyPlan.ownerId, actor.userId)).orderBy(desc(weeklyPlan.weekStartDate));
      const row = all.find((r) => r.weekStartDate === selected);
      const plan = row ? ownedPlan(await readPlan(tx, actor, row), actor.userId) : null;
      const context = plan?.state === "draft" ? await sources(tx, actor, plan.commitments.map((c) => c.actionId)) : [];
      return { weekStartDate: selected, currentWeekStartDate: current, timezone: plan?.timezone ?? zone, canCreate: selected >= current, view: plan ? planningView(plan, context) : null, savedWeeks: all.map(({ id, weekStartDate, state }) => ({ id, weekStartDate, state })) };
    }, { isolationLevel: "repeatable read", accessMode: "read only" })),
    read: (actor, id) => operation(() => db.transaction(async (tx) => {
      const [row] = await tx.select().from(weeklyPlan).where(and(eq(weeklyPlan.ownerId, actor.userId), eq(weeklyPlan.id, id)));
      const plan = row ? await readPlan(tx, actor, row) : null;
      return { plan, sources: plan?.state === "draft" ? await sources(tx, actor, plan.commitments.map((c) => c.actionId)) : [] };
    }, { isolationLevel: "repeatable read", accessMode: "read only" })),
    candidates: (actor) => operation(() => db.transaction((tx) => sources(tx, actor), { isolationLevel: "repeatable read", accessMode: "read only" })),
    executeOwned: (actor, mutationId, requestHash, apply) => operation(() => executeReceipt(db, actor, mutationId, requestHash, (tx) => apply({
      timezone: () => timezone(tx, actor),
      async insert(value) {
        const { commitments: _rows, ...record } = value; void _rows;
        const [row] = await tx.insert(weeklyPlan).values({ ...record, ownerId: actor.userId, createdAt: new Date(value.createdAt), updatedAt: new Date(value.updatedAt), committedAt: null }).onConflictDoNothing().returning();
        if (!row) throw new ApplicationError("CONFLICT", "A plan already exists for this week. Open its saved draft or baseline.", { kind: "WEEK_EXISTS" });
        return readPlan(tx, actor, row);
      },
      async findForUpdate(id) {
        const [row] = await tx.select().from(weeklyPlan).where(and(eq(weeklyPlan.ownerId, actor.userId), eq(weeklyPlan.id, id))).for("update");
        return row ? readPlan(tx, actor, row) : null;
      },
      async validateCarry(proof, plan, selections) {
        const [result] = await tx.select({decision:weeklyReviewDecision, prior:weeklyPlan}).from(weeklyReviewDecision)
          .innerJoin(weeklyReview,and(eq(weeklyReview.id,weeklyReviewDecision.reviewId),eq(weeklyReview.ownerId,weeklyReviewDecision.ownerId)))
          .innerJoin(weeklyPlan,and(eq(weeklyPlan.id,weeklyReview.planId),eq(weeklyPlan.ownerId,weeklyReview.ownerId)))
          .where(and(eq(weeklyReviewDecision.ownerId,actor.userId),eq(weeklyReviewDecision.reviewId,proof.reviewId),eq(weeklyReviewDecision.commitmentId,proof.commitmentId),eq(weeklyReviewDecision.kind,"carry"),eq(weeklyReview.status,"finalized")));
        if(!result)throw new ApplicationError("NOT_FOUND","This carry-forward intent is unavailable.");
        if(addDays(result.prior.weekStartDate,7)!==plan.weekStartDate||!selections.some(s=>s.actionId===result.decision.actionId))throw new ApplicationError("VALIDATION","Apply this Carry intent only to its following week's plan.");
        if(plan.commitments.some(c=>c.actionId===result.decision.actionId))throw new ApplicationError("CONFLICT","This Action is already included in this week's plan.",{kind:"ALREADY_INCLUDED"});
      },
      lockSources: (ids) => lockSources(tx, actor, ids),
      async replace(value: WeeklyPlan, expectedVersion: number) {
        const scope = and(eq(weeklyPlan.ownerId, actor.userId), eq(weeklyPlan.id, value.id), eq(weeklyPlan.version, expectedVersion), eq(weeklyPlan.state, "draft"));
        const [row] = await tx.update(weeklyPlan).set({ provisionalCapacityMinutes: value.provisionalCapacityMinutes, reserveMinutes: value.reserveMinutes, state: value.state, version: value.version, updatedAt: new Date(value.updatedAt), committedAt: value.committedAt ? new Date(value.committedAt) : null }).where(scope).returning();
        if (!row) throw new ApplicationError("CONFLICT", "This plan changed elsewhere. Review its latest saved version.", { kind: "VERSION" });
        // Aggregate replacement happens only after the locked Draft/version check.
        // Transaction rollback covers all rows and the receipt on any failure.
        const rowScope = and(eq(weeklyCommitment.ownerId, actor.userId), eq(weeklyCommitment.planId, value.id));
        await tx.delete(weeklyCommitment).where(rowScope);
        if (value.commitments.length) await tx.insert(weeklyCommitment).values(value.commitments.map((c) => ({ ...c, ownerId: actor.userId, createdAt: new Date(c.createdAt), updatedAt: new Date(c.updatedAt) })));
        if (value.state === "committed" && value.commitments.length) await tx.insert(commitmentIdentity).values(value.commitments.map(c=>({id:c.id,ownerId:actor.userId,planId:value.id}))).onConflictDoNothing();
        return readPlan(tx, actor, row);
      },
    }))),
  };
}
