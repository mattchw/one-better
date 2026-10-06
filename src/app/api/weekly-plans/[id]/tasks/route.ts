import { requireActor } from '@/server/actor';
import { commandBody, goalResponse, requireMutationOrigin } from '@/server/goals';
import { errorResponse } from '@/server/http-errors';
import { runtime } from '@/server/runtime';
import { executionClock } from '@/server/execution-clock';
import { calendarTaskService } from '@/modules/calendar-tasks/service';
export const dynamic='force-dynamic';
export async function POST(request:Request,{params}:{params:Promise<{id:string}>}) {
 try {
  const actor=await requireActor(request.headers);requireMutationOrigin(request);const {id}=await params;
  const change=await calendarTaskService(runtime().db,executionClock).change(actor,id,await commandBody(request));
  const expiresAt=(change.undo??change.editUndo??change.contextUndo)?.expiresAt;
  return goalResponse({change,undoRemainingMilliseconds:expiresAt?Math.max(0,Math.min(6000,Date.parse(expiresAt)-Date.parse(executionClock()))):0});
 }
 catch(error){return errorResponse(error);}
}
