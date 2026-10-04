import { requireActor } from "@/server/actor";
import { goalResponse } from "@/server/goals";
import { weeklyReviews } from "@/server/weekly-reviews";
import { errorResponse } from "@/server/http-errors";
export const dynamic = "force-dynamic";
export async function GET(request: Request, context: {params:Promise<{id:string}>}) {try {return goalResponse({review:await weeklyReviews().get(await requireActor(request.headers),(await context.params).id)});}catch(error){return errorResponse(error);}}
