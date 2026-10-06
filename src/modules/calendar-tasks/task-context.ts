import { and, eq } from 'drizzle-orm';
import type { Transaction } from '../../db/command-receipt';
import { action, milestone, timeBlock } from '../../db/schema';
import type { Actor } from '../../domain/actor';
import { ApplicationError } from '../../domain/errors';
import type { AmendmentCommitment } from '../amendments/domain';
import type { SourceGuard, PlanningSnapshot } from '../planning/domain';
import { lockSources, sources } from '../planning/repository';
import { taskGoal, type TaskGoal } from '../planning/task-goal';
export type ContextUndo = {
 mutationId:string;expiresAt:string;commitmentId:string;afterActionVersion:number;
 before:{title:string;source:SourceGuard};observedBlockIds:string[];blocks:{id:string;version:number;snapshot:PlanningSnapshot}[];
};
type Edit = {kind:'rename';title:string;expectedActionVersion:number}|{kind:'move';goal:TaskGoal|null;expectedActionVersion:number}|{kind:'restore';saved:ContextUndo};
const conflict=(message:string)=>new ApplicationError('CONFLICT',message,{kind:'TASK_CONTEXT_CHANGED'});
export async function changeTaskContext(tx:Transaction,actor:Actor,planId:string,chosen:AmendmentCommitment,edit:Edit,mutationId:string,now:string,blocks:typeof timeBlock.$inferSelect[],sessionBlockIds:Set<string>):Promise<ContextUndo|undefined>{
 // Account/plan locks are held by the caller; source locks follow the existing Goal/Milestone/Action order.
 const destination=edit.kind==='move'?edit.goal:edit.kind==='restore'&&edit.saved.before.source.goalId?{id:edit.saved.before.source.goalId,version:edit.saved.before.source.goalVersion!}:null;
 const parent=edit.kind==='rename'?undefined:await taskGoal(tx,actor,now,destination??undefined);
 const [live]=await lockSources(tx,actor,[chosen.actionId]);
 if(!live)throw new ApplicationError('NOT_FOUND','This task is unavailable.');
 const expected=edit.kind==='restore'?edit.saved.afterActionVersion:edit.expectedActionVersion;
 if(live.source.actionVersion!==expected)throw conflict('This task changed elsewhere. Refresh before editing it.');
 if(!live.eligible)throw conflict(live.reason??'This task is read-only.');
 const [original]=await tx.select().from(action).where(and(eq(action.ownerId,actor.userId),eq(action.id,chosen.actionId)));
 let milestoneId=edit.kind==='rename'?original.milestoneId:null;
 if(edit.kind==='restore'&&edit.saved.before.source.milestoneId){
  const [checkpoint]=await tx.select().from(milestone).where(and(eq(milestone.ownerId,actor.userId),eq(milestone.id,edit.saved.before.source.milestoneId))).for('update');
  if(!checkpoint||checkpoint.goalId!==parent?.id||checkpoint.state!=='active'||checkpoint.version!==edit.saved.before.source.milestoneVersion)throw conflict('The original milestone changed. Undo cannot restore its link.');
  milestoneId=checkpoint.id;
 }
 if(edit.kind==='restore'&&blocks.some(b=>b.planId===planId&&b.commitmentId===chosen.id&&b.state==='planned'&&!edit.saved.observedBlockIds.includes(b.id)))throw conflict('This task has newly scheduled time. Refresh before changing its Goal again.');
 if(edit.kind==='restore')for(const saved of edit.saved.blocks){
  const block=blocks.find(b=>b.id===saved.id);
  if(!block||block.version!==saved.version||block.state!=='planned'||sessionBlockIds.has(block.id)||block.start.getTime()<=Date.parse(now))throw conflict('A scheduled block changed or started. Undo cannot rewrite its history.');
 }
 const title=edit.kind==='rename'?edit.title:edit.kind==='restore'?edit.saved.before.title:original.title;
 const goalId=edit.kind==='rename'?original.goalId:parent?.id??null;
 if(edit.kind!=='restore'&&title===original.title&&goalId===original.goalId&&chosen.snapshot.action.title===title&&(chosen.snapshot.goal?.id??null)===goalId)throw conflict('This task already has that name and Goal.');
 await tx.update(action).set({title,goalId,milestoneId,version:original.version+1,updatedAt:new Date(now)}).where(and(eq(action.ownerId,actor.userId),eq(action.id,original.id),eq(action.version,original.version)));
 const [updated]=await sources(tx,actor,[chosen.actionId]);
 chosen.source=updated.source;chosen.snapshot=updated.context;
 const changedBlocks:ContextUndo['blocks']=[];
 if(edit.kind==='restore'){
  for(const saved of edit.saved.blocks)await tx.update(timeBlock).set({snapshot:saved.snapshot,version:saved.version+1,updatedAt:new Date(now)}).where(and(eq(timeBlock.ownerId,actor.userId),eq(timeBlock.id,saved.id)));
 }else{
  for(const block of blocks.filter(b=>b.planId===planId&&b.commitmentId===chosen.id&&b.state==='planned'&&b.start.getTime()>Date.parse(now)&&!sessionBlockIds.has(b.id))){
   changedBlocks.push({id:block.id,version:block.version+1,snapshot:block.snapshot});
   // Keep block-specific names and done conditions. Only a name inherited from the task follows a rename.
   const snapshot={...block.snapshot,goal:updated.context.goal,milestone:updated.context.milestone,action:{...block.snapshot.action,title:edit.kind==='rename'&&block.snapshot.action.title===live.context.action.title?title:block.snapshot.action.title}};
   await tx.update(timeBlock).set({snapshot,version:block.version+1,updatedAt:new Date(now)}).where(and(eq(timeBlock.ownerId,actor.userId),eq(timeBlock.id,block.id)));
  }
  return {mutationId,expiresAt:new Date(Date.parse(now)+6000).toISOString(),commitmentId:chosen.id,afterActionVersion:updated.source.actionVersion,before:{title:original.title,source:live.source},observedBlockIds:blocks.filter(b=>b.planId===planId&&b.commitmentId===chosen.id&&b.state==='planned').map(b=>b.id),blocks:changedBlocks};
 }
}
