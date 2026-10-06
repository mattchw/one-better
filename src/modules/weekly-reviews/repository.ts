import { and, asc, desc, eq, inArray, gt, lt, or, isNull, ne } from "drizzle-orm";
import type { Database } from "../../db/connect";
import { executeReceipt, type Transaction } from "../../db/command-receipt";
import { action, dailyReflection, focusSession, goal, milestone, timeBlock, user, weeklyPlan, weeklyReview, weeklyReviewDecision } from "../../db/schema";
import type { Actor } from "../../domain/actor";
import { ApplicationError } from "../../domain/errors";
import { archiveAction } from "../actions/domain";
import { replaceAction } from "../actions/repository";
import { history } from "../amendments/repository";
import { addDays, currentWeek, ownedPlan } from "../planning/domain";
import { lockSources, operation, readPlan, sources, timezone } from "../planning/repository";
import type { DailyReflection } from "../reviews/domain";
import type { FocusSession } from "../focus/domain";
import type { TimeBlock } from "../scheduling/domain";
import { commitmentHistory, deriveWeek, localWeekRange, type WeeklyReview } from "./domain";
import type { WeeklyReviewRepository } from "./service";
import { effectivePlan, type Amendment } from "../amendments/domain";
import type { WeeklyPlan } from "../planning/domain";
import {readHabitProgress} from "../reviews/habit-repository";
import { deriveReviewAnalytics } from "./analytics";
const unavailable = () => new ApplicationError("NOT_FOUND","This weekly review is unavailable.");
async function readReview(tx: Transaction, actor: Actor, row: typeof weeklyReview.$inferSelect): Promise<WeeklyReview> {
  const {ownerId:_owner,...value} = row; void _owner;
  const children = await tx.select().from(weeklyReviewDecision).where(and(eq(weeklyReviewDecision.ownerId,actor.userId),eq(weeklyReviewDecision.reviewId,row.id))).orderBy(asc(weeklyReviewDecision.commitmentId));
  return {...value,createdAt:row.createdAt.toISOString(),updatedAt:row.updatedAt.toISOString(),finalizedAt:row.finalizedAt?.toISOString()??null,decisions:children.map(({ownerId:_owner,planId:_plan,reviewId:_review,...d})=>{void _owner;void _plan;void _review;return d;})};
}
const times = <T extends {createdAt:Date;updatedAt:Date}>(v:T) => ({...v,createdAt:v.createdAt.toISOString(),updatedAt:v.updatedAt.toISOString()});
const blockDTO = (row:typeof timeBlock.$inferSelect):TimeBlock=>{const {ownerId:_owner,...v}=times(row);void _owner;return {...v,start:row.start.toISOString(),end:row.end.toISOString(),cancelledAt:row.cancelledAt?.toISOString()??null};};
const sessionDTO=(row:typeof focusSession.$inferSelect):FocusSession=>{const {ownerId:_owner,...v}=times(row);void _owner;return {...v,startedAt:row.startedAt.toISOString(),endedAt:row.endedAt?.toISOString()??null};};
const dailyDTO=(row:typeof dailyReflection.$inferSelect):DailyReflection=>{const {ownerId:_owner,...v}=times(row);void _owner;return {...v,finalizedAt:row.finalizedAt?.toISOString()??null};};
async function analytics(tx: Transaction, actor: Actor, week: string, zone: string, now: string, plan: WeeklyPlan | null, amendments: Amendment[]) {
  const range=localWeekRange(week,zone),start=new Date(range.start),end=new Date(range.end);
  const scheduled=await tx.select().from(timeBlock).where(and(eq(timeBlock.ownerId,actor.userId),lt(timeBlock.start,end),gt(timeBlock.end,start)));
  const contributing=await tx.select({block:timeBlock}).from(focusSession).innerJoin(timeBlock,and(eq(timeBlock.id,focusSession.timeBlockId),eq(timeBlock.ownerId,focusSession.ownerId)))
    .where(and(eq(focusSession.ownerId,actor.userId),lt(focusSession.startedAt,end),or(gt(focusSession.endedAt,start),Date.parse(now)>=start.getTime()?isNull(focusSession.endedAt):undefined)));
  const blocks=[...new Map([...scheduled,...contributing.map(v=>v.block)].map(b=>[b.id,b])).values()];
  const sessions=blocks.length?await tx.select().from(focusSession).where(and(eq(focusSession.ownerId,actor.userId),inArray(focusSession.timeBlockId,blocks.map(b=>b.id)))):[];
  // Analytics exposes reflection status, never reflection or session-note text.
  const reflections=await tx.select({localDate:dailyReflection.localDate,status:dailyReflection.status}).from(dailyReflection).where(and(eq(dailyReflection.ownerId,actor.userId),inArray(dailyReflection.localDate,Array.from({length:7},(_,i)=>addDays(week,i)))));
  const effective=plan?effectivePlan(plan,amendments):null;
  return deriveReviewAnalytics({startDate:week,days:7,timezone:zone,now,blocks:blocks.map(blockDTO),sessions:sessions.map(sessionDTO),reflections,
    plan:plan&&effective?{originalMinutes:plan.commitments.reduce((n,c)=>n+c.budgetMinutes,0),commitments:effective.commitments,reserveMinutes:effective.reserveMinutes}:null});
}
export function weeklyReviewRepository(db: Database): WeeklyReviewRepository {
  return {
    workspace:(actor,now,week)=>operation(()=>db.transaction(async tx=>{
      const zone=await timezone(tx,actor),current=currentWeek(now,zone);
      const plans=await tx.select().from(weeklyPlan).where(eq(weeklyPlan.ownerId,actor.userId)).orderBy(desc(weeklyPlan.weekStartDate));
      const weeks=plans.filter(p=>p.state==="committed"&&p.weekStartDate<current).map(p=>({id:p.id,weekStartDate:p.weekStartDate}));
      // Open the current local week; historical reviews are an explicit navigation choice.
      const selected=week??current,row=plans.find(p=>p.weekStartDate===selected);
      const plan=row?.state==="committed"?ownedPlan(await readPlan(tx,actor,row),actor.userId):null,amendments=plan?await history(tx,actor,plan.id):[];
      const dashboard=await analytics(tx,actor,selected,zone,now,plan,amendments);
      const habit=await readHabitProgress(tx,actor,zone,now);
      if(!plan||selected>=current)return {habit,weekStartDate:selected,currentWeekStartDate:current,timezone:zone,weeks,state:selected>=current?"unfinished":"uncommitted",facts:null,analytics:dashboard};
      const [r]=await tx.select().from(weeklyReview).where(and(eq(weeklyReview.ownerId,actor.userId),eq(weeklyReview.planId,plan.id)));
      const review=r?await readReview(tx,actor,r):null;
      const blocks=await tx.select().from(timeBlock).where(and(eq(timeBlock.ownerId,actor.userId),eq(timeBlock.planId,plan.id))).orderBy(asc(timeBlock.start),asc(timeBlock.id));
      // A prior week's session can continue into this local week. Keep its original lineage,
      // but include its intersecting effort in the week total, just like the daily projection.
      const range = localWeekRange(selected,zone);
      const other = await tx.select({block:timeBlock}).from(focusSession).innerJoin(timeBlock,and(eq(timeBlock.id,focusSession.timeBlockId),eq(timeBlock.ownerId,focusSession.ownerId)))
        .where(and(eq(focusSession.ownerId,actor.userId),ne(timeBlock.planId,plan.id),lt(focusSession.startedAt,new Date(range.end)),or(gt(focusSession.endedAt,new Date(range.start)),isNull(focusSession.endedAt))));
      const unique = new Map([...blocks,...other.map(v=>v.block)].map(b=>[b.id,b]));
      const sessions=unique.size?await tx.select().from(focusSession).where(and(eq(focusSession.ownerId,actor.userId),inArray(focusSession.timeBlockId,[...unique.keys()]))).orderBy(asc(focusSession.startedAt),asc(focusSession.id)):[];
      const dates=Array.from({length:7},(_,i)=>addDays(selected,i));
      const reflections=await tx.select().from(dailyReflection).where(and(eq(dailyReflection.ownerId,actor.userId),inArray(dailyReflection.localDate,dates)));
      const live=await sources(tx,actor,[...new Set(commitmentHistory(plan,amendments).map(c=>c.commitment.actionId))]);
      return {habit,weekStartDate:selected,currentWeekStartDate:current,timezone:zone,weeks,state:"ready",facts:deriveWeek(plan,amendments,zone,now,[...unique.values()].map(blockDTO),sessions.map(sessionDTO),live,reflections.map(dailyDTO),review),analytics:dashboard};
    },{isolationLevel:"repeatable read",accessMode:"read only"})),
    get:(actor,id)=>operation(()=>db.transaction(async tx=>{const [r]=await tx.select().from(weeklyReview).where(and(eq(weeklyReview.ownerId,actor.userId),eq(weeklyReview.id,id)));if(!r)throw unavailable();return readReview(tx,actor,r);},{isolationLevel:"repeatable read",accessMode:"read only"})),
    carries:(actor,week)=>operation(()=>db.transaction(async tx=>{
      const [p]=await tx.select().from(weeklyPlan).where(and(eq(weeklyPlan.ownerId,actor.userId),eq(weeklyPlan.weekStartDate,addDays(week,-7))));if(!p)return [];
      const [r]=await tx.select().from(weeklyReview).where(and(eq(weeklyReview.ownerId,actor.userId),eq(weeklyReview.planId,p.id),eq(weeklyReview.status,"finalized")));if(!r)return [];
      const review=await readReview(tx,actor,r),entries=commitmentHistory(ownedPlan(await readPlan(tx,actor,p),actor.userId),await history(tx,actor,p.id));
      const current=await sources(tx,actor,review.decisions.filter(d=>d.kind==="carry").map(d=>d.actionId));
      return review.decisions.filter(d=>d.kind==="carry").map(d=>{const e=entries.find(e=>e.commitment.id===d.commitmentId)!;return {reviewId:r.id,commitmentId:d.commitmentId,actionId:d.actionId,context:e.commitment.snapshot,priorBudgetMinutes:e.latestBudgetMinutes,proposedBudgetMinutes:d.proposedBudgetMinutes!,eligible:!!current.find(s=>s.actionId===d.actionId)?.eligible};});
    },{isolationLevel:"repeatable read",accessMode:"read only"})),
    execute:(actor,mutationId,hash,apply)=>operation(()=>executeReceipt(db,actor,mutationId,hash,async tx=>{
      const [account]=await tx.select().from(user).where(eq(user.id,actor.userId)).for("no key update");if(!account)throw unavailable();
      async function children(value:WeeklyReview){await tx.delete(weeklyReviewDecision).where(and(eq(weeklyReviewDecision.ownerId,actor.userId),eq(weeklyReviewDecision.reviewId,value.id)));if(value.decisions.length)await tx.insert(weeklyReviewDecision).values(value.decisions.map(d=>({...d,ownerId:actor.userId,planId:value.planId,reviewId:value.id})));}
      return apply({timezone:account.timezone,
        get:async id=>{const [r]=await tx.select().from(weeklyReview).where(and(eq(weeklyReview.ownerId,actor.userId),eq(weeklyReview.id,id))).for("update");if(!r)throw unavailable();return readReview(tx,actor,r);},
        byPlan:async id=>{const [r]=await tx.select().from(weeklyReview).where(and(eq(weeklyReview.ownerId,actor.userId),eq(weeklyReview.planId,id))).for("update");return r?readReview(tx,actor,r):null;},
        plan:async id=>{const [p]=await tx.select().from(weeklyPlan).where(and(eq(weeklyPlan.ownerId,actor.userId),eq(weeklyPlan.id,id))).for("update");return ownedPlan(p?await readPlan(tx,actor,p):null,actor.userId);},
        history:id=>history(tx,actor,id),sources:ids=>lockSources(tx,actor,[...new Set(ids)]),
        archive:async(id,version,now)=>{
          // Source locks have already been taken in Goal/Milestone/Action order.
          const [a]=await tx.select().from(action).where(and(eq(action.ownerId,actor.userId),eq(action.id,id)));
          const [g]=a.goalId?await tx.select().from(goal).where(and(eq(goal.ownerId,actor.userId),eq(goal.id,a.goalId))):[];
          const [m]=a.milestoneId?await tx.select().from(milestone).where(and(eq(milestone.ownerId,actor.userId),eq(milestone.id,a.milestoneId))):[];
          const value={...times(a),completedAt:a.completedAt?.toISOString()??null,archivedAt:a.archivedAt?.toISOString()??null};
          const parent=g?{...times(g),archivedAt:g.archivedAt?.toISOString()??null}:null;
          const checkpoint=m?{...times(m),completedAt:m.completedAt?.toISOString()??null,archivedAt:m.archivedAt?.toISOString()??null}:null;
          await replaceAction(tx,actor,archiveAction(value,version,parent,checkpoint,now),version);
        },
        insert:async value=>{const {decisions:_d,...v}=value;void _d;const [r]=await tx.insert(weeklyReview).values({...v,ownerId:actor.userId,createdAt:new Date(v.createdAt),updatedAt:new Date(v.updatedAt),finalizedAt:null}).returning();await children(value);return readReview(tx,actor,r);},
        update:async(value,version)=>{
          // Replace children while the parent is still Draft; terminal update then freezes both.
          await children(value);
          const [r]=await tx.update(weeklyReview).set({note:value.note,status:value.status,version:value.version,updatedAt:new Date(value.updatedAt),finalizedAt:value.finalizedAt?new Date(value.finalizedAt):null}).where(and(eq(weeklyReview.ownerId,actor.userId),eq(weeklyReview.id,value.id),eq(weeklyReview.status,"draft"),eq(weeklyReview.version,version))).returning();if(!r)throw new ApplicationError("CONFLICT","This weekly review changed elsewhere.");return readReview(tx,actor,r);
        },
      });
    })),
  };
}
