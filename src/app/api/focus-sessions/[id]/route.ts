import { requireActor } from "@/server/actor";
import { goalResponse } from "@/server/goals";
import { focus } from "@/server/focus";
import { errorResponse } from "@/server/http-errors";
export const dynamic="force-dynamic";
export async function GET(request:Request,context:{params:Promise<{id:string}>}){try{return goalResponse({session:await focus().get(await requireActor(request.headers),(await context.params).id)});}catch(error){return errorResponse(error);}}
