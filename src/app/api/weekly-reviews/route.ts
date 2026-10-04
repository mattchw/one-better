import { requireActor } from "@/server/actor";
import { commandBody, goalResponse, requireMutationOrigin } from "@/server/goals";
import { weeklyReviews } from "@/server/weekly-reviews";
import { errorResponse } from "@/server/http-errors";
export const dynamic = "force-dynamic";
export async function GET(request: Request) { try { const actor=await requireActor(request.headers); return goalResponse(await weeklyReviews().workspace(actor,new URL(request.url).searchParams.get("week")??undefined)); } catch(error) { return errorResponse(error); } }
export async function PUT(request: Request) { try { const actor=await requireActor(request.headers);requireMutationOrigin(request);return goalResponse({review:await weeklyReviews().save(actor,await commandBody(request))}); } catch(error) {return errorResponse(error);} }
