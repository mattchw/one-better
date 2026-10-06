"use client";
import { goalGroupKey, goalTitle } from '@/modules/planning/general';
/* eslint-disable @next/next/no-html-link-for-pages */
import { useEffect, useRef, useState } from 'react';
import type { quickPlanningContext } from '@/server/quick-planning';
import { sourceIssues, type WeeklyPlan, type PlanSelection } from '@/modules/planning/domain';
import type { PlacementReview } from '@/modules/scheduling/domain';
import { deriveFocusAvailability } from '@/modules/availability/domain';
import { suggestWeek } from '@/modules/planning/quick-schedule';
import { request, errorInfo } from './mutation-client';
import { duration } from './planning-presentation';
export type QuickPlanningContext = Awaited<ReturnType<typeof quickPlanningContext>>;
type Command = { url: string; body: object };
export function QuickWeekPlanner({ initial, focusGoals, onClose, onLock }: {
  initial: QuickPlanningContext; focusGoals: string[]; onClose: () => void; onLock: (locked: boolean) => void;
}) {
  const draft = initial.workspace.view?.plan, week = initial.workspace.weekStartDate;

  const candidates = [...initial.candidates].sort((a, b) => Number(focusGoals.includes(goalGroupKey(b.context.goal))) - Number(focusGoals.includes(goalGroupKey(a.context.goal))) || goalTitle(a.context.goal).localeCompare(goalTitle(b.context.goal)) || a.context.action.title.localeCompare(b.context.action.title));
  const [choices, setChoices] = useState<PlanSelection[]>(() => draft ? draft.commitments.flatMap(c=>{const live=candidates.find(s=>s.actionId===c.actionId);return live?[{actionId:c.actionId,budgetMinutes:c.budgetMinutes,source:live.source}]:[];}) : initial.unfinished ?? []);
  const [search, setSearch] = useState(''), [dirty, setDirty] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const [committed, setCommitted] = useState<WeeklyPlan | null>(null), [placed, setPlaced] = useState(0), [stopped, setStopped] = useState(false);
  const pending = useRef<Command | null>(null), saved = useRef<WeeklyPlan | null>(null), proposed = useRef<ReturnType<typeof suggestWeek> | null>(null), nextBlock = useRef(0), finished = useRef(false), working = useRef(false);
  const [uncertain, setUncertain] = useState(false);
  const total = choices.reduce((n, c) => n + c.budgetMinutes, 0);
  const fit = choices.length > 0 && choices.length <= 50 && total<=10080 && choices.every(c => Number.isInteger(c.budgetMinutes) && c.budgetMinutes > 0 && c.budgetMinutes <= 10080);
  const locked = busy || uncertain || dirty || !!committed;
  useEffect(() => { onLock(locked); return () => onLock(false); }, [locked, onLock]);
  useEffect(() => {
    if (!locked) return;
    const guard = (event: BeforeUnloadEvent) => { if (!finished.current) event.preventDefault(); };
    window.addEventListener('beforeunload', guard); return () => window.removeEventListener('beforeunload', guard);
  }, [locked]);
  function change(next: PlanSelection[]) { setChoices(next); setDirty(true); setError(''); }
  const send = async <T,>(command: Command): Promise<T> => request<T>(command.url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(command.body) });
  async function confirm() {
    if (working.current || !fit) return;
    working.current = true; setBusy(true); setError(''); setUncertain(false);
    try {
      if (!saved.current) {
        if(!pending.current) {
          const latest = await request<QuickPlanningContext>(`/api/weekly-plans/quick-context?week=${week}`);
          if ((latest.workspace.view?.plan.id ?? null) !== (draft?.id ?? null) || (latest.workspace.view?.plan.version ?? null) !== (draft?.version ?? null)) throw new Error('The week changed elsewhere. Reload it before continuing.');
          if (sourceIssues(choices, latest.candidates).length) throw new Error('A task or Goal changed. Reload your choices before continuing.');
          const availability = latest.context?.calendar.availability ? deriveFocusAvailability(latest.context.schedule, latest.context.calendar.availability, latest.now) : null;
          proposed.current = suggestWeek({week,timezone:latest.workspace.timezone,now:latest.now,availability,occupied:latest.occupied,choices});
          pending.current = { url: '/api/weekly-plans/quick-commit', body: { mutationId: crypto.randomUUID(), weekStartDate: week,
            ...(draft ? { planId: draft.id, expectedVersion: draft.version } : {}), commitments: choices } };
        }
        saved.current = (await send<{ plan: WeeklyPlan }>(pending.current)).plan; pending.current = null;
        setCommitted(saved.current); setDirty(false);
      }
      const plan = saved.current;
      const blocks = proposed.current?.blocks ?? [];
      while (nextBlock.current < blocks.length) {
        const b = blocks[nextBlock.current], commitmentId = plan.commitments.find(c => c.actionId === b.actionId)!.id;
        if (!pending.current) {
          const placement = { commitmentId, date: b.date, startTime: b.startTime, endTime: b.endTime };
          const checked = await send<PlacementReview>({ url: `/api/weekly-plans/${plan.id}/time-blocks/preview`, body: placement });
          if (checked.planVersion !== plan.version || checked.outsideHours || checked.busyConflict !== false || checked.calendarStatus !== 'fresh' || checked.adjustments.length ||
            Date.parse(checked.interval.start) !== Date.parse(b.start) || Date.parse(checked.interval.end) !== Date.parse(b.end) || checked.resultingMinutes > checked.budgetMinutes)
            throw new Error('Availability changed since the preview. Your tasks are saved; place the remaining time from the calendar.');
          pending.current = { url: `/api/weekly-plans/${plan.id}/time-blocks`, body: { ...placement, mutationId: crypto.randomUUID(),
            expectedPlanVersion: checked.planVersion, reviewKey: checked.reviewKey, acknowledgeOutsideHours: false, acknowledgeBusy: false } };
        }
        await send(pending.current); pending.current = null; nextBlock.current++; setPlaced(nextBlock.current);
      }
      // A receipt confirms this command, not necessarily the latest plan state.
      finished.current = true;
      // eslint-disable-next-line @next/next/no-location-assign-relative-destination -- Reload the server composition after receipt replay, including current amendments.
      window.location.assign(`/calendar?week=${week}`);
    } catch (e) {
      const info = errorInfo(e), unknown = info.code === 'UNCERTAIN' || info.code === 'DATABASE_UNAVAILABLE';
      if (e instanceof Error && !('info' in e)) { setError(e.message); pending.current = null; setStopped(true); }
      else { setError(info.message); setUncertain(unknown); if (!unknown) { pending.current = null; setStopped(!!saved.current); } }
    } finally { working.current = false; setBusy(false); }
  }
  return <section className="quick-week-planner living-week-planner" aria-labelledby="quick-week-title" aria-busy={busy}>
    <div className="canvas-section-heading"><h2 id="quick-week-title">What matters this week?</h2>{!busy && !uncertain && !committed && <button className="canvas-icon-button" aria-label={dirty ? 'Discard choices' : 'Close weekly planner'} onClick={onClose}>×</button>}</div>
    <p className="canvas-description">{initial.unfinished?.length ? 'Unfinished from last week, already picked. Untick anything you want to leave behind.' : 'Pick a few tasks. You can change your week at any time.'}</p>
    {error && <p role="alert" className="canvas-error">{error} {!committed && !uncertain && <a href={`/calendar?week=${week}`}>Reload latest week</a>}</p>}
    {candidates.length > 6 && <input type="search" aria-label="Find a task" placeholder="Find a task…" value={search} onChange={e => setSearch(e.target.value)}/>}
    <div className="quick-week-choices">{candidates.filter(c => choices.some(s => s.actionId === c.actionId) || `${c.context.action.title} ${goalTitle(c.context.goal)}`.toLowerCase().includes(search.toLowerCase())).map(c => {
      const chosen = choices.find(s => s.actionId === c.actionId),carried=initial.unfinished?.some(s=>s.actionId===c.actionId);
      return <div key={c.actionId} className={`quick-week-choice ${chosen ? 'is-chosen' : ''}`}>
        <label><input type="checkbox" checked={!!chosen} disabled={busy || uncertain || !!committed || !chosen && choices.length >= 50} onChange={() => change(chosen ? choices.filter(s => s.actionId !== c.actionId) : [...choices, { actionId: c.actionId, source: c.source, budgetMinutes: c.context.action.estimateMinutes ?? 60 }])}/><span><strong>{c.context.action.title}</strong><small>{carried?'From last week · ':''}{goalTitle(c.context.goal)}</small></span></label>
        <span>{duration(chosen?.budgetMinutes??c.context.action.estimateMinutes??60)}</span>
      </div>;
    })}</div>
    {!candidates.length && <div className="quick-week-empty"><p>No available tasks yet.</p><a className="quiet-button" href="/goals" onClick={() => { finished.current = true; }}>Create a Goal or Action →</a></div>}
    {total>10080&&<p className="canvas-error">Pick less than one week of task time.</p>}
    <p className="small-note">Times are added only where your current calendar allows. Anything left stays ready to schedule. Keeps ~{initial.sparePercent}% spare in your weekly allowance.</p>
    {committed && <p role="status">Tasks saved · {placed} blocks placed{busy ? ' · checking the next time…' : ''}.</p>}
    <div className="quick-week-actions">{!stopped && <button className="primary-button" disabled={!fit || busy} onClick={() => void confirm()}>{busy ? 'Planning your week…' : uncertain ? 'Retry same command' : 'Plan my week'}</button>}{stopped&&<a className="primary-button" onClick={()=>{finished.current=true;}} href={`/calendar?week=${week}`}>Back to my week →</a>}</div>
  </section>;
}
