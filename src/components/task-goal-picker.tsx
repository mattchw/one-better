"use client";
import { useEffect, useState } from 'react';
import type { Goal } from '@/modules/goals/domain';
import type { TaskGoal } from '@/modules/planning/task-goal';
import { request } from './mutation-client';

export type TaskGoalChoice = TaskGoal & Pick<Goal,'title'|'outcome'>;
export function TaskGoalPicker({ selected, onChange, disabled }: { selected?: TaskGoalChoice; onChange: (goal?: TaskGoalChoice) => void; disabled: boolean }) {
  const [goals, setGoals] = useState<Goal[]>([]), [loading, setLoading] = useState(true), [failed, setFailed] = useState(false), [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let active = true;
    request<{ goals: Goal[] }>('/api/goals?status=active').then(result => { if (active) { setGoals(result.goals); setFailed(false); setLoading(false); } }, () => { if (active) { setFailed(true); setLoading(false); } });
    return () => { active = false; };
  }, [attempt]);
  if (!loading && !failed && !goals.length) return null;
  return <div className="task-goal-picker">
    <label>Linked goal<select aria-label="Linked goal" value={selected?.id ?? ''} disabled={disabled || loading || failed} onChange={event => {
      const found = goals.find(goal => goal.id === event.target.value);
      onChange(found ? { id: found.id, version: found.version, title: found.title, outcome: found.outcome } : undefined);
    }}><option value="">General</option>{goals.map(goal => <option key={goal.id} value={goal.id}>{goal.title}</option>)}</select></label>
    {loading && <p className="small-note" role="status">Loading your goals…</p>}
    {failed && <p className="small-note" role="alert">Couldn’t load your goals. <button type="button" className="text-button" disabled={disabled} onClick={() => { setLoading(true); setAttempt(value => value + 1); }}>Retry goals</button></p>}
  </div>;
}
