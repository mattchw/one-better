import { requireActor } from "@/server/actor";
import { goalResponse } from "@/server/goals";
import { focus } from "@/server/focus";
import { errorResponse } from "@/server/http-errors";
export const dynamic="force-dynamic";
export async function GET(request:Request){try{return goalResponse(await focus().workspace(await requireActor(request.headers),new URL(request.url).searchParams.get("block")??undefined));}catch(error){return errorResponse(error);}}
