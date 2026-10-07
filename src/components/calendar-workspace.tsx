"use client";
import {CalendarStateController, type BlockCommand} from '@/client/calendar-state';
import {QueryClientProvider} from '@tanstack/react-query';
import { goalGroupKey, goalTitle } from '@/modules/planning/general';
/* Native links retain the existing editor's unsaved-navigation protection. */
/* eslint-disable @next/next/no-html-link-for-pages */
import {CalendarWorkList} from './calendar-work-list';
import {WeekActivity} from './week-activity';
import type {AmendmentHistory} from '@/modules/amendments/domain';
import {CalendarTaskEditor, AddWeeklyTask} from "./calendar-task-editor";
import {FirstWeekPlanner} from "./first-week-planner";
import {QuickWeekPlanner, type QuickPlanningContext} from "./quick-week-planner";
import type {CycleWorkspace} from "@/modules/focus-cycles/domain";
import {FocusCycleContext} from "./focus-cycle-context";
import {CoachPanel} from "./coach-panel";
import {CalendarMonth} from './calendar-month';
import {calendarHref,calendarHeading,calendarNavigate,dayMilliseconds,type CalendarScale} from './calendar-navigation';
import type {CalendarProjection,CalendarRangeBlock} from '@/modules/scheduling/calendar-reader';
import dynamic from "next/dynamic";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Temporal } from "@js-temporal/polyfill";
import { addDays, currentWeek, type WeekWorkspace, type PlanningSnapshot } from "@/modules/planning/domain";
import type { FocusWorkspace } from "@/modules/availability/service";
import { deriveFocusAvailability } from "@/modules/availability/domain";
import { elapsedMinutes, overlaps, type SchedulingView } from "@/modules/scheduling/domain";
import { freshnessMinutes } from "@/modules/calendar/domain";
import { BlockEditor, type Editor } from "./time-blocks-view";
import { outsideCurrentHours, goalTone } from "./calendar-layout";
import type { PlacementPrefill } from "./calendar-time-grid";
import { duration } from "./planning-presentation";
import { recordedTime } from "./focus-view";
import type { FocusWorkspace as ExecutionWorkspace } from "@/modules/focus/domain";
import { CalendarQuickFocus } from "./calendar-quick-focus";
import { request, errorInfo } from "./mutation-client";
import { EmptyState, Metric, Panel } from "./workspace-ui";

