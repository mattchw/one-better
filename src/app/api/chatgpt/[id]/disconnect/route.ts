import {requireActor} from '@/server/actor';
import {chatGPT} from '@/server/chatgpt';
import {commandBody,goalResponse,requireMutationOrigin} from '@/server/goals';
import {errorResponse} from '@/server/http-errors';
export async function POST(r:Request,{params}:{params:Promise<{id:string}>}){try{const actor=await requireActor(r.headers);requireMutationOrigin(r);return goalResponse({connection:await chatGPT().disconnect(actor,(await params).id,await commandBody(r))});}catch(e){return errorResponse(e);}}
