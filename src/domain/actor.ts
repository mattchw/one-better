import { z } from "zod";
import { ApplicationError } from "./errors";

const userId = z.uuid();
export type Actor = Readonly<{ userId: string }>;
export function actorFromSession(session: { user: { id: string } } | null): Actor {
  if (!session) throw new ApplicationError("UNAUTHENTICATED", "Sign in to continue.");
  const parsed = userId.safeParse(session.user.id);
  if (!parsed.success) throw new ApplicationError("UNAUTHENTICATED", "Sign in again to continue.");
  return Object.freeze({ userId: parsed.data });
}
