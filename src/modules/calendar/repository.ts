import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import type { Pool } from "pg";
import type { Database } from "../../db/connect";
import { calendarConnection, calendarOAuthFlow, calendarAvailabilityCache, user } from "../../db/schema";
import * as schema from "../../db/schema";
import { ApplicationError } from "../../domain/errors";

export type StoredConnection = typeof calendarConnection.$inferSelect;
export type StoredFlow = typeof calendarOAuthFlow.$inferSelect;
export type StoredCache = typeof calendarAvailabilityCache.$inferSelect;
export interface CalendarStore {
  connection(): Promise<StoredConnection | null>;
  timezone(): Promise<string>;
  flow(): Promise<StoredFlow | null>;
  saveFlow(value: StoredFlow): Promise<void>;
  saveConnection(value: StoredConnection, clearCache?: boolean): Promise<void>;
  complete(value: StoredConnection, flow: StoredFlow): Promise<void>;
  disconnect(value: StoredConnection): Promise<void>;
  cache(id: string, week: string, timezone: string): Promise<StoredCache | null>;
  saveCache(value: StoredCache): Promise<void>;
}
export interface CalendarRepository {
  read<T>(owner: string, work: (store: CalendarStore) => Promise<T>): Promise<T>;
  locked<T>(owner: string, work: (store: CalendarStore) => Promise<T>): Promise<T>;
}
const scopedStore = (db: Omit<Database, "$client">, owner: string): CalendarStore => {
  const connectionWhere = eq(calendarConnection.ownerId, owner);
  const cacheWhere = (id: string, week: string, timezone: string) => and(eq(calendarAvailabilityCache.ownerId, owner), eq(calendarAvailabilityCache.connectionId, id), eq(calendarAvailabilityCache.weekStartDate, week), eq(calendarAvailabilityCache.timezone, timezone));
  const assertOwner = (value: { ownerId: string }) => { if (value.ownerId !== owner) throw new ApplicationError("NOT_FOUND", "This Calendar connection is unavailable."); };
  return {
    async connection() { return (await db.select().from(calendarConnection).where(connectionWhere))[0] ?? null; },
    async timezone() { const row = (await db.select({ timezone: user.timezone }).from(user).where(eq(user.id, owner)))[0]; if (!row) throw new ApplicationError("UNAUTHENTICATED", "Sign in again."); return row.timezone; },
    async flow() { return (await db.select().from(calendarOAuthFlow).where(eq(calendarOAuthFlow.ownerId, owner)))[0] ?? null; },
    async saveFlow(value) { assertOwner(value); await db.insert(calendarOAuthFlow).values(value).onConflictDoUpdate({ target: calendarOAuthFlow.ownerId, set: value }); },
    async saveConnection(value, clearCache = false) { assertOwner(value); await db.transaction(async tx => { await tx.insert(calendarConnection).values(value).onConflictDoUpdate({ target: calendarConnection.ownerId, set: value }); if (clearCache) await tx.delete(calendarAvailabilityCache).where(eq(calendarAvailabilityCache.ownerId, owner)); }); },
    async complete(value, flow) { assertOwner(value); assertOwner(flow); await db.transaction(async tx => { await tx.insert(calendarConnection).values(value).onConflictDoUpdate({ target: calendarConnection.ownerId, set: value }); await tx.delete(calendarAvailabilityCache).where(eq(calendarAvailabilityCache.ownerId, owner)); await tx.update(calendarOAuthFlow).set(flow).where(eq(calendarOAuthFlow.ownerId, owner)); }); },
    async disconnect(value) { assertOwner(value); await db.transaction(async tx => { await tx.update(calendarConnection).set(value).where(connectionWhere); await tx.delete(calendarAvailabilityCache).where(eq(calendarAvailabilityCache.ownerId, owner)); await tx.delete(calendarOAuthFlow).where(eq(calendarOAuthFlow.ownerId, owner)); }); },
    async cache(id, week, timezone) { return (await db.select().from(calendarAvailabilityCache).where(cacheWhere(id, week, timezone)))[0] ?? null; },
    async saveCache(value) { assertOwner(value); await db.insert(calendarAvailabilityCache).values(value).onConflictDoUpdate({ target: [calendarAvailabilityCache.connectionId, calendarAvailabilityCache.weekStartDate, calendarAvailabilityCache.timezone], set: value }); },
  };
};
async function operation<T>(work: () => Promise<T>): Promise<T> { try { return await work(); } catch (error) { if (error instanceof ApplicationError) throw error; throw new ApplicationError("DATABASE_UNAVAILABLE", "Calendar data could not be saved or loaded. Please retry."); } }
export function calendarRepository(db: Database, pool: Pool): CalendarRepository {
  return {
    read: (owner, work) => operation(() => db.transaction(tx => work(scopedStore(tx as unknown as Database, owner)), { isolationLevel: "repeatable read", accessMode: "read only" })),
    locked: (owner, work) => operation(async () => {
      // Session advisory lock, not a transaction held over network calls. Every
      // writer shares this owner lock across processes. Cached reads continue.
      const client = await pool.connect(); let held = false; let broken = false;
      try { await client.query("SELECT pg_advisory_lock(hashtextextended($1, 0))", [`calendar:${owner}`]); held = true; return await work(scopedStore(drizzle(client, { schema }), owner)); }
      finally { if (held) { try { await client.query("SELECT pg_advisory_unlock(hashtextextended($1, 0))", [`calendar:${owner}`]); } catch { broken = true; } } client.release(broken); }
    }),
  };
}
