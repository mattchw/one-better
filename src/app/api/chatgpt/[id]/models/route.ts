import {requireActor} from '@/server/actor';
import {chatGPT} from '@/server/chatgpt';
import {goalResponse,requireMutationOrigin} from '@/server/goals';
import {errorResponse} from '@/server/http-errors';
import {ChatGPTFailure} from '@/modules/chatgpt/domain';
import {ApplicationError} from '@/domain/errors';
export async function POST(r:Request,{params}:{params:Promise<{id:string}>}){try{const actor=await requireActor(r.headers);requireMutationOrigin(r);return goalResponse({connection:await chatGPT().refreshModels(actor,(await params).id)});}catch(e){return errorResponse(e instanceof ChatGPTFailure?new ApplicationError('CONFLICT',e.kind==='terminal_refresh'||e.kind==='authentication'?'ChatGPT needs sign-in or plan permission. Reconnect this account.':'ChatGPT models are temporarily unavailable. Retry later.'):e);}}
