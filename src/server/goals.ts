import "server-only";
import { ApplicationError } from "../domain/errors";
import { goalRepository } from "../modules/goals/repository";
import { goalService } from "../modules/goals/service";
import { readConfiguration } from "./config";
import { runtime } from "./runtime";

export const goals = () => goalService(goalRepository(runtime().db));
export function requireMutationOrigin(request: Request) {
  if (request.headers.get("origin") !== new URL(readConfiguration(process.env).BETTER_AUTH_URL).origin) {
    throw new ApplicationError("FORBIDDEN", "This request origin is not allowed.");
  }
}
export async function commandBody(request: Request) {
  if (!request.headers.get("content-type")?.startsWith("application/json")) throw new ApplicationError("VALIDATION", "Send a JSON command.");
  // Bound the body before JSON parsing, including chunked requests without Content-Length.
  const reader = request.body?.getReader();
  if (!reader) throw new ApplicationError("VALIDATION", "A command is required.");
  let size = 0; const chunks: Uint8Array[] = [];
  try {
    for (;;) {
      const { done, value } = await reader.read(); if (done) break;
      size += value.byteLength;
      if (size > 32768) { await reader.cancel(); throw new ApplicationError("VALIDATION", "This command is too large."); }
      chunks.push(value);
    }
    return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
  } catch (error) {
    if (error instanceof ApplicationError) throw error;
    throw new ApplicationError("VALIDATION", "Send a valid JSON command.");
  } finally { reader.releaseLock(); }
}
export function goalResponse(value: unknown) { return Response.json(value, { headers: { "Cache-Control": "private, no-store" } }); }
