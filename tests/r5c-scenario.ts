import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
import type {Actor} from '../src/domain/actor';
import type {Action} from '../src/modules/actions/domain';
import type {WeeklyPlan} from '../src/modules/planning/domain';
import {goalService} from '../src/modules/goals/service';
import {goalRepository} from '../src/modules/goals/repository';
import {actionService} from '../src/modules/actions/service';
import {actionRepository} from '../src/modules/actions/repository';
import {focusService} from '../src/modules/focus/service';
import {focusRepository} from '../src/modules/focus/repository';
import {reviewService} from '../src/modules/reviews/service';
import {reviewRepository} from '../src/modules/reviews/repository';
import {calendarRepository} from '../src/modules/calendar/repository';
import {calendarScopes} from '../src/modules/calendar/domain';
import {credentialCipher} from '../src/modules/calendar/encryption';
import {provisionLocalUser} from '../scripts/local-user';
import {databaseCoaching} from './coaching-database';
import {canonical,fingerprint} from '../src/modules/coaching/context';

// Test-only synthetic data. No production account, Google access or AI calls.
export const r5cWeek='2028-01-03',r5cReviewWeek='2027-12-27',r5cNow='2028-01-05T08:00:00.000Z';
export const r5cPassword='Disposable-R5C-Quality-Gate!';
export const r5cMarkers={
 daily:'FINAL_DAILY_ALLOWED: Short morning sessions helped; protect room for interruptions.',
 weekly:'FINAL_WEEKLY_ALLOWED: Onboarding testing carried forward after support interrupted two mornings. I deliberately chose Carry with a smaller next-week budget; keep recovery protected.',
 draftDaily:'DRAFT_DAILY_EXCLUDED: Private unfinished thoughts must never be shared.',
 draftWeekly:'DRAFT_WEEKLY_EXCLUDED: Unfinished weekly deliberation must never be shared.',
 late:'LATE_DAILY_EXCLUDED: Finalized after the weekly review cutoff; not part of that review.',
 session:'SESSION_NOTE_EXCLUDED: A private scratch/end note, not coaching context.',
 calendar:'GOOGLE_METADATA_EXCLUDED',
};

