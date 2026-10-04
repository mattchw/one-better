import { createHash } from 'node:crypto';
import { Temporal } from '@js-temporal/polyfill';
import type { CycleWorkspace } from '../focus-cycles/domain';
import { capacitySummary, type WeekWorkspace, type PlanningSource } from '../planning/domain';
import type { SchedulingView } from '../scheduling/domain';
import type { EffectivePlan } from '../amendments/domain';
import type { FocusAvailability, FocusableHoursSchedule } from '../availability/domain';
import type { WeeklyFacts } from '../weekly-reviews/domain';
import { scheduleCandidates } from './candidates';
import { coachingSignals } from './signals';
import type { CoachingContext, CoachingScope, Fact, Reference } from './domain';
import {reviewInsightCandidates} from './review-candidates';

export type ContextSources = { scope:CoachingScope; requestTime?:string; cycles:CycleWorkspace; workspace:WeekWorkspace; scheduling:SchedulingView|null; effective:EffectivePlan|null; sources:PlanningSource[]; availability:FocusAvailability|null; hours:FocusableHoursSchedule|null; review:WeeklyFacts|null; recent:WeeklyFacts[]; outcomes:{outcome:string|null;count:number}[]; following?:{workspace:WeekWorkspace;effective:EffectivePlan|null;scheduling:SchedulingView|null} };
export function buildContext(input:ContextSources):CoachingContext {
  const {scope,cycles,workspace}=input;
  if(scope.contextType==='weekly_review'){
    const {facts,candidates,state}=reviewInsightCandidates(input),requestTime=input.requestTime??`${cycles.today}T00:00:00Z`,timezone=input.review?.timezone??workspace.timezone;
    return {...scope,schemaVersion:3,stateFingerprint:createHash('sha256').update(canonical({facts,state,candidates})).digest('hex'),requestTime,today:Temporal.Instant.from(requestTime).toZonedDateTimeISO(timezone).toPlainDate().toString(),timezone,planId:input.review?.plan.id??null,facts,signals:[],scheduleCandidates:[],reviewCandidates:candidates};
  }
  return buildCalendarContext(input);
}
// Calendar retains the R5E packet, signals, candidates and fingerprint semantics.
function buildCalendarContext(input:ContextSources):CoachingContext {
  const {scope,cycles,workspace,scheduling,effective,availability,hours}=input;
  // Enforce purpose at the whitelist itself, even if a caller supplies a Review.
  const review=scope.contextType==='weekly_review'?input.review:null;
  const facts:Fact[]=[];
  const add=(key:string,label:string,data:Record<string,unknown>,reference:Reference|null=null)=>{if(!facts.some(f=>f.key===key))facts.push({key,label,data,reference});};
  const entity=(kind:Reference['kind'],id:string,label:string,data:Record<string,unknown>)=>add(`${kind}:${id}`,label,data,{kind,id});
  const cycle=cycles.current;
  if(cycle){entity('focus_cycle',cycle.id,`Current Focus: ${cycle.title}`,{title:cycle.title,intent:cycle.intent,startDate:cycle.startDate,endDate:cycle.endDate,version:cycle.version,goalIds:cycle.goals.map(g=>g.goalId)});for(const g of cycle.goals)entity('goal',g.goalId,`Current Focus includes ${g.title}`,{title:g.title,outcome:g.outcome,version:g.goalVersion,archived:!!g.archivedAt,currentFocus:true});}
  const plan=review?.plan??workspace.view?.plan;
  if(plan){const current=review?.effective??effective??plan;entity('plan',plan.id,`Week ${scope.week}: ${plan.state} plan`,{state:plan.state,version:plan.version,timezone:plan.timezone,original:capacitySummary(plan),current:capacitySummary(current)});}
  const commitments=review?review.commitments.map(c=>({id:c.commitment.id,actionId:c.commitment.actionId,snapshot:c.commitment.snapshot,budgetMinutes:c.latestBudgetMinutes,scheduledMinutes:c.scheduledMilliseconds/60000,recordedMilliseconds:c.recordedMilliseconds,inEffectivePlan:c.inFinalPlan})):scheduling?.commitments.map(c=>({...c,inEffectivePlan:true}))??plan?.commitments.map(c=>({...c,snapshot:workspace.view?.sources.find(s=>s.actionId===c.actionId)?.context??null,scheduledMinutes:0,recordedMilliseconds:0,inEffectivePlan:true}))??[];
  for(const c of commitments){if(!c.snapshot)continue;
    entity('goal',c.snapshot.goal.id,`Goal: ${c.snapshot.goal.title}`,{title:c.snapshot.goal.title,outcome:c.snapshot.goal.outcome,currentFocus:!!cycle?.goals.some(g=>g.goalId===c.snapshot!.goal.id)});
    entity('action',c.actionId,`Action: ${c.snapshot.action.title}`,{title:c.snapshot.action.title,doneWhen:c.snapshot.action.doneWhen,estimateMinutes:c.snapshot.action.estimateMinutes,goalId:c.snapshot.goal.id});
    entity('commitment',c.id,`${c.snapshot.action.title}: ${c.budgetMinutes}m committed, ${c.scheduledMinutes}m scheduled, ${Math.max(0,c.budgetMinutes-c.scheduledMinutes)}m still unscheduled, ${c.recordedMilliseconds/60000}m recorded Focus`,{actionId:c.actionId,goalId:c.snapshot.goal.id,title:c.snapshot.action.title,budgetMinutes:c.budgetMinutes,scheduledMinutes:c.scheduledMinutes,unscheduledMinutes:Math.max(0,c.budgetMinutes-c.scheduledMinutes),recordedMilliseconds:c.recordedMilliseconds,inEffectivePlan:c.inEffectivePlan});
  }
  const selected=new Set(commitments.map(c=>c.actionId));
  // Current-plan sources are never truncated. Optional cycle candidates are selective.
  const relevant=input.sources.filter(s=>selected.has(s.actionId));
  relevant.push(...input.sources.filter(s=>!selected.has(s.actionId)&&s.eligible&&cycle?.goals.some(g=>g.goalId===s.context.goal.id)).slice(0,12));
  for(const s of relevant){entity('action',s.actionId,`Action: ${s.context.action.title}`,{title:s.context.action.title,goalId:s.context.goal.id,doneWhen:s.context.action.doneWhen,estimateMinutes:s.context.action.estimateMinutes});
    add(`source:${s.actionId}`,`${s.context.action.title}: ${s.eligible?'eligible for deliberate planning':'read-only source'}`,{source:s.source,eligible:s.eligible,title:s.context.action.title,doneWhen:s.context.action.doneWhen,estimateMinutes:s.context.action.estimateMinutes});}
  const blocks=review?review.commitments.flatMap(c=>c.blocks):scheduling?.blocks??[];
  for(const b of blocks)entity('time_block',b.id,`${b.snapshot.action.title}: ${b.state} block ${b.start}–${b.end}`,{commitmentId:b.commitmentId,state:b.state,start:b.start,end:b.end,version:b.version});
  if(scope.contextType==='calendar'){
    add('availability','Current availability is advisory',availability?{status:availability.status,timezone:availability.timezone,hoursVersion:hours?.version??0,focusableMinutes:availability.focusableMinutes,openMinutes:availability.openMinutes}:{status:'unavailable'});
    add('execution','Recorded Focus outcomes; no tracking does not mean no work',{outcomes:input.outcomes,recordedMilliseconds:scheduling?.commitments.reduce((n,c)=>n+c.recordedMilliseconds,0)??0});

  }
  if(review){add('review_summary',`Week ${scope.week}: ${review.scheduledMilliseconds/60000}m scheduled, ${review.recordedMilliseconds/60000}m recorded`,{original:review.originalSummary,final:review.finalSummary,scheduledMilliseconds:review.scheduledMilliseconds,recordedMilliseconds:review.recordedMilliseconds,outcomes:review.commitments.flatMap(c=>c.sessions.map(s=>({outcome:s.session.outcome,recordedMilliseconds:s.recordedMilliseconds}))),amendments:review.amendments.map(a=>({sequence:a.sequenceNumber,reason:a.reason}))});
    if(review.review?.status==='finalized')add('weekly_reflection','Finalized weekly reflection',{note:review.review.note,finalizedAt:review.review.finalizedAt,decisions:review.review.decisions.map(d=>({commitmentId:d.commitmentId,kind:d.kind,proposedBudgetMinutes:d.proposedBudgetMinutes}))});
    for(const day of review.daily)if(day.state==='finalized'&&day.reflection&&day.reflection.status==='finalized'&&day.reflection.finalizedAt&&(!review.review?.finalizedAt||Date.parse(day.reflection.finalizedAt)<=Date.parse(review.review.finalizedAt)))add(`daily_reflection:${day.date}`,`Finalized daily reflection: ${day.date}`,{date:day.date,note:day.reflection.note,finalizedAt:day.reflection.finalizedAt});
  }
  const relevantGoals=new Set(facts.filter(f=>f.reference?.kind==='goal').map(f=>f.reference!.id));
  for(const history of input.recent.slice(0,4))add(`history:${history.plan.weekStartDate}`,`Recent week ${history.plan.weekStartDate}: ${history.recordedMilliseconds/60000}m recorded`,{week:history.plan.weekStartDate,originalBudgetMinutes:history.originalSummary.totalMinutes,finalBudgetMinutes:history.finalSummary.totalMinutes,scheduledMilliseconds:history.scheduledMilliseconds,recordedMilliseconds:history.recordedMilliseconds,goals:history.commitments.filter(c=>relevantGoals.has(c.commitment.snapshot.goal.id)).map(c=>({goalId:c.commitment.snapshot.goal.id,actionId:selected.has(c.commitment.actionId)?c.commitment.actionId:null,title:c.commitment.snapshot.action.title,recordedMilliseconds:c.recordedMilliseconds,decision:history.review?.status==='finalized'?history.review.decisions.find(d=>d.commitmentId===c.commitment.id)?.kind??null:null}))});
  const requestTime=input.requestTime??`${cycles.today}T00:00:00Z`;
  const candidates=scheduleCandidates(input,requestTime);
  for(const c of candidates)add(c.id,`${c.localDate} ${c.startLocalTime}–${c.endLocalTime} ${scheduling!.timezone}: ${c.durationMinutes}m Calendar-open inside Focusable Hours; ${c.remainingUnscheduledMinutes}m still unscheduled`,{...c});
  const signals=coachingSignals(input,facts,candidates,requestTime);
  // Keep the mutation fingerprint of the full whitelist, but do not ask a model
  // to rediscover patterns from raw block/history/source rows or estimates.
  const stateFingerprint=createHash('sha256').update(canonical(facts)).digest('hex');
  const needed=new Set([...signals.flatMap(s=>s.evidenceRefs),...candidates.map(c=>c.id)]);
  const limited=facts.filter(f=>needed.has(f.key)||['focus_cycle','goal','plan'].includes(f.reference?.kind??'')||f.key==='availability'||f.key==='execution'||f.key==='weekly_reflection'||f.key.startsWith('daily_reflection:'));
  return {...scope,schemaVersion:2,stateFingerprint,requestTime,today:Temporal.Instant.from(requestTime).toZonedDateTimeISO(plan?.timezone??workspace.timezone).toPlainDate().toString(),timezone:plan?.timezone??workspace.timezone,planId:plan?.id??null,facts:limited.sort((a,b)=>a.key.localeCompare(b.key)),signals,scheduleCandidates:candidates};
}
// Canonical object-key order makes JSONB round trips/fresh identical fetches stable.
export function canonical(value:unknown):string {
  if(Array.isArray(value))return `[${value.map(canonical).join(',')}]`;
  if(value&&typeof value==='object')return `{${Object.keys(value).sort().map(key=>`${JSON.stringify(key)}:${canonical((value as Record<string,unknown>)[key])}`).join(',')}}`;
  return JSON.stringify(value)??'null';
}
// The exact request instant is authoritative but not a material fact by itself.
// Candidate expiry, local-day rollover and elapsed-work signals change the digest.
export const fingerprint=(context:CoachingContext)=>{const {requestTime:_time,...facts}=context;void _time;return createHash('sha256').update(canonical(facts)).digest('hex');};
