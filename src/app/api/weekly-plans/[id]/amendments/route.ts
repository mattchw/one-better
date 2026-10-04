import { requireActor } from "@/server/actor";
import { commandBody, goalResponse, requireMutationOrigin } from "@/server/goals";
import { amendments } from "@/server/amendments";
import { errorResponse } from "@/server/http-errors";
export const dynamic = "force-dynamic";
type Context = { params: Promise<{ id: string }> };
export async function GET(request: Request, context: Context) {
  try { return goalResponse(await amendments().history(await requireActor(request.headers), (await context.params).id)); } catch (error) { return errorResponse(error); }
}
export async function POST(request: Request, context: Context) {
  try { const actor = await requireActor(request.headers); requireMutationOrigin(request); return goalResponse({ amendment: await amendments().confirm(actor, (await context.params).id, await commandBody(request)) }); } catch (error) { return errorResponse(error); }
}
