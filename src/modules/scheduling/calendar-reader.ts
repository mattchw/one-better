import { and, asc, eq, gt, lt } from 'drizzle-orm';
import type { Database } from '../../db/connect';
import type { Actor } from '../../domain/actor';
import { focusSession, timeBlock, weeklyPlan } from '../../db/schema';
import { calendarRange, dayMilliseconds, type CalendarScale } from '../../components/calendar-navigation';
import type { TimeBlock } from './domain';
export type CalendarRangeBlock=TimeBlock & {weekStartDate:string};
export type CalendarProjection={blocks:CalendarRangeBlock[];recordedMilliseconds:number};
// Read-only projection. Two bounded, owner-scoped interval queries; no per-day/plan queries.
export async function readCalendarProjection(db:Database,actor:Actor,date:string,scale:CalendarScale,timezone:string):Promise<CalendarProjection> {
 const range=calendarRange(date,scale,timezone),start=new Date(range.start),end=new Date(range.end);
 return db.transaction(async tx=>{
 const rows=await tx.select({block:timeBlock,weekStartDate:weeklyPlan.weekStartDate}).from(timeBlock).innerJoin(weeklyPlan,and(eq(weeklyPlan.id,timeBlock.planId),eq(weeklyPlan.ownerId,timeBlock.ownerId))).where(and(eq(timeBlock.ownerId,actor.userId),eq(timeBlock.state,'planned'),lt(timeBlock.start,end),gt(timeBlock.end,start))).orderBy(asc(timeBlock.start),asc(timeBlock.id));
 // Only finalized recorded time. Active elapsed time remains in the existing Focus widget.
 const sessions=scale==='day'?await tx.select({start:focusSession.startedAt,end:focusSession.endedAt}).from(focusSession).where(and(eq(focusSession.ownerId,actor.userId),lt(focusSession.startedAt,end),gt(focusSession.endedAt,start))):[];
 return {blocks:rows.map(({block,weekStartDate})=>{const {ownerId,...value}=block;void ownerId;return {...value,weekStartDate,start:block.start.toISOString(),end:block.end.toISOString(),createdAt:block.createdAt.toISOString(),updatedAt:block.updatedAt.toISOString(),cancelledAt:block.cancelledAt?.toISOString()??null};}),recordedMilliseconds:sessions.reduce((n,s)=>n+dayMilliseconds({start:s.start.toISOString(),end:s.end!.toISOString()},date,timezone),0)};
 },{isolationLevel:'repeatable read',accessMode:'read only'});
}
