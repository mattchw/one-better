import { requireActor } from '@/server/actor';
import { runtime } from '@/server/runtime';
import { accountRepository } from '@/modules/account/repository';
import { readAccountContext } from '@/modules/account/service';
import { readCalendarProjection } from '@/modules/scheduling/calendar-reader';
import { calendarSelection } from '@/components/calendar-navigation';
import { goalResponse } from '@/server/goals';
import { errorResponse } from '@/server/http-errors';
export const dynamic='force-dynamic';
export async function GET(request:Request) {
 try {const actor=await requireActor(request.headers),account=await readAccountContext(actor,accountRepository(runtime().db)),params=new URL(request.url).searchParams;
 const {date,scale}=calendarSelection({date:params.get('date')??undefined,view:params.get('view')??undefined},account.timezone,Date.now());
 return goalResponse(await readCalendarProjection(runtime().db,actor,date,scale,account.timezone));
 }catch(error){return errorResponse(error);}
}
