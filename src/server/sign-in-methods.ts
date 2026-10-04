import { and, eq, sql } from "drizzle-orm";
import type { Database } from "../db/connect";
import { account } from "../db/schema";

export type SignInMethods = { passwordAvailable: boolean; google: { id: string; email: string } | null };
export async function readSignInMethods(db: Database, ownerId: string, email: string): Promise<SignInMethods> {
  const methods = await db.select({ id: account.id, providerId: account.providerId, usablePassword: sql<boolean>`${account.password} IS NOT NULL AND length(${account.password}) > 0` }).from(account).where(eq(account.userId, ownerId));
  const google = methods.find(method => method.providerId === "google");
  return { passwordAvailable: methods.some(method => method.providerId === "credential" && method.usablePassword), google: google ? { id: google.id, email } : null };
}
export async function canUnlinkGoogle(db: Database, ownerId: string, accountId: string): Promise<boolean> {
  const [owned] = await db.select({ id: account.id }).from(account).where(and(eq(account.id, accountId), eq(account.userId, ownerId), eq(account.providerId, "google"))).limit(1);
  return !!owned && (await readSignInMethods(db, ownerId, "")).passwordAvailable;
}
