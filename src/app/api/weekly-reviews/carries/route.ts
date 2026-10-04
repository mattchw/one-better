import { requireActor } from "@/server/actor";
import { goalResponse } from "@/server/goals";
import { weeklyReviews } from "@/server/weekly-reviews";
import { errorResponse } from "@/server/http-errors";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {try {return goalResponse({carries:await weeklyReviews().carries(await requireActor(request.headers),new URL(request.url).searchParams.get("week")??"")});}catch(error){return errorResponse(error);}}