export async function seedR5C(database:ReturnType<typeof import('../src/db/connect').connectDatabase>, options:{wellPlannedEstimateMinutes?:number}={}){
 const url=new URL(database.pool.options.connectionString!);
 assert.ok(['localhost','127.0.0.1','[::1]'].includes(url.hostname)&&/^\/execution_test_r5c[a-f0-9]+$/.test(url.pathname),'R5C seeding requires its own disposable loopback database.');
 let now='2027-12-20T08:00:00.000Z';const clock=()=>now;
 const services=databaseCoaching(database.db,database.pool,clock);
 const goals=goalService(goalRepository(database.db),clock),actions=actionService(actionRepository(database.db),clock),focus=focusService(focusRepository(database.db),clock),daily=reviewService(reviewRepository(database.db),clock);
 const primary:Actor={userId:(await provisionLocalUser(database.db,{email:'r5c-primary@example.test',password:r5cPassword,name:'R5C Frozen Week',timezone:'Europe/London'})).id};
 const restrained:Actor={userId:(await provisionLocalUser(database.db,{email:'r5c-restrained@example.test',password:r5cPassword,name:'R5C Well Planned',timezone:'Europe/London'})).id};
 async function createGoals(actor:Actor,wellPlanned=false){
  const definitions=[['Ship a small trustworthy One Better beta','Ten people can independently plan, focus and review a useful week.','Test the first-week onboarding flow','Five users finish onboarding without assistance.',240],['Maintain a sustainable running rhythm','Run consistently while protecting recovery.','Complete one steady run','Finish an easy run with time for recovery.',60],['Publish one practical essay each week','Share one useful lesson from building the planning loop.','Draft the planning essay','A clear first draft with one concrete example exists.',60]] as const;
  const selected=[],work:Action[]=[];
  for(const [title,outcome,actionTitle,doneWhen,estimateMinutes] of definitions){const goal=await goals.createGoal(actor,{mutationId:randomUUID(),title,outcome});selected.push(goal);work.push(await actions.createAction(actor,goal.id,{mutationId:randomUUID(),title:actionTitle,doneWhen,estimateMinutes:wellPlanned?options.wellPlannedEstimateMinutes??60:estimateMinutes}));}
  let cycle=await services.cycles.create(actor,{mutationId:randomUUID(),title:'Make the weekly loop useful and sustainable',intent:'Ship a small useful beta, maintain recovery, and share one concrete lesson. Preserve breathing room rather than filling every open hour.',startDate:'2027-12-20',endDate:'2028-01-31',goals:selected.map(g=>({goalId:g.id,goalVersion:g.version}))});
  cycle=await services.cycles.transition(actor,cycle.id,'activate',{mutationId:randomUUID(),expectedVersion:1});
  await services.hours.save(actor,{mutationId:randomUUID(),scheduleId:null,expectedVersion:0,windows:Array.from({length:5},(_,i)=>[{weekday:i+1,startMinute:540,endMinute:720},{weekday:i+1,startMinute:840,endMinute:960}]).flat()});
  return {goals:selected,actions:work,cycle};
 }
 async function plan(actor:Actor,week:string,work:Action[],budgets:number[]){const candidates=await services.plans.candidates(actor);let p=await services.plans.create(actor,{mutationId:randomUUID(),weekStartDate:week,provisionalCapacityMinutes:720,reserveMinutes:180});p=await services.plans.save(actor,p.id,{mutationId:randomUUID(),expectedVersion:1,provisionalCapacityMinutes:720,reserveMinutes:180,commitments:work.map((a,i)=>({actionId:a.id,budgetMinutes:budgets[i],source:candidates.find(c=>c.actionId===a.id)!.source}))});return services.plans.commit(actor,p.id,{mutationId:randomUUID(),expectedVersion:2});}
 async function block(actor:Actor,p:WeeklyPlan,action:Action,date:string,startTime:string,endTime:string){const input={commitmentId:p.commitments.find(c=>c.actionId===action.id)!.id,date,startTime,endTime},review=await services.schedule.preview(actor,p.id,input);return services.schedule.create(actor,p.id,{...input,mutationId:randomUUID(),expectedPlanVersion:review.planVersion,reviewKey:review.reviewKey,acknowledgeOutsideHours:false,acknowledgeBusy:false});}
 async function record(actor:Actor,id:string,from:string,to:string,outcome:'completed'|'partial'){now=from;const session=await focus.start(actor,id,{mutationId:randomUUID(),expectedBlockVersion:1,acknowledgeRemoved:false});now=to;return focus.end(actor,session.id,{mutationId:randomUUID(),expectedVersion:1,outcome,endNote:r5cMarkers.session});}
 const main=await createGoals(primary),well=await createGoals(restrained,true);
 const oldDraftPlan=await plan(primary,'2027-12-20',[main.actions[0]],[120]);
 now='2027-12-27T08:00:00.000Z';
 const prior=await plan(primary,r5cReviewWeek,[main.actions[0]],[120]);
 const priorBlock=await block(primary,prior,main.actions[0],'2027-12-28','09:00','10:00');
 const current=await plan(primary,r5cWeek,main.actions,[240,60,60]);
 const wellPlan=await plan(restrained,r5cWeek,well.actions,[60,60,60]);
 const mainBlocks=[await block(primary,current,main.actions[0],'2028-01-04','09:00','09:45'),await block(primary,current,main.actions[1],'2028-01-03','09:00','10:00'),await block(primary,current,main.actions[2],'2028-01-06','14:00','15:00')];
 const wellBlocks=[await block(restrained,wellPlan,well.actions[0],'2028-01-03','09:00','10:00'),await block(restrained,wellPlan,well.actions[1],'2028-01-04','09:00','10:00'),await block(restrained,wellPlan,well.actions[2],'2028-01-06','14:00','15:00')];
 await record(primary,priorBlock.id,'2027-12-28T09:00:00Z','2027-12-28T09:30:00Z','partial');
 now='2027-12-28T18:00:00Z';const finalizedDaily=await daily.save(primary,{mutationId:randomUUID(),localDate:'2027-12-28',reflectionId:null,expectedVersion:0,note:r5cMarkers.daily});await daily.finalize(primary,finalizedDaily.id,{mutationId:randomUUID(),expectedVersion:1});
 now='2027-12-30T18:00:00Z';
 const draftDaily=await daily.save(primary,{mutationId:randomUUID(),localDate:'2027-12-29',reflectionId:null,expectedVersion:0,note:r5cMarkers.draftDaily});
 const lateDaily=await daily.save(primary,{mutationId:randomUUID(),localDate:'2027-12-30',reflectionId:null,expectedVersion:0,note:r5cMarkers.late});
 now='2028-01-03T08:00:00Z';
 const candidates=await services.plans.candidates(primary),source=candidates.find(c=>c.actionId===main.actions[0].id)!.source;
 await services.reviews.save(primary,{mutationId:randomUUID(),planId:oldDraftPlan.id,reviewId:null,expectedVersion:0,note:r5cMarkers.draftWeekly,decisions:[]});
 const weekly=await services.reviews.save(primary,{mutationId:randomUUID(),planId:prior.id,reviewId:null,expectedVersion:0,note:r5cMarkers.weekly,decisions:[{commitmentId:prior.commitments[0].id,actionId:main.actions[0].id,kind:'carry',proposedBudgetMinutes:90,source}]});
 const finalizedWeekly=await services.reviews.finalize(primary,weekly.id,{mutationId:randomUUID(),expectedVersion:1,confirmArchive:false});
 await record(primary,mainBlocks[1].id,'2028-01-03T09:00:00Z','2028-01-03T10:00:00Z','completed');
 await record(restrained,wellBlocks[0].id,'2028-01-03T09:00:00Z','2028-01-03T10:00:00Z','completed');
 await record(primary,mainBlocks[0].id,'2028-01-04T09:00:00Z','2028-01-04T09:30:00Z','partial');
 await record(restrained,wellBlocks[1].id,'2028-01-04T09:00:00Z','2028-01-04T10:00:00Z','completed');
 now='2028-01-04T18:00:00Z';await daily.finalize(primary,lateDaily.id,{mutationId:randomUUID(),expectedVersion:1});
 now=r5cNow;
 const selection=[r5cMarkers.calendar],key=Buffer.alloc(32,12).toString('base64'),cipher=credentialCipher({r5c:key},'r5c');
 for(const actor of [primary,restrained]){const id=randomUUID(),repository=calendarRepository(database.db,database.pool);await repository.locked(actor.userId,async store=>{await store.saveConnection({id,ownerId:actor.userId,state:'connected',version:1,providerAccountId:r5cMarkers.calendar,encryptedCredentials:cipher.encrypt(JSON.stringify({accessToken:'dummy-synthetic-no-access',refreshToken:null,expiresAt:Date.parse(now)+3600000,scopes:[...calendarScopes],accountId:r5cMarkers.calendar}),`tokens:${actor.userId}:${id}`),accessExpiresAt:new Date(Date.parse(now)+3600000),grantedScopes:[...calendarScopes],calendars:[{id:selection[0],summary:r5cMarkers.calendar,primary:true,timezone:'Europe/London',accessRole:'freeBusyReader'}],selectedCalendarIds:selection,listFetchedAt:new Date(now),listError:null,createdAt:new Date(now),updatedAt:new Date(now)});await store.saveCache({ownerId:actor.userId,connectionId:id,weekStartDate:r5cWeek,timezone:'Europe/London',selectionKey:createHash('sha256').update(JSON.stringify(selection)).digest('hex'),intervals:[{start:'2028-01-05T10:00:00Z',end:'2028-01-05T11:00:00Z'},{start:'2028-01-06T09:00:00Z',end:'2028-01-06T10:00:00Z'},{start:'2028-01-07T14:00:00Z',end:'2028-01-07T15:00:00Z'}],fetchedAt:new Date(now),lastError:null});});}
 const scope={contextType:'calendar' as const,week:r5cWeek},reviewScope={contextType:'weekly_review' as const,week:r5cReviewWeek};
 const contexts={calendar:await services.context(primary,scope),restrained:await services.context(restrained,scope),review:await services.context(primary,reviewScope)};
 assert.equal(canonical(contexts.calendar),canonical(await services.context(primary,scope)),'Frozen context must be stable across reads.');
 for(const c of [contexts.calendar,contexts.restrained]){const text=JSON.stringify(c);for(const marker of Object.values(r5cMarkers))assert.ok(!text.includes(marker),'Calendar context leaked a privacy sentinel.');assert.equal(c.facts.find(f=>f.key==='availability')?.data.status,'available');}
 const reviewText=JSON.stringify(contexts.review);assert.ok(reviewText.includes(r5cMarkers.daily)&&reviewText.includes(r5cMarkers.weekly));for(const marker of [r5cMarkers.draftDaily,r5cMarkers.draftWeekly,r5cMarkers.late,r5cMarkers.session,r5cMarkers.calendar])assert.ok(!reviewText.includes(marker),'Review context leaked an excluded sentinel.');
 const commitments=contexts.calendar.facts.filter(f=>f.reference?.kind==='commitment');assert.ok(commitments.some(c=>c.data.budgetMinutes===240&&c.data.scheduledMinutes===45));assert.ok(commitments.some(c=>c.data.budgetMinutes===60&&c.data.scheduledMinutes===60));assert.equal(finalizedWeekly.decisions[0].kind,'carry');assert.equal(contexts.calendar.facts.filter(f=>f.reference?.kind==='goal').length,3);assert.ok(contexts.calendar.facts.some(f=>f.reference?.kind==='focus_cycle'));assert.ok(contexts.restrained.facts.filter(f=>f.reference?.kind==='commitment').every(f=>f.data.unscheduledMinutes===0));
 return {primary,restrained,main,well,current,wellPlan,prior,mainBlocks,draftDaily,finalizedWeekly,clock,services,contexts,scope,reviewScope,fingerprints:Object.fromEntries(Object.entries(contexts).map(([k,v])=>[k,fingerprint(v)]))};
}
