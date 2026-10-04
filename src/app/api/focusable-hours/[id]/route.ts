import { requireActor } from "@/server/actor";
import { hours } from "@/server/availability";
import { errorResponse } from "@/server/http-errors";
import { goalResponse } from "@/server/goals";
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) { try { return goalResponse(await hours().settings(await requireActor(request.headers), (await context.params).id)); } catch (error) { return errorResponse(error); } }
