import { requireActor } from "@/server/actor";
import { goalResponse } from "@/server/goals";
import { planning } from "@/server/planning";
import { errorResponse } from "@/server/http-errors";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  try { return goalResponse({ candidates: await planning().candidates(await requireActor(request.headers)) }); }
  catch (error) { return errorResponse(error); }
}
