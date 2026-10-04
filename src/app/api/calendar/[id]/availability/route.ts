import { requireActor } from "@/server/actor";
import { calendar } from "@/server/calendar";
import { errorResponse } from "@/server/http-errors";
import { commandBody, goalResponse, requireMutationOrigin } from "@/server/goals";
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try { const actor = await requireActor(request.headers); requireMutationOrigin(request); return goalResponse({ availability: await calendar().refreshAvailability(actor, (await context.params).id, await commandBody(request)) }); } catch (error) { return errorResponse(error); }
}
