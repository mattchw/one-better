import { randomUUID } from "node:crypto";
import { hashPassword } from "better-auth/crypto";
import { eq } from "drizzle-orm";
import { z } from "zod";
import type { Database } from "../src/db/connect";
import { account, user } from "../src/db/schema";
import { timezoneSchema } from "../src/domain/timezone";

const localUserSchema = z.object({ email: z.email().transform((s) => s.toLowerCase()), name: z.string().trim().min(1).max(160), password: z.string().min(12).max(128), timezone: timezoneSchema });
export function assertLocalProvisioning(databaseURL: string, origin: string, mode = process.env.NODE_ENV) {
  if (mode === "production") throw new Error("Local account provisioning is disabled in production.");
  if (![databaseURL, origin].every((value) => ["localhost", "127.0.0.1", "[::1]"].includes(new URL(value).hostname))) {
    throw new Error("Local account provisioning requires a loopback database and application origin.");
  }
}
export async function provisionLocalUser(db: Database, input: unknown) {
  const profile = localUserSchema.parse(input);
  const passwordHash = await hashPassword(profile.password);
  return db.transaction(async (tx) => {
    const [existing] = await tx.select({ id: user.id }).from(user).where(eq(user.email, profile.email)).limit(1);
    if (existing) return { id: existing.id, created: false };
    const id = randomUUID();
    await tx.insert(user).values({ id, email: profile.email, name: profile.name, timezone: profile.timezone, emailVerified: false });
    await tx.insert(account).values({ id: randomUUID(), accountId: id, providerId: "credential", userId: id, password: passwordHash });
    return { id, created: true };
  });
}
