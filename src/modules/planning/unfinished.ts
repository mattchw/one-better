import { and, eq } from 'drizzle-orm';
import type { Database } from '../../db/connect';
import type { Actor } from '../../domain/actor';
import { weeklyPlan, weeklyReview, weeklyReviewDecision } from '../../db/schema';
import { history } from '../amendments/repository';
import { effectivePlan } from '../amendments/domain';
import { readPlan, operation } from './repository';
import { addDays, ownedPlan, type PlanningSource } from './domain';

// Suggestions only: selecting them is reversible and no week is changed until
// the user presses Plan my week. Only live eligible Actions may be suggested.
export function unfinishedWeekTasks(db:Database,actor:Actor,week:string,candidates:PlanningSource[]) {
 return operation(()=>db.transaction(async tx=>{
  const [row]=await tx.select().from(weeklyPlan).where(and(eq(weeklyPlan.ownerId,actor.userId),eq(weeklyPlan.weekStartDate,addDays(week,-7)),eq(weeklyPlan.state,'committed')));
  if(!row)return [];
  const plan=ownedPlan(await readPlan(tx,actor,row),actor.userId),past=await history(tx,actor,plan.id);
  const [review]=await tx.select({id:weeklyReview.id}).from(weeklyReview).where(and(eq(weeklyReview.ownerId,actor.userId),eq(weeklyReview.planId,plan.id),eq(weeklyReview.status,'finalized')));
  const decisions=review?await tx.select({commitmentId:weeklyReviewDecision.commitmentId,kind:weeklyReviewDecision.kind,minutes:weeklyReviewDecision.proposedBudgetMinutes}).from(weeklyReviewDecision).where(and(eq(weeklyReviewDecision.ownerId,actor.userId),eq(weeklyReviewDecision.reviewId,review.id))):[];
  return effectivePlan(plan,past).commitments.flatMap(c=>{
   const source=candidates.find(s=>s.actionId===c.actionId&&s.eligible),decision=decisions.find(d=>d.commitmentId===c.id);
   if(!source||decision&&decision.kind!=='carry')return [];
   return [{actionId:c.actionId,budgetMinutes:decision?.minutes??c.budgetMinutes,source:source.source}];
  });
 },{isolationLevel:'repeatable read',accessMode:'read only'}));
}
