import { Temporal } from '@js-temporal/polyfill';
import type { ContextSources } from './context';
import type { CoachingSignal, Fact, ScheduleCandidate } from './domain';

// Facts, not assessments. Thresholds describe a decision worth considering and
// are shared by all providers. Fully scheduled work remains evidence, not advice.
export function coachingSignals(input:ContextSources, facts:Fact[], candidates:ScheduleCandidate[], requestTime:string):CoachingSignal[] {
  const result:CoachingSignal[]=[], review=input.scope.contextType==='weekly_review'?input.review:null;
  const commitments=facts.filter(f=>f.reference?.kind==='commitment'&&f.data.inEffectivePlan===true);
  const add=(kind:CoachingSignal['kind'],title:string,refs:string[],target:CoachingSignal['target'],worthConsidering=true,candidateIds:string[]=[])=>{
    result.push({id:`signal_${kind}_${target?.id??'week'}`,kind,title,evidenceRefs:refs,target,worthConsidering,candidateIds});
  };
  for (const c of commitments) {
    const budget=Number(c.data.budgetMinutes), scheduled=Number(c.data.scheduledMinutes), remaining=Number(c.data.unscheduledMinutes), recorded=Number(c.data.recordedMilliseconds), action=String(c.data.actionId);
    const slots=candidates.filter(s=>s.commitmentId===c.reference!.id).map(s=>s.id);
    if (!review && remaining>=60 && remaining>=budget/4) add('unscheduled',String(c.data.title),[c.key,...facts.some(f=>f.key===`goal:${c.data.goalId}`)?[`goal:${c.data.goalId}`]:[]],c.reference,true,slots);
    if (!review && budget>0 && scheduled>=budget) add('fully_scheduled',String(c.data.title),[c.key],c.reference,false);
    const elapsed=input.scheduling?.blocks.some(b=>b.commitmentId===c.reference!.id&&b.state==='planned'&&Temporal.Instant.compare(b.end,requestTime)<0);
    if (!review && recorded===0 && elapsed) add('unrecorded',String(c.data.title),[c.key,'execution'],c.reference);
    if (review && budget>=60 && Math.abs(budget-recorded/60000)>=Math.max(60,budget/2)) add('execution_difference',String(c.data.title),[c.key,'review_summary'],c.reference);
    // Consecutive finalized reviewed weeks, ending immediately before this week.
    // A missing/draft week or non-Carry decision breaks the pattern.
    const carryRefs:string[]=[];
    let week=Temporal.PlainDate.from(input.scope.week).subtract({days:7});
    for (let n=0;n<4;n++,week=week.subtract({days:7})) {
      const history=input.recent.find(h=>h.plan.weekStartDate===week.toString());
      const prior=history?.commitments.find(p=>p.commitment.actionId===action);
      if (!prior || history?.review?.status!=='finalized' || history.review.decisions.find(d=>d.commitmentId===prior.commitment.id)?.kind!=='carry') break;
      carryRefs.push(`history:${week}`);
    }
    if (carryRefs.length>=2) {
      const key=`carry:${action}`;
      facts.push({key,label:`${c.data.title}: Carry chosen in ${carryRefs.length} consecutive finalized prior weeks`,reference:null,data:{actionId:action,consecutiveCarries:carryRefs.length,weeks:carryRefs.map(k=>k.slice(8))}});
      add('repeated_carry',String(c.data.title),[c.key,key],c.reference);
    }
  }
  for (const goal of input.cycles.current?.goals??[]) {
    const key=`goal:${goal.goalId}`;
    if (goal.archivedAt || !facts.some(f=>f.key===key)) continue;
    if (!commitments.some(c=>c.data.goalId===goal.goalId)) add('focus_without_commitment',goal.title,[key],{kind:'goal',id:goal.goalId});
    const recent=input.recent.filter(h=>h.review?.status==='finalized').slice(0,2);
    if (recent.length===2 && recent.every(h=>!h.commitments.some(c=>c.commitment.snapshot.goal.id===goal.goalId&&c.recordedMilliseconds>0)) && !commitments.some(c=>c.data.goalId===goal.goalId&&Number(c.data.scheduledMinutes)>0)) {
      const evidence=`attention:${goal.goalId}`;
      facts.push({key:evidence,label:`${goal.title}: no recorded Focus in the most recent finalized reviewed weeks`,reference:null,data:{goalId:goal.goalId,weeks:recent.map(h=>h.plan.weekStartDate)}});
      add('attention',goal.title,[key,evidence],{kind:'goal',id:goal.goalId});
    }
  }
  if (review && review.amendments.length && Math.abs(review.finalSummary.totalMinutes-review.originalSummary.totalMinutes)>=60) add('amendment','Review the change in committed work',['review_summary'],{kind:'plan',id:review.plan.id});
  // Deterministic priority: protect bounded committed work, then reconsideration.
  return result.sort((a,b)=>Number(b.worthConsidering)-Number(a.worthConsidering)||a.id.localeCompare(b.id)).slice(0,12);
}
