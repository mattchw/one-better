import { requireActor } from "@/server/actor";
import { focusAvailability } from "@/server/availability";
import { errorResponse } from "@/server/http-errors";
import { goalResponse } from "@/server/goals";
export async function GET(request: Request) { try { const actor = await requireActor(request.headers); const query = new URL(request.url).searchParams; return goalResponse(await focusAvailability().read(actor, query.get("week") ?? "", query.get("scheduleId") ?? undefined)); } catch (error) { return errorResponse(error); } }
