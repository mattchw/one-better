import { randomUUID } from "node:crypto";
import { ApplicationError, type ErrorCode } from "../domain/errors";
const status: Record<ErrorCode, number> = { UNAUTHENTICATED: 401, FORBIDDEN: 403, NOT_FOUND: 404, VALIDATION: 400, CONFLICT: 409, DATABASE_UNAVAILABLE: 503, INTERNAL: 500 };
export function errorResponse(error: unknown) {
  const known = error instanceof ApplicationError ? error : new ApplicationError("INTERNAL", "Something went wrong. Please retry.");
  const requestId = randomUUID();
  if (status[known.code] >= 500) console.error(JSON.stringify({ requestId, code: known.code }));
  return Response.json({ error: { code: known.code, message: known.message, requestId, ...known.details } }, { status: status[known.code], headers: { "Cache-Control": "private, no-store" } });
}