const CalendarTimeGrid = dynamic(() => import("./calendar-time-grid"), {
  ssr: false, loading: () => <div className="calendar-loading" role="status">Preparing your calendar…</div>,
});
const dayLabel = (date: string, format: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", ...format }).format(new Date(`${date}T12:00Z`));
const instantLabel = (value: string, zone: string) => new Intl.DateTimeFormat("en-GB", { timeZone: zone, hour: "2-digit", minute: "2-digit", timeZoneName: "shortOffset" }).format(new Date(value));
export type CalendarInitial = {
  placeFirst?:string; taskAdded?:string; quickPlanning?:QuickPlanningContext|null; accountTimezone?:string; legacyWeek?:boolean; selection?:{scale:CalendarScale;date:string;week:string}; projection?:CalendarProjection|null; cycles?:CycleWorkspace; workspace: WeekWorkspace; schedule: SchedulingView | null; context: FocusWorkspace | null;
  activity?:AmendmentHistory|null;
  effective: { provisionalCapacityMinutes: number; reserveMinutes: number } | null;
  now: number; accountName: string; execution: ExecutionWorkspace | null;
};
export function WeekNavigator({ week, current, locked, today }: { week: string; current: string; locked: boolean; today?:string }) {
  const nav = (target: string, label: string, content: string) => locked
    ? <span className="week-disabled" aria-disabled="true">{content}</span>
    : <a className="calendar-week-control" aria-label={label} href={`/calendar?week=${target}`}>{content}</a>;
  return <nav className="calendar-week-navigation" aria-label="Calendar weeks">
    {nav(addDays(week, -7), "Previous week", "‹")}{locked?<span aria-disabled="true">Today</span>:<a className="calendar-week-control" aria-label="Current week" href={calendarHref('week',today??current)}>Today</a>}{nav(addDays(week, 7), "Next week", "›")}
  </nav>;
}
function WorkChooser({ commitments, prefill, onChoose, onClose }: {
  commitments: SchedulingView["commitments"]; prefill?: PlacementPrefill;
  onChoose: (id: string) => void; onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null), first = useRef<HTMLButtonElement>(null);
  useEffect(() => { dialog.current?.showModal(); first.current?.focus(); }, []);
  return <dialog ref={dialog} className="dialog calendar-work-chooser" aria-labelledby="work-chooser-title" onCancel={onClose}>
    <div className="canvas-section-heading"><h2 id="work-chooser-title">Make room for…</h2><button className="canvas-icon-button" aria-label="Close work selection" onClick={onClose}>×</button></div>
    <p className="canvas-description">{prefill ? `${dayLabel(prefill.date, { weekday: "long", day: "numeric", month: "short" })} · ${prefill.startTime}–${prefill.endTime}. Choose work, then review its placement.` : "Choose a weekly commitment to schedule."}</p>
    <div className="work-chooser-list">{commitments.map((c, index) => <button key={c.id} ref={index === 0 ? first : undefined} onClick={() => onChoose(c.id)} className={`work-choice tone-${goalTone(goalGroupKey(c.snapshot.goal))}`}>
      <span className="goal-dot" aria-hidden="true"/><span><strong>{c.snapshot.action.title}</strong><small>{goalTitle(c.snapshot.goal)} · {duration(Math.max(0, c.budgetMinutes - c.scheduledMinutes))} still unscheduled</small></span><span aria-hidden="true">→</span>
    </button>)}</div>
    <button className="quiet-button" onClick={onClose}>Keep planning</button>
  </dialog>;
}
export function CalendarWorkspace({initial}:{initial:CalendarInitial}){
 const [cache]=useState(()=>new CalendarStateController(initial.schedule));
 return <QueryClientProvider client={cache.queryClient}><CalendarWorkspaceContent initial={initial} cache={cache}/></QueryClientProvider>;
}
function CalendarWorkspaceContent({ initial,cache }: { initial: CalendarInitial;cache:CalendarStateController }) {
 const calendarState=useSyncExternalStore(cache.subscribe,cache.snapshot,cache.snapshot);
 const [viewId,setViewId]=useState(initial.schedule?.planId??null);
 const view=viewId?calendarState.views[viewId]??null:null;
 const setView=(next:SchedulingView|null)=>{if(next)cache.set(next);setViewId(next?.planId??null);};
  const [cycles,setCycles]=useState(initial.cycles);
  const [workspace, setWorkspace] = useState(initial.workspace);
  const week = workspace.weekStartDate, plan = workspace.view?.plan;
  const [context, setContext] = useState(initial.context), [now, setNow] = useState(initial.now);
  const [execution, setExecution] = useState(initial.execution);
  const scale=initial.selection?.scale??'week', selectedDate=initial.selection?.date??initial.workspace.weekStartDate;
  const [serverProjection,setProjection]=useState(initial.projection??null),[detailId,setDetailId]=useState<string|null>(null);
  const [selectedToken, setSelected] = useState<string | null>(null), [editor, setEditor] = useState<Editor | null>(() => {
    const c = initial.schedule?.canSchedule && initial.schedule.commitments.find(c => c.id === initial.placeFirst);
    return c ? { commitmentId: c.id, snapshot: c.snapshot } : null;
  });
  const selected=selectedToken?.startsWith('optimistic:')?(calendarState.aliases[selectedToken]??(Object.values(calendarState.views).some(v=>v.blocks.some(b=>b.id===selectedToken))?selectedToken:null)):selectedToken;
  const [chooser, setChooser] = useState<{ prefill?: PlacementPrefill } | null>(null);
  const [notice, setNotice] = useState(() => {
    const c = initial.schedule?.commitments.find(c => c.id === initial.taskAdded);
    return c ? `Task added to this week · ${duration(c.scheduledMinutes)} scheduled · ${duration(Math.max(0, c.budgetMinutes - c.scheduledMinutes))} still to place.` : "";
  }), [error, setError] = useState(""), [loading, setLoading] = useState(false);
  const [activity, setActivity] = useState(initial.activity);
  const zone = scale==='week'?(view?.timezone??workspace.timezone):(initial.accountTimezone??workspace.timezone), accountZone = initial.accountTimezone??view?.userTimezone??workspace.timezone;
  const dates = Array.from({ length: 7 }, (_, i) => addDays(week, i));
  const today = Temporal.Instant.fromEpochMilliseconds(now).toZonedDateTimeISO(accountZone).toPlainDate().toString();
  const [activeDay, setActiveDay] = useState(() => initial.selection?.date ?? (dates.includes(today) ? today : week));
  const [dayView] = useState(scale==='day'), [narrow, setNarrow] = useState(false), [workOpen, setWorkOpen] = useState(true);
  const [weekends, setWeekends] = useState(() => (initial.schedule?.blocks ?? []).some(b => Temporal.Instant.from(b.start).toZonedDateTimeISO(zone).dayOfWeek > 5) || dates.includes(today) && Temporal.PlainDate.from(today).dayOfWeek > 5);
  const knownPlans=new Set(Object.keys(calendarState.views));
  const projection=serverProjection?{...serverProjection,blocks:[...serverProjection.blocks.filter(b=>!knownPlans.has(b.planId)),...Object.values(calendarState.views).flatMap(v=>v.blocks.filter(b=>b.state==='planned').map(b=>({...b,weekStartDate:v.weekStartDate})))]}:null;
  const selectedHeading = useRef<HTMLHeadingElement>(null), refreshButton = useRef<HTMLButtonElement>(null), newBlockButton = useRef<HTMLButtonElement>(null);
  const [trigger, setTrigger] = useState<HTMLElement | null>(null), wasEditing = useRef(false);
  const [planningOpen, setPlanningOpen] = useState(!!initial.quickPlanning), [planningLocked, setPlanningLocked] = useState(false);
  const [taskLocked,setTaskLocked] = useState(false);
  const locked = !!editor || !!chooser || planningLocked || taskLocked;
  useEffect(() => {
    if (!initial.placeFirst && !initial.taskAdded) return;
    const url = new URL(window.location.href);
    url.searchParams.delete('placeFirst'); url.searchParams.delete('taskAdded');
    window.history.replaceState(null, '', url.toString());
  }, [initial.placeFirst, initial.taskAdded]);
  useEffect(() => {
    const media = window.matchMedia("(max-width:760px)");
    const update = () => { setNarrow(media.matches); setWorkOpen(!media.matches); };
    update(); media.addEventListener("change", update); return () => media.removeEventListener("change", update);
  }, []);
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 30_000); return () => clearInterval(timer); }, []);
  useEffect(() => {
    if(scale==='month')return;
    let mounted = true, running = false;
    const refreshFocus = async () => {
      if (document.visibilityState === "hidden" || running) return;
      running = true;
      try { const latest = await request<ExecutionWorkspace>("/api/focus"); if (mounted) setExecution(latest); }
      catch { if (mounted) setExecution(null); }
      finally { running = false; }
    };
    const timer = setInterval(() => void refreshFocus(), 30_000);
    window.addEventListener("focus", refreshFocus);
    return () => { mounted = false; clearInterval(timer); window.removeEventListener("focus", refreshFocus); };
  }, [scale]);
  useEffect(() => {
    if (selected && window.innerWidth < 1200) {
      selectedHeading.current?.focus({ preventScroll: true });
      selectedHeading.current?.closest(".selected-block-panel")?.scrollIntoView({ block: "start" });
    }
  }, [selected]);
  useEffect(() => {
    if (locked) { wasEditing.current = true; return; }
    if (wasEditing.current) { wasEditing.current = false; if (trigger?.isConnected) trigger.focus(); else newBlockButton.current?.focus(); }
  }, [locked, trigger]);

  useEffect(()=>{if(!calendarState.pending)return;const guard=(e:BeforeUnloadEvent)=>e.preventDefault();window.addEventListener('beforeunload',guard);return()=>window.removeEventListener('beforeunload',guard);},[calendarState.pending]);
  const availability = context?.calendar.availability;
  const focusable = availability ? deriveFocusAvailability(context!.schedule, availability, now) : null;
  const stale = !!availability && (availability.status === "stale" || !!availability.error || !!availability.fetchedAt && now - Date.parse(availability.fetchedAt) >= freshnessMinutes * 60000);
  const knownBusy = availability?.intervals && ["fresh", "stale"].includes(availability.status) ? availability.intervals : [];
  const blocks = view?.blocks.filter(b => b.state === "planned") ?? [], cancelled = view?.blocks.filter(b => b.state === "cancelled"&&!b.pending) ?? [];
  const detailView=detailId?calendarState.views[detailId]??null:null;
  const setDetailView=(next:SchedulingView|null)=>{if(next)cache.set(next);setDetailId(next?.planId??null);};
  const selectedView=detailView??view;
  const chosen = selectedView?.blocks.find(b => b.id === selected && b.state === "planned");
  const unscheduled = view?.commitments.reduce((sum, c) => sum + Math.max(0, c.budgetMinutes - c.scheduledMinutes), 0) ?? 0;
  const currentWeekNow = currentWeek(new Date(now).toISOString(), accountZone), canSchedule = (!!view?.canSchedule || scale==='month'&&plan?.state==='committed') && week >= currentWeekNow;
  const isMonth=scale==='month',isDay = !isMonth && (narrow || dayView);
  const projectedBlocks=projection?.blocks.map(b=>view?.blocks.find(v=>v.id===b.id)??({...b,executionLocked:false,recordedMilliseconds:0,canFocus:false,reviewRequired:false,canCancel:false,canEdit:false}))??blocks;
  const dayBlocks=projectedBlocks.filter(b=>dayMilliseconds(b,activeDay,zone)>0);
  function navigate(nextScale:CalendarScale,date:string){if(!locked&&!calendarState.pending)window.location.assign(calendarHref(nextScale,date));}
  async function selectProjected(block:CalendarRangeBlock){
    if(locked)return;
    if(block.id.startsWith('optimistic:'))return;
    const cached=calendarState.views[block.planId];if(cached){setDetailId(block.planId);setSelected(block.id);return;}
    setError('');
    try{const owned=await request<SchedulingView>(`/api/weekly-plans/${block.planId}/time-blocks`);setDetailView(owned);setSelected(block.id);}catch(e){setError(errorInfo(e).message);}
  }
  const selectTimeline=(id:string)=>{const block=projection?.blocks.find(b=>b.id===id);if(block)void selectProjected(block);else{setDetailView(null);setSelected(id);}};
  // Draft context is live; committed context comes from the effective immutable plan.
  type WorkItem = { id: string; budgetMinutes: number; scheduledMinutes: number; snapshot: PlanningSnapshot };
  const draftWork = plan?.state === "draft" ? plan.commitments.map(c => ({ ...c, scheduledMinutes: 0, snapshot: workspace.view?.sources.find(source => source.actionId === c.actionId)?.context ?? null })) : [];
  const workItems: WorkItem[] = view?.commitments ?? draftWork.filter((c): c is typeof c & { snapshot: PlanningSnapshot } => c.snapshot !== null);
  const workCount = view?.commitments.length ?? draftWork.length;


  async function reload(refreshCalendar = false) {
    if (locked || loading || calendarState.pending) return; setLoading(true); setError("");
    try {
      if (refreshCalendar) {
        const current = await request<FocusWorkspace>(`/api/focus-availability?week=${week}`);
        if (current.calendar.connection?.state === "connected" && current.calendar.connection.selectedCalendarIds.length)
          await request(`/api/calendar/${current.calendar.connection.id}/availability`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ weekStartDate: week }) });
      }
      const latestWorkspace = await request<WeekWorkspace>(`/api/weekly-plans?week=${week}`);
      const committedId = latestWorkspace.view?.plan.state === "committed" ? latestWorkspace.view.plan.id : null;
      const [next, advisory, history, focusContext] = await Promise.all([
        committedId&&(scale!=='month'||!!view) ? request<SchedulingView>(`/api/weekly-plans/${committedId}/time-blocks`) : Promise.resolve(null),
        scale==='month'?Promise.resolve(null):request<FocusWorkspace>(`/api/focus-availability?week=${week}`).catch(() => null),
        committedId&&scale!=='month' ? request<AmendmentHistory>(`/api/weekly-plans/${committedId}/amendments`) : Promise.resolve(null),
        scale==='month'?Promise.resolve(null):request<ExecutionWorkspace>("/api/focus").catch(() => null),
      ]);
      if(scale==='week')setCycles(await request<CycleWorkspace>("/api/focus-cycles")); setWorkspace(latestWorkspace); setView(next); setContext(advisory); setActivity(history); setExecution(focusContext);
      if(scale!=='week')setProjection(await request<CalendarProjection>(`/api/calendar/projection?view=${scale}&date=${selectedDate}`));
      setDetailView(null);
      setNotice(refreshCalendar ? "Calendar context refreshed." : "Workspace refreshed.");
    } catch (e) {
      setError(errorInfo(e).message);
      if (refreshCalendar) setContext(await request<FocusWorkspace>(`/api/focus-availability?week=${week}`).catch(() => null));
    } finally { setLoading(false); }
  }
  async function refreshTasks(mode?:'background') {
    if(mode==='background'){
      const id=view!.planId,generation=cache.canonical(id)!.planVersion;
      const [latestWorkspace,latestHistory]=await Promise.all([request<WeekWorkspace>(`/api/weekly-plans?week=${week}`),request<AmendmentHistory>(`/api/weekly-plans/${id}/amendments`)]);
      if(cache.snapshot().pending||cache.canonical(id)?.planVersion!==generation||(latestWorkspace.view?.plan.version??0)<generation)return;
      setWorkspace(latestWorkspace);setActivity(latestHistory);return;
    }
    const [latestWorkspace,next,latestHistory] = await Promise.all([
      request<WeekWorkspace>(`/api/weekly-plans?week=${week}`),
      request<SchedulingView>(`/api/weekly-plans/${view!.planId}/time-blocks`),
      request<AmendmentHistory>(`/api/weekly-plans/${view!.planId}/amendments`),
    ]);
    setWorkspace(latestWorkspace); setView(next); setActivity(latestHistory); setDetailView(null); setSelected(null);
  }
  function openEditor(value: Editor, source: HTMLElement) {
    if (!(value.block ? selectedView?.canSchedule : canSchedule) || value.block && Date.parse(value.block.start) <= now) { setNotice("This schedule is read-only. Refresh to inspect the latest state."); return; }
    setTrigger(source); setEditor(value);
  }
  function beginPlacement(source: HTMLElement, prefill?: PlacementPrefill) {
    if(scale==='month'&&!view&&canSchedule&&plan){
      setLoading(true);setError('');
      void request<SchedulingView>(`/api/weekly-plans/${plan.id}/time-blocks`).then(next=>{
        setView(next);setTrigger(source);
        if(!next.canSchedule||!next.commitments.length){setNotice('Review this week’s commitments before scheduling.');return;}
        if(next.commitments.length===1){const c=next.commitments[0];setEditor({commitmentId:c.id,snapshot:c.snapshot,prefill});}
        else setChooser({prefill});
      }).catch(e=>setError(errorInfo(e).message)).finally(()=>setLoading(false));return;
    }
    if (!canSchedule || locked || !view?.commitments.length) return;
    const target = source.tabIndex >= 0 ? source : newBlockButton.current ?? source;
    if (view.commitments.length === 1 || prefill) { const c = view.commitments[0]; openEditor({ commitmentId: c.id, snapshot: c.snapshot, prefill, chooseCommitment: view.commitments.length > 1 }, target); }
    else { setTrigger(target); setChooser({ prefill }); }
  }
  function moveBlock(id:string,start:string,end:string){const block=(view?.blocks??[]).find(b=>b.id===id)??(detailView?.blocks??[]).find(b=>b.id===id);if(!block||locked||loading)return false;return !!cache.submit(block.planId,'place',id,{start,end},block.snapshot,block.commitmentId);}
  const focusGoalIds=new Set(cycles?.current?.goals.filter(g=>!g.archivedAt).map(g=>g.goalId)??[]);
  const workContent = <>
    <FocusCycleContext workspace={cycles} compact locked={locked}/>
    <div className="canvas-section-heading"><h2>This week’s work</h2></div>
    <p className="canvas-description">{view ? `${view.commitments.length} ${view.commitments.length===1?"thing":"things"}${view.commitments.some(c=>c.scheduledMinutes<c.budgetMinutes)?` · ${view.commitments.filter(c=>c.scheduledMinutes<c.budgetMinutes).length} still need time`:""}` : plan?.state === "draft" ? "Your saved task choices" : "A few things to move forward."}</p>
    {!view && !draftWork.length ? <div className="work-empty"><p>Choose what matters this week.</p><p className="canvas-description">Start with one task, or pick up unfinished work.</p><a className="quiet-button" href={`/planning?week=${week}`} onClick={e => { if (initial.quickPlanning) { e.preventDefault(); setPlanningOpen(true); } }}>Plan this week →</a></div> : !workCount ? <p className="muted">Your list is clear. Add a task whenever you’re ready.</p> : <CalendarWorkList items={workItems} week={week} editable={canSchedule} locked={!!editor||!!chooser||loading||calendarState.pending} draft={!view} onSchedule={(c,source)=>openEditor({commitmentId:c.id,snapshot:c.snapshot},source)}/>}
    {draftWork.filter(c => !c.snapshot).map(c => <article className="calendar-commitment" key={c.id}><h3>Unavailable Action</h3><p>{duration(c.budgetMinutes)} chosen · source review required</p></article>)}
    {plan?.state === "draft" && <a className="quiet-button" href={`/planning?week=${week}`} onClick={e => { if (initial.quickPlanning) { e.preventDefault(); setPlanningOpen(true); } }}>Finish picking tasks →</a>}
    {canSchedule && !calendarState.pending && <AddWeeklyTask/>}
    {activity&&<WeekActivity plan={activity.baseline} changes={activity.amendments}/>}<a className="canvas-secondary-link" href="/goals">Manage goals →</a>
  </>;

  return <section className={`calendar-workspace calendar-scale-${scale} ${chosen?'has-block-selection':''} ${scale==='week'&&!view&&planningOpen&&initial.quickPlanning?'has-quick-planning':''}`}>
    {calendarState.errors.map(e=><div role="alert" className="canvas-error" key={e.id}><p>{e.message}</p><button className="quiet-button" onClick={()=>cache.dismiss(e.id)}>Dismiss</button></div>)}
    {calendarState.issues.map(issue=><div className="calendar-save-review" role="region" aria-label={issue.status==='uncertain'?'Unconfirmed calendar save':'Review dragged placement'} key={issue.blockId}><p>{issue.message}</p>{issue.review&&<><p>{instantLabel(issue.review.interval.start,calendarState.views[issue.planId].timezone)} – {instantLabel(issue.review.interval.end,calendarState.views[issue.planId].timezone)}</p>{issue.review.busyConflict&&<p>This overlaps Google-reported busy time.</p>}{issue.review.adjustments.map((text,i)=><p key={i}>Clock change: {text}</p>)}{issue.review.outsideHours&&<span className="outside-hours-tag">Outside Focusable Hours</span>}<button className="quiet-button" onClick={()=>cache.discard(issue.blockId)}>Move back</button><button className="primary-button" onClick={()=>cache.accept(issue.blockId)}>{issue.review.busyConflict?'Schedule anyway':'Save reviewed times'}</button></>}{issue.status==='uncertain'&&<button className="quiet-button" onClick={()=>cache.retry(issue.blockId)}>Retry same command</button>}</div>)}
    {calendarState.saving&&<span role="status" className="calendar-saving-status">Saving calendar changes…</span>}
    {notice && <p role="status" className="canvas-notice">{notice}</p>}{error && <p role="alert" className="canvas-error">{error}</p>}
    <div className="calendar-canvas">
      {scale==='week'&&<Panel tabIndex={0} className="work-rail" label="Work for this week"><details open={workOpen} onToggle={e => setWorkOpen(e.currentTarget.open)} className="work-disclosure"><summary>Work for this week <span>{workCount}</span></summary><div>{view&&canSchedule?<CalendarTaskEditor planId={view.planId} version={view.planVersion} onChanged={refreshTasks} onMoveStart={(id,goal)=>cache.beginTaskMove(view.planId,id,goal)} onAddStart={(input,mutationId)=>cache.beginTaskAdd(view.planId,input,mutationId)} onDropStart={id=>cache.beginTaskDrop(view.planId,id)} onLock={setTaskLocked}>{workContent}</CalendarTaskEditor>:workContent}</div></details></Panel>}
      <Panel className="week-calendar" label={scale==='week'?'Week calendar':scale==='month'?'Month calendar':'Day calendar'}>
        <div className="calendar-titlebar"><div><h1>{calendarHeading(selectedDate,scale)}</h1>
          <p className="canvas-description">{isMonth?`Local schedule · ${zone}`:`Week ${Temporal.PlainDate.from(week).weekOfYear}, ${Temporal.PlainDate.from(week).year} · ${zone} · ${view?'Your weekly tasks':plan?'Saved choices':'Start your week'}`}</p></div>
          <div className="calendar-top-actions">{initial.legacyWeek||!initial.selection ? <WeekNavigator week={week} current={currentWeekNow} locked={locked} today={today}/> : <nav className="calendar-week-navigation" aria-label="Calendar dates"><button className="calendar-week-control" disabled={locked} aria-label={`Previous ${scale}`} onClick={()=>navigate(scale,calendarNavigate(selectedDate,scale,-1))}>‹</button><button className="calendar-week-control" disabled={locked} aria-label="Today" onClick={()=>navigate(scale,today)}>Today</button><button className="calendar-week-control" disabled={locked} aria-label={`Next ${scale}`} onClick={()=>navigate(scale,calendarNavigate(selectedDate,scale,1))}>›</button></nav>}{canSchedule && (isMonth || !!view?.commitments.length) ? null : canSchedule ? <button className="primary-button" disabled={locked || loading} onClick={() => document.getElementById("add-weekly-task")?.click()}>Pick a task</button> : initial.quickPlanning ? <button className="quiet-button" disabled={locked} onClick={() => setPlanningOpen(true)}>Plan this week</button> : <a className="quiet-button" href={`/planning?week=${week}`}>Plan this week</a>}</div>
        </div>
        <div className="calendar-view-controls"><div className="view-switch" role="group" aria-label="Calendar view">{(['month','week','day'] as const).map(v=><button key={v} aria-pressed={scale===v} disabled={locked} onClick={()=>navigate(v,activeDay)}>{v[0].toUpperCase()+v.slice(1)}</button>)}</div>
          {canSchedule && (isMonth || !!view?.commitments.length) && <button ref={newBlockButton} className="quiet-button calendar-add-block" disabled={locked || loading} onClick={e => beginPlacement(e.currentTarget,scale==='week'?undefined:{date:selectedDate,startTime:'09:00',endTime:'10:00'})}>+ Time block</button>}
          {!isMonth&&<div className="calendar-legend" aria-label="Calendar legend"><span><i className="legend-focusable"/>Focusable Hours</span><span><i className="legend-busy"/>Google busy{stale ? " · stale" : ""}</span><span><i className="legend-block"/>Time block</span></div>}
          {scale==='week'&&!isDay && <button className="weekend-toggle" aria-pressed={weekends} disabled={locked} onClick={() => setWeekends(!weekends)}>{weekends ? "Hide weekends" : "Show weekends"}</button>}
          <button ref={refreshButton} className="canvas-icon-button" disabled={locked || loading} onClick={() => void reload()} aria-label="Refresh workspace" title="Refresh workspace">↻</button>
        </div>
        {isDay && <div className="mobile-day-picker" role="group" aria-label="Choose calendar day">{dates.map(date => <button key={date} aria-pressed={activeDay === date} disabled={locked} onClick={() => {if(scale==='day')navigate('day',date);else{setActiveDay(date);window.history.replaceState(null,'',calendarHref('week',date));}}}>{dayLabel(date, { weekday: "short" })}<span>{dayLabel(date, { day: "numeric" })}</span></button>)}</div>}
        <div className="calendar-grid-stage">
          {isMonth?<CalendarMonth compact={narrow} date={selectedDate} zone={zone} today={today} blocks={projection?.blocks??[]} selected={selected} locked={locked} onDate={date=>navigate('month',date)} onSelect={block=>void selectProjected(block)} onView={navigate}/>:<CalendarTimeGrid week={week} zone={zone} placementZone={view?.timezone ?? zone} accountZone={accountZone} now={now} day={isDay ? activeDay : null} weekends={weekends} selected={selected} blocks={scale==='day'?projectedBlocks:blocks} busy={knownBusy} focusable={focusable?.focusable ?? []} hours={context?.schedule ?? null} stale={stale} canSchedule={canSchedule && !locked && !loading && !!view?.commitments.length} onSelect={selectTimeline} pendingIds={Object.values(calendarState.views).flatMap(v=>v.blocks.filter(b=>b.pending).map(b=>b.id))} onMove={moveBlock} onPlace={(placement, source) => beginPlacement(source, placement)}/>}
          {scale==='week'&&!view && initial.quickPlanning && planningOpen && <div className="calendar-empty-overlay quick-week-overlay">{(initial.quickPlanning.workspace.view?.plan.commitments.length||initial.quickPlanning.unfinished?.length) ? <QuickWeekPlanner initial={initial.quickPlanning} focusGoals={[...focusGoalIds]} onLock={setPlanningLocked} onClose={() => { setPlanningOpen(false); setPlanningLocked(false); }}/> : <FirstWeekPlanner initial={initial.quickPlanning} onLock={setPlanningLocked} onClose={() => { setPlanningOpen(false); setPlanningLocked(false); }}/>}</div>}
          {scale==='week'&&!view && !initial.quickPlanning && <div className="calendar-empty-overlay"><EmptyState title="No tasks for this week"><p>Plan a current or future week to make room for your priorities.</p><a className="primary-button" href={`/planning?week=${week}`}>Choose a week →</a></EmptyState></div>}
          {scale==='week'&&view && !blocks.length && <div className="calendar-empty-overlay"><EmptyState title={view.commitments.length?"You’ve chosen what matters. Now make room for it.":"Make room for one small task."}><p>{view.commitments.length?"Pick an open stretch in your calendar, or schedule a task on the left.":"Add a task on the left. Your week can grow as you go."}</p>{canSchedule && view.commitments[0] && <button className="primary-button" onClick={e => openEditor({ commitmentId: view.commitments[0].id, snapshot: view.commitments[0].snapshot }, e.currentTarget)}>Schedule first block →</button>}</EmptyState></div>}
        </div>
        <div className="calendar-bottom-note"><span>Local schedule · Google timing is advisory</span><a href={`/review?week=${week}`}>See the week in Review →</a></div>
      </Panel>
      <aside tabIndex={0} className="context-rail" aria-label="Week context">
        {scale==='week'&&!chosen && <CalendarQuickFocus schedule={view} execution={execution} week={week} now={now} onInspect={setSelected}/>}
        {isMonth&&!chosen&&<Panel label="Selected day" className="selected-day-panel"><p className="summary-eyebrow">Selected day</p><h2>{calendarHeading(selectedDate,'day')}</h2><p>{duration((projection?.blocks??[]).reduce((n,b)=>n+dayMilliseconds(b,selectedDate,zone)/60000,0))} scheduled</p><button className="primary-button" disabled={locked} onClick={()=>navigate('day',selectedDate)}>View day →</button><button className="quiet-button" disabled={locked} onClick={()=>navigate('week',selectedDate)}>View week →</button><p className="canvas-description">Time blocks keep their original weekly commitment and budget.</p></Panel>}
        {scale==='day'&&!chosen&&<Panel label="Day context"><p className="summary-eyebrow">This day</p><h2>{duration(dayBlocks.reduce((n,b)=>n+dayMilliseconds(b,activeDay,zone)/60000,0))} scheduled</h2><dl><Metric label={activeDay===today?"Recorded focus today":"Recorded focus this day"} value={recordedTime(projection?.recordedMilliseconds??0)}/><Metric label="Still to place this week" value={duration(unscheduled)}/></dl>{dayBlocks.find(b=>Date.parse(b.start)>now)&&<p>Next: {dayBlocks.find(b=>Date.parse(b.start)>now)!.snapshot.action.title}</p>}<a className="canvas-secondary-link" href={calendarHref('week',activeDay)}>View week →</a></Panel>}

        {chosen && <Panel className={`selected-block-panel tone-${goalTone(goalGroupKey(chosen.snapshot.goal))}`} label="Selected time block">
          <div className="canvas-section-heading"><button className="summary-return" aria-label="Close block details" onClick={() => setSelected(null)}>← Calendar summary</button><span className="block-detail-status">{chosen.reviewRequired ? "Review required" : chosen.executionLocked ? "Execution started" : "Scheduled"}</span></div>
          <p className="selected-goal"><span className="goal-dot" aria-hidden="true"/>{goalTitle(chosen.snapshot.goal)}</p>{chosen.snapshot.milestone && <p className="work-milestone">◇ {chosen.snapshot.milestone.title}</p>}
          <h2 ref={selectedHeading} tabIndex={-1}>{chosen.snapshot.action.title}</h2><p className="selected-time">{dayLabel(Temporal.Instant.from(chosen.start).toZonedDateTimeISO(zone).toPlainDate().toString(), { weekday: "long", day: "numeric", month: "short" })}<br/>{instantLabel(chosen.start, zone)} – {instantLabel(chosen.end, zone)}</p><p className="canvas-description">Originating week {selectedView?.weekStartDate} · Times entered in {selectedView?.timezone}</p>
          {execution?.active ? <a className="primary-button start-focus-button" href={`/focus?block=${execution.active.detail.block.id}`}>Continue current focus →</a> : chosen.canFocus && !chosen.pending && selectedView?.weekStartDate === currentWeekNow && <a className="primary-button start-focus-button" href={`/focus?block=${chosen.id}`}>▶ Start focus</a>}
          <dl className="block-detail-metrics"><Metric label="Block duration" value={duration(elapsedMinutes(chosen))}/><Metric label="Recorded focus" value={recordedTime(chosen.recordedMilliseconds)}/></dl>
          {chosen.snapshot.action.doneWhen && <div className="selected-done"><strong>Done when</strong><p>{chosen.snapshot.action.doneWhen}</p></div>}
          {chosen.reviewRequired && <p className="canvas-warning">Review required · this commitment was removed from the Current Plan. Its block retains original context.</p>}
          {context && outsideCurrentHours(chosen, context.schedule, accountZone) && <span className="outside-hours-tag">Outside current Focusable Hours.</span>}
          {knownBusy.some(v => overlaps(v, chosen)) && <p className="canvas-warning">{stale ? "Previously fetched Google busy overlap." : "Overlaps known Google busy time."}</p>}
          {chosen.executionLocked && <p className="canvas-description">Execution has begun. The original schedule is locked.</p>}
          <div className="selected-block-actions">{chosen.canEdit && Date.parse(chosen.start) > now && <button disabled={locked||!!chosen.pending} className="quiet-button" onClick={e => openEditor({ commitmentId: chosen.commitmentId, snapshot: chosen.snapshot, block: chosen }, e.currentTarget)}>Reschedule</button>}{chosen.canCancel && Date.parse(chosen.start) > now && <button disabled={locked||!!chosen.pending} className="quiet-button" onClick={e => openEditor({ commitmentId: chosen.commitmentId, snapshot: chosen.snapshot, block: chosen, cancel: true }, e.currentTarget)}>Cancel block</button>}</div>
        </Panel>}
        {scale==='week'&&<Panel className="week-summary-panel" label="Week summary"><p className="summary-eyebrow">This week</p><h2 className="week-summary-hero">{view?<>{duration(unscheduled)} <span>still to place</span></>:<>Pick one task</>}</h2><p className="canvas-description">{!view?'That’s enough to start.':unscheduled>0?'Give these tasks a time when it suits you.':'Everything you picked has a time. Leave room for the week to change.'}</p></Panel>}
        {!isMonth&&<Panel className="calendar-context-panel" label="Calendar context"><h2>Calendar & availability</h2>
          {!context ? <p>Calendar context unavailable. Your local schedule is still here.</p> : !context.calendar.connection || context.calendar.connection.state === "disconnected" ? <><p>Connect Calendar to see busy time alongside your plan.</p><a className="quiet-button calendar-settings-link" href="/integrations">Calendar settings →</a></> : <><p className={`context-status ${stale ? "context-stale" : ""}`}><span aria-hidden="true">{stale ? "◷" : availability?.intervals ? "✓" : "◇"}</span> <span>{stale ? "Stale · last fetched timing" : availability?.intervals ? "Google busy timing available" : "Google timing unavailable"}</span></p>{focusable && <dl><Metric label="Calendar-open focus time" value={focusable.openMinutes === null ? "Unknown" : duration(focusable.openMinutes)}/></dl>}{availability?.fetchedAt && <p className="calendar-fetched">Last refreshed {new Intl.DateTimeFormat("en-GB", { timeZone: accountZone, day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }).format(new Date(availability.fetchedAt))}</p>}<button className="quiet-button" disabled={locked || loading} onClick={() => void reload(true)}>Refresh Calendar context</button></>}
          {focusable?.status === "not_configured" && <a className="canvas-secondary-link" href="/availability">Set Focusable Hours →</a>}{zone !== accountZone && <p className="canvas-description">Schedule uses {zone}; current availability uses {accountZone}.</p>}
          <details className="canvas-disclosure"><summary>Availability details <span aria-hidden="true">⌄</span></summary>{focusable && <dl><Metric label="Focusable Hours" value={duration(focusable.focusableMinutes)}/><Metric label="Busy within those hours" value={focusable.blockedMinutes === null ? "Unknown" : duration(focusable.blockedMinutes)}/></dl>}<p>Current recurring settings · {accountZone}. Empty time can stay empty.</p><a className="canvas-secondary-link" href="/availability">Edit Focusable Hours →</a></details>
        </Panel>}
        {scale==='week'&&<CoachPanel key={week} contextType="calendar" week={week} locked={locked||loading||calendarState.pending} revision={JSON.stringify([plan?.version,view?.blocks,cycles?.current,context?.schedule,availability?.status,availability?.intervals,workspace.view?.sources])} onPreview={(preview,source)=>{setView(preview.view);setTrigger(source);setEditor(preview.editor);}}/>}
      </aside>
    </div>
    {cancelled.length > 0 && <details className="calendar-cancelled-history"><summary>Cancelled blocks · {cancelled.length}</summary>{cancelled.map(b => <p key={b.id}>{b.snapshot.action.title} · {instantLabel(b.start, zone)} – {instantLabel(b.end, zone)} · Cancelled, record preserved</p>)}</details>}
    {chooser && view && <WorkChooser commitments={view.commitments} prefill={chooser.prefill} onClose={() => setChooser(null)} onChoose={id => { const c = view.commitments.find(c => c.id === id)!; setEditor({ commitmentId: c.id, snapshot: c.snapshot, prefill: chooser.prefill }); setChooser(null); }}/>}
    {editor && (editor.block?selectedView:view) && <BlockEditor editor={editor} view={(editor.block?selectedView:view)!} now={now} onClose={() => setEditor(null)} onOptimistic={(command,change)=>{const owner=editor.block?selectedView:view;if(!owner)return false;const key=cache.submit(owner.planId,change.kind,change.block?.id,change.interval,change.snapshot,change.commitmentId,command as BlockCommand);if(!key)return false;if(Temporal.Instant.from(change.interval.start).toZonedDateTimeISO(zone).dayOfWeek>5)setWeekends(true);setSelected(change.kind==='cancel'?null:key);setEditor(null);return true;}} onSaved={next => {
      const savedId = editor.cancel ? null : editor.block?.id ?? next.blocks.find(b => !(view?.blocks??[]).some(old => old.id === b.id))?.id ?? null;
      const saved = next.blocks.find(b => b.id === savedId);
      if (saved && Temporal.Instant.from(saved.start).toZonedDateTimeISO(zone).dayOfWeek > 5) setWeekends(true);
      if(next.planId===view?.planId)setView(next);if(editor.block&&detailView)setDetailView(next);else setDetailView(null);
      if(scale!=='week')void request<CalendarProjection>(`/api/calendar/projection?view=${scale}&date=${selectedDate}`).then(setProjection).catch(()=>setNotice('Refresh the calendar to see saved times.'));
      setNotice(editor.cancel ? "Block cancelled. Its record is preserved." : "Time block saved."); setSelected(savedId); setEditor(null);
    }}/>}
  </section>;
}
