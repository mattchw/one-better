import { requireActor } from '@/server/actor';
import { goalResponse } from '@/server/goals';
import { errorResponse } from '@/server/http-errors';
import { quickPlanningContext } from '@/server/quick-planning';
export const dynamic = 'force-dynamic';
export async function GET(request: Request) {
  try { return goalResponse(await quickPlanningContext(await requireActor(request.headers), new URL(request.url).searchParams.get('week') ?? undefined)); }
  catch (error) { return errorResponse(error); }
}
