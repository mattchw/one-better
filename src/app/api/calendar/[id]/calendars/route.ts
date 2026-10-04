import { requireActor } from "@/server/actor";
import { calendar } from "@/server/calendar";
import { errorResponse } from "@/server/http-errors";
import { goalResponse, requireMutationOrigin } from "@/server/goals";
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try { const actor = await requireActor(request.headers); requireMutationOrigin(request); return goalResponse({ connection: await calendar().refreshCalendars(actor, (await context.params).id) }); } catch (error) { return errorResponse(error); }
}
