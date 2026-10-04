import { and, desc, eq, lt } from 'drizzle-orm';
import type { Database } from '../../db/connect';
import { aiRecommendationRun as runs, user } from '../../db/schema';
import type { Actor } from '../../domain/actor';
import { ApplicationError } from '../../domain/errors';
import type { CoachingRepository, StoredRun } from './service';
const dto=(row:typeof runs.$inferSelect):StoredRun=>{const {ownerId:_owner,createdAt:_created,...value}=row;void _owner;void _created;return {...value,generatedAt:row.generatedAt.toISOString()};};
async function operation<T>(work:()=>Promise<T>){try{return await work();}catch(e){if(e instanceof ApplicationError)throw e;throw new ApplicationError('DATABASE_UNAVAILABLE','Coaching history could not be loaded. Please retry.');}}
export function coachingRepository(db:Database):CoachingRepository {
  const owned=(actor:Actor,id:string)=>and(eq(runs.ownerId,actor.userId),eq(runs.id,id));
  return {
    get:(actor,id)=>operation(async()=>{const [row]=await db.select().from(runs).where(owned(actor,id));return row?dto(row):null;}),
    latest:(actor,scope)=>operation(async()=>{const [row]=await db.select().from(runs).where(and(eq(runs.ownerId,actor.userId),eq(runs.contextType,scope.contextType),eq(runs.week,scope.week))).orderBy(desc(runs.createdAt),desc(runs.id)).limit(1);return row?dto(row):null;}),
    claim:(actor,run)=>operation(()=>db.transaction(async tx=>{
      const [owner]=await tx.select({id:user.id}).from(user).where(eq(user.id,actor.userId)).for('no key update');if(!owner)throw new ApplicationError('NOT_FOUND','This account is unavailable.');
      const [existing]=await tx.select().from(runs).where(owned(actor,run.id));if(existing)return {created:false,run:dto(existing)};
      // Recover abandoned claims only on another explicit generation command.
      await tx.update(runs).set({status:'failed',failure:'timeout',latencyMs:60000}).where(and(eq(runs.ownerId,actor.userId),eq(runs.status,'pending'),lt(runs.createdAt,new Date(Date.now()-60000))));
      const [pending]=await tx.select({id:runs.id}).from(runs).where(and(eq(runs.ownerId,actor.userId),eq(runs.status,'pending'))).limit(1);
      if(pending)throw new ApplicationError('CONFLICT','Coaching is already being generated. Wait for that request before trying again.');
      const [row]=await tx.insert(runs).values({...run,ownerId:actor.userId,generatedAt:new Date(run.generatedAt)}).returning();return {created:true,run:dto(row)};
    })),
    finish:(actor,run)=>operation(async()=>{const [row]=await db.update(runs).set({status:run.status,recommendations:run.recommendations,failure:run.failure,usage:run.usage,latencyMs:run.latencyMs}).where(and(owned(actor,run.id),eq(runs.status,'pending'))).returning();if(!row)throw new ApplicationError('CONFLICT','This coaching attempt has already finished. Refresh to inspect it.');return dto(row);}),
  };
}
