import { and, eq, lte, isNotNull } from 'drizzle-orm';
import type { Transaction } from '../../db/command-receipt';
import type { Actor } from '../../domain/actor';
import { focusSession, dailyReflection } from '../../db/schema';
import { deriveHabitProgress } from './habit';
// Counts dates only. No reflection or session-note text is read for the streak.
export async function readHabitProgress(tx:Transaction,actor:Actor,timezone:string,now:string) {
 const sessions=await tx.select({startedAt:focusSession.startedAt,endedAt:focusSession.endedAt}).from(focusSession).where(and(eq(focusSession.ownerId,actor.userId),isNotNull(focusSession.endedAt),lte(focusSession.endedAt,new Date(now))));
 const reflections=await tx.select({localDate:dailyReflection.localDate,status:dailyReflection.status,finalizedAt:dailyReflection.finalizedAt}).from(dailyReflection).where(and(eq(dailyReflection.ownerId,actor.userId),eq(dailyReflection.status,'finalized'),lte(dailyReflection.finalizedAt,new Date(now))));
 return deriveHabitProgress({timezone,now,sessions:sessions.map(s=>({startedAt:s.startedAt.toISOString(),endedAt:s.endedAt?.toISOString()??null})),reflections:reflections.map(r=>({...r,finalizedAt:r.finalizedAt?.toISOString()??null}))});
}
