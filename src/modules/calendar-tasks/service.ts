import { changeTaskContext, type ContextUndo } from './task-context';
import { createHash, randomUUID } from 'node:crypto';
import { and, asc, eq, inArray } from 'drizzle-orm';
import { z } from 'zod';
import type { Database } from '../../db/connect';
import { executeReceipt } from '../../db/command-receipt';
import { action, user, weeklyPlan, weeklyPlanAmendment, amendmentCommitment, commitmentIdentity, timeBlock, focusSession, mutationReceipt, focusableHours } from '../../db/schema';
import { taskGoal, taskGoalSchema } from '../planning/task-goal';
import type { Actor } from '../../domain/actor';
import { ApplicationError } from '../../domain/errors';
import { boundedText, parseCommand } from '../goals/domain';
import { ownedPlan, planningSource, capacitySummary } from '../planning/domain';
import { readPlan, operation, timezone } from '../planning/repository';
import { history } from '../amendments/repository';
import { effectivePlan, canAmend, type Amendment, type AmendmentCommitment } from '../amendments/domain';
import { reserveForBudget } from '../availability/domain';
import { overlaps } from '../scheduling/domain';
import { schedulingContext } from '../scheduling/repository';
const identity = { mutationId:z.uuid(), expectedVersion:z.number().int().min(1).max(2147483646) };
export const calendarTaskCommand = z.discriminatedUnion('kind',[
 z.strictObject({...identity,kind:z.literal('budget'),commitmentId:z.uuid(),delta:z.union([z.literal(-30),z.literal(30)])}),
 z.strictObject({...identity,kind:z.literal('rename'),commitmentId:z.uuid(),expectedActionVersion:identity.expectedVersion,title:boundedText('Task',160)}),
 z.strictObject({...identity,kind:z.literal('move'),commitmentId:z.uuid(),expectedActionVersion:identity.expectedVersion,goal:taskGoalSchema.nullable()}),
 z.strictObject({...identity,kind:z.literal('drop'),commitmentId:z.uuid()}),
 z.strictObject({...identity,kind:z.literal('add'),title:boundedText('Task',160),budgetMinutes:z.union([z.literal(30),z.literal(60),z.literal(120),z.literal(180)]),goal:taskGoalSchema.optional()}),
 z.strictObject({...identity,kind:z.literal('undo'),dropMutationId:z.uuid()}),
 z.strictObject({...identity,kind:z.literal('revert'),changeMutationId:z.uuid()}),
]);
type DropUndo = { mutationId:string; expiresAt:string; commitment:AmendmentCommitment; blocks:{id:string;version:number}[]; timing:string };
type EditUndo = {mutationId:string;expiresAt:string;kind:'budget'|'add';commitmentId:string;before:number;after:number};
export type CalendarTaskChange = Amendment & { undo?:DropUndo; editUndo?:EditUndo; contextUndo?:ContextUndo; preservedExecutionBlocks?:number };
const conflict = (message:string,kind='EFFECTIVE_VERSION') => new ApplicationError('CONFLICT',message,{kind});
const timingKey=(context:Awaited<ReturnType<typeof schedulingContext>>) => JSON.stringify({hours:context.hours,calendar:context.calendar,identity:context.calendarIdentity});
export function calendarTaskService(db:Database,clock=()=>new Date().toISOString()) {
 return { async change(actor:Actor,planId:string,input:unknown):Promise<CalendarTaskChange> {
  planId=parseCommand(z.uuid(),planId);const {mutationId,...command}=parseCommand(calendarTaskCommand,input);
  const requestHash=createHash('sha256').update(JSON.stringify({operation:'calendar-task.change',planId,...command})).digest('hex');
  return operation(()=>executeReceipt(db,actor,mutationId,requestHash,async tx=>{
   const [owner]=await tx.select({id:user.id}).from(user).where(eq(user.id,actor.userId)).for('no key update');
   if(!owner)throw new ApplicationError('NOT_FOUND','This account is unavailable.');
   const [row]=await tx.select().from(weeklyPlan).where(and(eq(weeklyPlan.id,planId),eq(weeklyPlan.ownerId,actor.userId))).for('update');
   const baseline=ownedPlan(row?await readPlan(tx,actor,row):null,actor.userId),now=clock();
   if(baseline.version!==command.expectedVersion)throw conflict('This week changed elsewhere. Refresh it before changing tasks.');
   if(!canAmend(baseline,now,await timezone(tx,actor)))throw conflict('Only current or future committed weeks can be changed.','READ_ONLY_WEEK');
   const past=await history(tx,actor,planId),current=effectivePlan(baseline,past);
   let commitments=structuredClone(current.commitments),undo:DropUndo|undefined,editUndo:EditUndo|undefined,contextUndo:ContextUndo|undefined,preservedExecutionBlocks=0;
   const allBlocks=await tx.select().from(timeBlock).where(eq(timeBlock.ownerId,actor.userId)).orderBy(asc(timeBlock.id)).for('update');
   const sessions=await tx.select({blockId:focusSession.timeBlockId,endedAt:focusSession.endedAt}).from(focusSession).where(eq(focusSession.ownerId,actor.userId));
   if(command.kind==='add') {
    if(commitments.length>=50)throw new ApplicationError('VALIDATION','Choose at most 50 tasks for a week.');
    const parent=await taskGoal(tx,actor,now,command.goal);
    const [created]=await tx.insert(action).values({id:randomUUID(),ownerId:actor.userId,goalId:parent?.id ?? null,title:command.title,estimateMinutes:command.budgetMinutes,version:1,createdAt:new Date(now),updatedAt:new Date(now)}).returning();
    const source=planningSource({...created,createdAt:now,updatedAt:now,completedAt:null,archivedAt:null},parent?{...parent,createdAt:parent.createdAt.toISOString(),updatedAt:parent.updatedAt.toISOString(),archivedAt:null}:null,null);
    const added={id:randomUUID(),actionId:source.actionId,source:source.source,snapshot:source.context,budgetMinutes:command.budgetMinutes};
    commitments.push(added);
    editUndo={mutationId,expiresAt:new Date(Date.parse(now)+6000).toISOString(),kind:'add',commitmentId:added.id,before:0,after:added.budgetMinutes};
   } else if(command.kind==='revert') {
    const [receipt]=await tx.select().from(mutationReceipt).where(and(eq(mutationReceipt.ownerId,actor.userId),eq(mutationReceipt.mutationId,command.changeMutationId)));
    const changed=receipt?.result as CalendarTaskChange|undefined,saved=changed?.editUndo??changed?.contextUndo;
    if(!saved||changed?.planId!==planId||saved.mutationId!==command.changeMutationId)throw new ApplicationError('NOT_FOUND','This task change is unavailable.');
    if(Date.parse(now)>=Date.parse(saved.expiresAt))throw conflict('The six-second Undo window has ended.','UNDO_EXPIRED');
    const chosen=commitments.find(c=>c.id===saved.commitmentId);
    if(baseline.version!==changed.version||!chosen||('after' in saved&&chosen.budgetMinutes!==saved.after))throw conflict('This week changed after that edit. Refresh before adjusting it again.','UNDO_CHANGED');
    if('afterActionVersion' in saved)await changeTaskContext(tx,actor,planId,chosen,{kind:'restore',saved},mutationId,now,allBlocks,new Set(sessions.map(s=>s.blockId)));
    else if(saved.kind==='budget')chosen.budgetMinutes=saved.before;
    else {
     const related=allBlocks.filter(b=>b.planId===planId&&b.commitmentId===chosen.id&&b.state==='planned');
     if(related.some(b=>sessions.some(s=>s.blockId===b.id&&!s.endedAt)))throw conflict('Finish the active Focus Session before removing this task.','ACTIVE_SESSION');
     for(const block of related.filter(b=>!sessions.some(s=>s.blockId===b.id)))await tx.update(timeBlock).set({state:'cancelled',cancelledAt:new Date(now),updatedAt:new Date(now),version:block.version+1}).where(and(eq(timeBlock.ownerId,actor.userId),eq(timeBlock.id,block.id)));
     commitments=commitments.filter(c=>c.id!==chosen.id);
    }
   } else if(command.kind==='undo') {
    const [receipt]=await tx.select().from(mutationReceipt).where(and(eq(mutationReceipt.ownerId,actor.userId),eq(mutationReceipt.mutationId,command.dropMutationId)));
    const dropped=receipt?.result as CalendarTaskChange|undefined;
    const saved=dropped?.undo;
    if(!saved||dropped?.planId!==planId||saved.mutationId!==command.dropMutationId)throw new ApplicationError('NOT_FOUND','This dropped task is unavailable.');
    if(Date.parse(now)>=Date.parse(saved.expiresAt))throw conflict('The six-second Undo window has ended. Add the task again if needed.','UNDO_EXPIRED');
    if(commitments.some(c=>c.id===saved.commitment.id||c.actionId===saved.commitment.actionId))throw conflict('This task is already in the week.','UNDO_CHANGED');
    if(saved.blocks.length&&timingKey(await schedulingContext(tx,actor,planId,false,new Date(now)))!==saved.timing)throw conflict('Calendar availability changed. The dropped blocks cannot be restored safely.','UNDO_CHANGED');
    for(const original of saved.blocks) {
     const block=allBlocks.find(b=>b.id===original.id);
     if(!block||block.state!=='cancelled'||block.version!==original.version||sessions.some(s=>s.blockId===block.id))throw conflict('A dropped block changed. Refresh the week before restoring work.','UNDO_CHANGED');
     if(allBlocks.some(b=>b.state==='planned'&&overlaps({start:b.start.toISOString(),end:b.end.toISOString()},{start:block.start.toISOString(),end:block.end.toISOString()})))throw conflict('Another block now uses this time. Undo cannot restore overlapping blocks.','LOCAL_OVERLAP');
    }
    commitments.push(saved.commitment);
    if(saved.blocks.length)await tx.update(timeBlock).set({state:'planned',cancelledAt:null,updatedAt:new Date(now)}).where(and(eq(timeBlock.ownerId,actor.userId),inArray(timeBlock.id,saved.blocks.map(b=>b.id))));
    // Versions advance on restore; they never go backwards.
    for(const original of saved.blocks)await tx.update(timeBlock).set({version:original.version+1}).where(and(eq(timeBlock.ownerId,actor.userId),eq(timeBlock.id,original.id)));
   } else {
    const chosen=commitments.find(c=>c.id===command.commitmentId);
    if(!chosen)throw new ApplicationError('NOT_FOUND','This weekly task is unavailable.');
    if(command.kind==='rename'||command.kind==='move'){
     contextUndo=await changeTaskContext(tx,actor,planId,chosen,command,mutationId,now,allBlocks,new Set(sessions.map(s=>s.blockId)));
    } else if(command.kind==='budget') {
     const budget=chosen.budgetMinutes+command.delta;
     if(budget<30||budget>10080)throw new ApplicationError('VALIDATION','Task time must stay between 30 minutes and one week.');
     editUndo={mutationId,expiresAt:new Date(Date.parse(now)+6000).toISOString(),kind:'budget',commitmentId:chosen.id,before:chosen.budgetMinutes,after:budget};
     chosen.budgetMinutes=budget;
    } else {
     const related=allBlocks.filter(b=>b.planId===planId&&b.commitmentId===chosen.id&&b.state==='planned');
     if(related.some(b=>sessions.some(s=>s.blockId===b.id&&!s.endedAt)))throw conflict('Finish the active Focus Session before dropping this task.','ACTIVE_SESSION');
     const cancellable=related.filter(b=>!sessions.some(s=>s.blockId===b.id));
     preservedExecutionBlocks=related.length-cancellable.length;
     const timing=timingKey(await schedulingContext(tx,actor,planId,false,new Date(now)));
     for(const block of cancellable)await tx.update(timeBlock).set({state:'cancelled',cancelledAt:new Date(now),updatedAt:new Date(now),version:block.version+1}).where(and(eq(timeBlock.ownerId,actor.userId),eq(timeBlock.id,block.id)));
     undo={mutationId,expiresAt:new Date(Date.parse(now)+6000).toISOString(),commitment:chosen,blocks:cancellable.map(b=>({id:b.id,version:b.version+1})),timing};
     commitments=commitments.filter(c=>c.id!==chosen.id);
    }
   }
   let {provisionalCapacityMinutes,reserveMinutes}=current;
   const total=commitments.reduce((n,c)=>n+c.budgetMinutes,0);
   if(total>10080)throw new ApplicationError('VALIDATION','These tasks exceed the length of a week.');
   if(capacitySummary({...current,commitments}).remainingMinutes<0){
    const [preference]=await tx.select({value:focusableHours.sparePercent}).from(focusableHours).where(eq(focusableHours.ownerId,actor.userId));
    reserveMinutes=Math.min(Math.max(reserveMinutes,reserveForBudget(total,preference?.value??25)),10080-total);provisionalCapacityMinutes=total+reserveMinutes;
   }
   const value:CalendarTaskChange={id:randomUUID(),planId,sequenceNumber:(past.at(-1)?.sequenceNumber??0)+1,version:baseline.version+1,createdAt:now,reason:`Calendar: ${command.kind==='budget'?'adjusted task time':command.kind==='add'?'added a task':command.kind==='drop'?'dropped a task':command.kind==='rename'?'renamed a task':command.kind==='move'?'moved a task':'undid task change'}`,provisionalCapacityMinutes,reserveMinutes,commitments,...(undo?{undo,preservedExecutionBlocks}:{}),...(editUndo?{editUndo}:{}),...(contextUndo?{contextUndo}:{})};
   const {undo:_undo,editUndo:_edit,contextUndo:_context,preservedExecutionBlocks:_preserved,...stored}=value;void _undo;void _edit;void _context;void _preserved;
   const {commitments:rows,...record}=stored;
   await tx.update(weeklyPlan).set({version:value.version}).where(and(eq(weeklyPlan.ownerId,actor.userId),eq(weeklyPlan.id,planId),eq(weeklyPlan.version,baseline.version)));
   await tx.insert(weeklyPlanAmendment).values({...record,ownerId:actor.userId,createdAt:new Date(now)});
   if(rows.length){await tx.insert(amendmentCommitment).values(rows.map(c=>({...c,amendmentId:value.id,ownerId:actor.userId})));await tx.insert(commitmentIdentity).values(rows.map(c=>({id:c.id,ownerId:actor.userId,planId}))).onConflictDoNothing();}
   if(value.undo)value.undo.expiresAt=new Date(Date.parse(clock())+6000).toISOString();
   if(value.editUndo)value.editUndo.expiresAt=new Date(Date.parse(clock())+6000).toISOString();
   if(value.contextUndo)value.contextUndo.expiresAt=new Date(Date.parse(clock())+6000).toISOString();
   return value;
  }));
 } };
}
