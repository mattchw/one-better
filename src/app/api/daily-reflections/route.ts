import { requireActor } from "@/server/actor";
import { commandBody, goalResponse, requireMutationOrigin } from "@/server/goals";
import { reviews } from "@/server/reviews";
import { errorResponse } from "@/server/http-errors";
export const dynamic = "force-dynamic";
export async function PUT(request: Request) { try { const actor = await requireActor(request.headers); requireMutationOrigin(request); return goalResponse({ reflection: await reviews().save(actor, await commandBody(request)) }); } catch (error) { return errorResponse(error); } }
