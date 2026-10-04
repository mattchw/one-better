import { requireActor } from "@/server/actor";
import { hours } from "@/server/availability";
import { errorResponse } from "@/server/http-errors";
import { commandBody, goalResponse, requireMutationOrigin } from "@/server/goals";
export async function GET(request: Request) { try { return goalResponse(await hours().settings(await requireActor(request.headers))); } catch (error) { return errorResponse(error); } }
export async function PUT(request: Request) { try { const actor = await requireActor(request.headers); requireMutationOrigin(request); return goalResponse({ schedule: await hours().save(actor, await commandBody(request)) }); } catch (error) { return errorResponse(error); } }
