import { requireActor } from "@/server/actor";
import { calendar } from "@/server/calendar";
import { errorResponse } from "@/server/http-errors";
import { goalResponse, requireMutationOrigin } from "@/server/goals";
export async function POST(request: Request) {
  try { const actor = await requireActor(request.headers); requireMutationOrigin(request); return goalResponse(await calendar().start(actor)); } catch (error) { return errorResponse(error); }
}
