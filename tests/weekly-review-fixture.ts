import {randomUUID} from "node:crypto";
import type {Database} from "../src/db/connect";
import type {Actor} from "../src/domain/actor";
import {goalService} from "../src/modules/goals/service";
import {goalRepository} from "../src/modules/goals/repository";
import {actionService} from "../src/modules/actions/service";
import {actionRepository} from "../src/modules/actions/repository";
import {planService} from "../src/modules/planning/service";
import {planRepository} from "../src/modules/planning/repository";
import {amendmentService} from "../src/modules/amendments/service";
import {amendmentRepository} from "../src/modules/amendments/repository";
import {schedulingService} from "../src/modules/scheduling/service";
import {schedulingRepository} from "../src/modules/scheduling/repository";
import {focusService} from "../src/modules/focus/service";
import {focusRepository} from "../src/modules/focus/repository";
import {reviewService} from "../src/modules/reviews/service";
import {reviewRepository} from "../src/modules/reviews/repository";
import {weeklyReviewService} from "../src/modules/weekly-reviews/service";
import {weeklyReviewRepository} from "../src/modules/weekly-reviews/repository";
import {addDays} from "../src/modules/planning/domain";
export async function weeklyFixture(db:Database,actor:Actor,week="2026-10-05") {
 let instant="2026-09-25T12:00:00.000Z";const clock=()=>instant;
 const goals=goalService(goalRepository(db),clock),actions=actionService(actionRepository(db),clock),plans=planService(planRepository(db),clock),amends=amendmentService(amendmentRepository(db),clock),schedule=schedulingService(schedulingRepository(db,()=>new Date(clock())),clock),focus=focusService(focusRepository(db),clock),daily=reviewService(reviewRepository(db),clock),reviews=weeklyReviewService(weeklyReviewRepository(db),clock);
 const goal=await goals.createGoal(actor,{mutationId:randomUUID(),title:"A useful planning practice",outcome:"Make decisions using an honest finished-week review"});
 const sources: import("../src/modules/actions/domain").Action[]=[];for(const title of ["Build weekly review flow","Test persistence and concurrency","Polish a complicated dashboard","Investigate production support"]){const a=await actions.createAction(actor,goal.id,{mutationId:randomUUID(),title,estimateMinutes:240,doneWhen:"A small usable outcome is delivered"});sources.push(a);}
 const candidates=await plans.candidates(actor),selection=(index:number,budgetMinutes:number)=>({actionId:sources[index].id,budgetMinutes,source:candidates.find(c=>c.actionId===sources[index].id)!.source});
 let plan=await plans.create(actor,{mutationId:randomUUID(),weekStartDate:week,provisionalCapacityMinutes:720,reserveMinutes:180});
 plan=await plans.save(actor,plan.id,{mutationId:randomUUID(),expectedVersion:1,provisionalCapacityMinutes:720,reserveMinutes:180,commitments:[selection(0,180),selection(1,120),selection(2,60)]});plan=await plans.commit(actor,plan.id,{mutationId:randomUUID(),expectedVersion:2});
 async function block(index:number,date:string,startTime:string,endTime:string){const history=await amends.history(actor,plan.id),commitment=history.effective.commitments.find(c=>c.actionId===sources[index].id)!;const input={commitmentId:commitment.id,date,startTime,endTime},p=await schedule.preview(actor,plan.id,input);return schedule.create(actor,plan.id,{...input,mutationId:randomUUID(),expectedPlanVersion:p.planVersion,reviewKey:p.reviewKey,acknowledgeOutsideHours:true,acknowledgeBusy:false});}
 const blocks=[await block(0,addDays(week,1),"10:00","12:00"),await block(1,addDays(week,2),"14:00","15:00"),await block(2,addDays(week,3),"11:00","12:00")];
 const cancelled=await block(2,addDays(week,3),"13:00","14:00");await schedule.cancel(actor,cancelled.id,{mutationId:randomUUID(),expectedVersion:1});
 instant=`${addDays(week,2)}T08:00:00.000Z`;
 await amends.confirm(actor,plan.id,{mutationId:randomUUID(),expectedVersion:3,provisionalCapacityMinutes:540,reserveMinutes:120,reason:"Production support reduced capacity; defer dashboard polish and add a small investigation.",commitments:[{actionId:sources[0].id,budgetMinutes:180},{actionId:sources[1].id,budgetMinutes:120},selection(3,45)]});
 instant=`${addDays(week,4)}T08:00:00.000Z`;
 await amends.confirm(actor,plan.id,{mutationId:randomUUID(),expectedVersion:4,provisionalCapacityMinutes:540,reserveMinutes:150,reason:"Protect recovery and reduce the review-flow budget.",commitments:[{actionId:sources[0].id,budgetMinutes:150},{actionId:sources[1].id,budgetMinutes:120},{actionId:sources[3].id,budgetMinutes:45}]});
 // Session timestamps can precede amendment metadata: authoritative independent execution facts.
 async function session(blockId:string,from:string,to:string,outcome:"completed"|"partial"|"abandoned") {instant=from;const s=await focus.start(actor,blockId,{mutationId:randomUUID(),expectedBlockVersion:1,acknowledgeRemoved:true});instant=to;return focus.end(actor,s.id,{mutationId:randomUUID(),expectedVersion:1,outcome,endNote:outcome==="partial"?"Interrupted; tests remain.":outcome==="abandoned"?"Production incident interrupted the attempt.":"Core behavior implemented."});}
 await session(blocks[0].id,`${addDays(week,1)}T09:00Z`,`${addDays(week,1)}T09:58Z`,"completed");await session(blocks[1].id,`${addDays(week,2)}T13:00Z`,`${addDays(week,2)}T13:43Z`,"partial");await session(blocks[1].id,`${addDays(week,2)}T14:00Z`,`${addDays(week,2)}T14:05Z`,"abandoned");
 instant=`${addDays(week,4)}T18:00Z`;await actions.completeAction(actor,sources[3].id,{mutationId:randomUUID(),expectedVersion:1});
 for(const [day,note] of [[0,"Clear original intent; leave room for interruptions."],[1,"Core flow delivered, with tests still to do."],[3,"Support changed the plan; dashboard work can wait."]] as const){const r=await daily.save(actor,{mutationId:randomUUID(),localDate:addDays(week,day),reflectionId:null,expectedVersion:0,note});await daily.finalize(actor,r.id,{mutationId:randomUUID(),expectedVersion:1});}
 await daily.save(actor,{mutationId:randomUUID(),localDate:addDays(week,4),reflectionId:null,expectedVersion:0,note:"An unfinished daily draft."});
 instant=`${addDays(week,7)}T09:00:00.000Z`;
 const facts=(await reviews.workspace(actor,week)).facts!;
 const decisions=facts.commitments.filter(c=>c.source?.eligible).map(c=>({commitmentId:c.commitment.id,actionId:c.commitment.actionId,kind:(c.commitment.actionId===sources[0].id?"carry":c.commitment.actionId===sources[1].id?"defer":"drop") as "carry"|"defer"|"drop",proposedBudgetMinutes:c.commitment.actionId===sources[0].id?90:null,source:c.source!.source}));
 const save=(extra:object={})=>({mutationId:randomUUID(),planId:plan.id,reviewId:null,expectedVersion:0,note:"Keep the review focused. Support changed capacity; carry a smaller review-flow slice, defer tests, and retire the dashboard.",decisions,...extra});
 return {actor,week,goal,actions,goals,plans,amends,schedule,focus,daily,reviews,plan,sources,blocks,cancelled,facts,decisions,save,clock,setNow:(v:string)=>{instant=v;},session};
}
