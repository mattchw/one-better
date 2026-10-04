import {and,desc,eq,inArray,sql} from 'drizzle-orm';
import type {Database} from '../../db/connect';
import {executeReceipt,type Transaction} from '../../db/command-receipt';
import {focusCycle,focusCycleGoal,goal,user} from '../../db/schema';
import {ApplicationError} from '../../domain/errors';
import type {CycleRepository} from './service';
import type {FocusCycle} from './domain';
const record=(r:typeof focusCycle.$inferSelect,goals:FocusCycle['goals']):FocusCycle=>({id:r.id,title:r.title,intent:r.intent,startDate:r.startDate,endDate:r.endDate,status:r.status,version:r.version,createdAt:r.createdAt.toISOString(),updatedAt:r.updatedAt.toISOString(),activatedAt:r.activatedAt?.toISOString()??null,finishedAt:r.finishedAt?.toISOString()??null,archivedAt:r.archivedAt?.toISOString()??null,goals});
async function operation<T>(run:()=>Promise<T>){try{return await run();}catch(e){if(e instanceof ApplicationError)throw e;throw new ApplicationError('DATABASE_UNAVAILABLE','Your Focus Cycle changes have not been confirmed. Retry the same command.');}}
async function members(db:Database|Transaction,owner:string,ids:string[]){if(!ids.length)return [];return db.select().from(focusCycleGoal).where(and(eq(focusCycleGoal.ownerId,owner),inArray(focusCycleGoal.cycleId,ids))).orderBy(focusCycleGoal.goalId);}
export function cycleRepository(db:Database):CycleRepository{return {
 read:actor=>operation(()=>db.transaction(async tx=>{const [u]=await tx.select().from(user).where(eq(user.id,actor.userId));if(!u)throw new ApplicationError('UNAUTHENTICATED','Sign in to continue.');const rows=await tx.select().from(focusCycle).where(eq(focusCycle.ownerId,actor.userId)).orderBy(desc(focusCycle.createdAt),desc(focusCycle.id));const joins=await members(tx,actor.userId,rows.map(c=>c.id)),live=joins.length?await tx.select().from(goal).where(and(eq(goal.ownerId,actor.userId),inArray(goal.id,joins.map(m=>m.goalId)))):[];return {timezone:u.timezone,cycles:rows.map(c=>record(c,joins.filter(m=>m.cycleId===c.id).map(m=>{const g=live.find(g=>g.id===m.goalId);return ['draft','active'].includes(c.status)&&g?{goalId:g.id,goalVersion:g.version,title:g.title,outcome:g.outcome,archivedAt:g.archivedAt?.toISOString()??null}:m.snapshot;})))};},{isolationLevel:'repeatable read'})),
 execute:(actor,mutationId,hash,apply)=>operation(()=>executeReceipt(db,actor,mutationId,hash,async tx=>{
  // Serialize all cycle commands for this owner, including two concurrent activations.
  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${`focus-cycle:${actor.userId}`},0))`);
  const [u]=await tx.select().from(user).where(eq(user.id,actor.userId));if(!u)throw new ApplicationError('UNAUTHENTICATED','Sign in to continue.');
  const scoped=(id:string)=>and(eq(focusCycle.ownerId,actor.userId),eq(focusCycle.id,id));
  const get=async(id:string)=>{const [r]=await tx.select().from(focusCycle).where(scoped(id)).for('update');return r?record(r,(await members(tx,actor.userId,[id])).map(m=>m.snapshot)):null;};
  const save=async(c:FocusCycle,insert:boolean)=>{const {goals,...value}=c,dates={...value,createdAt:new Date(c.createdAt),updatedAt:new Date(c.updatedAt),activatedAt:c.activatedAt?new Date(c.activatedAt):null,finishedAt:c.finishedAt?new Date(c.finishedAt):null,archivedAt:c.archivedAt?new Date(c.archivedAt):null};
   const old=insert?null:await get(c.id);
   if(insert)await tx.insert(focusCycle).values({...dates,ownerId:actor.userId});
   if(!old||['draft','active'].includes(old.status)){await tx.delete(focusCycleGoal).where(and(eq(focusCycleGoal.ownerId,actor.userId),eq(focusCycleGoal.cycleId,c.id)));if(goals.length)await tx.insert(focusCycleGoal).values(goals.map(g=>({cycleId:c.id,ownerId:actor.userId,goalId:g.goalId,snapshot:g})));}
   if(!insert)await tx.update(focusCycle).set(dates).where(and(scoped(c.id),eq(focusCycle.version,c.version-1)));
   return c;};
  return apply({get,active:async()=>{const [r]=await tx.select().from(focusCycle).where(and(eq(focusCycle.ownerId,actor.userId),eq(focusCycle.status,'active')));return r?record(r,(await members(tx,actor.userId,[r.id])).map(m=>m.snapshot)):null;},goals:async(ids)=>ids.length?(await tx.select().from(goal).where(and(eq(goal.ownerId,actor.userId),inArray(goal.id,ids))).orderBy(goal.id).for('update')).map(g=>({...g,createdAt:g.createdAt.toISOString(),updatedAt:g.updatedAt.toISOString(),archivedAt:g.archivedAt?.toISOString()??null})):[],insert:c=>save(c,true),replace:c=>save(c,false)},u.timezone);
 })),
};}
