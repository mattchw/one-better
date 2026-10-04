"use client";
/* Native links retain the existing editor's unsaved-navigation protection. */
/* eslint-disable @next/next/no-html-link-for-pages */
import type {CycleWorkspace} from "@/modules/focus-cycles/domain";
import {FocusCycleContext} from "./focus-cycle-context";
import {CoachPanel} from "./coach-panel";
import {CalendarMonth} from './calendar-month';
import {calendarHref,calendarHeading,calendarNavigate,dayMilliseconds,type CalendarScale} from './calendar-navigation';
import type {CalendarProjection,CalendarRangeBlock} from '@/modules/scheduling/calendar-reader';
import dynamic from "next/dynamic";
import { useEffect, useRef, useState } from "react";
import { Temporal } from "@js-temporal/polyfill";
import { addDays, currentWeek, capacitySummary, type WeekWorkspace, type PlanningSnapshot } from "@/modules/planning/domain";
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
  accountTimezone?:string; legacyWeek?:boolean; selection?:{scale:CalendarScale;date:string;week:string}; projection?:CalendarProjection|null; cycles?:CycleWorkspace; workspace: WeekWorkspace; schedule: SchedulingView | null; context: FocusWorkspace | null;
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
    <div className="work-chooser-list">{commitments.map((c, index) => <button key={c.id} ref={index === 0 ? first : undefined} onClick={() => onChoose(c.id)} className={`work-choice tone-${goalTone(c.snapshot.goal.id)}`}>
      <span className="goal-dot" aria-hidden="true"/><span><strong>{c.snapshot.action.title}</strong><small>{c.snapshot.goal.title} · {duration(Math.max(0, c.budgetMinutes - c.scheduledMinutes))} still unscheduled</small></span><span aria-hidden="true">→</span>
    </button>)}</div>
    <button className="quiet-button" onClick={onClose}>Keep planning</button>
  </dialog>;
}
export function CalendarWorkspace({ initial }: { initial: CalendarInitial }) {
  const [cycles,setCycles]=useState(initial.cycles);
  const [workspace, setWorkspace] = useState(initial.workspace);
  const week = workspace.weekStartDate, plan = workspace.view?.plan;
  const [view, setView] = useState(initial.schedule), [context, setContext] = useState(initial.context), [now, setNow] = useState(initial.now);
  const [execution, setExecution] = useState(initial.execution);
  const scale=initial.selection?.scale??'week', selectedDate=initial.selection?.date??initial.workspace.weekStartDate;
  const [projection,setProjection]=useState(initial.projection??null),[detailView,setDetailView]=useState<SchedulingView|null>(null);
  const [selected, setSelected] = useState<string | null>(null), [editor, setEditor] = useState<Editor | null>(null);
  const [chooser, setChooser] = useState<{ prefill?: PlacementPrefill } | null>(null);
  const [notice, setNotice] = useState(""), [error, setError] = useState(""), [loading, setLoading] = useState(false);
  const [effectiveCapacity, setEffectiveCapacity] = useState(initial.effective);
  const zone = scale==='week'?(view?.timezone??workspace.timezone):(initial.accountTimezone??workspace.timezone), accountZone = initial.accountTimezone??view?.userTimezone??workspace.timezone;
  const dates = Array.from({ length: 7 }, (_, i) => addDays(week, i));
  const today = Temporal.Instant.fromEpochMilliseconds(now).toZonedDateTimeISO(accountZone).toPlainDate().toString();
  const [activeDay, setActiveDay] = useState(() => initial.selection?.date ?? (dates.includes(today) ? today : week));
  const [dayView] = useState(scale==='day'), [narrow, setNarrow] = useState(false), [workOpen, setWorkOpen] = useState(true);
  const [weekends, setWeekends] = useState(() => (initial.schedule?.blocks ?? []).some(b => Temporal.Instant.from(b.start).toZonedDateTimeISO(zone).dayOfWeek > 5) || dates.includes(today) && Temporal.PlainDate.from(today).dayOfWeek > 5);
  const selectedHeading = useRef<HTMLHeadingElement>(null), refreshButton = useRef<HTMLButtonElement>(null), newBlockButton = useRef<HTMLButtonElement>(null);
  const [trigger, setTrigger] = useState<HTMLElement | null>(null), wasEditing = useRef(false);
  const locked = !!editor || !!chooser;
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

  const availability = context?.calendar.availability;
  const focusable = availability ? deriveFocusAvailability(context!.schedule, availability, now) : null;
  const stale = !!availability && (availability.status === "stale" || !!availability.error || !!availability.fetchedAt && now - Date.parse(availability.fetchedAt) >= freshnessMinutes * 60000);
  const knownBusy = availability?.intervals && ["fresh", "stale"].includes(availability.status) ? availability.intervals : [];
  const blocks = view?.blocks.filter(b => b.state === "planned") ?? [], cancelled = view?.blocks.filter(b => b.state === "cancelled") ?? [];
  const selectedView=detailView??view;
  const chosen = selectedView?.blocks.find(b => b.id === selected);
  const scheduled = blocks.reduce((sum, b) => sum + elapsedMinutes(b), 0);
  const unscheduled = view?.commitments.reduce((sum, c) => sum + Math.max(0, c.budgetMinutes - c.scheduledMinutes), 0) ?? 0;
  const scheduledWithinBudgets = view?.commitments.reduce((sum, c) => sum + Math.min(c.budgetMinutes, c.scheduledMinutes), 0) ?? 0;
  const summary = view ? capacitySummary({ provisionalCapacityMinutes: plan!.provisionalCapacityMinutes, reserveMinutes: plan!.reserveMinutes, commitments: view.commitments }) : plan ? capacitySummary(plan) : null;
  const capacity = effectiveCapacity?.provisionalCapacityMinutes ?? plan?.provisionalCapacityMinutes, reserve = effectiveCapacity?.reserveMinutes ?? plan?.reserveMinutes;
  const usable = capacity !== undefined && reserve !== undefined ? capacity - reserve : null, budget = summary?.totalMinutes ?? null;
  const breathing = usable !== null && budget !== null ? usable - budget : null;
  const currentWeekNow = currentWeek(new Date(now).toISOString(), accountZone), canSchedule = (!!view?.canSchedule || scale==='month'&&plan?.state==='committed') && week >= currentWeekNow;
  const isMonth=scale==='month',isDay = !isMonth && (narrow || dayView);
  const projectedBlocks=projection?.blocks.map(b=>view?.blocks.find(v=>v.id===b.id)??({...b,executionLocked:false,recordedMilliseconds:0,canFocus:false,reviewRequired:false,canCancel:false,canEdit:false}))??blocks;
  const dayBlocks=projectedBlocks.filter(b=>dayMilliseconds(b,activeDay,zone)>0);
  function navigate(nextScale:CalendarScale,date:string){if(!locked)window.location.assign(calendarHref(nextScale,date));}
  async function selectProjected(block:CalendarRangeBlock){
    if(locked)return;
    setError('');
    try{const owned=await request<SchedulingView>(`/api/weekly-plans/${block.planId}/time-blocks`);setDetailView(owned);setSelected(block.id);}catch(e){setError(errorInfo(e).message);}
  }
  const selectTimeline=(id:string)=>{const block=projection?.blocks.find(b=>b.id===id);if(block)void selectProjected(block);else{setDetailView(null);setSelected(id);}};
  // Draft context is live; committed context comes from the effective immutable plan.
  type WorkItem = { id: string; budgetMinutes: number; scheduledMinutes: number; snapshot: PlanningSnapshot };
  const draftWork = plan?.state === "draft" ? plan.commitments.map(c => ({ ...c, scheduledMinutes: 0, snapshot: workspace.view?.sources.find(source => source.actionId === c.actionId)?.context ?? null })) : [];
  const workItems: WorkItem[] = view?.commitments ?? draftWork.filter((c): c is typeof c & { snapshot: PlanningSnapshot } => c.snapshot !== null);
  const workCount = view?.commitments.length ?? draftWork.length;
  const groups = new Map<string, WorkItem[]>();
  for (const c of workItems) { const group = groups.get(c.snapshot.goal.id) ?? []; group.push(c); groups.set(c.snapshot.goal.id, group); }

  async function reload(refreshCalendar = false) {
    if (locked || loading) return; setLoading(true); setError("");
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
        committedId&&scale!=='month' ? request<{ effective: NonNullable<CalendarInitial["effective"]> }>(`/api/weekly-plans/${committedId}/amendments`) : Promise.resolve(null),
        scale==='month'?Promise.resolve(null):request<ExecutionWorkspace>("/api/focus").catch(() => null),
      ]);
      if(scale==='week')setCycles(await request<CycleWorkspace>("/api/focus-cycles")); setWorkspace(latestWorkspace); setView(next); setContext(advisory); setEffectiveCapacity(history?.effective ?? null); setExecution(focusContext);
      if(scale!=='week')setProjection(await request<CalendarProjection>(`/api/calendar/projection?view=${scale}&date=${selectedDate}`));
      setDetailView(null);
      setNotice(refreshCalendar ? "Calendar context refreshed. Your capacity remains your decision." : "Workspace refreshed.");
    } catch (e) {
      setError(errorInfo(e).message);
      if (refreshCalendar) setContext(await request<FocusWorkspace>(`/api/focus-availability?week=${week}`).catch(() => null));
    } finally { setLoading(false); }
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
  const focusGoalIds=new Set(cycles?.current?.goals.filter(g=>!g.archivedAt).map(g=>g.goalId)??[]);
  const renderGroups=(entries:[string,WorkItem[]][])=>entries.map(([id, items]) => <section className={`work-goal-group tone-${goalTone(id)}`} key={id}>
      <a className="work-goal" href={`/goals/${id}?week=${week}`}><span className="goal-dot" aria-hidden="true"/>{items[0].snapshot.goal.title}<span aria-hidden="true">↗</span></a>
      {items.map(c => <article className="calendar-commitment" key={c.id} data-calendar-commitment={c.id}>
        <h3>{c.snapshot.action.title}</h3>{c.snapshot.milestone && <p className="work-milestone">◇ {c.snapshot.milestone.title}</p>}
        <div className="commitment-progress" aria-hidden="true"><span style={{ width: `${Math.min(100, c.scheduledMinutes / c.budgetMinutes * 100)}%` }}/></div>
        <div className="work-budget"><span>{view ? `${duration(c.scheduledMinutes)} of ${duration(c.budgetMinutes)}` : `${duration(c.budgetMinutes)} chosen · Draft`}</span></div>
        <div className="work-card-footer"><p className="work-balance">{c.scheduledMinutes > 0 && c.scheduledMinutes < c.budgetMinutes ? `${duration(c.budgetMinutes - c.scheduledMinutes)} still unscheduled` : c.scheduledMinutes > c.budgetMinutes ? `${duration(c.scheduledMinutes - c.budgetMinutes)} beyond budget` : c.scheduledMinutes === 0 ? "" : "✓ Scheduled"}</p>
          {canSchedule && <button className="schedule-work-button" disabled={locked || loading} aria-label={`${c.scheduledMinutes < c.budgetMinutes ? "Schedule" : "Add time for"} ${c.snapshot.action.title}`} onClick={e => openEditor({ commitmentId: c.id, snapshot: c.snapshot }, e.currentTarget)}>{c.scheduledMinutes < c.budgetMinutes ? `+ Schedule ${duration(c.budgetMinutes - c.scheduledMinutes)}` : "Add time"}</button>}
        </div>
      </article>)}
    </section>);
  const workContent = <>
    <FocusCycleContext workspace={cycles} compact locked={locked}/>
    <div className="canvas-section-heading"><h2>This week’s work</h2></div>
    <p className="canvas-description">{view ? `${view.commitments.length} commitments · ${duration(unscheduled)} still to place` : plan?.state === "draft" ? "Draft choices · review and commit to schedule" : "A few meaningful commitments."}</p>
    {!view && !draftWork.length ? <div className="work-empty"><p>Choose what matters this week.</p><p className="canvas-description">Commit to a few Actions, then give them time here.</p><a className="quiet-button" href={`/planning?week=${week}`}>Plan this week →</a></div> : !workCount ? <p className="muted">No focus work committed. Leave room for reality.</p> : <>{renderGroups([...groups].filter(([id])=>!cycles?.current||focusGoalIds.has(id)))}{cycles?.current&&[...groups].some(([id])=>!focusGoalIds.has(id))&&<details className="cycle-other-work"><summary>Other committed work · {[...groups].filter(([id])=>!focusGoalIds.has(id)).reduce((n,[,items])=>n+items.length,0)}</summary>{renderGroups([...groups].filter(([id])=>!focusGoalIds.has(id)))}</details>}</>}
    {draftWork.filter(c => !c.snapshot).map(c => <article className="calendar-commitment" key={c.id}><h3>Unavailable Action</h3><p>{duration(c.budgetMinutes)} chosen · source review required</p></article>)}
    {plan?.state === "draft" && <a className="quiet-button" href={`/planning?week=${week}`}>Review and commit →</a>}
    <a className="canvas-secondary-link" href={`/planning?week=${week}`}>Manage weekly commitments →</a><a className="canvas-secondary-link" href="/goals">Manage goals & actions →</a>
  </>;

  return <section className={`calendar-workspace calendar-scale-${scale} ${chosen?'has-block-selection':''}`}>
    {notice && <p role="status" className="canvas-notice">{notice}</p>}{error && <p role="alert" className="canvas-error">{error}</p>}
    <div className="calendar-canvas">
      {scale==='week'&&<Panel tabIndex={0} className="work-rail" label="Work for this week"><details open={workOpen} onToggle={e => setWorkOpen(e.currentTarget.open)} className="work-disclosure"><summary>Work for this week <span>{workCount}</span></summary><div>{workContent}</div></details></Panel>}
      <Panel className="week-calendar" label={scale==='week'?'Week calendar':scale==='month'?'Month calendar':'Day calendar'}>
        <div className="calendar-titlebar"><div><h1>{calendarHeading(selectedDate,scale)}</h1>
          <p className="canvas-description">{isMonth?`Local schedule · ${zone}`:`Week ${Temporal.PlainDate.from(week).weekOfYear}, ${Temporal.PlainDate.from(week).year} · ${zone} · ${view?'Committed plan':plan?'Draft plan':'No committed plan'}`}</p></div>
          <div className="calendar-top-actions">{initial.legacyWeek||!initial.selection ? <WeekNavigator week={week} current={currentWeekNow} locked={locked} today={today}/> : <nav className="calendar-week-navigation" aria-label="Calendar dates"><button className="calendar-week-control" disabled={locked} aria-label={`Previous ${scale}`} onClick={()=>navigate(scale,calendarNavigate(selectedDate,scale,-1))}>‹</button><button className="calendar-week-control" disabled={locked} aria-label="Today" onClick={()=>navigate(scale,today)}>Today</button><button className="calendar-week-control" disabled={locked} aria-label={`Next ${scale}`} onClick={()=>navigate(scale,calendarNavigate(selectedDate,scale,1))}>›</button></nav>}{canSchedule && (isMonth || !!view?.commitments.length) ? <button ref={newBlockButton} className="primary-button" disabled={locked || loading} onClick={e => beginPlacement(e.currentTarget,scale==='week'?undefined:{date:selectedDate,startTime:'09:00',endTime:'10:00'})}>+ Time block</button> : <a className="quiet-button" href={`/planning?week=${week}`}>Plan this week</a>}</div>
        </div>
        <div className="calendar-view-controls"><div className="view-switch" role="group" aria-label="Calendar view">{(['month','week','day'] as const).map(v=><button key={v} aria-pressed={scale===v} disabled={locked} onClick={()=>navigate(v,activeDay)}>{v[0].toUpperCase()+v.slice(1)}</button>)}</div>
          {!isMonth&&<div className="calendar-legend" aria-label="Calendar legend"><span><i className="legend-focusable"/>Focusable Hours</span><span><i className="legend-busy"/>Google busy{stale ? " · stale" : ""}</span><span><i className="legend-block"/>Time block</span></div>}
          {scale==='week'&&!isDay && <button className="weekend-toggle" aria-pressed={weekends} disabled={locked} onClick={() => setWeekends(!weekends)}>{weekends ? "Hide weekends" : "Show weekends"}</button>}
          <button ref={refreshButton} className="canvas-icon-button" disabled={locked || loading} onClick={() => void reload()} aria-label="Refresh workspace" title="Refresh workspace">↻</button>
        </div>
        {isDay && <div className="mobile-day-picker" role="group" aria-label="Choose calendar day">{dates.map(date => <button key={date} aria-pressed={activeDay === date} disabled={locked} onClick={() => {if(scale==='day')navigate('day',date);else{setActiveDay(date);window.history.replaceState(null,'',calendarHref('week',date));}}}>{dayLabel(date, { weekday: "short" })}<span>{dayLabel(date, { day: "numeric" })}</span></button>)}</div>}
        <div className="calendar-grid-stage">
          {isMonth?<CalendarMonth compact={narrow} date={selectedDate} zone={zone} today={today} blocks={projection?.blocks??[]} selected={selected} locked={locked} onDate={date=>navigate('month',date)} onSelect={block=>void selectProjected(block)} onView={navigate}/>:<CalendarTimeGrid week={week} zone={zone} placementZone={view?.timezone ?? zone} accountZone={accountZone} now={now} day={isDay ? activeDay : null} weekends={weekends} selected={selected} blocks={scale==='day'?projectedBlocks:blocks} busy={knownBusy} focusable={focusable?.focusable ?? []} hours={context?.schedule ?? null} stale={stale} canSchedule={canSchedule && !locked && !loading && !!view?.commitments.length} onSelect={selectTimeline} onPlace={(placement, source) => beginPlacement(source, placement)}/>}
          {scale==='week'&&!view && <div className="calendar-empty-overlay"><EmptyState title={plan?.state === "draft" ? "Review your choices before scheduling." : "Plan this week before scheduling focus time."}><p>{plan?.state === "draft" ? "Your Draft choices are in the left rail. Review the week and commit its baseline to start placing time." : "Choose the few commitments that matter, then give them time here."}</p><a className="primary-button" href={`/planning?week=${week}`}>{plan?.state === "draft" ? "Review and commit →" : "Plan this week →"}</a></EmptyState></div>}
          {scale==='week'&&view && !blocks.length && <div className="calendar-empty-overlay"><EmptyState title="You’ve chosen what matters. Now make room for it."><p>Pick an open stretch in your calendar, or schedule from a commitment on the left.</p>{canSchedule && view.commitments[0] && <button className="primary-button" onClick={e => openEditor({ commitmentId: view.commitments[0].id, snapshot: view.commitments[0].snapshot }, e.currentTarget)}>Schedule first block →</button>}</EmptyState></div>}
        </div>
        <div className="calendar-bottom-note"><span>Local schedule · Google timing is advisory</span><a href={`/planning?week=${week}`}>Open weekly plan →</a></div>
      </Panel>
      <aside tabIndex={0} className="context-rail" aria-label="Week context">
        {scale==='week'&&!chosen && <CalendarQuickFocus execution={execution} week={week} now={now} onInspect={setSelected}/>}
        {isMonth&&!chosen&&<Panel label="Selected day" className="selected-day-panel"><p className="summary-eyebrow">Selected day</p><h2>{calendarHeading(selectedDate,'day')}</h2><p>{duration((projection?.blocks??[]).reduce((n,b)=>n+dayMilliseconds(b,selectedDate,zone)/60000,0))} scheduled</p><button className="primary-button" disabled={locked} onClick={()=>navigate('day',selectedDate)}>View day →</button><button className="quiet-button" disabled={locked} onClick={()=>navigate('week',selectedDate)}>View week →</button><p className="canvas-description">Time blocks keep their original weekly commitment and budget.</p></Panel>}
        {scale==='day'&&!chosen&&<Panel label="Day context"><p className="summary-eyebrow">This day</p><h2>{duration(dayBlocks.reduce((n,b)=>n+dayMilliseconds(b,activeDay,zone)/60000,0))} scheduled</h2><dl><Metric label={activeDay===today?"Recorded focus today":"Recorded focus this day"} value={recordedTime(projection?.recordedMilliseconds??0)}/><Metric label="Weekly unscheduled budget" value={duration(unscheduled)}/><Metric label="Weekly breathing room" value={breathing===null?'—':duration(breathing)}/></dl>{dayBlocks.find(b=>Date.parse(b.start)>now)&&<p>Next: {dayBlocks.find(b=>Date.parse(b.start)>now)!.snapshot.action.title}</p>}<a className="canvas-secondary-link" href={calendarHref('week',activeDay)}>View week →</a></Panel>}

        {chosen && <Panel className={`selected-block-panel tone-${goalTone(chosen.snapshot.goal.id)}`} label="Selected time block">
          <div className="canvas-section-heading"><button className="summary-return" aria-label="Close block details" onClick={() => setSelected(null)}>← Calendar summary</button><span className="block-detail-status">{chosen.reviewRequired ? "Review required" : chosen.executionLocked ? "Execution started" : "Scheduled"}</span></div>
          <p className="selected-goal"><span className="goal-dot" aria-hidden="true"/>{chosen.snapshot.goal.title}</p>{chosen.snapshot.milestone && <p className="work-milestone">◇ {chosen.snapshot.milestone.title}</p>}
          <h2 ref={selectedHeading} tabIndex={-1}>{chosen.snapshot.action.title}</h2><p className="selected-time">{dayLabel(Temporal.Instant.from(chosen.start).toZonedDateTimeISO(zone).toPlainDate().toString(), { weekday: "long", day: "numeric", month: "short" })}<br/>{instantLabel(chosen.start, zone)} – {instantLabel(chosen.end, zone)}</p><p className="canvas-description">Originating week {selectedView?.weekStartDate} · Times entered in {selectedView?.timezone}</p>
          {execution?.active ? <a className="primary-button start-focus-button" href={`/focus?block=${execution.active.detail.block.id}`}>Continue current focus →</a> : chosen.canFocus && selectedView?.weekStartDate === currentWeekNow && <a className="primary-button start-focus-button" href={`/focus?block=${chosen.id}`}>▶ Start focus</a>}
          <dl className="block-detail-metrics"><Metric label="Block duration" value={duration(elapsedMinutes(chosen))}/><Metric label="Commitment budget" value={selectedView?.commitments.find(c => c.id === chosen.commitmentId) ? duration(selectedView!.commitments.find(c => c.id === chosen.commitmentId)!.budgetMinutes) : "Removed from plan"}/><Metric label="Scheduled for this work" value={duration((selectedView?.blocks??[]).filter(b => b.state==='planned'&&b.commitmentId === chosen.commitmentId).reduce((n, b) => n + elapsedMinutes(b), 0))}/><Metric label="Recorded session time" value={recordedTime(chosen.recordedMilliseconds)}/></dl>
          {chosen.snapshot.action.doneWhen && <div className="selected-done"><strong>Done when</strong><p>{chosen.snapshot.action.doneWhen}</p></div>}
          {chosen.reviewRequired && <p className="canvas-warning">Review required · this commitment was removed from the Current Plan. Its block retains original context.</p>}
          {context && outsideCurrentHours(chosen, context.schedule, accountZone) && <p className="canvas-warning">Outside current Focusable Hours.</p>}
          {knownBusy.some(v => overlaps(v, chosen)) && <p className="canvas-warning">{stale ? "Previously fetched Google busy overlap." : "Overlaps known Google busy time."}</p>}
          {chosen.executionLocked && <p className="canvas-description">Execution has begun. The original schedule is locked.</p>}
          <div className="selected-block-actions">{chosen.canEdit && Date.parse(chosen.start) > now && <button disabled={locked} className="quiet-button" onClick={e => openEditor({ commitmentId: chosen.commitmentId, snapshot: chosen.snapshot, block: chosen }, e.currentTarget)}>Reschedule</button>}{chosen.canCancel && Date.parse(chosen.start) > now && <button disabled={locked} className="quiet-button" onClick={e => openEditor({ commitmentId: chosen.commitmentId, snapshot: chosen.snapshot, block: chosen, cancel: true }, e.currentTarget)}>Cancel block</button>}</div>
        </Panel>}
        {scale==='week'&&<Panel className="week-summary-panel" label="Week facts"><p className="summary-eyebrow">This week</p><h2 className="week-summary-hero">{duration(scheduled)} <span>scheduled</span></h2>
          {view && usable !== null && usable > 0 && <><div className="capacity-allocation" role="img" aria-label={`${duration(scheduledWithinBudgets)} scheduled within commitment budgets, ${duration(unscheduled)} still unscheduled, ${duration(Math.max(0, breathing ?? 0))} breathing room`}><span className="allocation-scheduled" style={{ flex: scheduledWithinBudgets }}/><span className="allocation-unscheduled" style={{ flex: unscheduled }}/><span className="allocation-breathing" style={{ flex: Math.max(0, breathing ?? 0) }}/></div><div className="allocation-legend"><span><i/>Scheduled within budgets</span><span><i/>Still unscheduled</span><span><i/>Breathing room</span></div></>}
          <dl className="week-facts"><Metric label={view ? "Committed budget" : "Draft budget"} value={budget === null ? "—" : duration(budget)}/><Metric label="Scheduled focus" value={duration(scheduled)}/><Metric label="Still unscheduled" value={view ? duration(unscheduled) : "—"}/><Metric label="Breathing room" value={breathing === null ? "—" : duration(breathing)}/><div className="metric-divider"/><Metric label="Weekly capacity" value={capacity === undefined ? "—" : duration(capacity)}/><Metric label="Protected reserve" value={reserve === undefined ? "—" : duration(reserve)}/><Metric label="Usable capacity" value={usable === null ? "—" : duration(usable)}/></dl>
          <p className="canvas-description">Budget, schedule and actual focus are different facts.</p><a className="canvas-secondary-link" href={`/planning?week=${week}`}>Weekly planning →</a>
        </Panel>}
        {!isMonth&&<Panel className="calendar-context-panel" label="Calendar context"><h2>Calendar & availability</h2>
          {!context ? <p>Calendar context unavailable. Your local schedule is still here.</p> : !context.calendar.connection || context.calendar.connection.state === "disconnected" ? <><p>Connect Calendar to see busy time alongside your plan.</p><a className="quiet-button calendar-settings-link" href="/integrations">Calendar settings →</a></> : <><p className={`context-status ${stale ? "context-stale" : ""}`}><span aria-hidden="true">{stale ? "◷" : availability?.intervals ? "✓" : "◇"}</span> <span>{stale ? "Stale · last fetched timing" : availability?.intervals ? "Google busy timing available" : "Google timing unavailable"}</span></p>{focusable && <dl><Metric label="Calendar-open focus time" value={focusable.openMinutes === null ? "Unknown" : duration(focusable.openMinutes)}/></dl>}{availability?.fetchedAt && <p className="calendar-fetched">Last refreshed {new Intl.DateTimeFormat("en-GB", { timeZone: accountZone, day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }).format(new Date(availability.fetchedAt))}</p>}<button className="quiet-button" disabled={locked || loading} onClick={() => void reload(true)}>Refresh Calendar context</button></>}
          {focusable?.status === "not_configured" && <a className="canvas-secondary-link" href="/availability">Set Focusable Hours →</a>}{zone !== accountZone && <p className="canvas-description">Schedule uses {zone}; current availability uses {accountZone}.</p>}
          <details className="canvas-disclosure"><summary>Availability details <span aria-hidden="true">⌄</span></summary>{focusable && <dl><Metric label="Focusable Hours" value={duration(focusable.focusableMinutes)}/><Metric label="Busy within those hours" value={focusable.blockedMinutes === null ? "Unknown" : duration(focusable.blockedMinutes)}/></dl>}<p>Current recurring settings · {accountZone}. Open time is advisory, and does not change your capacity.</p><a className="canvas-secondary-link" href={`/planning?week=${week}#focusable-availability`}>Full availability report →</a></details>
        </Panel>}
        {scale==='week'&&<CoachPanel key={week} contextType="calendar" week={week} locked={locked||loading} revision={JSON.stringify([plan?.version,view?.blocks,cycles?.current,context?.schedule,availability?.status,availability?.intervals,workspace.view?.sources])} onPreview={(preview,source)=>{setView(preview.view);setTrigger(source);setEditor(preview.editor);}}/>}
      </aside>
    </div>
    {cancelled.length > 0 && <details className="calendar-cancelled-history"><summary>Cancelled blocks · {cancelled.length}</summary>{cancelled.map(b => <p key={b.id}>{b.snapshot.action.title} · {instantLabel(b.start, zone)} – {instantLabel(b.end, zone)} · Cancelled, record preserved</p>)}</details>}
    {chooser && view && <WorkChooser commitments={view.commitments} prefill={chooser.prefill} onClose={() => setChooser(null)} onChoose={id => { const c = view.commitments.find(c => c.id === id)!; setEditor({ commitmentId: c.id, snapshot: c.snapshot, prefill: chooser.prefill }); setChooser(null); }}/>}
    {editor && (editor.block?selectedView:view) && <BlockEditor editor={editor} view={(editor.block?selectedView:view)!} now={now} onClose={() => setEditor(null)} onSaved={next => {
      const savedId = editor.cancel ? null : editor.block?.id ?? next.blocks.find(b => !(view?.blocks??[]).some(old => old.id === b.id))?.id ?? null;
      const saved = next.blocks.find(b => b.id === savedId);
      if (saved && Temporal.Instant.from(saved.start).toZonedDateTimeISO(zone).dayOfWeek > 5) setWeekends(true);
      if(next.planId===view?.planId)setView(next);if(editor.block&&detailView)setDetailView(next);else setDetailView(null);
      if(scale!=='week')void request<CalendarProjection>(`/api/calendar/projection?view=${scale}&date=${selectedDate}`).then(setProjection).catch(()=>setNotice('Refresh the calendar to see saved times.'));
      setNotice(editor.cancel ? "Block cancelled. Its record is preserved." : "Time block saved. Your commitment budget is unchanged."); setSelected(savedId); setEditor(null);
    }}/>}
  </section>;
}
