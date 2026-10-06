"use client";
/* eslint-disable @next/next/no-html-link-for-pages */
import { useEffect, useRef, useState } from 'react';
import { codePointLength } from '@/modules/goals/domain';
import { errorInfo } from './mutation-client';
import { duration } from './planning-presentation';
import { TaskGoalPicker, type TaskGoalChoice } from './task-goal-picker';
export type FirstWeekTaskCommand = { mutationId: string; title: string; budgetMinutes: number; goal?: { id: string; version: number } };
export function FirstWeekTask({ onAdd, onClose, onLock, canSuggestTimes, sparePercent = 25 }: {
  onAdd: (command: FirstWeekTaskCommand) => Promise<string>;
  onClose: () => void; onLock: (locked: boolean) => void; canSuggestTimes: boolean; sparePercent?: number;
}) {
  const [title, setTitle] = useState(''), [minutes, setMinutes] = useState(60), [busy, setBusy] = useState(false), [goal, setGoal] = useState<TaskGoalChoice>();
  const [uncertain, setUncertain] = useState(false), [error, setError] = useState('');
  const pending = useRef<FirstWeekTaskCommand | null>(null), running = useRef(false), finished = useRef(false);
  const text = title.trim(), valid = codePointLength(text) > 0 && codePointLength(text) <= 160 && text.isWellFormed() && !text.includes('\0');
  const locked = busy || uncertain || !!title;
  useEffect(() => { onLock(locked); return () => onLock(false); }, [locked, onLock]);
  useEffect(() => {
    if (!locked) return;
    const guard = (event: BeforeUnloadEvent) => { if (!finished.current) event.preventDefault(); };
    window.addEventListener('beforeunload', guard); return () => window.removeEventListener('beforeunload', guard);
  }, [locked]);
  async function add() {
    if (running.current || !valid) return;
    running.current = true; setBusy(true); setError(''); setUncertain(false);
    pending.current ??= { mutationId: crypto.randomUUID(), title: text, budgetMinutes: minutes, ...(goal ? { goal: { id: goal.id, version: goal.version } } : {}) };
    try {
      const href = await onAdd(pending.current); finished.current = true;
      // Reload persisted plan and block state after exact receipt retries.
      window.location.assign(href);
    }
    catch (e) {
      const info = errorInfo(e); setError(info.message);
      if (info.code === 'UNCERTAIN' || info.code === 'DATABASE_UNAVAILABLE') setUncertain(true);
      else pending.current = null;
    } finally { running.current = false; setBusy(false); }
  }
  return <section className="first-week-task" aria-labelledby="first-week-title" aria-busy={busy}>
    <div className="canvas-section-heading"><h2 id="first-week-title">What’s one thing to move forward this week?</h2><button className="canvas-icon-button" aria-label={title ? 'Discard task' : 'Close weekly planner'} disabled={busy || uncertain} onClick={onClose}>×</button></div>
    <p className="canvas-description">Start with one task. Add more whenever you need.</p>
    {error && <p className="canvas-error" role="alert">{error}</p>}
    <label className="first-week-input"><span className="sr-only">Task</span><input name="task" aria-label="Task" autoComplete="off" placeholder="e.g. Draft the project proposal" value={title} disabled={busy || uncertain} aria-invalid={codePointLength(text) > 160} onChange={e => { setTitle(e.target.value); setError(''); }} onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); void add(); } }}/></label>
    {codePointLength(text) > 160 && <p className="canvas-error">Use 160 characters or fewer.</p>}
    <TaskGoalPicker selected={goal} onChange={setGoal} disabled={busy || uncertain}/>
    <fieldset className="first-week-duration"><legend>How much time?</legend><div>{[30,60,120,180].map(value => <label key={value}><input type="radio" name="first-task-duration" value={value} checked={minutes === value} disabled={busy || uncertain} onChange={() => setMinutes(value)}/><span>{duration(value)}</span></label>)}</div></fieldset>
    {!canSuggestTimes && <p className="canvas-description first-week-timing-note">Calendar-open time is unavailable. Add the task to your week, then choose its times on the calendar.</p>}
    <p className="first-week-storage-note">Saved under “{goal?.title ?? 'General'}”, keeping ~{sparePercent}% spare.</p>
    <div className="quick-week-actions"><button className="primary-button" disabled={busy || !valid} onClick={() => void add()}>{busy ? 'Adding to your week…' : uncertain ? 'Retry same command' : 'Add to my week'}</button><a className="canvas-secondary-link" aria-disabled={busy || uncertain} href="/goals" onClick={e => { if (busy || uncertain) e.preventDefault(); else finished.current = true; }}>Set up goals instead →</a></div>
  </section>;
}
