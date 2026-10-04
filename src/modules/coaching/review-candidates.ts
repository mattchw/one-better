import {createHash} from 'node:crypto';
import {Temporal} from '@js-temporal/polyfill';
import {addDays} from '../planning/domain';
import type {ContextSources} from './context';
import type {Fact,Reference,ReviewInsightCandidate} from './domain';

// A bounded, read-only Review contract. Amounts describe records, never success,
// required effort, a productivity score, or a causal explanation.
export function reviewInsightCandidates(input:ContextSources) {
 const review=input.review,facts:Fact[]=[],candidates:ReviewInsightCandidate[]=[];
 const week=input.scope.week,followingWeek=addDays(week,7),cycle=input.cycles.current;
 const add=(key:string,label:string,data:Record<string,unknown>,reference:Reference|null=null)=>{
  if(!facts.some(f=>f.key===key))facts.push({key,label,data,reference});return key;
 };
 const commonBoundary=['Interpret the supplied relationship only; factual names, quantities, dates, decisions and history belong in server Evidence.','Recorded Focus is not completion; missing recorded Focus is not proof of no work.','Ask a conditional useful question; never choose Carry, Defer or Drop, prescribe scheduling, or invent work.','No inferred causal explanation, unsupported history, ratings or score.'];
 // Include state dependencies even when they suppress every candidate. That
 // makes saved insights stale when a source, Focus Cycle or next plan changes.
 const state={cycle:cycle?{id:cycle.id,version:cycle.version,start:cycle.startDate,end:cycle.endDate,goals:cycle.goals.map(g=>({id:g.goalId,version:g.goalVersion,archived:g.archivedAt})).sort((a,b)=>a.id.localeCompare(b.id))}:null,
  sources:input.sources.map(s=>({id:s.actionId,source:s.source,eligible:s.eligible,reason:s.reason})).sort((a,b)=>a.id.localeCompare(b.id)),
  review:review?{id:review.review?.id,version:review.review?.version,status:review.review?.status,cutoff:review.review?.finalizedAt,planVersion:review.plan.version}:null};
 const next=input.following,plan=next?.workspace.view?.plan;
 const nextCommitments=plan?.state==='committed'?next?.effective?.commitments??plan.commitments:plan?.commitments??[];
 const nextState=plan?.state??'absent';
 const nextFor=(actionId:string|null,goalId:string):ReviewInsightCandidate['following']=>{
  const matching=nextCommitments.filter(c=>actionId?c.actionId===actionId:(c.snapshot?.goal.id??next?.workspace.view?.sources.find(s=>s.actionId===c.actionId)?.context.goal.id)===goalId);
  return {state:nextState,budgetMinutes:matching.reduce((n,c)=>n+c.budgetMinutes,0),scheduledMinutes:matching.reduce((n,c)=>n+(next?.scheduling?.commitments.find(s=>s.id===c.id)?.scheduledMinutes??0),0),carryIntentMinutes:null as number|null};
 };
 const followingFact=(actionId:string|null,goalId:string,title:string)=>{
  const value=nextFor(actionId,goalId);
  const carry=review?.review?.status==='finalized'?review.review.decisions.find(d=>d.actionId===actionId&&d.kind==='carry'):null;
  value.carryIntentMinutes=carry?.proposedBudgetMinutes??null;
  const key=add(`following:${actionId??goalId}`,`Following week ${followingWeek}: ${value.state==='absent'?'no saved plan':`${value.state} plan; ${value.budgetMinutes}m selected and ${value.scheduledMinutes}m scheduled for ${title}`}\n${carry?`Human Carry intent: ${carry.proposedBudgetMinutes}m; selection in the next plan is recorded separately.`:''}`.trim(),{week:followingWeek,...value});
  return {key,value};
 };
 // Only terminal-cutoff-approved text is shared; draft/late/session bodies are
 // never accessed here. All permitted text remains data, not model instructions.
 const reflectionFacts:Fact[]=[];
 if(review){
  if(review.review?.status==='finalized'&&review.review.finalizedAt){
   const key=add('weekly_reflection','Finalized weekly reflection',{note:review.review.note,finalizedAt:review.review.finalizedAt});reflectionFacts.push(facts.find(f=>f.key===key)!);
  }
  for(const day of review.daily){const r=day.reflection;
   if(day.state!=='finalized'||r?.status!=='finalized'||!r.finalizedAt||review.review?.finalizedAt&&Date.parse(r.finalizedAt)>Date.parse(review.review.finalizedAt))continue;
   const key=add(`daily_reflection:${day.date}`,`Finalized daily reflection: ${day.date}`,{date:day.date,note:r.note,finalizedAt:r.finalizedAt});reflectionFacts.push(facts.find(f=>f.key===key)!);
  }
 }
 const reflect=(dates:Set<string>)=>reflectionFacts.filter(f=>/\b(interrupt\w*|blocker\w*|disrupt\w*|incident\w*|support|distract\w*|unexpected|displac\w*)\b/i.test(String(f.data.note))&&(f.key==='weekly_reflection'||dates.has(String(f.data.date)))).map(f=>{
  const key=`reflection_context:${f.key}`;
  add(key,`${f.label}: ${String(f.data.note).slice(0,360)}${String(f.data.note).length>360?'…':''}`,{reflectionKey:f.key,note:f.data.note});return key;
 });
 const addCandidate=(type:ReviewInsightCandidate['type'],title:string,subjects:Reference[],refs:string[],reflectionRefs:string[],following:ReviewInsightCandidate['following'],boundary:string[])=>{
  if(new Set(refs).size<2)return; // A Goal's membership alone is never eligible.
  const id=`review_insight_${createHash('sha256').update(JSON.stringify({type,week,subjects})).digest('hex').slice(0,24)}`;
  candidates.push({id,type,title,subjects,evidenceRefs:[...new Set(refs)],week,followingWeek,reflectionRefs,following,allowedInterpretation:[...commonBoundary,...boundary,...reflectionRefs.length?['Reflection text is supporting user-reported context beside the recorded relationship, not an established cause.']:['No permitted relevant reflection explains this relationship; do not invent an interruption, blocker, motivation or reason.'],...following.scheduledMinutes>0?['The following plan already protects time. Do not suggest protecting or prioritizing more time; ask whether any further change is actually needed.']:[]]});
 };
 if(!review)return {facts,candidates,state:{...state,following:null}};
 add('review_summary',`Week ${week}: ${review.originalSummary.totalMinutes}m baseline commitments → ${review.finalSummary.totalMinutes}m final commitments; ${review.scheduledMilliseconds/60000}m scheduled; ${review.recordedMilliseconds/60000}m recorded Focus`,{original:review.originalSummary,final:review.finalSummary});
 const eligible=(actionId:string,goalId:string)=>input.sources.some(s=>s.actionId===actionId&&s.eligible)&&(!cycle||cycle.goals.some(g=>g.goalId===goalId&&!g.archivedAt));
 for(const entry of [...review.commitments].sort((a,b)=>a.commitment.id.localeCompare(b.commitment.id))){
  const c=entry.commitment,goal=c.snapshot.goal;
  if(!eligible(c.actionId,goal.id))continue;
  const decision=review.review?.status==='finalized'?review.review.decisions.find(d=>d.commitmentId===c.id):null;
  if(decision?.kind==='defer'||decision?.kind==='drop')continue;
  const recorded=entry.recordedMilliseconds/60000,scheduled=entry.scheduledMilliseconds/60000,budget=entry.latestBudgetMinutes;
  const carries:{week:string;minutes:number|null}[]=[];
  // Count distinct adjacent finalized reviews, not duplicate commitment entries.
  const histories=[review,...input.recent].sort((a,b)=>b.plan.weekStartDate.localeCompare(a.plan.weekStartDate));
  let date=review.review?.status==='finalized'?week:addDays(week,-7);
  for(let n=0;n<5;n++,date=addDays(date,-7)){
   const h=histories.find(h=>h.plan.weekStartDate===date);
   const d=h?.review?.status==='finalized'?h.review.decisions.find(d=>d.actionId===c.actionId&&d.kind==='carry'):null;
   if(!d)break;carries.push({week:date,minutes:d.proposedBudgetMinutes});
  }
  const gap=budget>=60&&budget-recorded>=Math.max(60,budget/2);
  if(!gap&&carries.length<2)continue;
  const ref:Reference={kind:'commitment',id:c.id};
  const amount=add(`review_commitment:${c.id}`,`${c.snapshot.action.title}: ${budget}m committed; ${scheduled}m scheduled; ${recorded}m recorded Focus in ${week}`,{budgetMinutes:budget,scheduledMinutes:scheduled,recordedMinutes:recorded,actionId:c.actionId,goalId:goal.id},ref);
  const next=followingFact(c.actionId,goal.id,c.snapshot.action.title);
  const refs=[amount,next.key],dates=new Set(entry.blocks.map(b=>Temporal.Instant.from(b.start).toZonedDateTimeISO(review.timezone).toPlainDate().toString()));
  const reflectionRefs=reflect(dates);refs.push(...reflectionRefs);
  if(carries.length>=2)refs.push(add(`review_carry:${c.actionId}`,`${c.snapshot.action.title}: human Carry decisions in ${carries.map(c=>c.week).join(', ')} (${carries.length} distinct finalized Reviews)`,{actionId:c.actionId,carries}));
  // Significant capacity/budget changes are context beside execution, not causes.
  const changed=review.amendments.filter(a=>Math.abs(a.provisionalCapacityMinutes-review.plan.provisionalCapacityMinutes)>=60||Math.abs((a.commitments.find(v=>v.actionId===c.actionId)?.budgetMinutes??0)-entry.firstBudgetMinutes)>=60);
  for(const a of changed.slice(-2)){
   const after=entry.sessions.reduce((total,s)=>total+Math.max(0,Math.min(Date.parse(s.session.endedAt??input.requestTime??review.range.end),Date.parse(review.range.end))-Math.max(Date.parse(s.session.startedAt),Date.parse(a.createdAt),Date.parse(review.range.start))),0)/60000;
   refs.push(add(`review_amendment:${a.id}:${c.id}`,`Amendment saved ${a.createdAt}: capacity ${a.provisionalCapacityMinutes}m (baseline ${review.plan.provisionalCapacityMinutes}m); Action budget ${a.commitments.find(v=>v.actionId===c.actionId)?.budgetMinutes??0}m (first committed ${entry.firstBudgetMinutes}m); ${after}m recorded Focus after this save within the reviewed week`,{date:a.createdAt,baselineCapacity:review.plan.provisionalCapacityMinutes,savedCapacity:a.provisionalCapacityMinutes,recordedAfterMinutes:after}));
  }
  addCandidate(carries.length>=2?'repeated_carry':'planning_execution_gap',c.snapshot.action.title,[ref,{kind:'action',id:c.actionId},{kind:'goal',id:goal.id}],refs,reflectionRefs,next.value,[carries.length>=2?'Examine what condition would distinguish a fresh attempt from unchanged intent; never choose the rollover decision.':'Separate how much time was protected from what happened during execution. Do not label the gap failure or assume more time is required.']);
 }
 // A historical membership gap must still be relevant to today's active cycle,
 // span the reviewed week, have an eligible source, and be unaddressed next week.
 if(cycle&&cycle.startDate<=addDays(week,6)&&cycle.endDate>=week)for(const goal of cycle.goals){
  if(goal.archivedAt||!input.sources.some(s=>s.eligible&&s.context.goal.id===goal.goalId))continue;
  if(review.commitments.some(c=>c.commitment.snapshot.goal.id===goal.goalId)||review.otherWork.some(c=>c.block.snapshot.goal.id===goal.goalId&&c.recordedMilliseconds>0))continue;
  const deferred=[review,...input.recent.slice(0,1)].some(h=>h.review?.status==='finalized'&&h.review.decisions.some(d=>d.kind==='defer'&&h.commitments.some(c=>c.commitment.actionId===d.actionId&&c.commitment.snapshot.goal.id===goal.goalId)));
  if(deferred)continue;
  const next=followingFact(null,goal.goalId,goal.title);
  if(next.value.budgetMinutes>=30&&next.value.scheduledMinutes>=30)continue;
  const refs=[add(`review_focus:${goal.goalId}`,`${goal.title} belongs to Focus Cycle ${cycle.title}, whose dates overlap ${week}`,{goalId:goal.goalId,cycleId:cycle.id,version:cycle.version},{kind:'goal',id:goal.goalId}),add(`review_attention:${goal.goalId}`,`${goal.title}: no explicit commitment or linked recorded Focus in ${week}`,{goalId:goal.goalId,week,commitments:0,recordedMinutes:0}),next.key];
  addCandidate('focus_cycle_attention_gap',goal.title,[{kind:'goal',id:goal.goalId}],refs,[],next.value,['Ask whether the absence was intentional; membership does not imply the Goal requires work this week.']);
 }
 // A plan-level amendment relationship is useful when no Action gap already
 // contains that context. Require actual recorded execution alongside a change.
 if(!candidates.some(c=>c.evidenceRefs.some(k=>k.startsWith('review_amendment:')))&&review.recordedMilliseconds>0&&review.amendments.some(a=>Math.abs(a.provisionalCapacityMinutes-review.plan.provisionalCapacityMinutes)>=60)){
  const refs=[add('review_capacity',`Capacity in ${week}: ${review.plan.provisionalCapacityMinutes}m baseline → ${review.effective.provisionalCapacityMinutes}m final; reserve ${review.plan.reserveMinutes}m → ${review.effective.reserveMinutes}m`,{baseline:review.plan.provisionalCapacityMinutes,final:review.effective.provisionalCapacityMinutes}),add('review_amendment_execution',`${review.amendments.length} amendments; ${review.recordedMilliseconds/60000}m recorded Focus in the same reviewed week`,{dates:review.amendments.map(a=>a.createdAt),recordedMinutes:review.recordedMilliseconds/60000})];
  addCandidate('amendment_execution_context','Plan changes and execution',[{kind:'plan',id:review.plan.id}],refs,[],{state:nextState,budgetMinutes:0,scheduledMinutes:0,carryIntentMinutes:null},['Consider how revised capacity and recorded execution sit beside each other; do not claim a plan change caused an outcome.']);
 }
 const priority=(c:ReviewInsightCandidate)=>c.type==='repeated_carry'?0:c.reflectionRefs.length?1:c.type==='planning_execution_gap'?2:3;
 const limited=candidates.sort((a,b)=>priority(a)-priority(b)||a.id.localeCompare(b.id)).slice(0,6);
 return {facts:facts.sort((a,b)=>a.key.localeCompare(b.key)),candidates:limited,state:{...state,following:plan?{id:plan.id,version:plan.version,state:plan.state,commitments:nextCommitments.map(c=>({id:c.id,actionId:c.actionId,budget:c.budgetMinutes})).sort((a,b)=>a.id.localeCompare(b.id)),scheduled:next?.scheduling?.blocks.map(b=>({id:b.id,version:b.version,state:b.state,start:b.start,end:b.end,commitment:b.commitmentId})).sort((a,b)=>a.id.localeCompare(b.id))}:null}};
}
