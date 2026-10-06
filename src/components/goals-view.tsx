"use client";
import { goalGroupKey } from '@/modules/planning/general';
import { useEffect, useRef, useState, type FormEvent } from "react";
import { codePointLength, goalFieldsSchema, type Goal, type GoalStatus } from "@/modules/goals/domain";

import {FocusCyclesPanel} from "./focus-cycles-panel";
import type {CycleWorkspace} from "@/modules/focus-cycles/domain";
import Link from "next/link";
import { request, errorInfo, type CommandError } from "./mutation-client";
import type { Milestone } from "@/modules/milestones/domain";
import type { ActionCatalog } from "@/modules/actions/service";
import { duration } from "./planning-presentation";
import { readGoalWeek, weekWork, type GoalWeek } from "./goal-week";
export type GoalInsight = { milestones: Milestone[]; catalog: ActionCatalog };
type GoalError = CommandError<Goal>;
export type DialogState = { kind: "create" | "edit" | "archive"; goal?: Goal };

export function GoalsView({ initialGoals, initialStatus, initialInsights, initialWeek, initialCycles }: { initialGoals: Goal[]; initialStatus: GoalStatus; initialInsights: Record<string, GoalInsight>; initialWeek: GoalWeek; initialCycles:CycleWorkspace }) {
  const [cycles,setCycles]=useState(initialCycles);
  const [cycleOpen,setCycleOpen]=useState(false);
  const [previewId, setPreviewId] = useState<string | undefined>(initialCycles.current ? initialGoals.find(g=>initialCycles.current!.goals.some(m=>m.goalId===g.id&&!m.archivedAt))?.id : initialGoals[0]?.id);
  const [insights, setInsights] = useState(initialInsights);
  const [week, setWeek] = useState(initialWeek);
  const [items, setItems] = useState(initialGoals);
  const [status, setStatus] = useState<GoalStatus>(initialStatus);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [notice, setNotice] = useState("");
  const [dialog, setDialog] = useState<DialogState | null>(null);
  const trigger = useRef<HTMLElement | null>(null);
  const sequence = useRef(0);
  const createButton = useRef<HTMLButtonElement>(null);
  async function load(next: GoalStatus) {
    const requestId = ++sequence.current;
    setLoading(true); setLoadError(""); setStatus(next);
    window.history.replaceState(null, "", next === "archived" ? "/goals?view=archived" : "/goals");
    try { const nextCycles=await request<CycleWorkspace>("/api/focus-cycles"); if(requestId===sequence.current)setCycles(nextCycles); const data = await request<{ goals: Goal[] }>(`/api/goals?status=${next}`); const [nextWeek, entries] = await Promise.all([readGoalWeek(), Promise.all(data.goals.map(async goal => { const [progress, catalog] = await Promise.all([request<{ milestones: Milestone[] }>(`/api/goals/${goal.id}/milestones`), request<ActionCatalog>(`/api/goals/${goal.id}/actions`)]); return [goal.id, { milestones: progress.milestones, catalog }] as const; }))]); if (requestId === sequence.current) { setItems(data.goals); setInsights(Object.fromEntries(entries)); setWeek(nextWeek); if(next==="active" && nextCycles.current) setPreviewId(previous=>nextCycles.current!.goals.some(g=>g.goalId===previous&&!g.archivedAt)?previous:nextCycles.current!.goals.find(g=>!g.archivedAt)?.goalId); } }
    catch (error) { if (requestId === sequence.current) setLoadError(errorInfo(error).code === "UNAUTHENTICATED" ? "Your session expired. Sign in again to see your goals." : "Your goals could not be refreshed. The previous view may be out of date. Please retry."); }
    finally { if (requestId === sequence.current) setLoading(false); }
  }
  function open(value: DialogState, button: HTMLElement) { trigger.current = button; setNotice(""); setDialog(value); }
  function close() { setDialog(null); setTimeout(() => (trigger.current?.isConnected ? trigger.current : createButton.current)?.focus(), 0); }
  async function saved(kind: DialogState["kind"]) {
    close(); setNotice(kind === "archive" ? "Goal archived. Its outcome is kept in Archived." : "Goal saved.");
    await load(kind === "create" ? "active" : status);
  }
  const focusIds=new Set(cycles.current?.goals.filter(g=>!g.archivedAt).map(g=>g.goalId)??[]);
  const preview = items.find(g => g.id === previewId) ?? (cycles.current && status === "active" ? items.find(g=>focusIds.has(g.id)) : items[0]);
  const insight = preview ? insights[preview.id] : undefined;
  const checkpoints = insight?.milestones.filter(m => m.state !== "archived") ?? [];
  const chosen = preview ? weekWork(week).filter(c => goalGroupKey(c.context?.goal) === preview.id) : [];
  const goalActions = insight?.catalog.actions.filter(a => a.action.state !== "archived") ?? [];
  const completedActions = goalActions.filter(a => a.action.state === "completed").length;
  const nextAction = goalActions.find(a => a.action.state !== "completed" && a.mutability.editable);
  const renderGoals=(list:Goal[])=>list.map(goal => <article className={`goal-card ${preview?.id === goal.id ? "goal-selected" : ""}`} key={goal.id} data-goal-id={goal.id} aria-labelledby={`goal-${goal.id}`}>
        <h2 id={`goal-${goal.id}`} aria-label={goal.title}><button className="goal-select-button" aria-label={`Preview ${goal.title}`} aria-pressed={preview?.id === goal.id} onClick={() => setPreviewId(goal.id)}><span className="goal-dot" aria-hidden="true"/><span>{goal.title}</span><span className="goal-select-arrow" aria-hidden="true">→</span></button></h2>
        <div className="goal-list-progress" aria-hidden="true"><span style={{width:`${(insights[goal.id]?.catalog.actions.filter(a=>a.action.state==='completed').length??0)/Math.max(1,insights[goal.id]?.catalog.actions.filter(a=>a.action.state!=='archived').length??0)*100}%`}}/></div><p className="goal-list-facts">{insights[goal.id]?.catalog.actions.filter(a=>a.action.state==='completed').length??0} of {insights[goal.id]?.catalog.actions.filter(a=>a.action.state!=='archived').length??0} actions done</p>
        <details className="goal-list-details"><summary>Next actions</summary><p className="goal-outcome">{goal.outcome}</p><ul className="next-action-preview">{insights[goal.id]?.catalog.actions.filter(a => a.mutability.editable).slice(0,2).map(a => <li key={a.action.id}>{a.action.title}</li>)}</ul></details>
        <div className="goal-actions">{!goal.archivedAt && <><button className="quiet-button" onClick={e => open({ kind: "edit", goal }, e.currentTarget)} aria-label={`Edit ${goal.title}`}>Edit</button><button className="text-button" onClick={e => open({ kind: "archive", goal }, e.currentTarget)} aria-label={`Archive ${goal.title}`}>Archive</button></>}</div>
      </article>);
  return <section aria-labelledby="goals-title" className="goals-section">
    <div className="goals-heading"><div><p className="eyebrow">Small steps, compounding</p><h1 id="goals-title">Goals</h1></div><button ref={createButton} className="primary-button" onClick={e => open({ kind: "create" }, e.currentTarget)}>Create goal <span aria-hidden="true">+</span></button></div>
    {!preview&&<nav className="goal-tabs" aria-label="Goal views"><button aria-current={status === "active" ? "page" : undefined} onClick={() => void load("active")}>Active</button><button aria-current={status === "archived" ? "page" : undefined} onClick={() => void load("archived")}>Archived</button></nav>}
    <p className="goal-notice" role="status">{notice}{loading ? " Loading goals…" : ""}</p>
    {loadError && <div className="load-error" role="alert"><p>{loadError}</p><button className="quiet-button" onClick={() => void load(status)}>Retry loading goals</button>{loadError.includes("session") && <a href="/sign-in">Sign in</a>}</div>}
    {!loading && !loadError && !items.length && <div className="goal-empty"><span className="empty-mark" aria-hidden="true">↗</span><h2>{status === "active" ? "Start with an outcome." : "Nothing archived yet."}</h2><p>{status === "active" ? "No active goals yet. Start with an outcome you genuinely want to make progress toward." : "Archived goals stay here with their intended outcome for reference."}</p>{status === "active" && <button className="quiet-button" onClick={e => open({ kind: "create" }, e.currentTarget)}>Create a goal</button>}</div>}
    {!loading && !loadError && preview && <div className="goals-reference-layout">
      <aside className="goal-selector" aria-label="Your goals"><h2>Your goals</h2><nav className="goal-tabs" aria-label="Goal views"><button aria-current={status === "active" ? "page" : undefined} onClick={() => { setNotice(""); void load("active"); }}>Active</button><button aria-current={status === "archived" ? "page" : undefined} onClick={() => { setNotice(""); void load("archived"); }}>Archived</button></nav><p className="section-intro">{cycles.current && status === "active" ? `${focusIds.size} Goals in Current Focus. Other Goals stay available below.` : `${items.length} ${status} ${items.length === 1 ? "goal" : "goals"}. Make room for what matters.`}</p><div className="goal-grid">{renderGoals(status === "active" && cycles.current ? items.filter(g=>focusIds.has(g.id)) : items)}{status === "active" && cycles.current && <details className="outside-cycle-goals"><summary>Other active Goals · {items.filter(g=>!focusIds.has(g.id)).length}</summary>{renderGoals(items.filter(g=>!focusIds.has(g.id)))}</details>}</div></aside>
      <section className="goal-preview-surface" aria-label="Goal preview"><p className="eyebrow"><span className="goal-dot" aria-hidden="true"/>{preview.archivedAt ? "Archived goal" : cycles.current?.title ? `Goal · ${cycles.current.title}` : "Goal · intended outcome"}</p><h2>{preview.title}</h2><p className="goal-preview-outcome">{preview.outcome}</p>
        {checkpoints.map(m => <div className="goal-preview-group" key={m.id}><div className="preview-milestone"><span aria-hidden="true">◇</span><h3>{m.title}</h3><span className="reference-badge">{m.state === "completed" ? "Completed" : "Checkpoint"}</span></div><details className="goal-checkpoint-evidence"><summary>Done when</summary><p className="small-note">{m.successCondition}</p></details>{insight?.catalog.actions.filter(a => a.action.milestoneId === m.id && a.action.state !== "archived").map(a => <Link className="preview-action" href={`/goals/${preview.id}${a.action.state === "completed" ? "?actionView=completed" : ""}`} key={a.action.id}><span aria-label={a.action.state === "completed" ? "Completed action" : "Open action"} className={`preview-checkbox ${a.action.state === "completed" ? "is-done" : ""}`}>{a.action.state === "completed" ? "✓" : ""}</span><span>{a.action.title}</span>{chosen.some(c => c.actionId === a.action.id) && <span className="reference-badge">This week</span>}<span aria-hidden="true">→</span></Link>)}</div>)}
        <div className="goal-preview-group"><h3>Goal-level actions</h3>{insight?.catalog.actions.filter(a => !a.action.milestoneId && a.action.state !== "archived").map(a => <Link className="preview-action" href={`/goals/${preview.id}${a.action.state === "completed" ? "?actionView=completed" : ""}`} key={a.action.id}><span className={`preview-checkbox ${a.action.state === "completed" ? "is-done" : ""}`} aria-label={a.action.state === "completed" ? "Completed action" : "Open action"}>{a.action.state === "completed" ? "✓" : ""}</span><span>{a.action.title}</span>{chosen.some(c=>c.actionId===a.action.id)&&<span className="reference-badge">This week</span>}<span aria-hidden="true">→</span></Link>)}{!insight?.catalog.actions.some(a => !a.action.milestoneId && a.action.state !== "archived") && <p className="small-note">No goal-level actions yet.</p>}</div>
        <Link className="primary-button" href={`/goals/${preview.id}`}>Open goal workspace <span aria-hidden="true">→</span></Link>
      </section>
      <aside className="goal-context-rail" aria-label="Goal context"><section className="reference-panel"><p className="eyebrow">Progress</p><p className="reference-value">{completedActions}<small>of {goalActions.length} actions done</small></p><div className="goal-list-progress" aria-hidden="true"><span style={{width:`${completedActions/Math.max(1,goalActions.length)*100}%`}}/></div>{checkpoints.length>0&&<p className="small-note">{checkpoints.filter(m=>m.state==='completed').length} of {checkpoints.length} checkpoints reached</p>}<div className="context-rule"/><p className="outcome-label">Picked for this week</p><strong>{duration(chosen.reduce((n,c) => n + c.budgetMinutes,0))}</strong><p className="small-note">{week.workspace.view?.plan.state === "draft" ? "Saved choices" : week.workspace.view ? "Task time picked" : "No work chosen"} · week of {week.workspace.weekStartDate}</p><Link className="goal-open-link" href={`/calendar?week=${week.workspace.weekStartDate}`}>See the calendar →</Link></section><section className="reference-panel reference-prompt"><h3>Next smallest step</h3><p>{nextAction?.action.title ?? "Choose one useful Action, then give it time on your calendar."}</p>{nextAction?.action.doneWhen&&<p className="small-note">{nextAction.action.doneWhen}</p>}<Link href={`/goals/${preview.id}`} className="quiet-button">Choose work →</Link></section><details className="goal-cycle-disclosure" open={cycleOpen} onToggle={e=>setCycleOpen(e.currentTarget.open)}><summary>Focus Cycle{cycles.current ? ` · ${cycles.current.title}` : " · choose a horizon"}</summary><FocusCyclesPanel workspace={cycles} onChanged={()=>load(status)}/></details></aside>
    </div>}
    {!loading && !loadError && !preview && cycles.current && status === "active" && <div className="cycle-empty"><p>No active Goals selected. Edit your Focus Cycle or choose another Goal below.</p><details className="outside-cycle-goals"><summary>Other active Goals · {items.length}</summary>{renderGoals(items)}</details></div>}
    {!preview&&<details className="goal-cycle-disclosure" open={cycleOpen} onToggle={e=>setCycleOpen(e.currentTarget.open)}><summary>Focus Cycles</summary><FocusCyclesPanel workspace={cycles} onChanged={()=>load(status)}/></details>}
    {dialog && <GoalDialog state={dialog} onClose={close} onSaved={saved} />}
  </section>;
}

