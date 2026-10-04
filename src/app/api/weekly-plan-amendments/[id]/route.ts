import { requireActor } from "@/server/actor";
import { goalResponse } from "@/server/goals";
import { amendments } from "@/server/amendments";
import { errorResponse } from "@/server/http-errors";
export const dynamic = "force-dynamic";
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try { return goalResponse({ amendment: await amendments().get(await requireActor(request.headers), (await context.params).id) }); } catch (error) { return errorResponse(error); }
}
