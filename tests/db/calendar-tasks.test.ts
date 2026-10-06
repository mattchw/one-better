import {beforeAll,beforeEach,afterAll,it,expect} from 'vitest';
import {readFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {eq,inArray} from 'drizzle-orm';
import {migrate} from 'drizzle-orm/node-postgres/migrator';
import {connectDatabase} from '../../src/db/connect';
import {user,goal,milestone,action,weeklyPlan,weeklyCommitment,weeklyPlanAmendment,amendmentCommitment,commitmentIdentity,timeBlock,focusSession,mutationReceipt,focusableHours,weeklyReview,weeklyReviewDecision,dailyReflection} from '../../src/db/schema';
import {requireTestDatabaseURL} from '../../scripts/test-database';
import {actionService} from '../../src/modules/actions/service';
import {actionRepository} from '../../src/modules/actions/repository';
import {goalService} from '../../src/modules/goals/service';
import {goalRepository} from '../../src/modules/goals/repository';
import {legacyGeneralOutcome} from '../../src/modules/planning/general';
import {weeklyReviewService} from '../../src/modules/weekly-reviews/service';
import {weeklyReviewRepository} from '../../src/modules/weekly-reviews/repository';
import {calendarTaskService} from '../../src/modules/calendar-tasks/service';
import {planService} from '../../src/modules/planning/service';
import {planRepository} from '../../src/modules/planning/repository';
import {hoursService} from '../../src/modules/availability/service';
import {hoursRepository} from '../../src/modules/availability/repository';
const {db,pool}=connectDatabase(requireTestDatabaseURL().url),a={userId:randomUUID()},b={userId:randomUUID()};
let now='2028-01-03T08:00:00.000Z';const clock=()=>now,tasks=calendarTaskService(db,clock),plans=planService(planRepository(db),clock),hours=hoursService(hoursRepository(db),clock);
beforeAll(async()=>{await migrate(db,{migrationsFolder:'src/db/migrations'});for(const actor of [a,b])await db.insert(user).values({id:actor.userId,name:'Task QA',email:`tasks-${actor.userId}@example.test`,timezone:'Europe/London'});});
beforeEach(async()=>{now='2028-01-03T08:00:00.000Z';for(const table of [weeklyReviewDecision,weeklyReview,dailyReflection,focusSession,timeBlock,amendmentCommitment,weeklyPlanAmendment,weeklyCommitment,commitmentIdentity,weeklyPlan,action,milestone,goal,mutationReceipt,focusableHours])await db.delete(table).where(inArray(table.ownerId,[a.userId,b.userId]));});
afterAll(()=>pool.end());
async function fixture(){const plan=await plans.firstTask(a,{mutationId:randomUUID(),weekStartDate:'2028-01-03',title:'Reading',budgetMinutes:60});const c=plan.commitments[0];const [block]=await db.insert(timeBlock).values({id:randomUUID(),ownerId:a.userId,planId:plan.id,commitmentId:c.id,start:new Date('2028-01-04T10:00Z'),end:new Date('2028-01-04T10:30Z'),state:'planned',version:1,snapshot:c.snapshot!,createdAt:new Date(now),updatedAt:new Date(now)}).returning();return {plan,c,block};}
it('immediate budget changes retain baseline snapshots, scope owners, replay exactly and reject stale/concurrent writes',async()=>{
 const f=await fixture(),input={kind:'budget',mutationId:randomUUID(),expectedVersion:2,commitmentId:f.c.id,delta:30};
 const result=await tasks.change(a,f.plan.id,input);expect(result.commitments[0]).toMatchObject({id:f.c.id,budgetMinutes:90,snapshot:f.c.snapshot});expect(result.provisionalCapacityMinutes-result.reserveMinutes).toBeGreaterThanOrEqual(90);
 expect(await tasks.change(a,f.plan.id,input)).toEqual(result);expect((await plans.get(a,f.plan.id)).plan.commitments[0].budgetMinutes).toBe(60);
 await expect(tasks.change(b,f.plan.id,input)).rejects.toMatchObject({code:'NOT_FOUND'});
 await expect(tasks.change(a,f.plan.id,{...input,mutationId:randomUUID()})).rejects.toMatchObject({code:'CONFLICT'});
 const results=await Promise.allSettled([1,2].map(()=>tasks.change(a,f.plan.id,{...input,mutationId:randomUUID(),expectedVersion:3})));expect(results.filter(r=>r.status==='fulfilled')).toHaveLength(1);
 expect((await db.select().from(timeBlock).where(eq(timeBlock.id,f.block.id)))[0]).toEqual(f.block);
});
it('drop and Undo atomically hide/restore the task and exact blocks with advancing versions and no duplicates',async()=>{
 const f=await fixture(),input={kind:'drop',mutationId:randomUUID(),expectedVersion:2,commitmentId:f.c.id};
 const dropped=await tasks.change(a,f.plan.id,input);expect(dropped.commitments).toEqual([]);expect(dropped.undo?.expiresAt).toBe('2028-01-03T08:00:06.000Z');expect((await db.select().from(timeBlock).where(eq(timeBlock.id,f.block.id)))[0]).toMatchObject({state:'cancelled',version:2});
 now='2028-01-03T08:00:05.000Z';const undoInput={kind:'undo',mutationId:randomUUID(),expectedVersion:3,dropMutationId:input.mutationId};const restored=await tasks.change(a,f.plan.id,undoInput);expect(restored.commitments[0]).toMatchObject({id:f.c.id,budgetMinutes:60,snapshot:f.c.snapshot});
 expect((await db.select().from(timeBlock).where(eq(timeBlock.id,f.block.id)))[0]).toMatchObject({state:'planned',version:3,start:f.block.start,end:f.block.end});
 now='2028-01-03T08:00:20.000Z';expect(await tasks.change(a,f.plan.id,undoInput)).toEqual(restored);expect(await tasks.change(a,f.plan.id,input)).toEqual(dropped);
 expect((await db.select().from(weeklyPlanAmendment).where(eq(weeklyPlanAmendment.ownerId,a.userId))).length).toBe(2);
});
it('expired Undo and a newly occupied slot cannot restore any part of a dropped task',async()=>{
 const f=await fixture(),input={kind:'drop',mutationId:randomUUID(),expectedVersion:2,commitmentId:f.c.id};await tasks.change(a,f.plan.id,input);
 now='2028-01-03T08:00:06.000Z';await expect(tasks.change(a,f.plan.id,{kind:'undo',mutationId:randomUUID(),expectedVersion:3,dropMutationId:input.mutationId})).rejects.toMatchObject({details:{kind:'UNDO_EXPIRED'}});
 now='2028-01-03T08:00:05.000Z';const added=await tasks.change(a,f.plan.id,{kind:'add',mutationId:randomUUID(),expectedVersion:3,title:'Other task',budgetMinutes:60});await db.insert(timeBlock).values({...f.block,id:randomUUID(),commitmentId:added.commitments[0].id,version:1});
 await expect(tasks.change(a,f.plan.id,{kind:'undo',mutationId:randomUUID(),expectedVersion:4,dropMutationId:input.mutationId})).rejects.toMatchObject({details:{kind:'LOCAL_OVERLAP'}});
 expect((await db.select().from(timeBlock).where(eq(timeBlock.id,f.block.id)))[0].state).toBe('cancelled');expect((await db.select().from(weeklyPlan).where(eq(weeklyPlan.id,f.plan.id)))[0].version).toBe(4);
});
it('add creates one normal Action and immediately available commitment, uses no Goal and rejects unsupported durations',async()=>{
 const f=await fixture(),input={kind:'add',mutationId:randomUUID(),expectedVersion:2,title:'  Write a draft  ',budgetMinutes:120};const added=await tasks.change(a,f.plan.id,input);expect(added.commitments).toHaveLength(2);expect(added.commitments[1].snapshot.action.title).toBe('Write a draft');expect(await tasks.change(a,f.plan.id,input)).toEqual(added);
 expect((await db.select().from(goal).where(eq(goal.ownerId,a.userId)))).toHaveLength(0);expect((await db.select().from(action).where(eq(action.ownerId,a.userId)))).toHaveLength(2);expect(added.commitments[1].snapshot.goal).toBeNull();expect(added.commitments[1].source).toMatchObject({goalId:null,goalVersion:null});
 await expect(tasks.change(a,f.plan.id,{...input,mutationId:randomUUID(),expectedVersion:3,budgetMinutes:90})).rejects.toMatchObject({code:'VALIDATION'});
});
it('Calendar can add work to an empty owned Goal; retries preserve one Action and Undo keeps the Goal association',async()=>{
 const f=await fixture(),id=randomUUID();await db.insert(goal).values({id,ownerId:a.userId,title:'Workout',outcome:'Gain muscle',version:1});
 const input={kind:'add',mutationId:randomUUID(),expectedVersion:2,title:'Strength training',budgetMinutes:60,goal:{id,version:1}};
 const added=await tasks.change(a,f.plan.id,input),chosen=added.commitments[1];expect(chosen.snapshot.goal).toMatchObject({id,title:'Workout'});expect(chosen.source).toMatchObject({goalId:id,goalVersion:1});expect(await tasks.change(a,f.plan.id,input)).toEqual(added);
 const rows=await db.select().from(action).where(eq(action.goalId,id));expect(rows).toHaveLength(1);expect(rows[0].id).toBe(chosen.actionId);
 const reverted=await tasks.change(a,f.plan.id,{kind:'revert',mutationId:randomUUID(),expectedVersion:3,changeMutationId:input.mutationId});expect(reverted.commitments).toHaveLength(1);expect((await db.select().from(action).where(eq(action.id,chosen.actionId)))[0].goalId).toBe(id);
 expect((await db.select().from(goal).where(eq(goal.id,id)))[0].version).toBe(1);
});
it('first-task and Calendar add reject foreign, stale and archived Goals atomically without creating fallback work',async()=>{
 const f=await fixture(),id=randomUUID();await db.insert(goal).values({id,ownerId:b.userId,title:'Private goal',outcome:'Private outcome',version:1});
 const add=(selection:{id:string;version:number})=>tasks.change(a,f.plan.id,{kind:'add',mutationId:randomUUID(),expectedVersion:2,title:'Test task',budgetMinutes:60,goal:selection});
 const first=(selection:{id:string;version:number})=>plans.firstTask(a,{mutationId:randomUUID(),weekStartDate:'2028-01-10',title:'Test task',budgetMinutes:60,goal:selection});
 for(const apply of [add,first])await expect(apply({id,version:1})).rejects.toMatchObject({code:'NOT_FOUND'});
 await db.update(goal).set({ownerId:a.userId,version:2}).where(eq(goal.id,id));
 for(const apply of [add,first])await expect(apply({id,version:1})).rejects.toMatchObject({code:'CONFLICT',details:{kind:'VERSION'}});
 await db.update(goal).set({archivedAt:new Date(now)}).where(eq(goal.id,id));
 for(const apply of [add,first])await expect(apply({id,version:2})).rejects.toMatchObject({code:'CONFLICT',details:{kind:'ARCHIVED'}});
 expect((await db.select().from(action).where(eq(action.ownerId,a.userId)))).toHaveLength(1);expect((await db.select().from(weeklyPlan).where(eq(weeklyPlan.ownerId,a.userId)))).toHaveLength(1);
});
it('the single-task starter persists its selected Goal without creating Weekly priorities',async()=>{
 const id=randomUUID();await db.insert(goal).values({id,ownerId:a.userId,title:'Workout',outcome:'Gain muscle',version:1});
 const input={mutationId:randomUUID(),weekStartDate:'2028-01-03',title:'Strength training',budgetMinutes:30,goal:{id,version:1}};
 const plan=await plans.firstTask(a,input);expect(plan.commitments[0].snapshot?.goal?.id).toBe(id);expect(await plans.firstTask(a,input)).toEqual(plan);
 expect((await db.select().from(goal).where(eq(goal.ownerId,a.userId)))).toHaveLength(1);expect((await db.select().from(action).where(eq(action.goalId,id)))).toHaveLength(1);
});
it('drop never destroys execution; active sessions block Drop and finished actuals remain intact',async()=>{
 const f=await fixture(),id=randomUUID();await db.insert(focusSession).values({id,ownerId:a.userId,timeBlockId:f.block.id,startedAt:new Date(now),version:1,createdAt:new Date(now),updatedAt:new Date(now)});
 await expect(tasks.change(a,f.plan.id,{kind:'drop',mutationId:randomUUID(),expectedVersion:2,commitmentId:f.c.id})).rejects.toMatchObject({details:{kind:'ACTIVE_SESSION'}});
 now='2028-01-03T08:01:00.000Z';await db.update(focusSession).set({endedAt:new Date(now),updatedAt:new Date(now),outcome:'partial',version:2}).where(eq(focusSession.id,id));
 const dropped=await tasks.change(a,f.plan.id,{kind:'drop',mutationId:randomUUID(),expectedVersion:2,commitmentId:f.c.id});expect(dropped.preservedExecutionBlocks).toBe(1);expect(dropped.undo?.blocks).toEqual([]);expect((await db.select().from(focusSession).where(eq(focusSession.id,id)))[0].outcome).toBe('partial');expect((await db.select().from(timeBlock).where(eq(timeBlock.id,f.block.id)))[0].state).toBe('planned');
});
it('spare preference defaults to Some, persists/replays each reviewed choice and affects new plans only',async()=>{
 for(const percent of [0,25,40] as const){const saved=await hours.settings(a);const command={mutationId:randomUUID(),scheduleId:saved.schedule?.id??null,expectedVersion:saved.schedule?.version??0,windows:[],sparePercent:percent};const result=await hours.save(a,command);expect(result.sparePercent).toBe(percent);expect(await hours.save(a,command)).toEqual(result);expect((await hours.settings(a)).schedule?.sparePercent).toBe(percent);}
 const plan=await plans.firstTask(a,{mutationId:randomUUID(),weekStartDate:'2028-01-03',title:'First task',budgetMinutes:60});expect(plan).toMatchObject({provisionalCapacityMinutes:100,reserveMinutes:40});const saved=(await hours.settings(a)).schedule!;await hours.save(a,{mutationId:randomUUID(),scheduleId:saved.id,expectedVersion:saved.version,windows:[],sparePercent:0});expect((await plans.get(a,plan.id)).plan).toEqual(plan);
 await expect(hours.save(a,{mutationId:randomUUID(),scheduleId:saved.id,expectedVersion:saved.version+1,windows:[],sparePercent:50})).rejects.toMatchObject({code:'VALIDATION'});
});
it('time and task additions have short-lived safe Undo, exact retries and stale edit protection',async()=>{
 const f=await fixture(),change={kind:'budget',mutationId:randomUUID(),expectedVersion:2,commitmentId:f.c.id,delta:-30};
 const edited=await tasks.change(a,f.plan.id,change);expect(edited.editUndo?.before).toBe(60);
 const reverse={kind:'revert',mutationId:randomUUID(),expectedVersion:3,changeMutationId:change.mutationId};
 expect((await tasks.change(a,f.plan.id,reverse)).commitments[0].budgetMinutes).toBe(60);
 now='2028-01-03T08:00:20Z';expect(await tasks.change(a,f.plan.id,reverse)).toEqual(await tasks.change(a,f.plan.id,reverse));
 now='2028-01-03T08:00:00Z';const add={kind:'add',mutationId:randomUUID(),expectedVersion:4,title:'Quick added task',budgetMinutes:30};
 const added=await tasks.change(a,f.plan.id,add);expect(added.editUndo?.kind).toBe('add');
 await expect(tasks.change(b,f.plan.id,{kind:'revert',mutationId:randomUUID(),expectedVersion:5,changeMutationId:add.mutationId})).rejects.toMatchObject({code:'NOT_FOUND'});
 expect((await tasks.change(a,f.plan.id,{kind:'revert',mutationId:randomUUID(),expectedVersion:5,changeMutationId:add.mutationId})).commitments).toHaveLength(1);
 const again={...change,expectedVersion:6,mutationId:randomUUID()};await tasks.change(a,f.plan.id,again);
 now='2028-01-03T08:00:06Z';await expect(tasks.change(a,f.plan.id,{kind:'revert',mutationId:randomUUID(),expectedVersion:7,changeMutationId:again.mutationId})).rejects.toMatchObject({details:{kind:'UNDO_EXPIRED'}});
 now='2028-01-03T08:00:00Z';await tasks.change(a,f.plan.id,{...change,expectedVersion:7,delta:30,mutationId:randomUUID()});
 await expect(tasks.change(a,f.plan.id,{kind:'revert',mutationId:randomUUID(),expectedVersion:8,changeMutationId:again.mutationId})).rejects.toMatchObject({details:{kind:'UNDO_CHANGED'}});
});

it('General Actions remain editable, completable, owner scoped and usable in deliberate Review Drop',async()=>{
 const f=await fixture(),actions=actionService(actionRepository(db),clock),reviews=weeklyReviewService(weeklyReviewRepository(db),clock);
 expect((await actions.getAction(a,f.c.actionId)).mutability.editable).toBe(true);
 await expect(actions.getAction(b,f.c.actionId)).rejects.toMatchObject({code:'NOT_FOUND'});
 await expect(actions.updateAction(b,f.c.actionId,{mutationId:randomUUID(),expectedVersion:1,title:'Other'})).rejects.toMatchObject({code:'NOT_FOUND'});
 await expect(actions.updateAction(a,f.c.actionId,{mutationId:randomUUID(),expectedVersion:1,title:'Reading',milestoneId:randomUUID()})).rejects.toMatchObject({code:'VALIDATION'});
 const added=await tasks.change(a,f.plan.id,{kind:'add',mutationId:randomUUID(),expectedVersion:2,title:'An extra task',budgetMinutes:30}),extra=added.commitments[1];
 const edit={mutationId:randomUUID(),expectedVersion:1,title:'An edited extra task',estimateMinutes:30};
 const edited=await actions.updateAction(a,extra.actionId,edit);expect(edited).toMatchObject({goalId:null,title:edit.title,version:2});expect(await actions.updateAction(a,extra.actionId,edit)).toEqual(edited);
 const completed=await actions.completeAction(a,extra.actionId,{mutationId:randomUUID(),expectedVersion:2});expect(completed).toMatchObject({goalId:null,state:'completed'});
 now='2028-01-10T08:00:00Z';
 const review=await reviews.save(a,{mutationId:randomUUID(),reviewId:null,expectedVersion:0,planId:f.plan.id,note:'I deliberately no longer need Reading.',decisions:[{kind:'drop',commitmentId:f.c.id,actionId:f.c.actionId,proposedBudgetMinutes:null,source:f.c.source}]});
 const finalized=await reviews.finalize(a,review.id,{mutationId:randomUUID(),expectedVersion:1,confirmArchive:true});expect(finalized.status).toBe('finalized');
 const reviewed=await reviews.workspace(a,'2028-01-03');expect(reviewed.analytics?.goals).toEqual(expect.arrayContaining([expect.objectContaining({id:'general',title:'General'})]));expect(reviewed.facts?.plan.id).toBe(f.plan.id);
 expect((await actions.getAction(a,f.c.actionId)).action).toMatchObject({goalId:null,state:'archived'});
 expect((await db.select().from(timeBlock).where(eq(timeBlock.id,f.block.id)))[0]).toEqual(f.block);
});
it('legacy container conversion keeps frozen history, execution and retries while leaving user-created Goals alone',async()=>{
 const id=randomUUID(),other=randomUUID();
 await db.insert(goal).values([{id,ownerId:a.userId,title:'Weekly priorities',outcome:legacyGeneralOutcome,version:1},{id:other,ownerId:b.userId,title:'Weekly priorities',outcome:'A real personal Goal',version:1}]);
 const command={mutationId:randomUUID(),weekStartDate:'2028-01-03',title:'Legacy Reading',budgetMinutes:60,goal:{id,version:1}},plan=await plans.firstTask(a,command),c=plan.commitments[0];
 const [block]=await db.insert(timeBlock).values({id:randomUUID(),ownerId:a.userId,planId:plan.id,commitmentId:c.id,start:new Date('2028-01-04T10:00Z'),end:new Date('2028-01-04T10:30Z'),state:'planned',version:1,snapshot:c.snapshot!,createdAt:new Date(now),updatedAt:new Date(now)}).returning();
 const [session]=await db.insert(focusSession).values({id:randomUUID(),ownerId:a.userId,timeBlockId:block.id,startedAt:block.start,endedAt:block.end,outcome:'partial',version:2,createdAt:block.start,updatedAt:block.end}).returning();
 const [reflection]=await db.insert(dailyReflection).values({id:randomUUID(),ownerId:a.userId,localDate:'2028-01-04',status:'finalized',note:'Private reflection',version:2,createdAt:block.end,updatedAt:block.end,finalizedAt:block.end}).returning();
 const sql=await readFile('src/db/migrations/0016_general_tasks.sql','utf8');
 for(const statement of sql.split('--> statement-breakpoint').filter(s=>s.includes('UPDATE "')))await pool.query(statement);
 expect((await db.select().from(action).where(eq(action.id,c.actionId)))[0]).toMatchObject({goalId:null,milestoneId:null,version:2});
 expect((await db.select().from(goal).where(eq(goal.id,id)))[0].archivedAt).not.toBeNull();
 expect((await db.select().from(goal).where(eq(goal.id,other)))[0]).toMatchObject({archivedAt:null,version:1});
 expect((await plans.get(a,plan.id)).plan).toEqual(plan);expect(await plans.firstTask(a,command)).toEqual(plan);
 for(const [table,row] of [[timeBlock,block],[focusSession,session],[dailyReflection,reflection]] as const)expect((await db.select().from(table).where(eq(table.id,row.id)))[0]).toEqual(row);
 const candidates=await plans.candidates(a);expect(candidates.find(v=>v.actionId===c.actionId)).toMatchObject({eligible:true,context:{goal:null},source:{goalId:null,goalVersion:null,actionVersion:2}});
 const goals=goalService(goalRepository(db),clock);expect(await goals.listGoals(a,'active')).toEqual([]);expect(await goals.listGoals(a,'archived')).toEqual([]);expect((await goals.listGoals(b,'active')).map(g=>g.id)).toEqual([other]);
});

it('rename and Goal moves persist the Action, preserve baseline and slots, and Undo restores associations with advancing versions',async()=>{
 const f=await fixture();
 const parent=await goalService(goalRepository(db),clock).createGoal(a,{mutationId:randomUUID(),title:'Read more',outcome:'Enjoy more books'});
 const rename={kind:'rename',mutationId:randomUUID(),expectedVersion:2,commitmentId:f.c.id,expectedActionVersion:1,title:'Read ten pages'};
 const renamed=await tasks.change(a,f.plan.id,rename);expect(renamed.commitments[0].snapshot.action.title).toBe('Read ten pages');expect(await tasks.change(a,f.plan.id,rename)).toEqual(renamed);
 const move={kind:'move',mutationId:randomUUID(),expectedVersion:3,commitmentId:f.c.id,expectedActionVersion:2,goal:{id:parent.id,version:parent.version}};
 const moved=await tasks.change(a,f.plan.id,move);expect(moved.commitments[0]).toMatchObject({id:f.c.id,budgetMinutes:60,snapshot:{goal:{id:parent.id},action:{title:'Read ten pages'}}});
 expect((await db.select().from(action).where(eq(action.id,f.c.actionId)))[0]).toMatchObject({title:'Read ten pages',goalId:parent.id,version:3});
 expect((await db.select().from(timeBlock).where(eq(timeBlock.id,f.block.id)))[0]).toMatchObject({start:f.block.start,end:f.block.end,version:3,snapshot:{goal:{id:parent.id},action:{title:'Read ten pages'}}});
 expect((await plans.get(a,f.plan.id)).plan.commitments[0].snapshot).toEqual(f.c.snapshot);
 const restored=await tasks.change(a,f.plan.id,{kind:'revert',mutationId:randomUUID(),expectedVersion:4,changeMutationId:move.mutationId});expect(restored.commitments[0].snapshot.goal).toBeNull();expect(restored.commitments[0].source.actionVersion).toBe(4);
 expect((await db.select().from(action).where(eq(action.id,f.c.actionId)))[0]).toMatchObject({goalId:null,version:4});
 expect((await db.select().from(timeBlock).where(eq(timeBlock.id,f.block.id)))[0]).toMatchObject({snapshot:{goal:null},version:4});
 const back=await tasks.change(a,f.plan.id,{...move,mutationId:randomUUID(),expectedVersion:5,expectedActionVersion:4});
 const general=await tasks.change(a,f.plan.id,{kind:'move',mutationId:randomUUID(),expectedVersion:6,expectedActionVersion:5,commitmentId:f.c.id,goal:null});expect(back.commitments[0].snapshot.goal?.id).toBe(parent.id);expect(general.commitments[0].snapshot.goal).toBeNull();expect(await db.select().from(goal).where(eq(goal.ownerId,a.userId))).toHaveLength(1);
});
it('task edits reject foreign/archived/stale destinations and source changes without partial writes',async()=>{
 const f=await fixture(),goals=goalService(goalRepository(db),clock),foreign=await goals.createGoal(b,{mutationId:randomUUID(),title:'Private',outcome:'Private result'}),parent=await goals.createGoal(a,{mutationId:randomUUID(),title:'Workout',outcome:'Stay active'});
 const input={kind:'move',mutationId:randomUUID(),expectedVersion:2,commitmentId:f.c.id,expectedActionVersion:1,goal:{id:foreign.id,version:1}};
 await expect(tasks.change(a,f.plan.id,input)).rejects.toMatchObject({code:'NOT_FOUND'});
 await expect(tasks.change(a,f.plan.id,{...input,mutationId:randomUUID(),goal:{id:parent.id,version:99}})).rejects.toMatchObject({code:'CONFLICT'});
 await goals.archiveGoal(a,parent.id,{mutationId:randomUUID(),expectedVersion:1});await expect(tasks.change(a,f.plan.id,{...input,mutationId:randomUUID(),goal:{id:parent.id,version:2}})).rejects.toMatchObject({code:'CONFLICT'});
 await db.update(action).set({version:2}).where(eq(action.id,f.c.actionId));await expect(tasks.change(a,f.plan.id,{kind:'rename',mutationId:randomUUID(),expectedVersion:2,expectedActionVersion:1,commitmentId:f.c.id,title:'Other name'})).rejects.toMatchObject({code:'CONFLICT'});
 expect((await plans.get(a,f.plan.id)).plan.version).toBe(2);expect((await db.select().from(action).where(eq(action.id,f.c.actionId)))[0].title).toBe('Reading');expect((await db.select().from(timeBlock).where(eq(timeBlock.id,f.block.id)))[0]).toEqual(f.block);
});
it('rename preserves executed snapshots and custom block names; context Undo refuses changed or started blocks and expired edits',async()=>{
 const f=await fixture();const [executed]=await db.insert(timeBlock).values({...f.block,id:randomUUID(),start:new Date('2028-01-03T07:00Z'),end:new Date('2028-01-03T07:30Z')}).returning();
 await db.insert(focusSession).values({id:randomUUID(),ownerId:a.userId,timeBlockId:executed.id,startedAt:new Date('2028-01-03T07:00Z'),endedAt:new Date('2028-01-03T07:20Z'),outcome:'partial',version:2,createdAt:new Date('2028-01-03T07:00Z'),updatedAt:new Date('2028-01-03T07:20Z')});
 await db.update(timeBlock).set({snapshot:{...f.block.snapshot,action:{...f.block.snapshot.action,title:'Chapter one'}}}).where(eq(timeBlock.id,f.block.id));
 const input={kind:'rename',mutationId:randomUUID(),expectedVersion:2,expectedActionVersion:1,commitmentId:f.c.id,title:'Reading habit'};await tasks.change(a,f.plan.id,input);
 expect((await db.select().from(timeBlock).where(eq(timeBlock.id,executed.id)))[0]).toEqual(executed);expect((await db.select().from(timeBlock).where(eq(timeBlock.id,f.block.id)))[0].snapshot.action.title).toBe('Chapter one');
 await db.update(timeBlock).set({version:3}).where(eq(timeBlock.id,f.block.id));const undo={kind:'revert',mutationId:randomUUID(),expectedVersion:3,changeMutationId:input.mutationId};await expect(tasks.change(a,f.plan.id,undo)).rejects.toMatchObject({code:'CONFLICT'});
 expect((await db.select().from(action).where(eq(action.id,f.c.actionId)))[0].title).toBe('Reading habit');
 now='2028-01-03T08:00:06Z';await expect(tasks.change(a,f.plan.id,{...undo,mutationId:randomUUID()})).rejects.toMatchObject({details:{kind:'UNDO_EXPIRED'}});
});


it('Goal moves clear milestone links; Undo restores the original owned active milestone',async()=>{
 const f=await fixture(),parent=await goalService(goalRepository(db),clock).createGoal(a,{mutationId:randomUUID(),title:'Read books',outcome:'Finish a book'});
 const [checkpoint]=await db.insert(milestone).values({id:randomUUID(),ownerId:a.userId,goalId:parent.id,title:'Book one',successCondition:'Finish the final chapter',version:1,createdAt:new Date(now),updatedAt:new Date(now)}).returning();
 await db.update(action).set({goalId:parent.id,milestoneId:checkpoint.id,version:2}).where(eq(action.id,f.c.actionId));
 const input={kind:'move',mutationId:randomUUID(),expectedVersion:2,expectedActionVersion:2,commitmentId:f.c.id,goal:null};const moved=await tasks.change(a,f.plan.id,input);expect(moved.commitments[0].source).toMatchObject({goalId:null,milestoneId:null});
 const restored=await tasks.change(a,f.plan.id,{kind:'revert',mutationId:randomUUID(),expectedVersion:3,changeMutationId:input.mutationId});expect(restored.commitments[0].source).toMatchObject({goalId:parent.id,milestoneId:checkpoint.id,actionVersion:4});
 expect((await db.select().from(action).where(eq(action.id,f.c.actionId)))[0]).toMatchObject({goalId:parent.id,milestoneId:checkpoint.id,version:4});
});
it('context Undo rejects a new scheduled block or new execution and preserves the edited Action atomically',async()=>{
 const f=await fixture(),input={kind:'rename',mutationId:randomUUID(),expectedVersion:2,expectedActionVersion:1,commitmentId:f.c.id,title:'New task name'};await tasks.change(a,f.plan.id,input);
 const addedId=randomUUID();await db.insert(timeBlock).values({...f.block,id:addedId,start:new Date('2028-01-04T12:00Z'),end:new Date('2028-01-04T12:30Z')});const undo={kind:'revert',mutationId:randomUUID(),expectedVersion:3,changeMutationId:input.mutationId};await expect(tasks.change(a,f.plan.id,undo)).rejects.toMatchObject({code:'CONFLICT'});await db.delete(timeBlock).where(eq(timeBlock.id,addedId));
 await db.insert(focusSession).values({id:randomUUID(),ownerId:a.userId,timeBlockId:f.block.id,startedAt:new Date(now),version:1,createdAt:new Date(now),updatedAt:new Date(now)});await expect(tasks.change(a,f.plan.id,{...undo,mutationId:randomUUID()})).rejects.toMatchObject({code:'CONFLICT'});
 expect((await db.select().from(action).where(eq(action.id,f.c.actionId)))[0]).toMatchObject({title:'New task name',version:2});expect((await plans.get(a,f.plan.id)).plan.version).toBe(3);
});
