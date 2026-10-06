"use client";
import {useEffect,useRef,useState} from 'react';
import type {Goal} from '@/modules/goals/domain';
import type {ActionView} from '@/modules/actions/domain';
import type {PlanningSnapshot} from '@/modules/planning/domain';
import {goalGroupKey,goalTitle} from '@/modules/planning/general';
import {goalTone} from './calendar-layout';
import {duration} from './planning-presentation';
import {WeeklyTaskControls,useCalendarTasks} from './calendar-task-editor';
import {request,errorInfo} from './mutation-client';
export type CalendarWorkItem={id:string;budgetMinutes:number;scheduledMinutes:number;snapshot:PlanningSnapshot};
export function CalendarWorkList({items,week,editable,locked,draft,onSchedule}:{items:CalendarWorkItem[];week:string;editable:boolean;locked:boolean;draft:boolean;onSchedule:(item:CalendarWorkItem,source:HTMLButtonElement)=>void}){
 const controls=useCalendarTasks(),[goals,setGoals]=useState<Goal[]>([]),[drag,setDrag]=useState<string|null>(null),[over,setOver]=useState<string|null>(null),[moving,setMoving]=useState<string|null>(null),[localBusy,setLocalBusy]=useState(false),[error,setError]=useState('');
 const disabled=locked||!!controls?.busy||localBusy,canEdit=editable&&!!controls;
 useEffect(()=>{if(!canEdit)return;let active=true;request<{goals:Goal[]}>('/api/goals?status=active').then(r=>{if(active)setGoals(r.goals);},()=>{if(active)setError('Couldn’t load move destinations. Refresh the calendar to try again.');});return()=>{active=false;};},[canEdit]);
 const groups=new Map<string,{title:string;items:CalendarWorkItem[]}>();
 for(const item of items){const key=goalGroupKey(item.snapshot.goal);const group=groups.get(key)??{title:goalTitle(item.snapshot.goal),items:[]};group.items.push(item);groups.set(key,group);}
 if(drag||moving){for(const goal of goals)if(!groups.has(goal.id))groups.set(goal.id,{title:goal.title,items:[]});if(!groups.has('general'))groups.set('general',{title:'General',items:[]});}
 async function edit(item:CalendarWorkItem,kind:'rename'|'move',value:string){
  if(disabled||!controls)return false;setLocalBusy(true);setError('');
  try{const live=await request<ActionView>(`/api/actions/${item.snapshot.action.id}`);if(!live.mutability.editable)throw new Error(live.mutability.message??'This task is read-only.');
   if(kind==='rename')return await controls.change({kind,commitmentId:item.id,title:value,expectedActionVersion:live.action.version});
   const goal=goals.find(g=>g.id===value);if(value!=='general'&&!goal)throw new Error('This Goal is unavailable. Refresh the calendar.');
   return await controls.change({kind,commitmentId:item.id,goal:goal?{id:goal.id,version:goal.version}:null,expectedActionVersion:live.action.version});
  }catch(e){setError(e instanceof Error?e.message:errorInfo(e).message);return false;}finally{setLocalBusy(false);}
 }
 function clearDrag(){setDrag(null);setOver(null);}
 async function move(item:CalendarWorkItem,target:string){clearDrag();setMoving(null);if(goalGroupKey(item.snapshot.goal)!==target)await edit(item,'move',target);}
 return <div className={`calendar-work-list ${drag?'is-dragging':''}`} onKeyDown={e=>{if(e.key==='Escape'){clearDrag();setMoving(null);}}}>
  {error&&<p className="canvas-error" role="alert">{error}</p>}
  {moving&&<p className="small-note" role="status">Choose a Goal below for this task.</p>}
  {[...groups].map(([id,group])=><section key={id} data-goal-drop={id} className={`work-goal-group tone-${goalTone(id)} ${id==='general'?'is-general':''} ${over===id?'is-drop-target':''} ${drag?'accepts-task-drop':''}`}
   onDragOver={e=>{if(drag&&!disabled){e.preventDefault();e.dataTransfer.dropEffect='move';setOver(id);}}}
   onDragLeave={e=>{if(!e.currentTarget.contains(e.relatedTarget as Node|null))setOver(null);}}
   onDrop={e=>{e.preventDefault();const item=items.find(i=>i.id===drag&&i.id===e.dataTransfer.getData('text/plain'));if(item&&!disabled)void move(item,id);else clearDrag();}}>
   {moving?<button className="work-goal move-task-destination" disabled={disabled||goalGroupKey(items.find(i=>i.id===moving)!.snapshot.goal)===id} onClick={()=>void move(items.find(i=>i.id===moving)!,id)}><span className="goal-dot" aria-hidden="true"/>Move to {group.title}</button>:id==='general'?<div className="work-goal general-work-heading"><span className="goal-dot" aria-hidden="true"/>General</div>:<a className="work-goal" href={`/goals/${id}?week=${week}`}><span className="goal-dot" aria-hidden="true"/>{group.title}</a>}
   {!group.items.length&&<p className="empty-goal-drop">Drop a task here</p>}
   {group.items.map(item=><TaskCard key={item.id} item={item} editable={canEdit} disabled={disabled} draft={draft} dragging={drag===item.id} onDrag={e=>{if(disabled){e.preventDefault();return;}e.dataTransfer.setData('text/plain',item.id);e.dataTransfer.effectAllowed='move';setDrag(item.id);}} onDragEnd={clearDrag} onRename={title=>edit(item,'rename',title)} onMove={()=>{setError('');setMoving(item.id);}} onSchedule={source=>onSchedule(item,source)}/>)}
  </section>)}
 </div>;
}
function TaskCard({item,editable,disabled,draft,dragging,onDrag,onDragEnd,onRename,onMove,onSchedule}:{item:CalendarWorkItem;editable:boolean;disabled:boolean;draft:boolean;dragging:boolean;onDrag:React.DragEventHandler;onDragEnd:()=>void;onRename:(title:string)=>Promise<boolean>;onMove:()=>void;onSchedule:(source:HTMLButtonElement)=>void}){
 const controls=useCalendarTasks(),[menu,setMenu]=useState(false),[editing,setEditing]=useState(false),[title,setTitle]=useState(item.snapshot.action.title),[nameError,setNameError]=useState('');const root=useRef<HTMLElement>(null),options=useRef<HTMLButtonElement>(null),saving=useRef(false),cancelled=useRef(false);
 useEffect(()=>{if(!menu)return;const outside=(e:PointerEvent)=>{if(!root.current?.contains(e.target as Node))setMenu(false);};document.addEventListener('pointerdown',outside);return()=>document.removeEventListener('pointerdown',outside);},[menu]);
 async function save(){if(saving.current||cancelled.current)return;const text=title.trim();if(text===item.snapshot.action.title){setEditing(false);return;}if(!text||Array.from(text).length>160||!text.isWellFormed()||text.includes('\0')){setNameError('Use a task name between 1 and 160 characters.');return;}saving.current=true;try{if(await onRename(text))setEditing(false);}finally{saving.current=false;}}
 return <article ref={root} className={`calendar-commitment ${editable?'is-draggable':''} ${dragging?'task-dragging':''}`} data-calendar-commitment={item.id} draggable={editable&&!disabled&&!editing&&!menu} onDragStart={onDrag} onDragEnd={onDragEnd} onKeyDown={e=>{if(e.key==='Escape'){setMenu(false);options.current?.focus();}}}>
  <div className="weekly-task-title-row">{editing?<input className="weekly-task-name" autoFocus aria-label="Task name" value={title} disabled={disabled} onChange={e=>{setTitle(e.target.value);setNameError('');}} onBlur={()=>void save()} onKeyDown={e=>{if(e.key==='Enter'){e.preventDefault();void save();}if(e.key==='Escape'){e.stopPropagation();cancelled.current=true;setEditing(false);setNameError('');options.current?.focus();}}}/>:<h3>{item.snapshot.action.title}</h3>}
   {editable&&<div className="weekly-task-menu-anchor"><button ref={options} className="weekly-task-options" aria-label={`Options for ${item.snapshot.action.title}`} aria-expanded={menu} aria-haspopup="menu" disabled={disabled} onClick={()=>setMenu(!menu)}>⋯</button>{menu&&<div className="weekly-task-menu" role="menu" aria-label={`Task options for ${item.snapshot.action.title}`} onKeyDown={e=>{if(e.key==='ArrowDown'||e.key==='ArrowUp'){e.preventDefault();const buttons=Array.from(e.currentTarget.querySelectorAll('button'));const current=buttons.indexOf(document.activeElement as HTMLButtonElement);buttons[(current+(e.key==='ArrowDown'?1:buttons.length-1)+buttons.length)%buttons.length]?.focus();}}}>
    <button role="menuitem" autoFocus onClick={()=>{setMenu(false);setTitle(item.snapshot.action.title);cancelled.current=false;setEditing(true);}}>Edit</button>
    <button role="menuitem" onClick={()=>{setMenu(false);onMove();}}>Move to…</button>
    <button role="menuitem" className="weekly-task-delete" onClick={()=>{setMenu(false);void controls?.change({kind:'drop',commitmentId:item.id});}}>Delete</button>
   </div>}</div>}
  </div>
  {nameError&&<p role="alert" className="small-note">{nameError}</p>}
  {item.snapshot.milestone&&<p className="work-milestone">◇ {item.snapshot.milestone.title}</p>}
  <div className="commitment-progress" aria-hidden="true"><span style={{width:`${Math.min(100,item.scheduledMinutes/item.budgetMinutes*100)}%`}}/></div>
  {editable&&<WeeklyTaskControls id={item.id} title={item.snapshot.action.title} minutes={item.budgetMinutes} locked={disabled}/>}
  <div className="work-budget"><span>{draft?`${duration(item.budgetMinutes)} chosen · Draft`:item.scheduledMinutes?`${duration(item.scheduledMinutes)} of ${duration(item.budgetMinutes)}`:'Not scheduled'}</span>{!draft&&item.scheduledMinutes>=item.budgetMinutes&&<span className="work-scheduled">✓ Scheduled</span>}{editable&&item.scheduledMinutes<item.budgetMinutes&&<button className="schedule-work-button" disabled={disabled} aria-label={`Schedule ${item.snapshot.action.title}`} onClick={e=>onSchedule(e.currentTarget)}>+ Schedule {duration(item.budgetMinutes-item.scheduledMinutes)}</button>}</div>
  {item.scheduledMinutes>item.budgetMinutes&&<p className="work-balance">{duration(item.scheduledMinutes-item.budgetMinutes)} beyond budget</p>}
 </article>;
}
