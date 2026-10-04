import {requireActor} from '@/server/actor';
import {commandBody,goalResponse,requireMutationOrigin} from '@/server/goals';
import {errorResponse} from '@/server/http-errors';
import {ApplicationError} from '@/domain/errors';
import {focusCycles} from '@/server/focus-cycles';
export const dynamic='force-dynamic';
export async function POST(r:Request,{params}:{params:Promise<{id:string;command:string}>}){try{const actor=await requireActor(r.headers);requireMutationOrigin(r);const {id,command}=await params;if(command!=='activate'&&command!=='finish'&&command!=='archive')throw new ApplicationError('NOT_FOUND','This command is unavailable.');return goalResponse({cycle:await focusCycles().transition(actor,id,command,await commandBody(r))});}catch(e){return errorResponse(e);}}
