import { requireActor } from "@/server/actor";
import { calendar } from "@/server/calendar";
import { errorResponse } from "@/server/http-errors";
import { commandBody, goalResponse, requireMutationOrigin } from "@/server/goals";
type Context = { params: Promise<{ id: string }> };
export async function GET(request: Request, context: Context) {
  try { const actor = await requireActor(request.headers); const { id } = await context.params; return goalResponse(await calendar().workspace(actor, new URL(request.url).searchParams.get("week") ?? undefined, id)); } catch (error) { return errorResponse(error); }
}
export async function PATCH(request: Request, context: Context) {
  try { const actor = await requireActor(request.headers); requireMutationOrigin(request); const { id } = await context.params; return goalResponse({ connection: await calendar().select(actor, id, await commandBody(request)) }); } catch (error) { return errorResponse(error); }
}
