import { and, asc, eq, gt, inArray, isNull, lt, or } from "drizzle-orm";
import { ApplicationError } from "../../domain/errors";
import type { Database } from "../../db/connect";
import { executeReceipt } from "../../db/command-receipt";
import { dailyReflection, focusSession, timeBlock, user, weeklyPlan } from "../../db/schema";
import { localDate, type FocusSession } from "../focus/domain";
import type { TimeBlock } from "../scheduling/domain";
import { deriveDay, localDayRange, type DailyReflection, type OwnedReflection } from "./domain";
import type { ReviewRepository } from "./service";

const reflectionDTO = (row: typeof dailyReflection.$inferSelect): OwnedReflection => ({ ...row, createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString(), finalizedAt: row.finalizedAt?.toISOString() ?? null });
const publicReflection = (row: typeof dailyReflection.$inferSelect): DailyReflection => { const { ownerId: _owner, ...value } = reflectionDTO(row); void _owner; return value; };
const sessionDTO = (row: typeof focusSession.$inferSelect): FocusSession => { const { ownerId: _owner, ...value } = row; void _owner; return { ...value, startedAt: row.startedAt.toISOString(), endedAt: row.endedAt?.toISOString() ?? null, createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString() }; };
const blockDTO = (row: typeof timeBlock.$inferSelect): TimeBlock => { const { ownerId: _owner, ...value } = row; void _owner; return { ...value, start: row.start.toISOString(), end: row.end.toISOString(), createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString(), cancelledAt: row.cancelledAt?.toISOString() ?? null }; };
async function operation<T>(work: () => Promise<T>) { try { return await work(); } catch (error) { if (error instanceof ApplicationError) throw error; throw new ApplicationError("DATABASE_UNAVAILABLE", "Daily execution could not be confirmed. Retry to recover your saved reflection."); } }

export function reviewRepository(db: Database): ReviewRepository {
  return {
    day: (actor, now, date) => operation(() => db.transaction(async tx => {
      const [account] = await tx.select({ timezone: user.timezone }).from(user).where(eq(user.id, actor.userId));
      if (!account) throw new ApplicationError("NOT_FOUND", "This account is unavailable.");
      const requested = date ?? localDate(now, account.timezone), range = localDayRange(requested, account.timezone);
      const start = new Date(range.start), end = new Date(range.end);
      const joinPlan = and(eq(weeklyPlan.id, timeBlock.planId), eq(weeklyPlan.ownerId, timeBlock.ownerId));
      const scheduled = await tx.select({ block: timeBlock, planTimezone: weeklyPlan.timezone }).from(timeBlock).innerJoin(weeklyPlan, joinPlan).where(and(eq(timeBlock.ownerId, actor.userId), lt(timeBlock.start, end), gt(timeBlock.end, start))).orderBy(asc(timeBlock.start), asc(timeBlock.id));
      // Include work linked to a block scheduled on another date, not just today's blocks.
      const contributing = await tx.select({ block: timeBlock, planTimezone: weeklyPlan.timezone }).from(focusSession).innerJoin(timeBlock, and(eq(timeBlock.id, focusSession.timeBlockId), eq(timeBlock.ownerId, focusSession.ownerId))).innerJoin(weeklyPlan, joinPlan).where(and(eq(focusSession.ownerId, actor.userId), lt(focusSession.startedAt, end), or(gt(focusSession.endedAt, start), Date.parse(now) >= start.getTime() ? isNull(focusSession.endedAt) : undefined)));
      const unique = new Map([...scheduled, ...contributing].map(v => [v.block.id, v]));
      // All associated sessions distinguish 'none recorded' from execution on a different day.
      const sessions = unique.size ? await tx.select().from(focusSession).where(and(eq(focusSession.ownerId, actor.userId), inArray(focusSession.timeBlockId, [...unique.keys()]))).orderBy(asc(focusSession.startedAt), asc(focusSession.id)) : [];
      const [reflection] = await tx.select().from(dailyReflection).where(and(eq(dailyReflection.ownerId, actor.userId), eq(dailyReflection.localDate, requested)));
      return { ...deriveDay(requested, account.timezone, now, [...unique.values()].map(v => ({ block: blockDTO(v.block), planTimezone: v.planTimezone })), sessions.map(sessionDTO)), reflection: reflection ? publicReflection(reflection) : null };
    }, { isolationLevel: "repeatable read", accessMode: "read only" })),
    get: (actor, id) => operation(async () => { const [row] = await db.select().from(dailyReflection).where(and(eq(dailyReflection.ownerId, actor.userId), eq(dailyReflection.id, id))); return row ? reflectionDTO(row) : null; }),
    execute: (actor, mutationId, hash, apply) => operation(() => executeReceipt(db, actor, mutationId, hash, async tx => {
      // Same receipt-compatible owner lock as Focus start/end and scheduling.
      const [account] = await tx.select({ timezone: user.timezone }).from(user).where(eq(user.id, actor.userId)).for("no key update");
      if (!account) throw new ApplicationError("NOT_FOUND", "This account is unavailable.");
      return apply({
        timezone: account.timezone,
        byDate: async date => { const [row] = await tx.select().from(dailyReflection).where(and(eq(dailyReflection.ownerId, actor.userId), eq(dailyReflection.localDate, date))).for("update"); return row ? publicReflection(row) : null; },
        get: async id => { const [row] = await tx.select().from(dailyReflection).where(and(eq(dailyReflection.ownerId, actor.userId), eq(dailyReflection.id, id))).for("update"); return row ? reflectionDTO(row) : null; },
        active: async () => { const [row] = await tx.select().from(focusSession).where(and(eq(focusSession.ownerId, actor.userId), isNull(focusSession.endedAt))); return row ? sessionDTO(row) : null; },
        insert: async value => { const [row] = await tx.insert(dailyReflection).values({ ...value, ownerId: actor.userId, createdAt: new Date(value.createdAt), updatedAt: new Date(value.updatedAt), finalizedAt: null }).returning(); return publicReflection(row); },
        update: async (value, version) => { const [row] = await tx.update(dailyReflection).set({ note: value.note, status: value.status, version: value.version, updatedAt: new Date(value.updatedAt), finalizedAt: value.finalizedAt ? new Date(value.finalizedAt) : null }).where(and(eq(dailyReflection.ownerId, actor.userId), eq(dailyReflection.id, value.id), eq(dailyReflection.version, version), eq(dailyReflection.status, "draft"))).returning(); if (!row) throw new ApplicationError("CONFLICT", "This reflection changed elsewhere.", { kind: "REFLECTION_VERSION" }); return publicReflection(row); },
      });
    })),
  };
}
