import type {CalendarTaskChange} from '../../src/modules/calendar-tasks/service';
import {it,expect,vi} from 'vitest';
import {CalendarStateController} from '../../src/client/calendar-state';
import {RequestFailure} from '../../src/components/mutation-client';
import type {SchedulingView,PlacementReview,TimeBlock} from '../../src/modules/scheduling/domain';
const planId='11111111-1111-4111-8111-111111111111',blockId='22222222-2222-4222-8222-222222222222',commitmentId='33333333-3333-4333-8333-333333333333',actionId='44444444-4444-4444-8444-444444444444';
const snapshot={action:{id:actionId,title:'Read a chapter',doneWhen:null,estimateMinutes:120},goal:null,milestone:null};
const interval=(hour:number,minutes=60)=>({start:`2028-01-04T${String(hour).padStart(2,'0')}:00:00Z`,end:`2028-01-04T${String(hour+minutes/60).padStart(2,'0')}:00:00Z`});
const block:SchedulingView['blocks'][number]={id:blockId,planId,commitmentId,...interval(9),state:'planned',version:1,createdAt:'2028-01-03T08:00:00Z',updatedAt:'2028-01-03T08:00:00Z',cancelledAt:null,snapshot,executionLocked:false,recordedMilliseconds:0,canEdit:true,canCancel:true,canFocus:false,reviewRequired:false};
const view:SchedulingView={planId,weekStartDate:'2028-01-03',timezone:'Europe/London',userTimezone:'Europe/London',planVersion:3,canSchedule:true,blocks:[block],commitments:[{id:commitmentId,actionId,source:{actionVersion:1,goalId:null,goalVersion:null,milestoneId:null,milestoneVersion:null},snapshot,budgetMinutes:180,scheduledMinutes:60,recordedMilliseconds:0}]};
const review:PlacementReview={interval:interval(10),adjustments:[],outsideHours:false,hoursConfigured:true,busyConflict:false,calendarStatus:'fresh',fetchedAt:'2028-01-03T08:00:00Z',budgetMinutes:180,scheduledMinutes:60,resultingMinutes:60,planVersion:3,reviewKey:'a'.repeat(64)};
const clock=()=>Date.parse('2028-01-03T08:00Z');
const deferred=<T>()=>{let resolve!:(v:T)=>void,reject!:(e:unknown)=>void;const promise=new Promise<T>((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};
const tick=async()=>{for(let i=0;i<15;i++)await Promise.resolve();};
function transport(fn:(url:string,options?:RequestInit)=>Promise<unknown>){return fn as <T>(url:string,options?:RequestInit)=>Promise<T>;}
it('create appears instantly with one derived total, replaces its temporary ID without awaiting reconciliation, and no duplicate on replay',async()=>{
 const write=deferred<{block:TimeBlock}>(),read=deferred<SchedulingView>();const api=vi.fn(async(url:string)=>url.includes('preview')?review:url.includes('time-blocks')&&url!==`/api/weekly-plans/${planId}/time-blocks`?{}:read.promise);
 const cache=new CalendarStateController(view,transport(async(url,opt)=>opt?.method==='POST'&&!url.endsWith('preview')?write.promise:api(url)),clock,()=>crypto.randomUUID());
 const temp=cache.submit(planId,'create',undefined,interval(11),snapshot,commitmentId)!;
 expect(temp).toMatch(/^optimistic:/);expect(cache.snapshot().views[planId].blocks).toHaveLength(2);expect(cache.snapshot().views[planId].commitments[0].scheduledMinutes).toBe(120);
 await tick();write.resolve({block:{...block,id:'55555555-5555-4555-8555-555555555555',...interval(11)}});await tick();
 expect(cache.snapshot().pending).toBe(false);expect(cache.snapshot().views[planId].blocks.map(b=>b.id)).not.toContain(temp);expect(cache.snapshot().views[planId].blocks).toHaveLength(2);expect(cache.snapshot().views[planId].commitments[0].scheduledMinutes).toBe(120);
 cache.queryClient.clear();
});
it('rapid moves coalesce behind the in-flight write and use the returned version without old responses flashing over new intent',async()=>{
 const first=deferred<{block:TimeBlock}>(),second=deferred<{block:TimeBlock}>();const bodies:Record<string,unknown>[]=[];
 const cache=new CalendarStateController(view,transport(async(url,opt)=>{if(url.endsWith('preview'))return review;if(opt?.method==='PATCH'){bodies.push(JSON.parse(String(opt.body)));return bodies.length===1?first.promise:second.promise;}return view;}),clock);
 cache.submit(planId,'place',blockId,interval(10),snapshot,commitmentId);await tick();expect(bodies).toHaveLength(1);
 cache.submit(planId,'place',blockId,interval(11),snapshot,commitmentId);cache.submit(planId,'place',blockId,interval(12),snapshot,commitmentId);
 expect(cache.snapshot().views[planId].blocks[0].start).toBe(interval(12).start);expect(bodies).toHaveLength(1);
 first.resolve({block:{...block,...interval(10),version:2}});await tick();expect(cache.snapshot().views[planId].blocks[0].start).toBe(interval(12).start);expect(bodies).toHaveLength(2);expect(bodies[1]).toMatchObject({startTime:'12:00',expectedVersion:2});
 second.resolve({block:{...block,...interval(12),version:3}});await tick();cache.queryClient.clear();
});
it('cancel hides immediately and definitive rejection restores the confirmed schedule and totals without changing other pending blocks',async()=>{
 const rejected=deferred<{block:TimeBlock}>();const cache=new CalendarStateController(view,transport(async(url)=>url.endsWith('/cancel')?rejected.promise:new Promise(()=>{})),clock);
 cache.submit(planId,'cancel',blockId,interval(9),snapshot,commitmentId);expect(cache.snapshot().views[planId].blocks[0].state).toBe('cancelled');expect(cache.snapshot().views[planId].commitments[0].scheduledMinutes).toBe(0);
 const pending=cache.submit(planId,'create',undefined,interval(12),snapshot,commitmentId)!;
 rejected.reject(new RequestFailure({code:'CONFLICT',message:'Execution has begun.',kind:'EXECUTION_LOCKED'}));await tick();expect(cache.snapshot().views[planId].blocks[0].state).toBe('planned');expect(cache.snapshot().views[planId].commitments[0].scheduledMinutes).toBe(120);expect(cache.snapshot().views[planId].blocks.find(b=>b.id===pending)).toMatchObject({pending:'saving',state:'planned'});expect(cache.snapshot().errors[0].message).toContain('Execution has begun');cache.queryClient.clear();
});
it('busy or clock-change preview pauses with no write, accepts explicitly, and Move back discards the projection',async()=>{
 const calls:string[]=[];const cache=new CalendarStateController(view,transport(async(url,opt)=>{calls.push(opt?.method??'GET');if(url.endsWith('preview'))return {...review,busyConflict:true};if(opt?.method==='PATCH')return {block:{...block,...interval(10),version:2}};return view;}),clock);
 cache.submit(planId,'place',blockId,interval(10),snapshot,commitmentId);await tick();expect(calls).toEqual(['POST']);expect(cache.snapshot().issues[0].status).toBe('review');expect(cache.snapshot().views[planId].blocks[0].start).toBe(interval(10).start);cache.discard(blockId);expect(cache.snapshot().views[planId].blocks[0].start).toBe(interval(9).start);
 cache.submit(planId,'place',blockId,interval(10),snapshot,commitmentId);await tick();cache.accept(blockId);await tick();expect(calls).toContain('PATCH');cache.queryClient.clear();
});
it('an uncertain write keeps exact identity/body for retry and only then sends the newest queued intention',async()=>{
 const first=deferred<{block:TimeBlock}>();const bodies:string[]=[];
 const cache=new CalendarStateController(view,transport(async(url,opt)=>{if(url.endsWith('preview'))return review;if(opt?.method==='PATCH'){bodies.push(String(opt.body));if(bodies.length===1)return first.promise;const data=JSON.parse(String(opt.body));return {block:{...block,...interval(Number(data.startTime.slice(0,2))),version:bodies.length}};}return new Promise(()=>{});}),clock);
 cache.submit(planId,'place',blockId,interval(10),snapshot,commitmentId);await tick();cache.submit(planId,'place',blockId,interval(12),snapshot,commitmentId);first.reject(new RequestFailure({code:'UNCERTAIN',message:'Response lost'}));await tick();expect(cache.snapshot().issues[0].status).toBe('uncertain');expect(cache.snapshot().views[planId].blocks[0].start).toBe(interval(12).start);
 cache.retry(blockId);await tick();expect(bodies).toHaveLength(3);expect(bodies[0]).toBe(bodies[1]);expect(JSON.parse(bodies[2])).toMatchObject({startTime:'12:00',expectedVersion:2});cache.queryClient.clear();
});
it('late reads cannot overwrite newer saves',async()=>{
 const read=deferred<SchedulingView>();const cache=new CalendarStateController(view,transport(async(url,opt)=>{if(url.endsWith('preview'))return review;if(opt?.method==='PATCH')return {block:{...block,...interval(11),version:2}};return read.promise;}),clock);
 void cache.refresh(planId);await tick();cache.submit(planId,'place',blockId,interval(11),snapshot,commitmentId);await tick();read.resolve(view);await tick();expect(cache.snapshot().views[planId].blocks[0]).toMatchObject({start:interval(11).start,version:2});expect(cache.snapshot().errors).toHaveLength(0);cache.queryClient.clear();
});
it('execution-locked, read-only, past, cross-day and out-of-week requests never reach the transport',()=>{
 const api=vi.fn();const locked=new CalendarStateController({...view,blocks:[{...block,executionLocked:true,canEdit:false}]},api,clock);
 expect(locked.submit(planId,'place',blockId,interval(10),snapshot,commitmentId)).toBeNull();expect(api).not.toHaveBeenCalled();locked.queryClient.clear();
 const cache=new CalendarStateController(view,api,clock);expect(cache.submit(planId,'create',undefined,{start:'2028-01-04T23:30Z',end:'2028-01-05T00:30Z'},snapshot,commitmentId)).toBeNull();expect(cache.submit(planId,'create',undefined,{start:'2028-02-04T10:00Z',end:'2028-02-04T11:00Z'},snapshot,commitmentId)).toBeNull();expect(api).not.toHaveBeenCalled();cache.queryClient.clear();
});

it('background read failure keeps a confirmed write and never raises a save error',async()=>{
 const cache=new CalendarStateController(view,transport(async(url,opt)=>{if(url.endsWith('preview'))return review;if(opt?.method==='PATCH')return {block:{...block,...interval(11),version:2}};throw new RequestFailure({code:'DATABASE_UNAVAILABLE',message:'Read failed'});}),clock);
 cache.submit(planId,'place',blockId,interval(11),snapshot,commitmentId);await tick();expect(cache.snapshot().pending).toBe(false);expect(cache.snapshot().views[planId].blocks[0]).toMatchObject({start:interval(11).start,version:2});expect(cache.snapshot().errors).toEqual([]);cache.queryClient.clear();
});

it('an idle mounted Calendar retains its confirmed cache for later interactions',async()=>{
 vi.useFakeTimers();const api=vi.fn(async()=>new Promise(()=>{})),cache=new CalendarStateController(view,transport(api),clock);
 try{await vi.advanceTimersByTimeAsync(30*60*1000);expect(cache.canonical(planId)).toEqual(view);expect(cache.submit(planId,'place',blockId,interval(11),snapshot,commitmentId)).toBe(blockId);expect(cache.snapshot().views[planId].blocks[0].start).toBe(interval(11).start);}finally{cache.queryClient.clear();vi.useRealTimers();}
});

const destination={id:'66666666-6666-4666-8666-666666666666',title:'Workout',outcome:'Move every day',version:1,createdAt:'2028-01-03T08:00Z',updatedAt:'2028-01-03T08:00Z',archivedAt:null};
function taskMoveResult():CalendarTaskChange{return {id:crypto.randomUUID(),planId,sequenceNumber:1,version:4,createdAt:'2028-01-03T08:01Z',reason:'Calendar: moved a task',provisionalCapacityMinutes:240,reserveMinutes:60,commitments:[{...view.commitments[0],source:{...view.commitments[0].source,actionVersion:2,goalId:destination.id,goalVersion:1},snapshot:{...snapshot,goal:{id:destination.id,title:destination.title,outcome:destination.outcome}}}],contextUndo:{mutationId:crypto.randomUUID(),expiresAt:'2028-01-03T08:01:06Z',commitmentId,afterActionVersion:2,before:{title:snapshot.action.title,source:view.commitments[0].source},observedBlockIds:[blockId],blocks:[{id:blockId,version:2,snapshot}]}};}
it('task reassignment projects the Goal before any request and reconciles versions without touching executed or past block history',()=>{
 const locked={...block,id:'locked',executionLocked:true,canEdit:false},past={...block,id:'past',start:'2028-01-03T07:00Z',end:'2028-01-03T08:00Z'},custom={...block,snapshot:{...snapshot,action:{...snapshot.action,title:'Read ten pages'}}};
 const cache=new CalendarStateController({...view,blocks:[custom,locked,past]},transport(()=>new Promise(()=>{})),clock);const move=cache.beginTaskMove(planId,commitmentId,destination)!;
 expect(move.actionId).toBe(actionId);expect(cache.canonical(planId)!.commitments[0].snapshot.goal).toBeNull();const projected=cache.snapshot().views[planId];expect(projected.commitments[0]).toMatchObject({pending:'saving',snapshot:{goal:{id:destination.id},milestone:null}});expect(projected.blocks[0]).toMatchObject({version:1,canEdit:false,snapshot:{goal:{id:destination.id},action:{title:'Read ten pages'}}});expect(projected.blocks.slice(1).map(b=>b.snapshot.goal)).toEqual([null,null]);expect(projected.commitments[0].scheduledMinutes).toBe(180);
 move.confirm(taskMoveResult());expect(cache.snapshot().pending).toBe(false);expect(cache.canonical(planId)!.planVersion).toBe(4);expect(cache.canonical(planId)!.blocks[0]).toMatchObject({version:2,start:block.start,end:block.end,snapshot:{goal:{id:destination.id},action:{title:'Read ten pages'}}});expect(cache.canonical(planId)!.blocks[1].version).toBe(1);cache.queryClient.clear();
});
it('rejected task movement rolls back context and totals, and an obsolete handle cannot alter a later intention',()=>{
 const cache=new CalendarStateController(view,transport(()=>new Promise(()=>{})),clock),first=cache.beginTaskMove(planId,commitmentId,destination)!;
 first.rollback();expect(cache.snapshot().views[planId].commitments[0].snapshot.goal).toBeNull();expect(cache.snapshot().views[planId].blocks[0].snapshot.goal).toBeNull();expect(cache.snapshot().views[planId].commitments[0].scheduledMinutes).toBe(60);
 const next=cache.beginTaskMove(planId,commitmentId,destination)!;first.confirm(taskMoveResult());expect(cache.snapshot().pending).toBe(true);expect(cache.canonical(planId)!.planVersion).toBe(3);next.rollback();cache.queryClient.clear();
});
it('an uncertain task move keeps its context projection and blocks schedule writes until its receipt is confirmed',()=>{
 const api=vi.fn(()=>new Promise(()=>{})),cache=new CalendarStateController(view,transport(api),clock),move=cache.beginTaskMove(planId,commitmentId,destination)!;
 move.uncertain();expect(cache.snapshot()).toMatchObject({pending:true,saving:false});expect(cache.snapshot().views[planId].commitments[0].pending).toBe('uncertain');expect(cache.submit(planId,'place',blockId,interval(11),snapshot,commitmentId)).toBeNull();expect(api).not.toHaveBeenCalled();move.confirm(taskMoveResult());expect(cache.snapshot().pending).toBe(false);cache.queryClient.clear();
});

const addedId='77777777-7777-4777-8777-777777777777',addedActionId='88888888-8888-4888-8888-888888888888';
function taskAddResult():CalendarTaskChange{return {...taskMoveResult(),commitments:[view.commitments[0],{id:addedId,actionId:addedActionId,budgetMinutes:60,source:{actionVersion:1,goalId:destination.id,goalVersion:1,milestoneId:null,milestoneVersion:null},snapshot:{action:{id:addedActionId,title:'Strength training',doneWhen:null,estimateMinutes:60},goal:{id:destination.id,title:destination.title,outcome:destination.outcome},milestone:null}}],contextUndo:undefined,editUndo:{kind:'add',mutationId:addedId,expiresAt:'2028-01-03T08:01:06Z',commitmentId:addedId,before:0,after:60}};}
it('adding a task projects its Goal and budget immediately, then replaces temporary identities without waiting for reads',()=>{
 const cache=new CalendarStateController(view,transport(()=>new Promise(()=>{})),clock),handle=cache.beginTaskAdd(planId,{title:'Strength training',budgetMinutes:60,goal:destination},addedId)!;
 expect(cache.canonical(planId)!.commitments).toHaveLength(1);expect(cache.snapshot()).toMatchObject({pending:true,saving:true});const next=cache.snapshot().views[planId];expect(next.commitments[1]).toMatchObject({id:`optimistic:${addedId}`,pending:'saving',budgetMinutes:60,scheduledMinutes:0,recordedMilliseconds:0,snapshot:{goal:{id:destination.id},action:{title:'Strength training'}}});expect(next.blocks).toEqual(view.blocks);
 handle.confirm(taskAddResult());expect(cache.snapshot().pending).toBe(false);expect(cache.canonical(planId)!.planVersion).toBe(4);expect(cache.snapshot().views[planId].commitments[1]).toMatchObject({id:addedId,actionId:addedActionId,scheduledMinutes:0});expect(cache.snapshot().views[planId].commitments[1].pending).toBeUndefined();cache.queryClient.clear();
});
it('an uncertain addition stays visible once and a rejected addition restores totals without disrupting a later task',()=>{
 const cache=new CalendarStateController(view,transport(()=>new Promise(()=>{})),clock),first=cache.beginTaskAdd(planId,{title:'Strength training',budgetMinutes:60},addedId)!;
 first.uncertain();expect(cache.snapshot()).toMatchObject({pending:true,saving:false});expect(cache.snapshot().views[planId].commitments[1]).toMatchObject({pending:'uncertain',snapshot:{goal:null}});expect(cache.beginTaskAdd(planId,{title:'Duplicate',budgetMinutes:60},'duplicate')).toBeNull();expect(cache.submit(planId,'create',undefined,interval(11),snapshot,`optimistic:${addedId}`)).toBeNull();
 first.rollback();expect(cache.snapshot().views[planId].commitments).toEqual(view.commitments);const next=cache.beginTaskAdd(planId,{title:'Another task',budgetMinutes:30},'next')!;first.confirm(taskAddResult());expect(cache.snapshot().views[planId].commitments[1].snapshot.action.title).toBe('Another task');next.rollback();cache.queryClient.clear();
});
it('late reads cannot remove a newly confirmed task and invalid/read-only additions never project',async()=>{
 const read=deferred<SchedulingView>(),cache=new CalendarStateController(view,transport(()=>read.promise),clock);void cache.refresh(planId);await tick();const handle=cache.beginTaskAdd(planId,{title:'Strength training',budgetMinutes:60},addedId)!;handle.confirm(taskAddResult());read.resolve(view);await tick();expect(cache.snapshot().views[planId].commitments.map(c=>c.id)).toEqual([commitmentId,addedId]);expect(cache.beginTaskAdd(planId,{title:'',budgetMinutes:60},'invalid')).toBeNull();cache.queryClient.clear();
 const locked=new CalendarStateController({...view,canSchedule:false},transport(()=>new Promise(()=>{})),clock);expect(locked.beginTaskAdd(planId,{title:'Task',budgetMinutes:60},addedId)).toBeNull();locked.queryClient.clear();
});

function taskDropResult():CalendarTaskChange{return {...taskMoveResult(),commitments:[],contextUndo:undefined,undo:{mutationId:addedId,expiresAt:'2028-01-03T08:01:06Z',commitment:view.commitments[0],blocks:[{id:blockId,version:2}],timing:'fixture'},preservedExecutionBlocks:0};}
it('task removal immediately hides its commitment and unexecuted blocks, preserves recorded execution, and confirms receipt versions',()=>{
 const executed={...block,id:'executed',executionLocked:true,recordedMilliseconds:600000},past={...block,id:'past',start:'2028-01-03T06:00Z',end:'2028-01-03T07:00Z'},unrelated={...block,id:'other',commitmentId:'other-task'};
 const cache=new CalendarStateController({...view,blocks:[block,executed,past,unrelated]},transport(()=>new Promise(()=>{})),clock),drop=cache.beginTaskDrop(planId,commitmentId)!;
 expect(cache.canonical(planId)!.commitments).toHaveLength(1);expect(cache.snapshot().views[planId].commitments).toHaveLength(0);expect(cache.snapshot().views[planId].blocks.map(b=>b.state)).toEqual(['cancelled','planned','cancelled','planned']);expect(cache.snapshot().views[planId].blocks[1]).toMatchObject({reviewRequired:true,recordedMilliseconds:600000,snapshot,pending:'saving',canFocus:false});
 const result=taskDropResult();result.undo!.blocks.push({id:'past',version:2});result.preservedExecutionBlocks=1;drop.confirm(result);expect(cache.snapshot().pending).toBe(false);expect(cache.canonical(planId)!.blocks[0]).toMatchObject({state:'cancelled',version:2,cancelledAt:result.createdAt});expect(cache.canonical(planId)!.blocks[1]).toMatchObject({state:'planned',executionLocked:true,recordedMilliseconds:600000,reviewRequired:true});expect(cache.canonical(planId)!.blocks[3]).toEqual(unrelated);cache.queryClient.clear();
});
it('rejected removal restores exact task, calendar blocks and totals; obsolete handles cannot remove a later intention',()=>{
 const cache=new CalendarStateController(view,transport(()=>new Promise(()=>{})),clock),first=cache.beginTaskDrop(planId,commitmentId)!;first.rollback();expect(cache.snapshot().views[planId]).toMatchObject({commitments:view.commitments,blocks:view.blocks});const next=cache.beginTaskAdd(planId,{title:'Another task',budgetMinutes:30},addedId)!;first.confirm(taskDropResult());expect(cache.snapshot().views[planId].commitments).toHaveLength(2);next.rollback();cache.queryClient.clear();
});
it('an uncertain removal stays projected and a late read cannot resurrect a confirmed deletion',async()=>{
 const read=deferred<SchedulingView>(),api=vi.fn(()=>read.promise),cache=new CalendarStateController(view,transport(api),clock);void cache.refresh(planId);await tick();const drop=cache.beginTaskDrop(planId,commitmentId)!;drop.uncertain();expect(cache.snapshot()).toMatchObject({pending:true,saving:false});expect(cache.snapshot().views[planId].commitments).toHaveLength(0);expect(cache.beginTaskAdd(planId,{title:'Task',budgetMinutes:60},addedId)).toBeNull();expect(cache.submit(planId,'create',undefined,interval(11),snapshot,commitmentId)).toBeNull();drop.confirm(taskDropResult());read.resolve(view);await tick();expect(cache.snapshot().views[planId].commitments).toHaveLength(0);expect(cache.snapshot().views[planId].blocks[0]).toMatchObject({state:'cancelled',version:2});cache.queryClient.clear();
});
it('removal trusts receipt cancellations if execution began elsewhere and read-only/missing tasks never project',()=>{
 const cache=new CalendarStateController(view,transport(()=>new Promise(()=>{})),clock),drop=cache.beginTaskDrop(planId,commitmentId)!;const result=taskDropResult();result.undo!.blocks=[];result.preservedExecutionBlocks=1;drop.confirm(result);expect(cache.snapshot().views[planId].blocks[0]).toMatchObject({state:'planned',executionLocked:true,reviewRequired:true,canEdit:false});expect(cache.beginTaskDrop(planId,'missing')).toBeNull();cache.queryClient.clear();
 const locked=new CalendarStateController({...view,canSchedule:false},transport(()=>new Promise(()=>{})),clock);expect(locked.beginTaskDrop(planId,commitmentId)).toBeNull();locked.queryClient.clear();
});
