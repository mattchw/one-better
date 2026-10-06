import { and, eq } from "drizzle-orm";
import type { Database } from "../../db/connect";
import { executeReceipt } from "../../db/command-receipt";
import { focusableHours, user } from "../../db/schema";
import { ApplicationError } from "../../domain/errors";
import type { HoursRepository } from "./service";
const dto = (row: typeof focusableHours.$inferSelect) => ({ id: row.id, version: row.version, windows: row.windows, sparePercent: row.sparePercent as 0|25|40, createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString() });
async function operation<T>(work: () => Promise<T>) { try { return await work(); } catch (error) { if (error instanceof ApplicationError) throw error; throw new ApplicationError("DATABASE_UNAVAILABLE", "Your Focusable Hours could not be confirmed. Please retry."); } }
export function hoursRepository(db: Database): HoursRepository {
  return {
    read: (actor, id) => operation(() => db.transaction(async tx => {
      const [owner] = await tx.select({ timezone: user.timezone }).from(user).where(eq(user.id, actor.userId));
      if (!owner) throw new ApplicationError("NOT_FOUND", "This account is unavailable.");
      const [row] = await tx.select().from(focusableHours).where(and(eq(focusableHours.ownerId, actor.userId), id ? eq(focusableHours.id, id) : undefined));
      if (id && !row) throw new ApplicationError("NOT_FOUND", "These Focusable Hours are unavailable.");
      return { schedule: row ? dto(row) : null, timezone: owner.timezone };
    }, { isolationLevel: "repeatable read", accessMode: "read only" })),
    execute: (actor, mutationId, hash, apply) => operation(() => executeReceipt(db, actor, mutationId, hash, async tx => {
      // Stable owner row serializes initial creation as well as replacement.
      // NO KEY UPDATE is compatible with the receipt FK KEY SHARE lock;
      // FOR UPDATE would deadlock competing lock upgrades after receipt insert.
      const [owner] = await tx.select({ id: user.id }).from(user).where(eq(user.id, actor.userId)).for("no key update");
      if (!owner) throw new ApplicationError("NOT_FOUND", "This account is unavailable.");
      const key = eq(focusableHours.ownerId, actor.userId);
      const [current] = await tx.select().from(focusableHours).where(key).for("update");
      const result = apply(current ? dto(current) : null);
      const value = { ...result, createdAt: new Date(result.createdAt), updatedAt: new Date(result.updatedAt) };
      const [saved] = current ? await tx.update(focusableHours).set({ windows: value.windows, sparePercent: value.sparePercent, version: value.version, updatedAt: value.updatedAt }).where(and(key, eq(focusableHours.version, current.version))).returning() : await tx.insert(focusableHours).values({ ...value, ownerId: actor.userId }).returning();
      if (!saved) throw new ApplicationError("CONFLICT", "Focusable Hours changed elsewhere.", { kind: "HOURS_VERSION" });
      return dto(saved);
    })),
  };
}
