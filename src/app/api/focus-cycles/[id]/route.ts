import {requireActor} from '@/server/actor';
import {commandBody,goalResponse,requireMutationOrigin} from '@/server/goals';
import {errorResponse} from '@/server/http-errors';
import {focusCycles} from '@/server/focus-cycles';
export const dynamic='force-dynamic';
export async function PATCH(r:Request,{params}:{params:Promise<{id:string}>}){try{const actor=await requireActor(r.headers);requireMutationOrigin(r);return goalResponse({cycle:await focusCycles().update(actor,(await params).id,await commandBody(r))});}catch(e){return errorResponse(e);}}
