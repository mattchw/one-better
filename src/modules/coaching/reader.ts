import type { Actor } from '../../domain/actor';
import { buildContext } from './context';
import type { CoachingScope } from './domain';
import type { CycleWorkspace } from '../focus-cycles/domain';
import type { WeekWorkspace, PlanningSource } from '../planning/domain';
import type { EffectivePlan } from '../amendments/domain';
import type { SchedulingView } from '../scheduling/domain';
import type { FocusWorkspace } from '../availability/service';
import type { ReviewWorkspace } from '../weekly-reviews/domain';
import {addDays} from '../planning/domain';
export function coachingContextReader(deps:{
  clock?:()=>string;
  cycles:(actor:Actor)=>Promise<CycleWorkspace>;
  planning:(actor:Actor,week:string)=>Promise<WeekWorkspace>;
  candidates:(actor:Actor)=>Promise<PlanningSource[]>;
  scheduling:(actor:Actor,id:string)=>Promise<SchedulingView>;
  effective:(actor:Actor,id:string)=>Promise<EffectivePlan>;
  availability:(actor:Actor,week:string)=>Promise<FocusWorkspace>;
  review:(actor:Actor,week?:string)=>Promise<ReviewWorkspace>;
  outcomes:(actor:Actor,planId:string)=>Promise<{outcome:string|null;count:number}[]>;
}) {
  return async(actor:Actor,scope:CoachingScope,requestTime=deps.clock?.()??new Date().toISOString())=>{
    const [cycles,workspace,reviews,followingWorkspace]=await Promise.all([deps.cycles(actor),deps.planning(actor,scope.week),deps.review(actor,scope.contextType==='weekly_review'?scope.week:undefined),scope.contextType==='weekly_review'?deps.planning(actor,addDays(scope.week,7)):null]);
    const plan=workspace.view?.plan;
    const [scheduling,effective,advisory,candidates,outcomes]=await Promise.all([
      plan?.state==='committed'?deps.scheduling(actor,plan.id):null,
      plan?.state==='committed'?deps.effective(actor,plan.id):null,
      scope.contextType==='calendar'?deps.availability(actor,scope.week):null,
      deps.candidates(actor),
      scope.contextType==='calendar'&&plan?deps.outcomes(actor,plan.id):[],
    ]);
    const weeks=reviews.weeks.filter(w=>w.weekStartDate<scope.week).slice(0,4);
    const recent=await Promise.all(weeks.map(w=>deps.review(actor,w.weekStartDate)));
    const followingPlan=followingWorkspace?.view?.plan;
    const [followingEffective,followingScheduling]=await Promise.all([followingPlan?.state==='committed'?deps.effective(actor,followingPlan.id):null,followingPlan?.state==='committed'?deps.scheduling(actor,followingPlan.id):null]);
    const sources=new Map([...candidates,...workspace.view?.sources??[],...reviews.facts?.commitments.flatMap(c=>c.source?[c.source]:[])??[]].map(s=>[s.actionId,s]));
    return buildContext({scope,requestTime,cycles,workspace,scheduling,effective,sources:[...sources.values()],availability:advisory?.availability??null,hours:advisory?.schedule??null,review:scope.contextType==='weekly_review'?reviews.facts:null,recent:recent.flatMap(r=>r.facts?[r.facts]:[]),outcomes,...followingWorkspace?{following:{workspace:followingWorkspace,effective:followingEffective,scheduling:followingScheduling}}:{}});
  };
}
