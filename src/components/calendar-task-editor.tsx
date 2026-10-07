"use client";
import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import type {Goal} from '@/modules/goals/domain';
import type {ActionView} from '@/modules/actions/domain';
import type {TaskMoveHandle,TaskChangeHandle,TaskAddInput} from '@/client/calendar-state';
import type { CalendarTaskChange } from '@/modules/calendar-tasks/service';
import { codePointLength } from '@/modules/goals/domain';
import { request, errorInfo } from './mutation-client';
import { duration } from './planning-presentation';
import { TaskGoalPicker, type TaskGoalChoice } from './task-goal-picker';
export type Command = {kind:'rename';commitmentId:string;title:string;expectedActionVersion:number}|{kind:'move';commitmentId:string;goal:{id:string;version:number}|null;expectedActionVersion:number}|{kind:'budget';commitmentId:string;delta:number}|{kind:'drop';commitmentId:string}|{kind:'add';title:string;budgetMinutes:number;goal?:{id:string;version:number}}|{kind:'undo';dropMutationId:string}|{kind:'revert';changeMutationId:string};
type Controls = {added:number;busy:boolean;failedAdd?:TaskAddInput;add:(input:TaskAddInput)=>boolean;move:(commitmentId:string,goal:Goal|null)=>Promise<boolean>;change:(command:Command)=>Promise<boolean>};
const TaskContext=createContext<Controls|null>(null);
export const useCalendarTasks=()=>useContext(TaskContext);
export function CalendarTaskEditor({planId,version,onChanged,onMoveStart,onAddStart,onDropStart,onLock,children}:{planId:string;version:number;onChanged:(mode?:'background')=>Promise<void>;onMoveStart?:(commitmentId:string,goal:Goal|null)=>TaskMoveHandle|null;onAddStart:(input:TaskAddInput,mutationId:string)=>TaskChangeHandle|null;onDropStart:(commitmentId:string)=>TaskChangeHandle|null;onLock:(locked:boolean)=>void;children:ReactNode}) {
 const [busy,setBusy]=useState(false),[pending,setPending]=useState<object|null>(null),[error,setError]=useState(''),[undo,setUndo]=useState<{command:Command;expiresAt:string}>(),[notice,setNotice]=useState('');
 const [added,setAdded]=useState(0);
 const taskHandle=useRef<TaskChangeHandle|null>(null),addDraft=useRef<TaskAddInput|null>(null);
 const [failedAdd,setFailedAdd]=useState<TaskAddInput>();
 const running=useRef(false),last=useRef<{change:CalendarTaskChange;undoRemainingMilliseconds:number;receivedAt:number}|null>(null),timer=useRef<ReturnType<typeof setTimeout>|null>(null);
 useEffect(()=>{onLock(busy||!!pending);return()=>onLock(false);},[busy,pending,onLock]);
 useEffect(()=>()=>{if(timer.current)clearTimeout(timer.current);},[]);
 useEffect(()=>{if(!pending)return;const guard=(e:BeforeUnloadEvent)=>e.preventDefault();window.addEventListener('beforeunload',guard);return()=>window.removeEventListener('beforeunload',guard);},[pending]);
 function add(input:TaskAddInput){
  if(running.current||busy||pending)return false;
  const mutationId=crypto.randomUUID(),handle=onAddStart(input,mutationId);
  if(!handle){setError('This week is busy, read-only or already has 50 tasks. Finish the current save before adding another task.');return false;}
  taskHandle.current=handle;addDraft.current=input;setFailedAdd(undefined);
  void change({kind:'add',title:input.title,budgetMinutes:input.budgetMinutes,...(input.goal?{goal:{id:input.goal.id,version:input.goal.version}}:{})},undefined,mutationId);return true;
 }
 async function change(command?:Command,moving?:{commitmentId:string;goal:Goal|null},mutationId?:string){
  if(running.current)return false;running.current=true;setBusy(true);setError('');
  let body:object|null=pending;
  try {
   if(command?.kind==='drop'&&!body){const handle=onDropStart(command.commitmentId);if(!handle)throw new Error('This task is busy or read-only. Try again once the current save finishes.');taskHandle.current=handle;setNotice('Removing task…');}
   if(moving&&!body){
    const handle=onMoveStart?.(moving.commitmentId,moving.goal);if(!handle)throw new Error('This task is busy or read-only. Try again once the current save finishes.');taskHandle.current=handle;
    const live=await request<ActionView>(`/api/actions/${handle.actionId}`);if(!live.mutability.editable)throw new Error(live.mutability.message??'This task is read-only.');
    body={kind:'move',commitmentId:moving.commitmentId,goal:moving.goal?{id:moving.goal.id,version:moving.goal.version}:null,expectedActionVersion:live.action.version,mutationId:crypto.randomUUID(),expectedVersion:version};
   }
   body??={...command,mutationId:mutationId??crypto.randomUUID(),expectedVersion:version};setPending(body);
   if(!last.current){const response=await request<{change:CalendarTaskChange;undoRemainingMilliseconds:number}>(`/api/weekly-plans/${planId}/tasks`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});last.current={...response,receivedAt:performance.now()};}
   const result=last.current.change;
   if(taskHandle.current){taskHandle.current.confirm(result);taskHandle.current=null;addDraft.current=null;void onChanged('background').catch(()=>{});}else await onChanged();
   const kind=(body as {kind:string}).kind;
   if(kind==='add')setAdded(n=>n+1);
   if(result.undo||result.editUndo||result.contextUndo){
    if(timer.current)clearTimeout(timer.current);
    const saved=result.undo??result.editUndo??result.contextUndo!;
    setUndo({command:result.undo?{kind:'undo',dropMutationId:saved.mutationId}:{kind:'revert',changeMutationId:saved.mutationId},expiresAt:saved.expiresAt});
    setNotice(kind==='drop'?`Task dropped.${result.preservedExecutionBlocks?' Recorded focus history is kept.':''}`:kind==='add'?'Task added.':kind==='rename'?'Task renamed.':kind==='move'?'Task moved.':'Task time updated.');
    timer.current=setTimeout(()=>{setUndo(undefined);setNotice('');},Math.max(0,last.current.undoRemainingMilliseconds-(performance.now()-last.current.receivedAt)));
   }
   else if(kind==='undo'||kind==='revert'){if(timer.current)clearTimeout(timer.current);setUndo(undefined);setNotice(kind==='undo'?'Task and its blocks restored.':'Task change undone.');}
   else {if(!undo)setNotice('Task updated.');}
   setPending(null);last.current=null;return true;
  } catch(e){const info=errorInfo(e);setError(!body&&e instanceof Error?e.message:info.message);if(!last.current&&(!body||!['UNCERTAIN','DATABASE_UNAVAILABLE'].includes(info.code))){taskHandle.current?.rollback();taskHandle.current=null;if(addDraft.current){setFailedAdd(addDraft.current);addDraft.current=null;setAdded(n=>n+1);}setPending(null);if((body as {kind?:string}|null)?.kind==='drop')setNotice('');if(command?.kind==='undo'||command?.kind==='revert'){setUndo(undefined);setNotice('');}}else {taskHandle.current?.uncertain();if((body as {kind?:string}|null)?.kind==='drop')setNotice('Task removal is unconfirmed. Retry to confirm the save.');}return false;}
  finally{running.current=false;setBusy(false);}
 }
 return <TaskContext.Provider value={{added,busy:busy||!!pending,failedAdd,add,change,move:(commitmentId,goal)=>change(undefined,{commitmentId,goal})}}>{children}
 {error&&<div className="canvas-error" role="alert"><p>{error}</p>{pending&&<button className="quiet-button" disabled={busy} onClick={()=>void change()}>Retry same task change</button>}</div>}
 {notice&&<div className={`calendar-task-toast ${undo?'has-undo':''}`} role="status"><span>{notice}</span>{undo&&<button disabled={busy||!!pending} onClick={()=>void change(undo.command)}>Undo</button>}</div>}
 </TaskContext.Provider>;
}
export function WeeklyTaskControls({id,title,minutes,locked}:{id:string;title:string;minutes:number;locked:boolean}) {
 const controls=useContext(TaskContext);if(!controls)return null;const disabled=locked||controls.busy;
 return <div className="weekly-task-controls"><div className="weekly-task-stepper" role="group" aria-label={`Time for ${title}`}><button disabled={disabled||minutes<=30} aria-label={`Reduce ${title} by 30 minutes`} onClick={()=>void controls.change({kind:'budget',commitmentId:id,delta:-30})}>−</button><span>{duration(minutes)}</span><button disabled={disabled||minutes>10050} aria-label={`Increase ${title} by 30 minutes`} onClick={()=>void controls.change({kind:'budget',commitmentId:id,delta:30})}>+</button></div></div>;
}
export function AddWeeklyTask(){
 return <WeeklyTaskForm key={useContext(TaskContext)?.added}/>;
}
function WeeklyTaskForm(){
 const controls=useContext(TaskContext),[open,setOpen]=useState(!!controls?.failedAdd),[title,setTitle]=useState(controls?.failedAdd?.title??''),[minutes,setMinutes]=useState(controls?.failedAdd?.budgetMinutes??60),[goal,setGoal]=useState<TaskGoalChoice|undefined>(controls?.failedAdd?.goal);const text=title.trim();
 const valid=codePointLength(text)>0&&codePointLength(text)<=160&&text.isWellFormed()&&!text.includes('\0');
 useEffect(()=>{if(!open||!title)return;const guard=(e:BeforeUnloadEvent)=>e.preventDefault();window.addEventListener('beforeunload',guard);return()=>window.removeEventListener('beforeunload',guard);},[open,title]);
 if(!controls)return null;
 if(!open)return <button id="add-weekly-task" className="quiet-button add-weekly-task" disabled={controls.busy} onClick={()=>setOpen(true)}>+ Add a task</button>;
 function add(){if(valid&&controls!.add({title:text,budgetMinutes:minutes,goal})){setTitle('');setOpen(false);}}
 return <form className="add-weekly-task-form" onSubmit={e=>{e.preventDefault();void add();}}><label>Task name<input autoFocus value={title} disabled={controls.busy} onChange={e=>setTitle(e.target.value)} placeholder="One thing to move forward"/></label><TaskGoalPicker selected={goal} onChange={setGoal} disabled={controls.busy}/><fieldset disabled={controls.busy}><legend>Time for this task</legend>{[30,60,120,180].map(value=><label key={value}><input type="radio" name="add-task-time" checked={minutes===value} onChange={()=>setMinutes(value)}/><span>{duration(value)}</span></label>)}</fieldset><p className="small-note">Saved under {goal?.title ?? 'General'}. Schedule it when you’re ready.</p><div><button className="primary-button" disabled={controls.busy||!valid}>Add task</button><button className="quiet-button" type="button" disabled={controls.busy} onClick={()=>{setTitle('');setOpen(false);}}>Cancel</button></div></form>;
}
