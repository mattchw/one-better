import type { Actor } from "../../domain/actor";
import { ApplicationError } from "../../domain/errors";

export type AccountContext = Readonly<{ id: string; name: string; email: string; timezone: string }>;
export interface AccountRepository { findOwnedUser(ownerId: string): Promise<AccountContext | null> }

export async function readAccountContext(actor: Actor, repository: AccountRepository): Promise<AccountContext> {
  const user = await repository.findOwnedUser(actor.userId);
  if (!user || user.id !== actor.userId) throw new ApplicationError("NOT_FOUND", "Account unavailable.");
  return user;
}
