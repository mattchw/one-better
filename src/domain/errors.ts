export type ErrorCode = "UNAUTHENTICATED" | "FORBIDDEN" | "NOT_FOUND" | "VALIDATION" | "CONFLICT" | "DATABASE_UNAVAILABLE" | "INTERNAL";
export class ApplicationError extends Error {
  constructor(public readonly code: ErrorCode, message: string, public readonly details?: Record<string, unknown>) { super(message); this.name = "ApplicationError"; }
}
