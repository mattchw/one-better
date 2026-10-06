"use client";
import { goalTitle } from '@/modules/planning/general';
import Link from "next/link";
import { recordedTime } from "./focus-view";
import { useEffect, useRef, useState } from "react";
import { Temporal } from "@js-temporal/polyfill";
import { elapsedMinutes, previewSchema, type PlacementReview, type SchedulingView, type TimeBlock } from "@/modules/scheduling/domain";
import { addDays, currentWeek, type PlanningSnapshot } from "@/modules/planning/domain";
import { Context, duration } from "./planning-presentation";
import { errorInfo, request, type CommandError } from "./mutation-client";
export type Editor = { commitmentId: string; snapshot: PlanningSnapshot; chooseCommitment?: boolean; block?: TimeBlock; cancel?: boolean; prefill?: { date: string; startTime: string; endTime: string }; coaching?:{runId:string;index:number}; initialReview?:PlacementReview };
type Pending = { url: string; method: string; body: object };
const wall = (instant: string, timezone: string) => { const v=Temporal.Instant.from(instant).toZonedDateTimeISO(timezone); return {date:v.toPlainDate().toString(),time:v.toPlainTime().toString({smallestUnit:"minute"})}; };
const stamp = (instant: string, timezone: string) => new Intl.DateTimeFormat("en-GB",{timeZone:timezone,weekday:"short",day:"numeric",month:"short",hour:"2-digit",minute:"2-digit",timeZoneName:"shortOffset"}).format(new Date(instant));
function Balance({budget,scheduled}:{budget:number;scheduled:number}) {return <p className="small-note">{scheduled>budget ? `${duration(scheduled-budget)} scheduled beyond this week’s commitment budget.` : `${duration(budget-scheduled)} still unscheduled.`}</p>;}
export function BlockEditor({editor,view,now,onClose,onSaved}:{editor:Editor;view:SchedulingView;now:number;onClose:()=>void;onSaved:(view:SchedulingView)=>void}) {
  const dialog=useRef<HTMLDialogElement>(null),first=useRef<HTMLInputElement>(null),cancel=useRef<HTMLButtonElement>(null);
  const [block,setBlock]=useState(editor.block),[date,setDate]=useState(editor.block?wall(editor.block.start,view.timezone).date:editor.prefill?.date??""),[start,setStart]=useState(editor.block?wall(editor.block.start,view.timezone).time:editor.prefill?.startTime??""),[end,setEnd]=useState(editor.block?wall(editor.block.end,view.timezone).time:editor.prefill?.endTime??"");
  const [review,setReview]=useState<PlacementReview|null>(editor.initialReview??null),[busyAck,setBusyAck]=useState(false),[busy,setBusy]=useState(false),[pending,setPending]=useState<Pending|null>(null),[error,setError]=useState<CommandError<TimeBlock>|null>(null);
  const [commitmentId,setCommitmentId]=useState(editor.commitmentId);
  const chooseCommitment=editor.chooseCommitment&&!block&&!editor.coaching;
  const snapshot=chooseCommitment?view.commitments.find(c=>c.id===commitmentId)?.snapshot??editor.snapshot:editor.snapshot;
  useEffect(()=>{dialog.current?.showModal();if(editor.cancel)cancel.current?.focus();else first.current?.focus(); const guard=(event:BeforeUnloadEvent)=>event.preventDefault();window.addEventListener("beforeunload",guard);return()=>window.removeEventListener("beforeunload",guard);},[editor.cancel]);
  const url=`/api/weekly-plans/${view.planId}/time-blocks`,locked=busy||!!pending;
  const placement={commitmentId,date,startTime:start,endTime:end,...(block?{blockId:block.id,expectedVersion:block.version}:{})};
  const valid=previewSchema.safeParse(placement).success;
  function changed(update:()=>void) {update();setReview(null);setBusyAck(false);setError(null);}
  async function inspect(latest=false) {
    setBusy(true);setError(null);setReview(null);setBusyAck(false);
    try {
      let saved=block;
      if(latest && block){saved=(await request<{block:TimeBlock}>(`/api/time-blocks/${block.id}`)).block;setBlock(saved);if(saved.state!=="planned" || Date.parse(saved.start)<=Date.now()){setError({code:"CONFLICT",kind:saved.state!=="planned"?"CANCELLED":"STARTED",message:"This block is cancelled or has started. Its schedule history is preserved; close this retained draft to inspect it."});return;}}
      if(editor.cancel)return;
      const next=await request<PlacementReview>(`${url}/preview`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({...placement,...(saved?{blockId:saved.id,expectedVersion:saved.version}:{})})});setReview(next);
    } catch(e){setError(errorInfo<TimeBlock>(e));}finally{setBusy(false);}
  }
  async function confirm(command:Pending) {
    setPending(command);setBusy(true);setError(null);
    try {await request(command.url,{method:command.method,headers:{"Content-Type":"application/json"},body:JSON.stringify(command.body)});onSaved(await request<SchedulingView>(url));}
    catch(e){const info=errorInfo<TimeBlock>(e);setError(info);if(info.code!=="UNCERTAIN"&&info.code!=="DATABASE_UNAVAILABLE"){setPending(null);setReview(null);setBusyAck(false);}}
    finally{setBusy(false);}
  }
  async function save() {
    if(block&&Date.parse(block.start)<=Date.now()){setError({code:"CONFLICT",kind:"STARTED",message:"This block has started. Its schedule history is preserved."});return;}
    if(editor.cancel && block){void confirm({url:`/api/time-blocks/${block.id}/cancel`,method:"POST",body:{mutationId:crypto.randomUUID(),expectedVersion:block.version}});return;}
    if(!review)return;
    if(editor.coaching){setBusy(true);try{await request(`/api/coaching/${editor.coaching.runId}/preview`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({index:editor.coaching.index})});}catch(e){setError(errorInfo<TimeBlock>(e));setReview(null);return;}finally{setBusy(false);}}
    const body={commitmentId,date,startTime:start,endTime:end,mutationId:crypto.randomUUID(),expectedPlanVersion:review.planVersion,reviewKey:review.reviewKey,acknowledgeOutsideHours:review.outsideHours,acknowledgeBusy:busyAck,...(block?{expectedVersion:block.version}:{})};
    void confirm({url:block?`/api/time-blocks/${block.id}`:url,method:block?"PATCH":"POST",body});
  }
  const started=!!block&&Date.parse(block.start)<=now;
  const blocked=started||!!error && ["BLOCK_VERSION","CANCELLED","STARTED","READ_ONLY_WEEK"].includes(error.kind??"");
  return <dialog ref={dialog} className="goal-dialog block-dialog" aria-labelledby="block-editor-title" onCancel={e=>{if(locked)e.preventDefault();else onClose();}}>
    <p className="eyebrow">Local schedule · {view.timezone}</p><h2 id="block-editor-title">{editor.cancel?"Cancel this planned block?":block?"Reschedule time block":"Schedule time block"}</h2>
    {chooseCommitment?<div className="block-work-choice"><label htmlFor="block-work">Work to schedule</label><select id="block-work" value={commitmentId} disabled={locked} onChange={e=>changed(()=>setCommitmentId(e.target.value))}>{view.commitments.map(c=><option key={c.id} value={c.id}>{c.snapshot.action.title} · {goalTitle(c.snapshot.goal)}</option>)}</select><p className="small-note">{goalTitle(snapshot.goal)}</p></div>:<p className="block-task">{snapshot.action.title}</p>}
    {editor.cancel && block?<><p>{stamp(block.start,view.timezone)} → {stamp(block.end,view.timezone)}</p><p>Cancellation preserves the record. Your commitment and Action stay unchanged.</p></>:<>
      <div className="block-fields"><div><label htmlFor="block-date">Day</label><input ref={first} id="block-date" type="date" min={view.weekStartDate} max={addDays(view.weekStartDate,6)} value={date} disabled={locked} onChange={e=>changed(()=>setDate(e.target.value))}/></div><div><label htmlFor="block-start">Start time</label><input id="block-start" type="time" step="60" value={start} disabled={locked} onChange={e=>changed(()=>setStart(e.target.value))}/></div><div><label htmlFor="block-end">End time</label><input id="block-end" type="time" step="60" value={end} disabled={locked} onChange={e=>changed(()=>setEnd(e.target.value))}/></div></div>
      <p className="small-note">Choose future times within one local day of this week. Local blocks cannot overlap.</p>
      {review && <div className="block-review" aria-label="Placement review"><p>{stamp(review.interval.start,view.timezone)} → {stamp(review.interval.end,view.timezone)} · {duration(elapsedMinutes(review.interval))}</p><dl className="block-totals"><div><dt>Weekly commitment</dt><dd>{duration(review.budgetMinutes)}</dd></div><div><dt>Already scheduled</dt><dd>{duration(review.scheduledMinutes)}</dd></div><div><dt>After this block</dt><dd>{duration(review.resultingMinutes)}</dd></div></dl><Balance budget={review.budgetMinutes} scheduled={review.resultingMinutes}/>
        {review.adjustments.map((v,i)=><p key={i} className="calendar-warning">Clock change: {v}</p>)}
        {review.outsideHours?<span className="outside-hours-tag">Outside Focusable Hours</span>:<p>Within Focusable Hours.</p>}
        {review.calendarStatus==="unknown"?<p className="calendar-warning">Calendar conflict status is unknown. Missing or incomplete data does not mean free time.</p>:<><p className={review.calendarStatus==="stale"?"calendar-warning":"small-note"}>{review.calendarStatus==="stale"?"Stale Calendar information":"Fresh Calendar information"}{review.fetchedAt && ` · fetched ${stamp(review.fetchedAt,view.timezone)}`}</p>{review.busyConflict?<div className="calendar-warning"><p>This overlaps Google-reported busy time.</p><label className="block-ack"><input type="checkbox" checked={busyAck} disabled={locked} onChange={e=>setBusyAck(e.target.checked)}/>Schedule over Google busy time anyway</label></div>:<p>No Google busy overlap in this snapshot.</p>}</>}
      </div>}
    </>}
    {started&&!error&&<p className="calendar-warning">This block has started. Its schedule is preserved; close this draft to inspect history.</p>}
    {error && <div role="alert" className="dialog-error"><p>{error.message}</p>{pending?<><p>Keep this draft open until the original command is confirmed.</p><button disabled={busy} className="quiet-button" onClick={()=>void confirm(pending)}>Retry same command</button></>:error.kind==="BLOCK_VERSION"?<><p>Your chosen times are retained. Review the latest saved block before trying again.</p><button disabled={busy} className="quiet-button" onClick={()=>void inspect(true)}>Review latest block and retained times</button></>:null}</div>}
    <div className="dialog-actions"><button ref={cancel} className="quiet-button" disabled={locked} onClick={onClose}>Keep schedule</button>{!editor.cancel && !review && <button className="primary-button" disabled={!valid||locked||blocked} onClick={()=>void inspect()}>Review placement</button>}{(review||editor.cancel) && <button className="primary-button" disabled={locked||blocked||(!editor.cancel&&(!review||review.busyConflict===true&&!busyAck))} onClick={save}>{editor.cancel?"Cancel block":review?.busyConflict?"Schedule anyway":block?"Save new times":"Schedule block"}</button>}</div>
  </dialog>;
}
export function TimeBlocksView({planId,version,onEditing}:{planId:string;version:number;onEditing:(editing:boolean)=>void}) {
  const [view,setView]=useState<SchedulingView|null>(null),[editor,setEditor]=useState<Editor|null>(null),[error,setError]=useState<CommandError|null>(null),[notice,setNotice]=useState("");const trigger=useRef<HTMLElement|null>(null),refresh=useRef<HTMLButtonElement>(null),wasOpen=useRef(false);
  const [now,setNow]=useState(()=>Date.now());
  useEffect(()=>{const timer=setInterval(()=>setNow(Date.now()),30_000);return()=>clearInterval(timer);},[]);
  const url=`/api/weekly-plans/${planId}/time-blocks`;
  useEffect(()=>{let active=true;request<SchedulingView>(url).then(v=>{if(active)setView(v);}).catch(e=>{if(active)setError(errorInfo(e));});return()=>{active=false;};},[url,version]);
  useEffect(()=>{onEditing(!!editor);return()=>onEditing(false);},[editor,onEditing]);
  useEffect(()=>{if(editor){wasOpen.current=true;return;}if(wasOpen.current){wasOpen.current=false;const target=trigger.current; if(target?.isConnected&&target.getClientRects().length)target.focus();else refresh.current?.focus();}},[editor]);
  function begin(value:Editor,event:React.MouseEvent<HTMLButtonElement>,clickedAt:number){if(!view?.canSchedule||view.weekStartDate<currentWeek(new Date(clickedAt).toISOString(),view.userTimezone)||value.block&&Date.parse(value.block.start)<=clickedAt){setNotice("This schedule is now read-only. Started blocks and finished weeks are preserved.");void load();return;}trigger.current=event.currentTarget;setEditor(value);}
  function close(){setEditor(null);}
  async function load(){try{setView(await request<SchedulingView>(url));setError(null);}catch(e){setError(errorInfo(e));}}
  const eligible=!!view?.canSchedule&&view.weekStartDate>=currentWeek(new Date(now).toISOString(),view.userTimezone);
  const blocks=view?.blocks.map(b=>({...b,canCancel:eligible&&b.canCancel&&Date.parse(b.start)>now,canEdit:eligible&&b.canEdit&&Date.parse(b.start)>now})).filter(b=>b.state==="planned")??[],orphaned=blocks.filter(b=>b.reviewRequired&&b.canCancel),cancelled=view?.blocks.filter(b=>b.state==="cancelled")??[];
  function row(block:SchedulingView["blocks"][number]) {return <article key={block.id} data-time-block={block.id} className={`local-block ${block.reviewRequired?"block-orphan":""}`}><div><p className="block-task">{block.snapshot.action.title}</p><p>{stamp(block.start,view!.timezone)} → {wall(block.end,view!.timezone).time} · {duration(elapsedMinutes(block))}</p><p className="small-note">{goalTitle(block.snapshot.goal)}{block.snapshot.milestone&&` · ${block.snapshot.milestone.title}`}</p>{block.reviewRequired&&<p className="calendar-warning">Commitment removed from the current plan. {block.canCancel?"Review this planned block deliberately.":"Preserved schedule history."}</p>}<p className="small-note">Recorded session time: {recordedTime(block.recordedMilliseconds)}</p>{block.executionLocked&&<p className="small-note">Execution has begun · original schedule locked</p>}{!block.canCancel&&block.state==="planned"&&<p className="small-note">Preserved schedule history · read-only</p>}{block.state==="cancelled"&&<p className="small-note">Cancelled · record preserved</p>}</div><div className="block-actions">{block.canFocus&&<Link className="quiet-button" href={`/focus?block=${block.id}`}>Open focus</Link>}{block.canEdit&&<button className="quiet-button" onClick={e=>begin({commitmentId:block.commitmentId,snapshot:block.snapshot,block},e,Date.now())}>Reschedule</button>}{block.canCancel&&<button className="text-button" onClick={e=>begin({commitmentId:block.commitmentId,snapshot:block.snapshot,block,cancel:true},e,Date.now())}>Cancel block</button>}</div></article>;}
  return <div className="local-scheduling">
    {error&&<div role="alert"><p>{error.message}</p><button className="quiet-button" onClick={()=>void load()}>Reload local schedule</button></div>}{notice&&<p role="status" className="plan-notice">{notice}</p>}
    {!view?<p>Loading local schedule…</p>:<><div className="commitment-list">{view.commitments.map(c=><article className="commitment-card" data-commitment-id={c.id} key={c.id}><p className="commitment-budget">{duration(c.budgetMinutes)} this week</p><Context value={c.snapshot}/><p className="scheduled-total">Scheduled: {duration(c.scheduledMinutes)}</p><p className="small-note">Recorded session time: {recordedTime(c.recordedMilliseconds)}</p><Balance budget={c.budgetMinutes} scheduled={c.scheduledMinutes}/>{eligible&&<button className="quiet-button" onClick={e=>begin({commitmentId:c.id,snapshot:c.snapshot},e,Date.now())}>Add time block</button>}</article>)}</div>{!view.commitments.length&&<p className="historical-notice">No focus work committed. Making room for reality is a legitimate plan.</p>}
      <section className="local-week" aria-label="Local weekly schedule"><div className="planning-section-heading"><div><p className="eyebrow">Deliberately protected time</p><h2>Local weekly schedule</h2></div><button ref={refresh} className="quiet-button" onClick={()=>void load()}>Refresh schedule</button></div><p className="small-note">{view.timezone} · Local blocks represent your intended work. Focusable Hours and Google busy timing remain advisory context.</p>{orphaned.length>0&&<p className="calendar-warning" role="status">{orphaned.length} scheduled block{orphaned.length===1?"":"s"} belong{orphaned.length===1?"s":""} to work removed from the current plan. Review or cancel them below.</p>}
      {!blocks.length?<p className="muted">No local time blocks yet. Choose when to make room for a commitment.</p>:Array.from({length:7},(_,i)=>addDays(view.weekStartDate,i)).map(date=>{const values=blocks.filter(b=>wall(b.start,view.timezone).date===date);return values.length>0?<div key={date} className="local-day"><h3>{new Intl.DateTimeFormat("en-GB",{timeZone:"UTC",weekday:"long",day:"numeric",month:"short"}).format(new Date(`${date}T12:00Z`))}</h3>{values.map(row)}</div>:null;})}
      {cancelled.length>0&&<details className="cancelled-blocks"><summary>Cancelled blocks · {cancelled.length}</summary>{cancelled.map(row)}</details>}</section>
      {editor&&<BlockEditor editor={editor} view={view} now={now} onClose={close} onSaved={v=>{setView(v);setNotice(editor.cancel?"Block cancelled. Its record is preserved.":"Time block saved. Commitment budget and plan history are unchanged.");close();}}/>}
    </>}
  </div>;
}
