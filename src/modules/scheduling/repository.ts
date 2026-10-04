import { and, asc, eq } from "drizzle-orm";
import type { Database } from "../../db/connect";
import { executeReceipt, type Transaction } from "../../db/command-receipt";
import { focusSession, timeBlock, weeklyPlan, user, focusableHours, calendarConnection, calendarAvailabilityCache } from "../../db/schema";
import type { Actor } from "../../domain/actor";
import { ApplicationError } from "../../domain/errors";
import { ownedPlan } from "../planning/domain";
import { readPlan } from "../planning/repository";
import { history } from "../amendments/repository";
import { effectivePlan } from "../amendments/domain";
import { cachedAvailability } from "../calendar/service";
import type { SchedulingContext, OwnedBlock, TimeBlock } from "./domain";
import type { SchedulingRepository } from "./service";
const dto = (row: typeof timeBlock.$inferSelect): OwnedBlock => ({...row,start:row.start.toISOString(),end:row.end.toISOString(),createdAt:row.createdAt.toISOString(),updatedAt:row.updatedAt.toISOString(),cancelledAt:row.cancelledAt?.toISOString()??null});
const publicBlock = (row: typeof timeBlock.$inferSelect): TimeBlock => {const {ownerId:_owner,...value}=dto(row);void _owner;return value;};
const stored = (value:TimeBlock) => ({...value,start:new Date(value.start),end:new Date(value.end),createdAt:new Date(value.createdAt),updatedAt:new Date(value.updatedAt),cancelledAt:value.cancelledAt?new Date(value.cancelledAt):null});
async function operation<T>(work:()=>Promise<T>) { try{return await work();}catch(error){if(error instanceof ApplicationError)throw error;throw new ApplicationError("DATABASE_UNAVAILABLE","Your local schedule could not be confirmed. Please retry.");} }
async function context(tx:Transaction,actor:Actor,id:string,locked:boolean,now:Date):Promise<SchedulingContext> {
  const scope=and(eq(weeklyPlan.ownerId,actor.userId),eq(weeklyPlan.id,id));
  const query=tx.select().from(weeklyPlan).where(scope);
  const [row]=locked?await query.for("update"):await query;
  const plan=ownedPlan(row?await readPlan(tx,actor,row):null,actor.userId);
  const [owner]=await tx.select({timezone:user.timezone}).from(user).where(eq(user.id,actor.userId));
  if(!owner)throw new ApplicationError("NOT_FOUND","This account is unavailable.");
  const [hours]=await tx.select().from(focusableHours).where(eq(focusableHours.ownerId,actor.userId));
  // One selection/cache snapshot; no provider call inside this transaction.
  const [calendar]=await tx.select({connection:calendarConnection,cache:calendarAvailabilityCache}).from(calendarConnection).leftJoin(calendarAvailabilityCache,and(eq(calendarAvailabilityCache.ownerId,actor.userId),eq(calendarAvailabilityCache.connectionId,calendarConnection.id),eq(calendarAvailabilityCache.weekStartDate,plan.weekStartDate),eq(calendarAvailabilityCache.timezone,owner.timezone))).where(eq(calendarConnection.ownerId,actor.userId));
  const blocks=await tx.select().from(timeBlock).where(eq(timeBlock.ownerId,actor.userId)).orderBy(asc(timeBlock.start),asc(timeBlock.id));
  const execution=await tx.select({timeBlockId:focusSession.timeBlockId,startedAt:focusSession.startedAt,endedAt:focusSession.endedAt}).from(focusSession).where(eq(focusSession.ownerId,actor.userId));
  const effective=plan.state==="committed"?effectivePlan(plan,await history(tx,actor,id)):{provisionalCapacityMinutes:plan.provisionalCapacityMinutes,reserveMinutes:plan.reserveMinutes,commitments:[]};
  return {execution:execution.map(s=>({...s,startedAt:s.startedAt.toISOString(),endedAt:s.endedAt?.toISOString()??null})),plan,effective,userTimezone:owner.timezone,hours:hours?{id:hours.id,version:hours.version,windows:hours.windows,createdAt:hours.createdAt.toISOString(),updatedAt:hours.updatedAt.toISOString()}:null,calendar:cachedAvailability(calendar?.connection??null,calendar?.cache??null,plan.weekStartDate,owner.timezone,null,now),calendarIdentity:JSON.stringify(calendar?{id:calendar.connection.id,version:calendar.connection.version,state:calendar.connection.state,selection:calendar.connection.selectedCalendarIds}:null),blocks:blocks.map(publicBlock)};
}
export function schedulingRepository(db:Database,clock=()=>new Date()):SchedulingRepository {
  return {
    read:(actor,id)=>operation(()=>db.transaction(tx=>context(tx,actor,id,false,clock()),{isolationLevel:"repeatable read",accessMode:"read only"})),
    get:(actor,id)=>operation(async()=>{const [row]=await db.select().from(timeBlock).where(and(eq(timeBlock.ownerId,actor.userId),eq(timeBlock.id,id)));return row?dto(row):null;}),
    execute:(actor,mutationId,hash,apply)=>operation(()=>executeReceipt(db,actor,mutationId,hash,async tx=>{
      // Stable owner lock serializes every local schedule writer across all Plans.
      // NO KEY UPDATE remains compatible with receipt FK KEY SHARE locks.
      const [owner]=await tx.select({id:user.id}).from(user).where(eq(user.id,actor.userId)).for("no key update");
      if(!owner)throw new ApplicationError("NOT_FOUND","This account is unavailable.");
      return apply({
        context:id=>context(tx,actor,id,true,clock()),
        block:async id=>{const [row]=await tx.select().from(timeBlock).where(and(eq(timeBlock.ownerId,actor.userId),eq(timeBlock.id,id))).for("update");return row?dto(row):null;},
        insert:async value=>{const [row]=await tx.insert(timeBlock).values({...stored(value),ownerId:actor.userId}).returning();return publicBlock(row);},
        replace:async(value,version)=>{const [row]=await tx.update(timeBlock).set({start:new Date(value.start),end:new Date(value.end),state:value.state,version:value.version,updatedAt:new Date(value.updatedAt),cancelledAt:value.cancelledAt?new Date(value.cancelledAt):null}).where(and(eq(timeBlock.ownerId,actor.userId),eq(timeBlock.id,value.id),eq(timeBlock.version,version),eq(timeBlock.state,"planned"))).returning();if(!row)throw new ApplicationError("CONFLICT","This time block changed elsewhere.",{kind:"BLOCK_VERSION"});return publicBlock(row);},
      });
    })),
  };
}
