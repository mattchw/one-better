import { eq } from "drizzle-orm";
import type { Database } from "../../db/connect";
import { user } from "../../db/schema";
import { ApplicationError } from "../../domain/errors";
import type { AccountRepository } from "./service";

export function accountRepository(db: Database): AccountRepository {
  return { async findOwnedUser(ownerId) {
    try {
      const [result] = await db.select({ id: user.id, name: user.name, email: user.email, timezone: user.timezone })
        .from(user).where(eq(user.id, ownerId)).limit(1);
      return result ?? null;
    } catch { throw new ApplicationError("DATABASE_UNAVAILABLE", "Cannot reach your account. Please retry."); }
  } };
}
