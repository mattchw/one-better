import { requireActor } from "@/server/actor";
import { commandBody, goalResponse, requireMutationOrigin } from "@/server/goals";
import { planning } from "@/server/planning";
import { errorResponse } from "@/server/http-errors";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  try { return goalResponse(await planning().workspace(await requireActor(request.headers), new URL(request.url).searchParams.get("week") ?? undefined)); }
  catch (error) { return errorResponse(error); }
}
export async function POST(request: Request) {
  try { const actor = await requireActor(request.headers); requireMutationOrigin(request); return goalResponse({ plan: await planning().create(actor, await commandBody(request)) }); }
  catch (error) { return errorResponse(error); }
}
