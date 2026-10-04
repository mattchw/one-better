import { deriveFocusAvailability } from '../src/modules/availability/domain';
import { weekRange, busyTotals } from '../src/modules/calendar/domain';
import { randomUUID } from 'node:crypto';
import type { ContextSources } from '../src/modules/coaching/context';
import type { CoachingContext, Recommendation,ReviewInsight } from '../src/modules/coaching/domain';
export function contextFixture():ContextSources {
  const goal=randomUUID(),action=randomUUID(),commitment=randomUUID(),planId=randomUUID(),at='2026-10-01T08:00:00.000Z';
  const snapshot={goal:{id:goal,title:'Improve onboarding',outcome:'People can plan a first week'},action:{id:action,title:'Build review flow',doneWhen:'The small flow is usable',estimateMinutes:180},milestone:null};
  const source={actionVersion:1,goalId:goal,goalVersion:1,milestoneId:null,milestoneVersion:null};
  const selected={id:commitment,planId,actionId:action,budgetMinutes:150,snapshot,source,createdAt:at,updatedAt:at};
  const plan={id:planId,weekStartDate:'2026-10-05',timezone:'Europe/London',state:'committed' as const,version:3,provisionalCapacityMinutes:600,reserveMinutes:120,commitments:[selected],createdAt:at,updatedAt:at,committedAt:at};
  const cycle={id:randomUUID(),title:'Make the loop useful',intent:'Ship small slices',startDate:'2026-10-01',endDate:'2026-11-30',status:'active' as const,version:2,createdAt:at,updatedAt:at,activatedAt:at,finishedAt:null,archivedAt:null,goals:[{goalId:goal,goalVersion:1,title:snapshot.goal.title,outcome:snapshot.goal.outcome,archivedAt:null}]};
  const hours={id:randomUUID(),version:1,windows:[{weekday:1,startMinute:540,endMinute:1020}],createdAt:at,updatedAt:at};
  const availability=deriveFocusAvailability(hours,{weekStartDate:plan.weekStartDate,timezone:plan.timezone,status:'fresh',intervals:[],...busyTotals([],weekRange(plan.weekStartDate,plan.timezone)),fetchedAt:'2026-10-03T09:00:00Z',error:null},Date.parse('2026-10-03T09:00:00Z'));
  return {requestTime:'2026-10-03T09:00:00Z',scope:{contextType:'calendar',week:plan.weekStartDate},cycles:{current:cycle,cycles:[cycle],today:'2026-10-03',timezone:'Europe/London'},workspace:{weekStartDate:plan.weekStartDate,currentWeekStartDate:'2026-09-28',timezone:'Europe/London',canCreate:true,savedWeeks:[],view:{plan,sources:[],issues:[],summary:{usableMinutes:480,totalMinutes:150,remainingMinutes:330},canCommit:false}},scheduling:{planId,weekStartDate:plan.weekStartDate,timezone:plan.timezone,userTimezone:plan.timezone,planVersion:3,canSchedule:true,commitments:[{...selected,scheduledMinutes:45,recordedMilliseconds:600000}],blocks:[]},effective:{...plan,commitments:[selected]},sources:[{actionId:action,source,context:snapshot,eligible:true,reason:null}],availability,hours,review:null,recent:[],outcomes:[{outcome:'partial',count:1}]};
}
export function suggestions(context:CoachingContext):Recommendation[] {
  const signal=context.signals.find(s=>s.worthConsidering);
  if(!signal)return [];
  const candidate=context.scheduleCandidates.find(c=>signal.candidateIds.includes(c.id));
  const common={signalId:signal.id,rationale:'Protecting manageable work can help follow through while preserving flexibility.',evidenceRefs:signal.evidenceRefs};
  return candidate?[{type:'schedule_candidate',candidateId:candidate.id,...common}]:[{type:context.contextType==='weekly_review'?'review_plan':'observation',...common}];
}
export function reviewSuggestions(context:CoachingContext):ReviewInsight[]{
 const candidate=context.reviewCandidates?.[0];if(!candidate)return [];
 return [{candidateId:candidate.id,interpretation:candidate.type==='repeated_carry'?'A changed approach may distinguish renewed intent from an unchanged attempt.':candidate.type==='focus_cycle_attention_gap'?'An absence of explicit commitment may be intentional or may invite a deliberate choice.':'Separating protected time from recorded execution can clarify where a change would be useful.',reflectionQuestion:candidate.following.scheduledMinutes>0?'Given that the following plan protects time, is any further change actually needed?':candidate.type==='repeated_carry'?'Which condition would make a fresh attempt meaningfully different?':'Was the issue how much time was protected, or what happened during execution?'}];
}
export const coachingOutput=(context:CoachingContext,empty=false)=>context.contextType==='weekly_review'?{insights:empty?[]:reviewSuggestions(context)}:{recommendations:empty?[]:suggestions(context)};
