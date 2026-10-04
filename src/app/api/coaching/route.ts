import { requireActor } from '@/server/actor';
import { commandBody, goalResponse, requireMutationOrigin } from '@/server/goals';
import { errorResponse } from '@/server/http-errors';
import { coaching } from '@/server/coaching';
export const dynamic='force-dynamic';
export async function GET(r:Request){try{const actor=await requireActor(r.headers),url=new URL(r.url);return goalResponse(await (await coaching(actor)).view(actor,{contextType:url.searchParams.get('contextType'),week:url.searchParams.get('week')}));}catch(e){return errorResponse(e);}}
export async function POST(r:Request){try{const actor=await requireActor(r.headers);requireMutationOrigin(r);return goalResponse({run:await (await coaching(actor)).generate(actor,await commandBody(r))});}catch(e){return errorResponse(e);}}
