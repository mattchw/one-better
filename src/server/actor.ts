import "server-only";
import { actorFromSession } from "../domain/actor";
import { ApplicationError } from "../domain/errors";
import { runtime } from "./runtime";
export async function requireActor(headers: Headers) {
  try { return actorFromSession(await runtime().auth.api.getSession({ headers })); }
  catch (error) {
    if (error instanceof ApplicationError) throw error;
    throw new ApplicationError("DATABASE_UNAVAILABLE", "Cannot verify your account. Please retry.");
  }
}
