import { requireActor } from "@/server/actor";
import { goalResponse } from "@/server/goals";
import { reviews } from "@/server/reviews";
import { errorResponse } from "@/server/http-errors";
export const dynamic = "force-dynamic";
export async function GET(request: Request) { try { return goalResponse(await reviews().day(await requireActor(request.headers), new URL(request.url).searchParams.get("date") ?? undefined)); } catch (error) { return errorResponse(error); } }
