import { requireActor } from "@/server/actor";
import { commandBody, goalResponse, goals, requireMutationOrigin } from "@/server/goals";
import { errorResponse } from "@/server/http-errors";
import { ApplicationError } from "@/domain/errors";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  try {
    const actor = await requireActor(request.headers);
    const status = new URL(request.url).searchParams.get("status") ?? "active";
    if (status !== "active" && status !== "archived") throw new ApplicationError("VALIDATION", "Choose Active or Archived goals.");
    return goalResponse({ goals: await goals().listGoals(actor, status) });
  } catch (error) { return errorResponse(error); }
}
export async function POST(request: Request) {
  try {
    const actor = await requireActor(request.headers); requireMutationOrigin(request);
    return goalResponse({ goal: await goals().createGoal(actor, await commandBody(request)) });
  } catch (error) { return errorResponse(error); }
}
