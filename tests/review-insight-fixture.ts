import {randomUUID} from 'node:crypto';
import {deriveWeek} from '../src/modules/weekly-reviews/domain';
import {addDays,capacitySummary} from '../src/modules/planning/domain';
import type {TimeBlock} from '../src/modules/scheduling/domain';
import type {FocusSession} from '../src/modules/focus/domain';
import type {DailyReflection} from '../src/modules/reviews/domain';
import {contextFixture} from './coaching-fixture';
export const reviewQualityKinds=['gap_reflection','already_addressed','repeated_carry','clean','completed','no_reflection'] as const;
export type ReviewQualityKind=typeof reviewQualityKinds[number];
export const reviewQualityWeek='2028-01-03',reviewQualityNow='2028-01-12T08:00:00Z';
export const reviewPrivacyMarkers={daily:'Production issue interrupted the planned work.',weekly:'Support changed the plan; distinguish protected time from recorded focus.',draftDaily:'PRIVATE_DRAFT_DAILY_R5F',draftWeekly:'PRIVATE_DRAFT_WEEKLY_R5F',late:'PRIVATE_LATE_DAILY_R5F',session:'PRIVATE_SESSION_NOTE_R5F',google:'PRIVATE_GOOGLE_META_R5F'};
export function reviewInsightFixture(kind:ReviewQualityKind='gap_reflection'){
 const input=contextFixture(),plan=input.workspace.view!.plan,c=plan.commitments[0],source=input.sources[0],at='2027-12-20T08:00:00Z',cutoff='2028-01-10T09:00:00Z';
 input.scope={contextType:'weekly_review',week:reviewQualityWeek};input.requestTime=reviewQualityNow;input.cycles.today='2028-01-12';input.cycles.current!.startDate='2027-12-20';input.cycles.current!.endDate='2028-01-31';
 plan.weekStartDate=reviewQualityWeek;plan.createdAt=plan.updatedAt=plan.committedAt=at;c.budgetMinutes=['clean','already_addressed'].includes(kind)?60:kind==='repeated_carry'?120:240;
 const block:TimeBlock={id:randomUUID(),planId:plan.id,commitmentId:c.id,start:'2028-01-05T09:00:00Z',end:'2028-01-05T10:00:00Z',state:'planned',version:1,createdAt:at,updatedAt:at,cancelledAt:null,snapshot:c.snapshot!};
 const session:FocusSession={id:randomUUID(),timeBlockId:block.id,startedAt:block.start,endedAt:['clean','already_addressed'].includes(kind)?block.end:'2028-01-05T09:30:00Z',outcome:kind==='completed'?'completed':'partial',endNote:reviewPrivacyMarkers.session,version:2,createdAt:block.start,updatedAt:block.end};
 const daily=(date:string,note:string,status:'draft'|'finalized',finalizedAt:string|null):DailyReflection=>({id:randomUUID(),localDate:date,note,status,version:2,createdAt:at,updatedAt:finalizedAt??cutoff,finalizedAt});
 const reflections=[daily('2028-01-05',kind==='gap_reflection'?reviewPrivacyMarkers.daily:'An ordinary record.',kind==='no_reflection'?'draft':'finalized',kind==='no_reflection'?null:'2028-01-06T08:00:00Z'),daily('2028-01-06',reviewPrivacyMarkers.draftDaily,'draft',null),daily('2028-01-07',reviewPrivacyMarkers.late,'finalized','2028-01-11T09:00:00Z')];
 if(kind==='completed')source.eligible=false;
 const review={id:randomUUID(),planId:plan.id,status:kind==='no_reflection'?'draft' as const:'finalized' as const,note:kind==='gap_reflection'?reviewPrivacyMarkers.weekly:kind==='no_reflection'?reviewPrivacyMarkers.draftWeekly:'Reflect on the recorded week.',version:2,createdAt:cutoff,updatedAt:cutoff,finalizedAt:kind==='no_reflection'?null:cutoff,decisions:kind==='completed'?[]:[{commitmentId:c.id,actionId:c.actionId,kind:'carry' as const,proposedBudgetMinutes:90,source:c.source}]};
 // Without a finalized review there is no terminal cutoff; use only draft
 // reflections in that scenario, rather than pretend an approved late note exists.
 const days=kind==='no_reflection'?reflections.filter(r=>r.status==='draft'):reflections;
 const amendments=kind==='gap_reflection'?[{id:randomUUID(),planId:plan.id,sequenceNumber:1,reason:'Support reduced capacity.',version:4,createdAt:'2028-01-05T08:00:00Z',provisionalCapacityMinutes:540,reserveMinutes:120,commitments:[{id:c.id,actionId:c.actionId,budgetMinutes:c.budgetMinutes,source:c.source,snapshot:c.snapshot!}]}]:[];
 input.review=deriveWeek(plan,amendments,plan.timezone,reviewQualityNow,[block],[session],input.sources,days,review);input.effective=input.review.effective;
 if(kind==='repeated_carry'){
  const prior=structuredClone(plan);prior.id=randomUUID();prior.weekStartDate=addDays(reviewQualityWeek,-7);prior.commitments[0].id=randomUUID();prior.commitments[0].planId=prior.id;
  input.recent=[deriveWeek(prior,[],plan.timezone,reviewQualityNow,[],[],input.sources,[],{...review,id:randomUUID(),planId:prior.id,finalizedAt:'2028-01-03T08:00:00Z',decisions:[{...review.decisions[0],commitmentId:prior.commitments[0].id}]})];
 }
 if(kind==='already_addressed'){
  const essay={...source,actionId:randomUUID(),context:{...source.context,goal:{...source.context.goal,id:randomUUID(),title:'Write a practical essay'},action:{...source.context.action,id:randomUUID(),title:'Draft an essay'}}};essay.context.action.id=essay.actionId;essay.source={...source.source,goalId:essay.context.goal.id};input.sources.push(essay);
  input.cycles.current!.goals.push({goalId:essay.context.goal.id,goalVersion:1,title:essay.context.goal.title,outcome:essay.context.goal.outcome,archivedAt:null});
  const next=structuredClone(plan);next.id=randomUUID();next.weekStartDate=addDays(reviewQualityWeek,7);next.commitments=[{...c,id:randomUUID(),planId:next.id,actionId:essay.actionId,snapshot:essay.context,source:essay.source,budgetMinutes:60}];
  input.following={workspace:{...input.workspace,weekStartDate:next.weekStartDate,view:{plan:next,sources:[],issues:[],summary:capacitySummary(next),canCommit:false}},effective:{...next,commitments:[{...next.commitments[0],snapshot:essay.context}]},scheduling:{...input.scheduling!,planId:next.id,weekStartDate:next.weekStartDate,commitments:[{...next.commitments[0],snapshot:essay.context,scheduledMinutes:60,recordedMilliseconds:0}],blocks:[{...block,id:randomUUID(),planId:next.id,commitmentId:next.commitments[0].id,start:'2028-01-13T09:00:00Z',end:'2028-01-13T10:00:00Z',snapshot:essay.context,executionLocked:false,recordedMilliseconds:0,canFocus:false,reviewRequired:false,canCancel:true,canEdit:true}]}};
 }
 Object.assign(input,{googleMetadata:reviewPrivacyMarkers.google});
 return input;
}
