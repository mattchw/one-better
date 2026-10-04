import { requireActor } from "@/server/actor";
import { commandBody, goalResponse, goals, requireMutationOrigin } from "@/server/goals";
import { errorResponse } from "@/server/http-errors";
export const dynamic = "force-dynamic";
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const actor = await requireActor(request.headers); requireMutationOrigin(request);
    return goalResponse({ goal: await goals().archiveGoal(actor, (await context.params).id, await commandBody(request)) });
  } catch (error) { return errorResponse(error); }
}
