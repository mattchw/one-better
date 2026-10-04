import {requireActor} from '@/server/actor';
import {chatGPT,chatGPTConfiguration} from '@/server/chatgpt';
import {goalResponse} from '@/server/goals';
import {errorResponse} from '@/server/http-errors';
export async function GET(r:Request){try{const actor=await requireActor(r.headers);return goalResponse(chatGPTConfiguration()?await chatGPT().workspace(actor):{configured:false,connections:[]});}catch(e){return errorResponse(e);}}
