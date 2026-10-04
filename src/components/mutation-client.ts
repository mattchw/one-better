import type { FocusSession } from "@/modules/focus/domain";
import type { TimeBlock } from "@/modules/scheduling/domain";
import type { Amendment } from "@/modules/amendments/domain";
import type { WeeklyPlan } from "@/modules/planning/domain";
import type { Action } from "@/modules/actions/domain";
import type { Goal } from "@/modules/goals/domain";
import type { Milestone } from "@/modules/milestones/domain";
export type CommandError<T = Goal> = { code: string; message: string; fields?: Record<string, string>; kind?: string; current?: T };
export class RequestFailure extends Error {
  constructor(readonly info: CommandError<Goal | Milestone | Action | WeeklyPlan | Amendment | TimeBlock | FocusSession>) { super(info.message); }
}
export async function request<T>(url: string, options?: RequestInit): Promise<T> {
  let response: Response;
  try { response = await fetch(url, { ...options, cache: "no-store" }); }
  catch { throw new RequestFailure({ code: "UNCERTAIN", message: "The connection was interrupted. Your change may have saved. Retry this same command to confirm it safely." }); }
  let body;
  try { body = await response.json(); }
  catch { throw new RequestFailure({ code: "UNCERTAIN", message: "The server response was interrupted. Retry this same command to confirm it safely." }); }
  if (!response.ok) throw new RequestFailure(body.error ?? { code: "UNCERTAIN", message: "Your change could not be confirmed. Please retry." });
  return body as T;
}
export function errorInfo<T = Goal>(error: unknown): CommandError<T> { return error instanceof RequestFailure ? error.info as CommandError<T> : { code: "UNCERTAIN", message: "Your change could not be confirmed. Please retry." }; }
