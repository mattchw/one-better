"use client";
/* Full-document goal navigation preserves native pending-command unload guards. */
/* eslint-disable @next/next/no-html-link-for-pages */
import { useRef, useState } from "react";
import Link from "next/link";
import type { Goal } from "@/modules/goals/domain";
import type { Milestone, MilestoneState } from "@/modules/milestones/domain";
import type { ActionState, ActionView } from "@/modules/actions/domain";
import type { ActionCatalog } from "@/modules/actions/service";
import { MilestonesView } from "./milestones-view";
import { ActionsView } from "./actions-view";
import { GoalDialog, type DialogState } from "./goals-view";
import { AddToWeekDialog } from "./add-to-week-dialog";
import { readGoalWeek, weekWork, type GoalWeek } from "./goal-week";
import { duration } from "./planning-presentation";
import { request } from "./mutation-client";
export function GoalWorkView({ goal: initialGoal, milestones, milestoneState, catalog, actionState, timezone, initialWeek, navigation = [] }: { navigation?: Goal[]; goal: Goal; milestones: Milestone[]; milestoneState: MilestoneState; catalog: ActionCatalog; actionState: ActionState; timezone: string; initialWeek: GoalWeek }) {
  const [checkpointItems, setCheckpointItems] = useState(milestones);
  const [goal, setGoal] = useState(initialGoal), [revision, setRevision] = useState(0), [week, setWeek] = useState(initialWeek);
  const [dialog, setDialog] = useState<DialogState | null>(null), [adding, setAdding] = useState<ActionView | null>(null), [notice, setNotice] = useState("");
  const weekSequence = useRef(0);
  const trigger = useRef<HTMLElement | null>(null), heading = useRef<HTMLHeadingElement>(null);
  const work = weekWork(week).filter(c => c.context?.goal.id === goal.id), plan = week.workspace.view?.plan;
  function restore() { setTimeout(() => (trigger.current?.isConnected ? trigger.current : heading.current)?.focus(), 0); }
  async function refreshWeek() { const id = ++weekSequence.current; try { const latest = await readGoalWeek(week.workspace.weekStartDate); if (id === weekSequence.current) setWeek(latest); } catch { if (id === weekSequence.current) setNotice("Weekly choices may be out of date. Refresh this page to review the latest context."); } }
  async function savedGoal() {
    const [latest, checkpoints] = await Promise.all([request<{ goal: Goal }>(`/api/goals/${goal.id}`), request<{ milestones: Milestone[] }>(`/api/goals/${goal.id}/milestones`)]);
    setCheckpointItems(checkpoints.milestones);
    setGoal(latest.goal); setRevision(v => v + 1); setDialog(null); restore();
    try { setWeek(await readGoalWeek(week.workspace.weekStartDate)); } catch { setNotice("Goal saved. Refresh this page to review the latest weekly context."); }
  }
  async function checkpointsChanged() {
    setRevision(v => v + 1); void refreshWeek();
    try { setCheckpointItems((await request<{ milestones: Milestone[] }>(`/api/goals/${goal.id}/milestones`)).milestones); }
    catch { setNotice("Checkpoint saved. Refresh this page to review the latest progress context."); }
  }
  return <>
    <div className="goal-detail-layout"><aside className="goal-selector" aria-label="Your goals"><h2>Goals</h2><p className="section-intro">Small steps, compounding.</p><nav className="goal-selector-links" aria-label="Choose goal">{navigation.map(g => <a key={g.id} href={`/goals/${g.id}${week.workspace.weekStartDate !== week.workspace.currentWeekStartDate ? `?week=${week.workspace.weekStartDate}` : ""}`} aria-current={g.id === goal.id ? "page" : undefined}><span className="goal-dot" aria-hidden="true"/>{g.id === goal.id ? goal.title : g.title}</a>)}</nav><a className="quiet-button" href="/goals">All goals / create goal →</a></aside><div className="goal-detail-surface">
    <Link className="back-link" href={goal.archivedAt ? "/goals?view=archived" : "/goals"}>← All goals</Link>
    <div className="goal-direction"><div><p className="eyebrow">{goal.archivedAt ? "Archived goal" : "Active focus · why this matters"}</p><h1 ref={heading} tabIndex={-1} className="goal-detail-title">{goal.title}</h1><p className="outcome-label">Outcome</p><p className="goal-outcome goal-detail-outcome">{goal.outcome}</p></div>{!goal.archivedAt && <div className="goal-direction-actions"><button className="quiet-button" aria-label={`Edit ${goal.title}`} onClick={e => { trigger.current = e.currentTarget; setDialog({ kind: "edit", goal }); }}>Edit goal</button><button className="text-button" aria-label={`Archive ${goal.title}`} onClick={e => { trigger.current = e.currentTarget; setDialog({ kind: "archive", goal }); }}>Archive</button></div>}</div>
    <p className="goal-journey">Outcome <span>→</span> Progress checkpoints <span>→</span> Possible work <span>→</span> This week <span>→</span> Calendar</p>
    {notice && <p className="plan-notice" role="status">{notice}</p>}
    <div className="goal-work-layout"><section className="goal-progress-panel"><MilestonesView key={goal.version} goal={goal} initialMilestones={checkpointItems} initialState={milestoneState} onChanged={() => void checkpointsChanged()} /></section>
      <ActionsView currentWeek={week.workspace.currentWeekStartDate} onChanged={() => void refreshWeek()} initialCatalog={catalog} initialState={actionState} timezone={timezone} refreshKey={revision} week={week.workspace.weekStartDate} chosen={Object.fromEntries(work.map(c => [c.actionId, c.budgetMinutes]))} onAddToWeek={(action, element) => { trigger.current = element; setAdding(action); }} />
    </div></div><aside className="goal-context-rail" aria-label="Goal context">
      <section className="goal-this-week" aria-labelledby="goal-this-week-title"><div className="milestones-heading"><div><p className="eyebrow">Am I choosing this now?</p><h2 id="goal-this-week-title">{week.workspace.weekStartDate === week.workspace.currentWeekStartDate ? "This week’s work" : `Week of ${week.workspace.weekStartDate}`}</h2></div><Link className="quiet-button" href={`/calendar?week=${week.workspace.weekStartDate}`}>Calendar →</Link></div>
        <p className="week-choice-caption">Week of {week.workspace.weekStartDate} · {plan?.state === "draft" ? "Draft choices · review to schedule" : plan ? "Current committed plan" : "Choose work below"}</p>
        {work.length ? <div className="goal-week-work">{work.map(c => <Link href={`/calendar?week=${week.workspace.weekStartDate}`} key={c.actionId}><span><strong>{c.context!.action.title}</strong><small>{duration(c.budgetMinutes)} {plan?.state === "draft" ? "chosen" : "committed"}</small></span><span aria-hidden="true">→</span></Link>)}</div> : <p className="muted">A little meaningful work is enough. Add an Action when you’re ready to choose it.</p>}
        {!!week.workspace.view?.issues.length && <p className="canvas-warning">Draft source context needs review before committing.</p>}
        {plan?.state === "draft" && <Link className="goal-open-link" href={`/planning?week=${week.workspace.weekStartDate}`}>Review and commit this week →</Link>}
        {plan?.state === "committed" && <Link className="goal-open-link" href={`/planning?week=${week.workspace.weekStartDate}`}>Deliberately amend this week →</Link>}
      </section>
      <section className="reference-panel reference-prompt"><h3>Make progress observable</h3><p>Keep checkpoints about outcomes. Choose Actions for the week when you have room for them.</p></section></aside></div>
    {dialog && <GoalDialog state={dialog} onClose={() => { setDialog(null); restore(); }} onSaved={savedGoal} />}
    {adding && <AddToWeekDialog action={adding} initialWeek={week.workspace.weekStartDate} onClose={() => { setAdding(null); restore(); }} onSaved={value => { ++weekSequence.current; const url = new URL(window.location.href); if (value.workspace.weekStartDate === value.workspace.currentWeekStartDate) url.searchParams.delete("week"); else url.searchParams.set("week", value.workspace.weekStartDate); window.history.replaceState(null, "", url); setWeek(value); setAdding(null); setRevision(v => v + 1); setNotice(weekWork(value).some(c => c.actionId === adding.action.id) ? "Action chosen for the week. Open Calendar to see it; review and commit before scheduling a Draft." : "Command confirmed. The current week has changed since that command; review its latest choices."); restore(); }} />}
  </>;
}
