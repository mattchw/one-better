import {randomUUID} from "node:crypto";
import type {Database} from "../src/db/connect";
import type {Actor} from "../src/domain/actor";
import {goalService} from "../src/modules/goals/service";
import {goalRepository} from "../src/modules/goals/repository";
import {milestoneService} from "../src/modules/milestones/service";
import {milestoneRepository} from "../src/modules/milestones/repository";
import {actionService} from "../src/modules/actions/service";
import {actionRepository} from "../src/modules/actions/repository";
import {planService} from "../src/modules/planning/service";
import {planRepository} from "../src/modules/planning/repository";
import {amendmentService} from "../src/modules/amendments/service";
import {amendmentRepository} from "../src/modules/amendments/repository";
import {schedulingService} from "../src/modules/scheduling/service";
import {schedulingRepository} from "../src/modules/scheduling/repository";
import {addDays} from "../src/modules/planning/domain";
export async function executionFixture(db:Database,actor:Actor,week="2026-10-05",clock=()=>"2026-09-25T12:00:00.000Z"){
 const goals=goalService(goalRepository(db)),milestones=milestoneService(milestoneRepository(db)),actions=actionService(actionRepository(db)),plans=planService(planRepository(db),clock),schedule=schedulingService(schedulingRepository(db,()=>new Date(clock())),clock),amends=amendmentService(amendmentRepository(db),()=>"2026-10-06T08:45:00.123Z");
 const goal=await goals.createGoal(actor,{mutationId:randomUUID(),title:"Close the planning and doing loop",outcome:"Use a recoverable focus session for real work"});
 const milestone=await milestones.createMilestone(actor,goal.id,{mutationId:randomUUID(),title:"A trustworthy execution slice",successCondition:"Focus survives interruptions and restarts"});
 const action=await actions.createAction(actor,goal.id,{mutationId:randomUUID(),title:"Build focus-session UI",doneWhen:"Start, recover and end work deliberately",estimateMinutes:240,milestoneId:milestone.id});
 const source=(await plans.candidates(actor)).find(c=>c.actionId===action.id)!;
 let plan=await plans.create(actor,{mutationId:randomUUID(),weekStartDate:week,provisionalCapacityMinutes:720,reserveMinutes:180});
 plan=await plans.save(actor,plan.id,{mutationId:randomUUID(),expectedVersion:1,provisionalCapacityMinutes:720,reserveMinutes:180,commitments:[{actionId:action.id,budgetMinutes:180,source:source.source}]});
 plan=await plans.commit(actor,plan.id,{mutationId:randomUUID(),expectedVersion:2});
 async function create(date=addDays(week,1),startTime="10:00",endTime="12:00"){
  const input={commitmentId:plan.commitments[0].id,date,startTime,endTime},review=await schedule.preview(actor,plan.id,input);
  return schedule.create(actor,plan.id,{...input,mutationId:randomUUID(),expectedPlanVersion:review.planVersion,reviewKey:review.reviewKey,acknowledgeOutsideHours:true,acknowledgeBusy:false});
 }
 const block=await create();
 async function amend(budgets:number[]){const h=await amends.history(actor,plan.id);return amends.confirm(actor,plan.id,{mutationId:randomUUID(),expectedVersion:h.baseline.version,provisionalCapacityMinutes:720,reserveMinutes:180,reason:"Adjust intent while preserving execution",commitments:budgets.map(budgetMinutes=>({actionId:action.id,budgetMinutes,...(h.effective.commitments.some(c=>c.actionId===action.id)?{}:{source:source.source})}))});}
 return {goal,milestone,action,plan,block,create,amend,schedule,goals,actions,amends,actor};
}
