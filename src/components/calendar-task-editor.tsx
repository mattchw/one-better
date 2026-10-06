"use client";
import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import type { CalendarTaskChange } from '@/modules/calendar-tasks/service';
import { codePointLength } from '@/modules/goals/domain';
import { request, errorInfo } from './mutation-client';
import { duration } from './planning-presentation';
import { TaskGoalPicker, type TaskGoalChoice } from './task-goal-picker';
export type Command = {kind:'rename';commitmentId:string;title:string;expectedActionVersion:number}|{kind:'move';commitmentId:string;goal:{id:string;version:number}|null;expectedActionVersion:number}|{kind:'budget';commitmentId:string;delta:number}|{kind:'drop';commitmentId:string}|{kind:'add';title:string;budgetMinutes:number;goal?:{id:string;version:number}}|{kind:'undo';dropMutationId:string}|{kind:'revert';changeMutationId:string};
type Controls = {added:number;busy:boolean;change:(command:Command)=>Promise<boolean>};
const TaskContext=createContext<Controls|null>(null);
export const useCalendarTasks=()=>useContext(TaskContext);
export function CalendarTaskEditor({planId,version,onChanged,onLock,children}:{planId:string;version:number;onChanged:()=>Promise<void>;onLock:(locked:boolean)=>void;children:ReactNode}) {
 const [busy,setBusy]=useState(false),[pending,setPending]=useState<object|null>(null),[error,setError]=useState(''),[undo,setUndo]=useState<{command:Command;expiresAt:string}>(),[notice,setNotice]=useState('');
 const [added,setAdded]=useState(0);
 const running=useRef(false),last=useRef<{change:CalendarTaskChange;undoRemainingMilliseconds:number;receivedAt:number}|null>(null),timer=useRef<ReturnType<typeof setTimeout>|null>(null);
 useEffect(()=>{onLock(busy||!!pending);return()=>onLock(false);},[busy,pending,onLock]);
 useEffect(()=>()=>{if(timer.current)clearTimeout(timer.current);},[]);
 useEffect(()=>{if(!pending)return;const guard=(e:BeforeUnloadEvent)=>e.preventDefault();window.addEventListener('beforeunload',guard);return()=>window.removeEventListener('beforeunload',guard);},[pending]);
 async function change(command?:Command){
  if(running.current)return false;running.current=true;setBusy(true);setError('');
  const body=pending??{...command,mutationId:crypto.randomUUID(),expectedVersion:version};setPending(body);
  try {
   if(!last.current){const response=await request<{change:CalendarTaskChange;undoRemainingMilliseconds:number}>(`/api/weekly-plans/${planId}/tasks`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});last.current={...response,receivedAt:performance.now()};}
   const result=last.current.change;
   await onChanged();
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
  } catch(e){const info=errorInfo(e);setError(info.message);if(!last.current&&!['UNCERTAIN','DATABASE_UNAVAILABLE'].includes(info.code)){setPending(null);if(command?.kind==='undo'||command?.kind==='revert'){setUndo(undefined);setNotice('');}}return false;}
  finally{running.current=false;setBusy(false);}
 }
 return <TaskContext.Provider value={{added,busy:busy||!!pending,change}}>{children}
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
 const controls=useContext(TaskContext),[open,setOpen]=useState(false),[title,setTitle]=useState(''),[minutes,setMinutes]=useState(60),[goal,setGoal]=useState<TaskGoalChoice>();const text=title.trim();
 const valid=codePointLength(text)>0&&codePointLength(text)<=160&&text.isWellFormed()&&!text.includes('\0');
 useEffect(()=>{if(!open||!title)return;const guard=(e:BeforeUnloadEvent)=>e.preventDefault();window.addEventListener('beforeunload',guard);return()=>window.removeEventListener('beforeunload',guard);},[open,title]);
 if(!controls)return null;
 if(!open)return <button id="add-weekly-task" className="quiet-button add-weekly-task" disabled={controls.busy} onClick={()=>setOpen(true)}>+ Add a task</button>;
 async function add(){if(valid&&await controls!.change({kind:'add',title:text,budgetMinutes:minutes,...(goal?{goal:{id:goal.id,version:goal.version}}:{})})){setTitle('');setOpen(false);}}
 return <form className="add-weekly-task-form" onSubmit={e=>{e.preventDefault();void add();}}><label>Task name<input autoFocus value={title} disabled={controls.busy} onChange={e=>setTitle(e.target.value)} placeholder="One thing to move forward"/></label><TaskGoalPicker selected={goal} onChange={setGoal} disabled={controls.busy}/><fieldset disabled={controls.busy}><legend>Time for this task</legend>{[30,60,120,180].map(value=><label key={value}><input type="radio" name="add-task-time" checked={minutes===value} onChange={()=>setMinutes(value)}/><span>{duration(value)}</span></label>)}</fieldset><p className="small-note">Saved under {goal?.title ?? 'General'}. Schedule it when you’re ready.</p><div><button className="primary-button" disabled={controls.busy||!valid}>Add task</button><button className="quiet-button" type="button" disabled={controls.busy} onClick={()=>{setTitle('');setOpen(false);}}>Cancel</button></div></form>;
}
