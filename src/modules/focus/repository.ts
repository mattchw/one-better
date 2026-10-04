import { Temporal } from "@js-temporal/polyfill";
import { and, asc, eq, isNull } from "drizzle-orm";
import type { Database } from "../../db/connect";
import { executeReceipt, type Transaction } from "../../db/command-receipt";
import { focusSession, timeBlock, weeklyPlan, user } from "../../db/schema";
import { ApplicationError } from "../../domain/errors";
import type { Actor } from "../../domain/actor";
import { currentWeek, ownedPlan } from "../planning/domain";
import { readPlan } from "../planning/repository";
import { history } from "../amendments/repository";
import { effectivePlan } from "../amendments/domain";
import type { TimeBlock } from "../scheduling/domain";
import { focusDetail, localDate, type FocusContext, type FocusSession, type OwnedSession } from "./domain";
import type { FocusRepository } from "./service";
const dto=(row:typeof focusSession.$inferSelect):OwnedSession=>({...row,startedAt:row.startedAt.toISOString(),endedAt:row.endedAt?.toISOString()??null,createdAt:row.createdAt.toISOString(),updatedAt:row.updatedAt.toISOString()});
const publicSession=(row:typeof focusSession.$inferSelect):FocusSession=>{const {ownerId:_owner,...value}=dto(row);void _owner;return value;};
const blockDTO=(row:typeof timeBlock.$inferSelect):TimeBlock=>{const {ownerId:_owner,...value}=row;void _owner;return {...value,start:row.start.toISOString(),end:row.end.toISOString(),createdAt:row.createdAt.toISOString(),updatedAt:row.updatedAt.toISOString(),cancelledAt:row.cancelledAt?.toISOString()??null};};
async function operation<T>(work:()=>Promise<T>){try{return await work();}catch(error){if(error instanceof ApplicationError)throw error;throw new ApplicationError("DATABASE_UNAVAILABLE","Your focus session could not be confirmed. Retry to recover the saved session.");}}
async function owner(tx:Transaction,actor:Actor,locked=false){const query=tx.select({id:user.id,timezone:user.timezone}).from(user).where(eq(user.id,actor.userId));const [value]=locked?await query.for("no key update"):await query;if(!value)throw new ApplicationError("NOT_FOUND","This account is unavailable.");return value;}
async function context(tx:Transaction,actor:Actor,id:string,locked=false):Promise<FocusContext>{
 const query=tx.select().from(timeBlock).where(and(eq(timeBlock.ownerId,actor.userId),eq(timeBlock.id,id)));const [block]=locked?await query.for("update"):await query;if(!block)throw new ApplicationError("NOT_FOUND","This time block is unavailable.");
 const planQuery=tx.select().from(weeklyPlan).where(and(eq(weeklyPlan.ownerId,actor.userId),eq(weeklyPlan.id,block.planId)));const [row]=locked?await planQuery.for("update"):await planQuery;
 const plan=ownedPlan(row?await readPlan(tx,actor,row):null,actor.userId),account=await owner(tx,actor);
 const blocks=await tx.select().from(timeBlock).where(and(eq(timeBlock.ownerId,actor.userId),eq(timeBlock.planId,plan.id))).orderBy(asc(timeBlock.start),asc(timeBlock.id));
 const sessions=await tx.select({session:focusSession}).from(focusSession).innerJoin(timeBlock,and(eq(timeBlock.ownerId,focusSession.ownerId),eq(timeBlock.id,focusSession.timeBlockId))).where(and(eq(focusSession.ownerId,actor.userId),eq(timeBlock.planId,plan.id))).orderBy(asc(focusSession.startedAt),asc(focusSession.id));
 return {block:blockDTO(block),plan,effective:plan.state==="committed"?effectivePlan(plan,await history(tx,actor,plan.id)):{provisionalCapacityMinutes:plan.provisionalCapacityMinutes,reserveMinutes:plan.reserveMinutes,commitments:[]},userTimezone:account.timezone,blocks:blocks.map(blockDTO),sessions:sessions.map(v=>publicSession(v.session))};
}
export function focusRepository(db:Database):FocusRepository{return {
 workspace:(actor,now,selected)=>operation(()=>db.transaction(async tx=>{
   const account=await owner(tx,actor),today=localDate(now,account.timezone),week=currentWeek(now,account.timezone);
   const day=Temporal.PlainDate.from(today).toZonedDateTime(account.timezone),next=day.add({days:1}).toInstant();
   const [active]=await tx.select().from(focusSession).where(and(eq(focusSession.ownerId,actor.userId),isNull(focusSession.endedAt)));
   const rows=await tx.select({block:timeBlock}).from(timeBlock).innerJoin(weeklyPlan,and(eq(weeklyPlan.id,timeBlock.planId),eq(weeklyPlan.ownerId,timeBlock.ownerId))).where(and(eq(timeBlock.ownerId,actor.userId),eq(timeBlock.state,"planned"),eq(weeklyPlan.state,"committed"),eq(weeklyPlan.weekStartDate,week))).orderBy(asc(timeBlock.start),asc(timeBlock.id));
   const todayRows=rows.filter(v=>Temporal.Instant.compare(v.block.start.toISOString(),next)<0&&Temporal.Instant.compare(v.block.end.toISOString(),day.toInstant())>0);
   const todayBlocks=[];for(const row of todayRows)todayBlocks.push(focusDetail(await context(tx,actor,row.block.id),now));
   return {serverNow:now,timezone:account.timezone,today,active:active?{session:publicSession(active),detail:focusDetail(await context(tx,actor,active.timeBlockId),now)}:null,todayBlocks,selected:selected?focusDetail(await context(tx,actor,selected),now):null};
 },{isolationLevel:"repeatable read",accessMode:"read only"})),
 get:(actor,id)=>operation(async()=>{const [row]=await db.select().from(focusSession).where(and(eq(focusSession.ownerId,actor.userId),eq(focusSession.id,id)));return row?dto(row):null;}),
 execute:(actor,mutationId,hash,apply)=>operation(()=>executeReceipt(db,actor,mutationId,hash,async tx=>{
   await owner(tx,actor,true);
   return apply({context:id=>context(tx,actor,id,true),active:async()=>{const [row]=await tx.select().from(focusSession).where(and(eq(focusSession.ownerId,actor.userId),isNull(focusSession.endedAt)));return row?publicSession(row):null;},session:async id=>{const [row]=await tx.select().from(focusSession).where(and(eq(focusSession.ownerId,actor.userId),eq(focusSession.id,id))).for("update");return row?dto(row):null;},insert:async value=>{const [row]=await tx.insert(focusSession).values({...value,ownerId:actor.userId,startedAt:new Date(value.startedAt),endedAt:null,createdAt:new Date(value.createdAt),updatedAt:new Date(value.updatedAt)}).returning();return publicSession(row);},end:async(value,version)=>{const [row]=await tx.update(focusSession).set({endedAt:new Date(value.endedAt!),outcome:value.outcome,endNote:value.endNote,version:value.version,updatedAt:new Date(value.updatedAt)}).where(and(eq(focusSession.ownerId,actor.userId),eq(focusSession.id,value.id),eq(focusSession.version,version),isNull(focusSession.endedAt))).returning();if(!row)throw new ApplicationError("CONFLICT","This focus session changed elsewhere.",{kind:"SESSION_VERSION"});return publicSession(row);}});
 })),
};}
