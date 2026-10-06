"use client";
import { goalTitle } from '@/modules/planning/general';
import { useEffect, useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import { mondayOf, calendarDate, type PlanningSource } from "@/modules/planning/domain";
import type { ActionView } from "@/modules/actions/domain";
import { duration } from "./planning-presentation";
import { readGoalWeek, weekWork, type GoalWeek } from "./goal-week";
import { request, errorInfo, type CommandError } from "./mutation-client";
type Context = { week: GoalWeek; candidates: PlanningSource[] };
type Command = { url: string; method: "POST" | "PATCH"; body: object; adding: boolean; week: string };
export function AddToWeekDialog({ action, initialWeek, onClose, onSaved }: { action: ActionView; initialWeek: string; onClose: () => void; onSaved: (value: GoalWeek) => void }) {
  const dialog = useRef<HTMLDialogElement>(null), budgetInput = useRef<HTMLInputElement>(null), serial = useRef(0), inFlight = useRef(false);
  const [picked, setPicked] = useState(initialWeek), [budget, setBudget] = useState("");
  const [context, setContext] = useState<Context | null>(null), [review, setReview] = useState<Context | null>(null);
  const [busy, setBusy] = useState(false), [pending, setPending] = useState<Command | null>(null), [error, setError] = useState<CommandError | null>(null), [needsReview, setNeedsReview] = useState(false);
  const locked = busy || !!pending;
  useEffect(() => { const element = dialog.current!; element.showModal(); budgetInput.current?.focus(); return () => element.close(); }, []);
  useEffect(() => { if (!budget && !pending) return; const guard = (e: BeforeUnloadEvent) => e.preventDefault(); window.addEventListener("beforeunload", guard); return () => window.removeEventListener("beforeunload", guard); }, [budget, pending]);
  async function read(week: string): Promise<Context> {
    const [value, pool] = await Promise.all([readGoalWeek(week), request<{ candidates: PlanningSource[] }>("/api/weekly-plans/candidates")]);
    return { week: value, candidates: pool.candidates };
  }
  useEffect(() => {
    const id = ++serial.current; let cancelled = false;
    if (!calendarDate(picked)) return;
    read(mondayOf(picked)).then(value => { if (!cancelled && id === serial.current) { setContext(value); setError(null); setNeedsReview(false); setReview(null); } }).catch(failure => { if (!cancelled && id === serial.current) { setContext(null); setError(errorInfo(failure)); } });
    return () => { cancelled = true; };
  }, [picked]);
  const workspace = context?.week.workspace, plan = workspace?.view?.plan;
  const candidate = context?.candidates.find(c => c.actionId === action.action.id);
  const included = context ? weekWork(context.week).some(c => c.actionId === action.action.id) : false;
  const validBudget = /^\d+$/.test(budget) && Number(budget) > 0 && Number(budget) <= 10080;
  const issues = workspace?.view?.issues ?? [];
  const editableWeek = !!workspace && workspace.weekStartDate >= workspace.currentWeekStartDate;
  const canAdd = !!plan && plan.state === "draft" && editableWeek && !!candidate && !included && !issues.length && plan.commitments.length < 50 && validBudget && Number(budget)+plan.commitments.reduce((n,c)=>n+c.budgetMinutes,0)<=10080 && !needsReview && !review;
  async function execute(command: Command) {
    if (inFlight.current) return; inFlight.current = true; setBusy(true); setPending(command); setError(null);
    let acknowledged = false;
    try {
      await request(command.url, { method: command.method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(command.body) }); acknowledged = true;
      // A replay receipt is historical. Controls must use the current saved plan.
      const latest = await read(command.week);
      setContext(latest); setPending(null);
      if (command.adding) onSaved(latest.week);
    } catch (failure) {
      const info = errorInfo(failure); setError(info);
      if (!acknowledged && !["UNCERTAIN", "DATABASE_UNAVAILABLE", "INTERNAL"].includes(info.code)) { setPending(null); setNeedsReview(true); }
    } finally { inFlight.current = false; setBusy(false); }
  }
  function submit(e: FormEvent) {
    e.preventDefault(); if (locked || needsReview || !context) return;
    if (!plan) {
      if (!editableWeek || !workspace?.canCreate || !validBudget || !candidate) return;
      void execute({ url: "/api/weekly-plans/quick-commit", method: "POST", adding: true, week: workspace.weekStartDate, body: { mutationId: crypto.randomUUID(), weekStartDate: workspace.weekStartDate, commitments: [{actionId:action.action.id,budgetMinutes:Number(budget),source:candidate.source}] } });
    } else if (canAdd) {
      const total=plan.commitments.reduce((n,c)=>n+c.budgetMinutes,0)+Number(budget), reserve=Math.min(plan.reserveMinutes,10080-total);
      void execute({ url: `/api/weekly-plans/${plan.id}`, method: "PATCH", adding: true, week: plan.weekStartDate, body: { mutationId: crypto.randomUUID(), expectedVersion: plan.version, provisionalCapacityMinutes: Math.max(plan.provisionalCapacityMinutes,total+reserve), reserveMinutes: reserve, commitments: [...plan.commitments.map(c => ({ actionId: c.actionId, budgetMinutes: c.budgetMinutes, source: c.source })), { actionId: action.action.id, budgetMinutes: Number(budget), source: candidate!.source }] } });
    }
  }
  async function reviewLatest() {
    if (busy || pending) return; setBusy(true);
    try { setReview(await read(mondayOf(picked))); } catch (failure) { setError(errorInfo(failure)); } finally { setBusy(false); }
  }
  const reviewCandidate = review?.candidates.find(c => c.actionId === action.action.id);
  return <dialog ref={dialog} className="goal-dialog add-week-dialog" aria-labelledby="add-week-title" onCancel={e => { e.preventDefault(); if (!locked) onClose(); }}><form onSubmit={submit} noValidate>
    <p className="eyebrow">Choose deliberately</p><h2 id="add-week-title">Add to this week</h2><p className="week-action-title">{candidate?.context.action.title ?? action.action.title}</p>{candidate?.context.action.doneWhen && <p className="small-note">Done when: {candidate.context.action.doneWhen}</p>}
    <label htmlFor="commitment-budget">Task time in minutes</label><input ref={budgetInput} id="commitment-budget" type="number" min="1" max="10080" step="1" value={budget} disabled={locked} onChange={e => setBudget(e.target.value)} /><p className="field-help">Time to give this task in the week.</p>
    <label htmlFor="commitment-week">Week containing</label><input id="commitment-week" type="date" min={workspace?.currentWeekStartDate} value={picked} disabled={locked} onChange={e => { setContext(null); setPicked(e.target.value); }} />
    {!context && <p role="status">{error ? "Week context unavailable." : "Loading week context…"}</p>}
    {workspace && <p className="week-choice-caption">Week of {workspace.weekStartDate} · {workspace.timezone}</p>}
    {included && <p role="status">Already chosen for this week. <Link href={`/calendar?week=${workspace!.weekStartDate}`}>Open Calendar →</Link></p>}
    {context && !candidate && <p role="alert">This Action is no longer eligible. It needs an active Goal, an Open Action and an active Milestone if assigned.</p>}
    {!editableWeek && workspace && <p>This week is historical. Choose the current or a future week.</p>}
    {plan?.state === "committed" && !included && <p>This week already has a task list. <Link href={`/planning?week=${workspace!.weekStartDate}`}>Edit this week on Calendar →</Link>, or choose another week.</p>}
    {!!issues.length && <p role="alert">Existing choices need source review. <Link href={`/planning?week=${workspace!.weekStartDate}`}>Review your weekly plan →</Link></p>}
    {plan && plan.commitments.length >= 50 && <p>This week already has 50 choices. Review the weekly plan before adding more.</p>}
    {review && <div className="reviewed-state"><strong>Latest week context</strong><p>{review.week.workspace.view?.plan.state ?? "No plan"}</p><p>{reviewCandidate?.context.action.title ?? "Action no longer eligible"}</p>{reviewCandidate && <><p>{goalTitle(reviewCandidate.context.goal)}: {reviewCandidate.context.goal?.outcome}</p>{reviewCandidate.context.milestone && <p>{reviewCandidate.context.milestone.title}: {reviewCandidate.context.milestone.successCondition}</p>}{reviewCandidate.context.action.doneWhen && <p>{reviewCandidate.context.action.doneWhen}</p>}</>}<ul>{weekWork(review.week).map(c => <li key={c.actionId}>{c.context?.action.title ?? "Unavailable Action"} · {duration(c.budgetMinutes)}</li>)}</ul><button type="button" className="quiet-button" onClick={() => { setContext(review); setReview(null); setNeedsReview(false); setError(null); }}>Use reviewed context</button></div>}
    {error && <div role="alert" className="dialog-error"><p>{error.message}</p>{pending ? <button type="button" className="quiet-button" disabled={busy} onClick={() => void execute(pending)}>Retry same command</button> : <button type="button" className="quiet-button" disabled={busy} onClick={() => void reviewLatest()}>Review latest context</button>}{error.code === "UNAUTHENTICATED" && <Link href="/sign-in">Sign in again</Link>}</div>}
    <p className="small-note">Your task will appear on Calendar, ready to give it time.</p><div className="dialog-actions"><button type="button" className="quiet-button" disabled={locked} onClick={onClose}>Cancel</button><button className="primary-button" disabled={locked || needsReview || !!review || (plan ? !canAdd : !workspace?.canCreate || !validBudget || !candidate || !editableWeek)}>{busy ? "Saving…" : "Add to week"}</button></div>
  </form></dialog>;
}
