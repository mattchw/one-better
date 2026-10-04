import {requireActor} from '@/server/actor';
import {commandBody,goalResponse,requireMutationOrigin} from '@/server/goals';
import {errorResponse} from '@/server/http-errors';
import {focusCycles} from '@/server/focus-cycles';
export const dynamic='force-dynamic';
export async function GET(r:Request){try{return goalResponse(await focusCycles().workspace(await requireActor(r.headers)));}catch(e){return errorResponse(e);}}
export async function POST(r:Request){try{const actor=await requireActor(r.headers);requireMutationOrigin(r);return goalResponse({cycle:await focusCycles().create(actor,await commandBody(r))});}catch(e){return errorResponse(e);}}
