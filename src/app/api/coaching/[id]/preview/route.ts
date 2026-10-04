import { requireActor } from '@/server/actor';
import { commandBody, goalResponse, requireMutationOrigin } from '@/server/goals';
import { errorResponse } from '@/server/http-errors';
import { coaching } from '@/server/coaching';
export const dynamic='force-dynamic';
export async function POST(r:Request,{params}:{params:Promise<{id:string}>}){try{const actor=await requireActor(r.headers);requireMutationOrigin(r);return goalResponse(await (await coaching(actor)).preview(actor,(await params).id,await commandBody(r)));}catch(e){return errorResponse(e);}}
