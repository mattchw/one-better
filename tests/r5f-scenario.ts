import {randomUUID} from 'node:crypto';
import type {Database} from '../src/db/connect';
import type {Pool} from 'pg';
import {goalRepository} from '../src/modules/goals/repository';
import {goalService} from '../src/modules/goals/service';
import {actionRepository} from '../src/modules/actions/repository';
import {actionService} from '../src/modules/actions/service';
import {focusRepository} from '../src/modules/focus/repository';
import {focusService} from '../src/modules/focus/service';
import {reviewRepository} from '../src/modules/reviews/repository';
import {reviewService} from '../src/modules/reviews/service';
import {provisionLocalUser} from '../scripts/local-user';
import {databaseCoaching} from './coaching-database';
import {reviewQualityKinds,reviewQualityNow,reviewQualityWeek,reviewPrivacyMarkers,type ReviewQualityKind} from './review-insight-fixture';
import type {CoachingScope} from '../src/modules/coaching/domain';

export const r5fPassword='Disposable-R5F-Quality-Only!';
export async function seedR5F(db:Database,pool:Pool){
 let now='2027-12-20T08:00:00Z';const clock=()=>now;
 const d=databaseCoaching(db,pool,clock),goals=goalService(goalRepository(db),clock),actions=actionService(actionRepository(db),clock),focus=focusService(focusRepository(db),clock),daily=reviewService(reviewRepository(db),clock);
 const fixtures:{kind:ReviewQualityKind;actor:{userId:string};email:string;scope:CoachingScope}[]=[];
 for(const kind of reviewQualityKinds){
  now='2027-12-20T08:00:00Z';const email=`r5f-${kind}@example.test`,actor={userId:(await provisionLocalUser(db,{email,password:r5fPassword,name:'R5F synthetic reviewer',timezone:'Europe/London'})).id};
  const goal=await goals.createGoal(actor,{mutationId:randomUUID(),title:'Launch a useful onboarding flow',outcome:'A new user can connect Calendar and commit a first plan without help.'});
  const action=await actions.createAction(actor,goal.id,{mutationId:randomUUID(),title:'Ship guided first-week planning',doneWhen:'A new user completes the guided path independently.',estimateMinutes:240});
  let essay:Awaited<ReturnType<typeof actions.createAction>>|undefined;
  const selectedGoals=[{goalId:goal.id,goalVersion:goal.version}];
  if(kind==='already_addressed'){const g=await goals.createGoal(actor,{mutationId:randomUUID(),title:'Write a practical essay',outcome:'Publish a useful account of what the weekly loop taught me.'});essay=await actions.createAction(actor,g.id,{mutationId:randomUUID(),title:'Draft the planning essay',doneWhen:'A readable draft is ready for editing.',estimateMinutes:60});selectedGoals.push({goalId:g.id,goalVersion:g.version});}
  const cycle=await d.cycles.create(actor,{mutationId:randomUUID(),title:'Make the weekly loop useful and sustainable',intent:'Protect small deliberate commitments and learn from recorded execution.',startDate:'2027-12-20',endDate:'2028-01-31',goals:selectedGoals});await d.cycles.transition(actor,cycle.id,'activate',{mutationId:randomUUID(),expectedVersion:cycle.version});
  await d.hours.save(actor,{mutationId:randomUUID(),scheduleId:null,expectedVersion:0,windows:[{weekday:3,startMinute:540,endMinute:720},{weekday:4,startMinute:540,endMinute:720}]});
  async function plan(week:string,actionId:string,budget:number){const candidates=await d.plans.candidates(actor);let p=await d.plans.create(actor,{mutationId:randomUUID(),weekStartDate:week,provisionalCapacityMinutes:720,reserveMinutes:180});p=await d.plans.save(actor,p.id,{mutationId:randomUUID(),expectedVersion:p.version,provisionalCapacityMinutes:720,reserveMinutes:180,commitments:[{actionId,budgetMinutes:budget,source:candidates.find(c=>c.actionId===actionId)!.source}]});return d.plans.commit(actor,p.id,{mutationId:randomUUID(),expectedVersion:p.version});}
  async function block(p:Awaited<ReturnType<typeof plan>>,date:string){const input={commitmentId:p.commitments[0].id,date,startTime:'09:00',endTime:'10:00'},review=await d.schedule.preview(actor,p.id,input);return d.schedule.create(actor,p.id,{...input,mutationId:randomUUID(),expectedPlanVersion:review.planVersion,reviewKey:review.reviewKey,acknowledgeOutsideHours:true,acknowledgeBusy:false});}
  async function record(b:Awaited<ReturnType<typeof block>>,minutes:number,outcome:'partial'|'completed'='partial'){now=b.start;const session=await focus.start(actor,b.id,{mutationId:randomUUID(),expectedBlockVersion:b.version,acknowledgeRemoved:false});now=new Date(Date.parse(b.start)+minutes*60000).toISOString();await focus.end(actor,session.id,{mutationId:randomUUID(),expectedVersion:session.version,outcome,endNote:reviewPrivacyMarkers.session});}
  async function finalize(p:Awaited<ReturnType<typeof plan>>,note:string){const facts=(await d.reviews.workspace(actor,p.weekStartDate)).facts!,decisions=facts.commitments.filter(c=>c.source?.eligible).map(c=>({commitmentId:c.commitment.id,actionId:c.commitment.actionId,kind:'carry' as const,proposedBudgetMinutes:90,source:c.source!.source}));const draft=await d.reviews.save(actor,{mutationId:randomUUID(),planId:p.id,reviewId:null,expectedVersion:0,note,decisions});return d.reviews.finalize(actor,draft.id,{mutationId:randomUUID(),expectedVersion:draft.version,confirmArchive:false});}
  if(kind==='repeated_carry'){const prior=await plan('2027-12-27',action.id,120),b=await block(prior,'2027-12-29');await record(b,30);now='2028-01-03T08:00:00Z';await finalize(prior,'A fresh attempt remains worth considering; I have not chosen the next approach.');}
  const budget=['clean','already_addressed'].includes(kind)?60:kind==='repeated_carry'?120:240;
  const current=await plan(reviewQualityWeek,action.id,budget),b=await block(current,'2028-01-05');
  if(kind==='gap_reflection'){now='2028-01-05T08:00:00Z';await d.amends.confirm(actor,current.id,{mutationId:randomUUID(),expectedVersion:current.version,provisionalCapacityMinutes:540,reserveMinutes:120,reason:'Production support reduced available capacity.',commitments:[{actionId:action.id,budgetMinutes:240}]});}
  await record(b,['clean','already_addressed'].includes(kind)?60:30,kind==='completed'?'completed':'partial');
  now='2028-01-06T08:00:00Z';const day=await daily.save(actor,{mutationId:randomUUID(),localDate:'2028-01-05',reflectionId:null,expectedVersion:0,note:kind==='gap_reflection'?reviewPrivacyMarkers.daily:kind==='no_reflection'?reviewPrivacyMarkers.draftDaily:'An ordinary record of deliberately selected work.'});
  if(kind!=='no_reflection')await daily.finalize(actor,day.id,{mutationId:randomUUID(),expectedVersion:day.version});
  const draft=await daily.save(actor,{mutationId:randomUUID(),localDate:'2028-01-06',reflectionId:null,expectedVersion:0,note:reviewPrivacyMarkers.draftDaily});void draft;
  if(kind==='completed'){now='2028-01-09T18:00:00Z';await actions.completeAction(actor,action.id,{mutationId:randomUUID(),expectedVersion:action.version});}
  now='2028-01-10T09:00:00Z';
  if(kind==='no_reflection')await d.reviews.save(actor,{mutationId:randomUUID(),planId:current.id,reviewId:null,expectedVersion:0,note:reviewPrivacyMarkers.draftWeekly,decisions:[]});
  else await finalize(current,kind==='gap_reflection'?reviewPrivacyMarkers.weekly:kind==='repeated_carry'?'I want a fresh attempt to involve a changed approach rather than unchanged intent.':'Reflect on the recorded week and preserve breathing room.');
  if(essay){const next=await plan('2028-01-10',essay.id,60);await block(next,'2028-01-13');}
  if(kind!=='no_reflection'){now='2028-01-11T09:00:00Z';const late=await daily.save(actor,{mutationId:randomUUID(),localDate:'2028-01-07',reflectionId:null,expectedVersion:0,note:reviewPrivacyMarkers.late});await daily.finalize(actor,late.id,{mutationId:randomUUID(),expectedVersion:late.version});}
  fixtures.push({kind,actor,email,scope:{contextType:'weekly_review',week:reviewQualityWeek}});
 }
 now=reviewQualityNow;
 return {fixtures,services:d,clock,setNow:(value:string)=>{now=value;}};
}
