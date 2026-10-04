import { and, eq, sql } from 'drizzle-orm';
import type { Database } from '../src/db/connect';
import type { Pool } from 'pg';
import { focusSession, timeBlock } from '../src/db/schema';
import { coachingContextReader } from '../src/modules/coaching/reader';
import { cycleService } from '../src/modules/focus-cycles/service';
import { cycleRepository } from '../src/modules/focus-cycles/repository';
import { planService } from '../src/modules/planning/service';
import { planRepository } from '../src/modules/planning/repository';
import { amendmentService } from '../src/modules/amendments/service';
import { amendmentRepository } from '../src/modules/amendments/repository';
import { schedulingService } from '../src/modules/scheduling/service';
import { schedulingRepository } from '../src/modules/scheduling/repository';
import { hoursService, focusAvailabilityService } from '../src/modules/availability/service';
import { hoursRepository } from '../src/modules/availability/repository';
import { calendarService } from '../src/modules/calendar/service';
import { calendarRepository } from '../src/modules/calendar/repository';
import { weeklyReviewService } from '../src/modules/weekly-reviews/service';
import { weeklyReviewRepository } from '../src/modules/weekly-reviews/repository';
export function databaseCoaching(db:Database,pool:Pool,clock:()=>string){
 const plans=planService(planRepository(db),clock),cycles=cycleService(cycleRepository(db),clock),amends=amendmentService(amendmentRepository(db),clock),schedule=schedulingService(schedulingRepository(db,()=>new Date(clock())),clock),hours=hoursService(hoursRepository(db),clock),calendar=calendarService(calendarRepository(db,pool),null,null,()=>new Date(clock())),availability=focusAvailabilityService(hours,calendar,()=>Date.parse(clock())),reviews=weeklyReviewService(weeklyReviewRepository(db),clock);
 const context=coachingContextReader({clock:clock,cycles:a=>cycles.workspace(a),planning:(a,w)=>plans.workspace(a,w),candidates:a=>planRepository(db).candidates(a),scheduling:(a,id)=>schedule.view(a,id),effective:async(a,id)=>(await amends.history(a,id)).effective,availability:(a,w)=>availability.read(a,w),review:(a,w)=>reviews.workspace(a,w),outcomes:async(a,id)=>db.select({outcome:focusSession.outcome,count:sql<number>`count(*)::int`}).from(focusSession).innerJoin(timeBlock,and(eq(timeBlock.ownerId,focusSession.ownerId),eq(timeBlock.id,focusSession.timeBlockId))).where(and(eq(focusSession.ownerId,a.userId),eq(timeBlock.planId,id))).groupBy(focusSession.outcome)});
 return {context,plans,cycles,amends,schedule,hours,reviews};
}
export const coachingCleanupTables=['ai_recommendation_run','focus_cycle_goal','focus_cycle','weekly_review_decision','weekly_review','daily_reflection','focus_session','time_block','amendment_commitment','weekly_plan_amendment','commitment_identity','weekly_commitment','weekly_plan','action','milestone','goal','mutation_receipt','focusable_hours','calendar_availability_cache','calendar_oauth_flow','google_calendar_connection'];

// Fresh synthetic FreeBusy coverage for coaching tests; no Google API calls.
export async function coachingCalendarFixture(db:Database,pool:Pool,actor:import('../src/domain/actor').Actor,week:string,now:string){
 const {randomUUID,createHash}=await import('node:crypto');
 const {calendarScopes}=await import('../src/modules/calendar/domain');
 const {credentialCipher}=await import('../src/modules/calendar/encryption');
 const id=randomUUID(),ids=['coaching-test-calendar'],cipher=credentialCipher({fixture:Buffer.alloc(32,12).toString('base64')},'fixture');
 await calendarRepository(db,pool).locked(actor.userId,async store=>{
  await store.saveConnection({id,ownerId:actor.userId,state:'connected',version:1,providerAccountId:'synthetic',encryptedCredentials:cipher.encrypt(JSON.stringify({accessToken:'synthetic-no-access',refreshToken:null,expiresAt:Date.parse(now)+3600000,scopes:[...calendarScopes],accountId:'synthetic'}),`tokens:${actor.userId}:${id}`),accessExpiresAt:new Date(Date.parse(now)+3600000),grantedScopes:[...calendarScopes],calendars:[{id:ids[0],summary:'Synthetic',primary:true,timezone:'Europe/London',accessRole:'freeBusyReader'}],selectedCalendarIds:ids,listFetchedAt:new Date(now),listError:null,createdAt:new Date(now),updatedAt:new Date(now)});
  await store.saveCache({ownerId:actor.userId,connectionId:id,weekStartDate:week,timezone:'Europe/London',selectionKey:createHash('sha256').update(JSON.stringify(ids)).digest('hex'),intervals:[],fetchedAt:new Date(now),lastError:null});
 });
}