export function GoalDialog({ state, onClose, onSaved }: { state: DialogState; onClose: () => void; onSaved: (kind: DialogState["kind"]) => Promise<void> }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [title, setTitle] = useState(state.goal?.title ?? "");
  const [outcome, setOutcome] = useState(state.goal?.outcome ?? "");
  const [base, setBase] = useState(state.goal);
  const [error, setError] = useState<GoalError | null>(null);
  const [pending, setPending] = useState(false);
  const [reviewed, setReviewed] = useState(false);
  const inFlight = useRef(false);
  const command = useRef<{ mutationId: string; payload: object } | null>(null);
  const uncertain = error?.code === "UNCERTAIN" || error?.code === "DATABASE_UNAVAILABLE" || error?.code === "INTERNAL";
  const conflict = error?.code === "CONFLICT";
  useEffect(() => {
    const element = dialog.current!; element.showModal();
    element.querySelector<HTMLElement>("[data-initial-focus]")?.focus();
    return () => element.close();
  }, []);
  function change(field: "title" | "outcome", value: string) {
    command.current = null; setError((previous) => previous?.code === "CONFLICT" ? previous : null);
    if (field === "title") setTitle(value); else setOutcome(value);
  }
  async function submit(event: FormEvent) {
    event.preventDefault(); if (inFlight.current || conflict) return;
    if (state.kind !== "archive" && !command.current) {
      const valid = goalFieldsSchema.safeParse({ title, outcome });
      if (!valid.success) {
        const fields: Record<string, string> = {};
        for (const issue of valid.error.issues) fields[String(issue.path[0])] ??= issue.message;
        setError({ code: "VALIDATION", message: "Check the highlighted fields.", fields }); return;
      }
    }
    if (!command.current) {
      const mutationId = crypto.randomUUID();
      command.current = { mutationId, payload: { mutationId, ...(state.kind === "archive" ? {} : { title, outcome }), ...(base ? { expectedVersion: base.version } : {}) } };
    }
    inFlight.current = true; setPending(true);
    try {
      await request<{ goal: Goal }>(state.kind === "create" ? "/api/goals" : `/api/goals/${base!.id}${state.kind === "archive" ? "/archive" : ""}`, { method: state.kind === "edit" ? "PATCH" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(command.current.payload) });
      await onSaved(state.kind);
    } catch (failure) {
      const info = errorInfo(failure); setError(info);
      if (["VALIDATION", "CONFLICT", "NOT_FOUND", "FORBIDDEN", "UNAUTHENTICATED"].includes(info.code)) command.current = null;
    } finally { inFlight.current = false; setPending(false); }
  }
  async function review() {
    setPending(true);
    try {
      const { goal } = await request<{ goal: Goal }>(`/api/goals/${base!.id}`);
      setBase(goal); command.current = null;
      if (goal.archivedAt) setError({ code: "CONFLICT", kind: "ARCHIVED", message: "This goal is now archived. Your draft is still shown, but it cannot be saved.", current: goal });
      else { setError(null); setReviewed(true); }
    } catch (failure) { setError({ ...errorInfo(failure), code: "CONFLICT", message: "The latest version could not be loaded. Your draft is kept. Retry reviewing before saving." }); }
    finally { setPending(false); }
  }
  const locked = pending || Boolean(uncertain);
  const heading = state.kind === "create" ? "Create a goal" : state.kind === "edit" ? "Edit goal" : "Archive this goal?";
  return <dialog className="goal-dialog" ref={dialog} aria-labelledby="goal-dialog-title" onCancel={(e) => { e.preventDefault(); if (!locked) onClose(); }}>
    <form onSubmit={submit} noValidate>
      <p className="eyebrow">{state.kind === "archive" ? "Keep the history" : "An outcome to move toward"}</p><h2 id="goal-dialog-title">{heading}</h2>
      {state.kind === "archive" ? <div className="archive-explanation"><p><strong>{base?.title}</strong> will leave your active goals.</p><p>Its outcome will stay in Archived for reference. There is no restore action yet.</p></div> : <>
        <p className="muted">Give it a clear name and describe what success means.</p>
        <label htmlFor="goal-title">Title</label><input data-initial-focus id="goal-title" value={title} disabled={locked} onChange={(e) => change("title", e.target.value)} aria-invalid={Boolean(error?.fields?.title)} aria-describedby="title-help title-error" placeholder="Launch One Better MVP" />
        <div className="field-help" id="title-help">A concise name <span>{codePointLength(title.trim())}/160</span></div><p id="title-error" className="error-message">{error?.fields?.title}</p>
        <label htmlFor="goal-outcome">Outcome</label><textarea id="goal-outcome" value={outcome} disabled={locked} onChange={(e) => change("outcome", e.target.value)} aria-invalid={Boolean(error?.fields?.outcome)} aria-describedby="outcome-help outcome-error" rows={3} placeholder="I have a usable planning system that I rely on every week." />
        <div className="field-help" id="outcome-help">What will be true when this succeeds? <span>{codePointLength(outcome.trim())}/2000</span></div><p id="outcome-error" className="error-message">{error?.fields?.outcome}</p>
      </>}
      {reviewed && <div className="reviewed-state" role="status"><p>Latest saved version reviewed. Your draft is kept; compare it before saving.</p><p><strong>{base?.title}</strong></p><p className="goal-outcome">{base?.outcome}</p></div>}
      {error && <div className="dialog-error" role="alert"><p>{error.message}</p>{error.current && <div className="latest-goal"><p className="outcome-label">Latest saved version{error.current.archivedAt ? " · Archived" : ""}</p><strong>{error.current.title}</strong><p className="goal-outcome">{error.current.outcome}</p></div>}{conflict && error.kind !== "ARCHIVED" && <button type="button" className="quiet-button" disabled={pending} onClick={() => void review()}>Review latest saved version</button>}{error.code === "UNAUTHENTICATED" && <a href="/sign-in">Sign in again</a>}</div>}
      <div className="dialog-actions"><button type="button" className="quiet-button" data-initial-focus={state.kind === "archive" ? true : undefined} disabled={locked} onClick={onClose}>{conflict ? "Close without saving" : "Cancel"}</button><button className="primary-button" disabled={pending || Boolean(conflict) || error?.code === "NOT_FOUND" || error?.code === "UNAUTHENTICATED"}>{pending ? "Saving…" : uncertain ? "Retry same change" : state.kind === "archive" ? "Archive goal" : "Save goal"}</button></div>
    </form>
  </dialog>;
}
