import type {Goal} from '../modules/goals/domain';
import type {CalendarTaskChange} from '../modules/calendar-tasks/service';
import { QueryClient } from '@tanstack/react-query';
import { Temporal } from '@js-temporal/polyfill';
import { currentWeek, type PlanningSnapshot } from '../modules/planning/domain';
import { elapsedMinutes, resolvePlacement, type PlacementReview, type SchedulingView, type TimeBlock } from '../modules/scheduling/domain';
import { errorInfo, request, type CommandError } from '../components/mutation-client';
export type BlockStatus='saving'|'review'|'uncertain';
export type ClientBlock=SchedulingView['blocks'][number]&{pending?:BlockStatus};
export type ClientCommitment=SchedulingView['commitments'][number]&{pending?:BlockStatus};
export type ClientSchedule=Omit<SchedulingView,'blocks'|'commitments'>&{blocks:ClientBlock[];commitments:ClientCommitment[]};
export type TaskChangeHandle={confirm:(result:CalendarTaskChange)=>void;rollback:()=>void;uncertain:()=>void};
export type TaskMoveHandle=TaskChangeHandle&{actionId:string};
export type TaskAddInput={title:string;budgetMinutes:number;goal?:Pick<Goal,'id'|'version'|'title'|'outcome'>};
type TaskAdd={commitment:ClientCommitment;status:'saving'|'uncertain'};
type TaskDrop={commitmentId:string;status:'saving'|'uncertain'};
type TaskMove={commitmentId:string;goal:PlanningSnapshot['goal'];status:'saving'|'uncertain'};
export type BlockCommand={url:string;method:string;body:Record<string,unknown>};
type Interval={start:string;end:string};
type Intent={id:string;planId:string;blockId:string;kind:'create'|'place'|'cancel';interval:Interval;snapshot:PlanningSnapshot;commitmentId:string;command?:BlockCommand};
type Job={latest:Intent;active?:Intent;command?:BlockCommand;review?:PlacementReview;status:'queued'|BlockStatus;error?:CommandError};
export type CalendarState={aliases:Record<string,string>;views:Record<string,ClientSchedule>;pending:boolean;saving:boolean;issues:{blockId:string;planId:string;status:BlockStatus;message:string;review?:PlacementReview}[];errors:{id:string;message:string}[]};
type Transport=<T>(url:string,options?:RequestInit)=>Promise<T>;
export const scheduleKey=(planId:string)=>['calendar','schedule',planId] as const;
export function recount(view:SchedulingView):ClientSchedule {
 return {...view,commitments:view.commitments.map(c=>({...c,scheduledMinutes:view.blocks.filter(b=>b.state==='planned'&&b.commitmentId===c.id).reduce((n,b)=>n+elapsedMinutes(b),0)}))};
}
const wall=(interval:Interval,zone:string)=>{
 const start=Temporal.Instant.from(interval.start).toZonedDateTimeISO(zone),end=Temporal.Instant.from(interval.end).toZonedDateTimeISO(zone);
 if(!start.toPlainDate().equals(end.toPlainDate()))throw new Error('Keep the block within one local day.');
 return {date:start.toPlainDate().toString(),startTime:start.toPlainTime().toString({smallestUnit:'minute'}),endTime:end.toPlainTime().toString({smallestUnit:'minute'})};
};
// One owner-scoped cache per mounted Calendar. Confirmed data and pending intentions are separate.
// Server receipts/versions remain authoritative. Query responses never replace a newer mutation.
export class CalendarStateController {
 // This cache has no useQuery observers; keep confirmed views for the mounted page lifetime.
 readonly queryClient:QueryClient;
 private taskMoves=new Map<string,TaskMove>();
 private taskAdds=new Map<string,TaskAdd>();
 private taskDrops=new Map<string,TaskDrop>();
 private planIds=new Set<string>();private jobs=new Map<string,Job>();private running=false;
 private aliases:Record<string,string>={};private listeners=new Set<()=>void>();private revision=new Map<string,number>();private errors:CalendarState['errors']=[];
 private state:CalendarState={aliases:{},views:{},pending:false,saving:false,issues:[],errors:[]};
 constructor(initial:SchedulingView|null,private transport:Transport=request,private clock=()=>Date.now(),private uuid=()=>crypto.randomUUID()){
  this.queryClient=new QueryClient({defaultOptions:{queries:{retry:false,staleTime:30000,gcTime:Infinity}}});if(initial)this.set(initial);
 }
 subscribe=(listener:()=>void)=>{this.listeners.add(listener);return()=>{this.listeners.delete(listener);};};
 snapshot=()=>this.state;
 canonical=(id:string)=>this.queryClient.getQueryData<SchedulingView>(scheduleKey(id));
 set(view:SchedulingView){this.planIds.add(view.planId);this.bump(view.planId);this.queryClient.setQueryData(scheduleKey(view.planId),view);this.emit();}
 private bump(planId:string){this.revision.set(planId,(this.revision.get(planId)??0)+1);}
 private emit(){
  const views:Record<string,ClientSchedule>={};
  for(const id of this.planIds){const canonical=this.canonical(id);if(!canonical)continue;
   const blocks:ClientBlock[]=canonical.blocks.map(b=>({...b}));
   const drop=this.taskDrops.get(id);
   const commitments:ClientCommitment[]=canonical.commitments.filter(c=>c.id!==drop?.commitmentId).map(c=>({...c})),move=this.taskMoves.get(id);
   if(drop)for(let i=0;i<blocks.length;i++){const b=blocks[i];if(b.commitmentId===drop.commitmentId&&b.state==='planned')blocks[i]={...b,state:b.executionLocked?'planned':'cancelled',reviewRequired:b.executionLocked,pending:drop.status,canEdit:false,canCancel:false,canFocus:false};}
   const add=this.taskAdds.get(id);if(add)commitments.push({...add.commitment,pending:add.status});
   if(move){const chosen=commitments.find(c=>c.id===move.commitmentId);if(chosen){chosen.snapshot={...chosen.snapshot,goal:move.goal,milestone:null};chosen.pending=move.status;}
    for(let i=0;i<blocks.length;i++){const b=blocks[i];if(b.commitmentId===move.commitmentId&&b.state==='planned'&&!b.executionLocked&&Date.parse(b.start)>this.clock())blocks[i]={...b,snapshot:{...b.snapshot,goal:move.goal,milestone:null},pending:move.status,canEdit:false,canCancel:false,canFocus:false};}
   }
   for(const job of this.jobs.values())if(job.latest.planId===id){const intent=job.latest,status=job.status==='queued'?'saving':job.status,index=blocks.findIndex(b=>b.id===intent.blockId),old=blocks[index];
    if(intent.kind==='create'&&!old)blocks.push({id:intent.blockId,planId:id,commitmentId:intent.commitmentId,...intent.interval,state:'planned',version:0,createdAt:new Date(this.clock()).toISOString(),updatedAt:new Date(this.clock()).toISOString(),cancelledAt:null,snapshot:intent.snapshot,executionLocked:false,recordedMilliseconds:0,canEdit:false,canCancel:false,canFocus:false,reviewRequired:false,pending:status});
    else if(old)blocks[index]={...old,...intent.interval,state:intent.kind==='cancel'?'cancelled':'planned',pending:status,canFocus:false,canCancel:false,canEdit:intent.kind==='place'&&status==='saving'&&old.canEdit};
   }
   views[id]=recount({...canonical,blocks,commitments});
  }
  this.state={aliases:{...this.aliases},views,pending:this.jobs.size>0||this.taskMoves.size>0||this.taskAdds.size>0||this.taskDrops.size>0,saving:[...this.jobs.values()].some(j=>j.status==='saving'||j.status==='queued')||[...this.taskMoves.values()].some(m=>m.status==='saving')||[...this.taskAdds.values()].some(a=>a.status==='saving')||[...this.taskDrops.values()].some(d=>d.status==='saving'),errors:this.errors,issues:[...this.jobs.values()].filter(j=>j.status==='review'||j.status==='uncertain').map(j=>({blockId:j.latest.blockId,planId:j.latest.planId,status:j.status as BlockStatus,message:j.error?.message??'Review this placement before saving.',review:j.review}))};
  for(const listener of this.listeners)listener();
 }
 beginTaskMove(planId:string,commitmentId:string,goal:Goal|null):TaskMoveHandle|null {
  const view=this.canonical(planId),chosen=view?.commitments.find(c=>c.id===commitmentId);
  if(!view?.canSchedule||!chosen||view.weekStartDate<currentWeek(new Date(this.clock()).toISOString(),view.userTimezone)||this.snapshot().pending)return null;
  const move:TaskMove={commitmentId,goal:goal?{id:goal.id,title:goal.title,outcome:goal.outcome}:null,status:'saving'};
  void this.queryClient.cancelQueries({queryKey:scheduleKey(planId)});this.bump(planId);this.taskMoves.set(planId,move);this.emit();
  return {actionId:chosen.actionId,
   uncertain:()=>{if(this.taskMoves.get(planId)===move){move.status='uncertain';this.emit();}},
   rollback:()=>{if(this.taskMoves.get(planId)!==move)return;this.taskMoves.delete(planId);this.bump(planId);this.emit();void this.refresh(planId);},
   confirm:(result)=>{
    if(this.taskMoves.get(planId)!==move)return;
    const current=this.canonical(planId)!,changed=result.commitments.find(c=>c.id===commitmentId)!;
    const updated=new Map(result.contextUndo?.blocks.map(b=>[b.id,b])??[]);
    const blocks=current.blocks.map(b=>{const saved=updated.get(b.id);return saved?{...b,version:saved.version,updatedAt:result.createdAt,snapshot:{...b.snapshot,goal:changed.snapshot.goal,milestone:changed.snapshot.milestone}}:b;});
    this.taskMoves.delete(planId);this.confirmTaskChange(planId,result,blocks);
   }};
 }
 beginTaskAdd(planId:string,input:TaskAddInput,mutationId:string):TaskChangeHandle|null {
  const view=this.canonical(planId),title=input.title.trim();
  if(!view?.canSchedule||view.weekStartDate<currentWeek(new Date(this.clock()).toISOString(),view.userTimezone)||this.snapshot().pending||view.commitments.length>=50||!title||Array.from(title).length>160||!title.isWellFormed()||title.includes('\0')||![30,60,120,180].includes(input.budgetMinutes))return null;
  const id=`optimistic:${mutationId}`,actionId=`optimistic-action:${mutationId}`,goal=input.goal;
  const add:TaskAdd={status:'saving',commitment:{id,actionId,budgetMinutes:input.budgetMinutes,scheduledMinutes:0,recordedMilliseconds:0,source:{actionVersion:1,goalId:goal?.id??null,goalVersion:goal?.version??null,milestoneId:null,milestoneVersion:null},snapshot:{action:{id:actionId,title,doneWhen:null,estimateMinutes:input.budgetMinutes},goal:goal?{id:goal.id,title:goal.title,outcome:goal.outcome}:null,milestone:null}}};
  void this.queryClient.cancelQueries({queryKey:scheduleKey(planId)});this.bump(planId);this.taskAdds.set(planId,add);this.emit();
  return {
   uncertain:()=>{if(this.taskAdds.get(planId)===add){add.status='uncertain';this.emit();}},
   rollback:()=>{if(this.taskAdds.get(planId)!==add)return;this.taskAdds.delete(planId);this.bump(planId);this.emit();void this.refresh(planId);},
   confirm:result=>{if(this.taskAdds.get(planId)!==add)return;this.taskAdds.delete(planId);this.confirmTaskChange(planId,result);}
  };
 }
 private confirmTaskChange(planId:string,result:CalendarTaskChange,blocks=this.canonical(planId)!.blocks){
  const current=this.canonical(planId)!,commitments=result.commitments.map(c=>({...c,scheduledMinutes:0,recordedMilliseconds:current.commitments.find(old=>old.id===c.id)?.recordedMilliseconds??0}));
  this.bump(planId);this.queryClient.setQueryData(scheduleKey(planId),recount({...current,planVersion:result.version,commitments,blocks}));this.emit();void this.refresh(planId);
 }
 beginTaskDrop(planId:string,commitmentId:string):TaskChangeHandle|null {
  const view=this.canonical(planId);
  if(!view?.canSchedule||!view.commitments.some(c=>c.id===commitmentId)||view.weekStartDate<currentWeek(new Date(this.clock()).toISOString(),view.userTimezone)||this.snapshot().pending)return null;
  const drop:TaskDrop={commitmentId,status:'saving'};
  void this.queryClient.cancelQueries({queryKey:scheduleKey(planId)});this.bump(planId);this.taskDrops.set(planId,drop);this.emit();
  return {
   uncertain:()=>{if(this.taskDrops.get(planId)===drop){drop.status='uncertain';this.emit();}},
   rollback:()=>{if(this.taskDrops.get(planId)!==drop)return;this.taskDrops.delete(planId);this.bump(planId);this.emit();void this.refresh(planId);},
   confirm:result=>{
    if(this.taskDrops.get(planId)!==drop)return;
    const cancelled=new Map(result.undo?.blocks.map(b=>[b.id,b])??[]);
    const blocks=this.canonical(planId)!.blocks.map(b=>{const saved=cancelled.get(b.id);
     if(saved)return {...b,state:'cancelled' as const,version:saved.version,cancelledAt:result.createdAt,updatedAt:result.createdAt,canEdit:false,canCancel:false,canFocus:false,reviewRequired:false};
     // A Focus Session may have appeared since the last read; only receipt-listed blocks were cancelled.
     return b.commitmentId===commitmentId&&b.state==='planned'?{...b,executionLocked:true,canEdit:false,canCancel:false,reviewRequired:true}:b;
    });
    this.taskDrops.delete(planId);this.confirmTaskChange(planId,result,blocks);
   }
  };
 }
 private reject(message:string){const id=this.uuid();this.errors=[...this.errors,{id,message}];this.emit();return null;}
 dismiss(id:string){this.errors=this.errors.filter(e=>e.id!==id);this.emit();}
 submit(planId:string,kind:Intent['kind'],blockId:string|undefined,interval:Interval,snapshot:PlanningSnapshot,commitmentId:string,command?:BlockCommand){
  if(this.taskMoves.has(planId)||this.taskAdds.has(planId)||this.taskDrops.has(planId))return this.reject('Confirm the pending task change before changing its schedule.');
  const view=this.canonical(planId),existing=blockId?view?.blocks.find(b=>b.id===blockId):null,job=blockId?this.jobs.get(blockId):null;
  if(!view||!view.canSchedule||view.weekStartDate<currentWeek(new Date(this.clock()).toISOString(),view.userTimezone))return this.reject('This week is read-only. The schedule has been kept.');
  if(kind!=='create'&&(!existing||existing.state!=='planned'||existing.executionLocked||Date.parse(existing.start)<=this.clock()||kind==='place'&&!existing.canEdit||kind==='cancel'&&!existing.canCancel))return this.reject('This block is read-only or execution has begun. Its schedule has been kept.');
  if(job?.status==='uncertain')return this.reject('Confirm the pending save before changing this block again.');
  if(kind!=='cancel')try{const placement=wall(interval,view.timezone);const resolved=resolvePlacement(view,placement);if(Date.parse(resolved.interval.start)<=this.clock())throw new Error('Choose a future start time.');}catch(e){return this.reject(e instanceof Error?e.message:'Choose valid times inside this week.');}
  const id=String(command?.body.mutationId??this.uuid()),key=blockId??`optimistic:${id}`;
  const intent:Intent={id,planId,blockId:key,kind,interval,snapshot,commitmentId,command};
  void this.queryClient.cancelQueries({queryKey:scheduleKey(planId)});this.bump(planId);
  if(job){job.latest=intent;if(job.status==='review')job.active=undefined;if(!job.active){job.command=undefined;job.review=undefined;job.status='queued';}}
  else this.jobs.set(key,{latest:intent,status:'queued'});
  this.emit();void this.pump();return key;
 }
 private async pump(){
  if(this.running)return;this.running=true;
  try{while(true){
   // Serialize each plan's preview/write because reviewKey also covers neighboring blocks.
   const paused=new Set([...this.jobs.values()].filter(j=>j.status==='review'||j.status==='uncertain').map(j=>j.latest.planId));
   const entry=[...this.jobs.entries()].find(([,j])=>j.status==='queued'&&!paused.has(j.latest.planId));if(!entry)break;
   const [key,job]=entry;const intent=job.active??job.latest;job.active=intent;job.status='saving';this.emit();
   try{
    if(!job.command){
     if(intent.command)job.command=intent.command;
     else{const view=this.canonical(intent.planId)!,block=view.blocks.find(b=>b.id===key);
      if(intent.kind==='cancel')job.command={url:`/api/time-blocks/${key}/cancel`,method:'POST',body:{mutationId:intent.id,expectedVersion:block!.version}};
      else{
       const placement={commitmentId:intent.commitmentId,...wall(intent.interval,view.timezone),...(block?{blockId:block.id,expectedVersion:block.version}:{})};
       const review=await this.transport<PlacementReview>(`/api/weekly-plans/${view.planId}/time-blocks/preview`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(placement)});
       if(job.latest!==intent){job.active=undefined;job.status='queued';this.emit();continue;}
       job.review=review;
       if(review.busyConflict||review.adjustments.length){job.status='review';this.emit();continue;}
       job.command=this.placementCommand(intent,block?.version,review,false);
      }
     }
    }
    const command=job.command;
    const {block}=await this.transport<{block:TimeBlock}>(command.url,{method:command.method,headers:{'Content-Type':'application/json'},body:JSON.stringify(command.body)});
    this.merge(block,key);
    if(job.latest===intent){this.jobs.delete(key);}
    else{job.active=undefined;job.command=undefined;job.review=undefined;job.status='queued';if(job.latest.command)job.latest={...job.latest,command:undefined};}
    this.emit();if(![...this.jobs.values()].some(j=>j.latest.planId===intent.planId))void this.refresh(intent.planId);
   }catch(e){const info=errorInfo(e);
    if(info.code==='UNCERTAIN'||info.code==='DATABASE_UNAVAILABLE'){job.error=info;job.status='uncertain';this.emit();}
    else{this.jobs.delete(key);this.errors=[...this.errors,{id:intent.id,message:`Change wasn’t saved. ${info.message} The confirmed schedule is restored.`}];this.emit();void this.refresh(intent.planId);}
   }
  }}finally{this.running=false;}
 }
 private placementCommand(intent:Intent,version:number|undefined,review:PlacementReview,busyAck:boolean):BlockCommand{
  const view=this.canonical(intent.planId)!;return {url:version?`/api/time-blocks/${intent.blockId}`:`/api/weekly-plans/${intent.planId}/time-blocks`,method:version?'PATCH':'POST',body:{commitmentId:intent.commitmentId,...wall(intent.interval,view.timezone),mutationId:intent.id,expectedPlanVersion:review.planVersion,reviewKey:review.reviewKey,acknowledgeOutsideHours:review.outsideHours,acknowledgeBusy:busyAck,...(version?{expectedVersion:version}:{})}};
 }
 accept(blockId:string){const job=this.jobs.get(blockId);if(!job||job.status!=='review'||!job.review)return;const intent=job.active!;job.command=this.placementCommand(intent,this.canonical(intent.planId)?.blocks.find(b=>b.id===blockId)?.version,job.review,true);job.status='queued';job.active=undefined;this.emit();void this.pump();}
 discard(blockId:string){const job=this.jobs.get(blockId);if(job?.status!=='review')return;this.jobs.delete(blockId);this.emit();void this.pump();}
 retry(blockId:string){const job=this.jobs.get(blockId);if(job?.status!=='uncertain')return;
  // Resolve the exact in-flight receipt before advancing to the newer coalesced intent.

  job.status='queued';job.error=undefined;this.emit();void this.pump();
 }
 private merge(block:TimeBlock,oldId:string){if(oldId.startsWith('optimistic:'))this.aliases[oldId]=block.id;const view=this.canonical(block.planId)!;const previous=view.blocks.find(b=>b.id===oldId);const committed=view.commitments.some(c=>c.id===block.commitmentId);const future=Date.parse(block.start)>this.clock();
  const result={...previous,...block,executionLocked:previous?.executionLocked??false,recordedMilliseconds:previous?.recordedMilliseconds??0,reviewRequired:!committed&&block.state==='planned',canCancel:view.canSchedule&&future&&block.state==='planned'&&!previous?.executionLocked,canEdit:view.canSchedule&&future&&block.state==='planned'&&committed&&!previous?.executionLocked,canFocus:view.canSchedule&&block.state==='planned'&&view.weekStartDate===currentWeek(new Date(this.clock()).toISOString(),view.userTimezone)};
  this.bump(block.planId);this.queryClient.setQueryData(scheduleKey(block.planId),recount({...view,blocks:[...view.blocks.filter(b=>b.id!==oldId&&b.id!==block.id),result]}));
 }
 async refresh(planId:string){
  const generation=this.revision.get(planId);try{
   await this.queryClient.invalidateQueries({queryKey:scheduleKey(planId),refetchType:'none'});
   await this.queryClient.fetchQuery({queryKey:scheduleKey(planId),staleTime:0,queryFn:async({signal})=>{
    const next=await this.transport<SchedulingView>(`/api/weekly-plans/${planId}/time-blocks`,{signal});
    const current=this.canonical(planId)!;
    if(generation!==this.revision.get(planId)||this.taskMoves.has(planId)||this.taskAdds.has(planId)||this.taskDrops.has(planId)||[...this.jobs.values()].some(j=>j.latest.planId===planId)||next.planVersion<current.planVersion)return current;
    const fresh=new Map(next.blocks.map(b=>[b.id,b]));
    for(const known of current.blocks){const fetched=fresh.get(known.id);if(!fetched||fetched.version<known.version)fresh.set(known.id,{...known,executionLocked:known.executionLocked||!!fetched?.executionLocked,canEdit:known.canEdit&&!fetched?.executionLocked,canCancel:known.canCancel&&!fetched?.executionLocked});}
    return recount({...next,blocks:[...fresh.values()]});
   }});this.emit();
  }catch{/* A confirmed write stays confirmed when only background reconciliation fails. */}
 }
}
