import { requireActor } from "@/server/actor";
import { calendar } from "@/server/calendar";
import { errorResponse } from "@/server/http-errors";
import { goalResponse } from "@/server/goals";
export async function GET(request: Request) {
  try { return goalResponse(await calendar().workspace(await requireActor(request.headers), new URL(request.url).searchParams.get("week") ?? undefined)); } catch (error) { return errorResponse(error); }
}
