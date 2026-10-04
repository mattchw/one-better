"use client";
import { useEffect, useRef, useState, type FormEvent } from "react";
import type { Goal } from "@/modules/goals/domain";
import { codePointLength } from "@/modules/goals/domain";
import { evidenceSchema, milestoneFieldsSchema, type Milestone, type MilestoneState } from "@/modules/milestones/domain";
import { request, errorInfo, type CommandError } from "./mutation-client";
type Kind = "create" | "edit" | "complete" | "archive";
type DialogState = { kind: Kind; milestone?: Milestone };
export function MilestonesView({ goal, initialMilestones, initialState, onChanged }: { onChanged?: () => void; goal: Goal; initialMilestones: Milestone[]; initialState: MilestoneState }) {
  const [parent, setParent] = useState(goal); const [items, setItems] = useState(initialMilestones);
  const [state, setState] = useState(initialState); const [dialog, setDialog] = useState<DialogState | null>(null);
  const [loading, setLoading] = useState(false); const [error, setError] = useState(""); const [notice, setNotice] = useState("");
  const trigger = useRef<HTMLElement | null>(null); const add = useRef<HTMLButtonElement>(null); const activeTab = useRef<HTMLButtonElement>(null); const sequence = useRef(0);
  async function load(next: MilestoneState) {
    const current = ++sequence.current; setLoading(true); setError(""); setState(next);
    const url = new URL(window.location.href); if (next === "active") url.searchParams.delete("view"); else url.searchParams.set("view", next); window.history.replaceState(null, "", url);
    try {
      const [data, latest] = await Promise.all([request<{ milestones: Milestone[] }>(`/api/goals/${goal.id}/milestones`), request<{ goal: Goal }>(`/api/goals/${goal.id}`)]);
      if (current === sequence.current) { setItems(data.milestones); setParent(latest.goal); onChanged?.(); }
    } catch (failure) { if (current === sequence.current) setError(errorInfo(failure).code === "UNAUTHENTICATED" ? "Your session expired. Sign in again to see this goal." : "Milestones could not be refreshed. Please retry; the previous view may be out of date."); }
    finally { if (current === sequence.current) setLoading(false); }
  }
  function open(value: DialogState, button: HTMLElement) { trigger.current = button; setNotice(""); setDialog(value); }
  function close() { setDialog(null); setTimeout(() => (trigger.current?.isConnected ? trigger.current : add.current ?? activeTab.current)?.focus(), 0); }
  async function saved(kind: Kind) { close(); setNotice(kind === "complete" ? "Milestone completed. Its success condition and evidence are kept." : kind === "archive" ? "Milestone archived. Its history is retained." : "Milestone saved."); await load(kind === "complete" ? "completed" : kind === "archive" ? "archived" : "active"); }
  const visible = items.filter((item) => item.state === state);
  return <section className="milestones-section" aria-labelledby="milestones-title">
    <div className="milestones-heading"><div><p className="eyebrow">Observable progress</p><h2 id="milestones-title">Progress checkpoints</h2></div>{!parent.archivedAt && <button ref={add} className="primary-button" onClick={(e) => open({ kind: "create" }, e.currentTarget)}>Add milestone <span aria-hidden="true">+</span></button>}</div>
    <p className="checkpoint-count">{items.filter(m => m.state === "completed").length} completed {items.filter(m => m.state === "completed").length === 1 ? "checkpoint" : "checkpoints"} · {items.filter(m => m.state === "active").length} ahead</p>
    {parent.archivedAt && <p className="historical-notice" role="status">This goal is archived. Its milestones are kept as read-only history.</p>}
    {state === "active" && items.some(m => m.state === "completed") && <ul className="checkpoint-preview achieved-checkpoints" aria-label="Achieved checkpoints">{items.filter(m => m.state === "completed").slice(0,3).map(m => <li key={m.id}><span className="checkpoint-complete" aria-label="Completed checkpoint">●</span>{m.title}</li>)}</ul>}
    <nav className="goal-tabs" aria-label="Milestone views">{(["active", "completed", "archived"] as const).map((tab) => <button key={tab} ref={tab === "active" ? activeTab : undefined} aria-current={state === tab ? "page" : undefined} onClick={() => { setNotice(""); void load(tab); }}>{tab[0].toUpperCase() + tab.slice(1)}</button>)}</nav>
    <p role="status" className="goal-notice">{notice}{loading ? " Loading milestones…" : ""}</p>
    {error && <div className="load-error" role="alert"><p>{error}</p><button className="quiet-button" onClick={() => void load(state)}>Retry loading milestones</button>{error.includes("session") && <a href="/sign-in">Sign in</a>}</div>}
    {!loading && !error && !visible.length && <div className="goal-empty"><h3>{state === "active" ? "What would meaningful progress look like?" : state === "completed" ? "No completed milestones yet." : "No archived milestones yet."}</h3><p>{state === "active" ? "Milestones describe observable outcomes that show this goal is moving forward." : state === "completed" ? "When a success condition happens, its definition and evidence will stay here." : "Checkpoints that are no longer relevant remain here for reference."}</p>{state === "active" && !parent.archivedAt && <button className="quiet-button" onClick={(e) => open({ kind: "create" }, e.currentTarget)}>Create a milestone</button>}</div>}
    {!loading && !error && <div className="milestone-list">{visible.map((item) => <article className="milestone-card" key={item.id} data-milestone-id={item.id} aria-labelledby={`milestone-${item.id}`}><span className="state-caption">{item.state === "active" ? "Outcome checkpoint" : item.state === "completed" ? "Completed" : "Archived"}</span><h3 id={`milestone-${item.id}`}>{item.title}</h3><p className="outcome-label">Success when</p><p className="goal-outcome">{item.successCondition}</p>{item.state === "completed" && <div className="completion-evidence"><p className="outcome-label">Evidence / result</p><p className="goal-outcome">{item.evidence ?? "No evidence note was added."}</p></div>}{item.state === "active" && !parent.archivedAt && <div className="goal-actions"><button className="quiet-button" aria-label={`Edit ${item.title}`} onClick={(e) => open({ kind: "edit", milestone: item }, e.currentTarget)}>Edit</button><div><button className="quiet-button" aria-label={`Complete ${item.title}`} onClick={(e) => open({ kind: "complete", milestone: item }, e.currentTarget)}>Complete</button><button className="text-button" aria-label={`Archive ${item.title}`} onClick={(e) => open({ kind: "archive", milestone: item }, e.currentTarget)}>Archive</button></div></div>}</article>)}</div>}
    {dialog && <MilestoneDialog goalId={goal.id} state={dialog} onClose={close} onSaved={saved} onParentArchived={() => void load(state)} />}
  </section>;
}
function MilestoneDialog({ goalId, state, onClose, onSaved, onParentArchived }: { goalId: string; state: DialogState; onClose: () => void; onSaved: (kind: Kind) => Promise<void>; onParentArchived: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null); const command = useRef<object | null>(null); const inFlight = useRef(false);
  const [base, setBase] = useState(state.milestone); const [title, setTitle] = useState(state.milestone?.title ?? ""); const [condition, setCondition] = useState(state.milestone?.successCondition ?? ""); const [evidence, setEvidence] = useState("");
  const [error, setError] = useState<CommandError<Milestone> | null>(null); const [pending, setPending] = useState(false); const [reviewed, setReviewed] = useState(false);
  const uncertain = Boolean(error && ["UNCERTAIN", "DATABASE_UNAVAILABLE", "INTERNAL"].includes(error.code)); const conflict = error?.code === "CONFLICT"; const locked = pending || uncertain;
  useEffect(() => { const element = dialog.current!; element.showModal(); element.querySelector<HTMLElement>("[data-initial-focus]")?.focus(); return () => element.close(); }, []);
  function change(field: "title" | "condition" | "evidence", value: string) { command.current = null; setError((prev) => prev?.code === "CONFLICT" ? prev : null); if (field === "title") setTitle(value); else if (field === "condition") setCondition(value); else setEvidence(value); }
  async function submit(event: FormEvent) {
    event.preventDefault(); if (inFlight.current || conflict) return;
    if (!command.current) {
      const parsed = state.kind === "create" || state.kind === "edit" ? milestoneFieldsSchema.safeParse({ title, successCondition: condition }) : state.kind === "complete" ? evidenceSchema.safeParse(evidence) : null;
      if (parsed && !parsed.success) { const fields: Record<string, string> = {}; for (const issue of parsed.error.issues) fields[String(issue.path[0] ?? "evidence")] ??= issue.message; setError({ code: "VALIDATION", message: "Check the highlighted fields.", fields }); return; }
      command.current = { mutationId: crypto.randomUUID(), ...(base ? { expectedVersion: base.version } : {}), ...(state.kind === "create" || state.kind === "edit" ? { title, successCondition: condition } : state.kind === "complete" ? { evidence } : {}) };
    }
    inFlight.current = true; setPending(true);
    try {
      const url = state.kind === "create" ? `/api/goals/${goalId}/milestones` : `/api/milestones/${base!.id}${state.kind === "edit" ? "" : `/${state.kind}`}`;
      await request(url, { method: state.kind === "edit" ? "PATCH" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(command.current) }); await onSaved(state.kind);
    } catch (failure) { const info = errorInfo<Milestone>(failure); setError(info); if (info.kind === "GOAL_ARCHIVED") onParentArchived(); if (["VALIDATION", "CONFLICT", "NOT_FOUND", "FORBIDDEN", "UNAUTHENTICATED"].includes(info.code)) command.current = null; }
    finally { inFlight.current = false; setPending(false); }
  }
  async function review() {
    setPending(true);
    try {
      const [latest, parent] = await Promise.all([request<{ milestone: Milestone }>(`/api/milestones/${base!.id}`), request<{ goal: Goal }>(`/api/goals/${goalId}`)]);
      setBase(latest.milestone); command.current = null;
      if (parent.goal.archivedAt) { onParentArchived(); setError({ code: "CONFLICT", kind: "GOAL_ARCHIVED", message: "This goal is archived. Your draft is kept, but its milestones cannot be changed." }); }
      else if (latest.milestone.state !== "active") setError({ code: "CONFLICT", kind: "TERMINAL", message: `This milestone is ${latest.milestone.state}. Your draft is kept but cannot be saved.`, current: latest.milestone });
      else { setError(null); setReviewed(true); }
    } catch { setError({ code: "CONFLICT", kind: "VERSION", message: "The latest version could not be loaded. Your draft is kept. Retry reviewing before saving." }); }
    finally { setPending(false); }
  }
  const heading = state.kind === "create" ? "Add a milestone" : state.kind === "edit" ? "Edit milestone" : state.kind === "complete" ? "Did the success condition happen?" : "Archive this milestone?";
  return <dialog ref={dialog} className="goal-dialog" aria-labelledby="milestone-dialog-title" onCancel={(event) => { event.preventDefault(); if (!locked) onClose(); }}><form onSubmit={submit} noValidate><p className="eyebrow">{state.kind === "complete" ? "Confirm an observable outcome" : "Evidence of progress"}</p><h2 id="milestone-dialog-title">{heading}</h2>
    {state.kind === "create" || state.kind === "edit" ? <><p className="muted">Name a checkpoint and define what you would need to observe.</p><label htmlFor="milestone-title">Title</label><input id="milestone-title" data-initial-focus disabled={locked} value={title} onChange={(e) => change("title", e.target.value)} aria-invalid={Boolean(error?.fields?.title)} aria-describedby="milestone-title-help milestone-title-error" placeholder="Weekly planning loop is usable" /><div className="field-help" id="milestone-title-help">An outcome checkpoint <span>{codePointLength(title.trim())}/160</span></div><p className="error-message" id="milestone-title-error">{error?.fields?.title}</p><label htmlFor="milestone-condition">Success condition</label><textarea id="milestone-condition" disabled={locked} value={condition} onChange={(e) => change("condition", e.target.value)} aria-invalid={Boolean(error?.fields?.successCondition)} aria-describedby="condition-help condition-error" rows={3} placeholder="I can choose commitments, compare them with capacity, and preserve the resulting plan." /><div className="field-help" id="condition-help">What observable outcome would demonstrate success? <span>{codePointLength(condition.trim())}/2000</span></div><p className="error-message" id="condition-error">{error?.fields?.successCondition}</p></> : <><h3>{base?.title}</h3><p className="outcome-label">Declared success condition</p><p className="goal-outcome">{base?.successCondition}</p>{state.kind === "complete" ? <><p className="muted">Confirm completion only if this outcome actually happened. Working on it alone does not fulfil the condition.</p><label htmlFor="milestone-evidence">Evidence / result (optional)</label><textarea id="milestone-evidence" data-initial-focus disabled={locked} rows={3} value={evidence} onChange={(e) => change("evidence", e.target.value)} aria-invalid={Boolean(error?.fields?.evidence)} aria-describedby="evidence-help evidence-error" /><div className="field-help" id="evidence-help">What happened? <span>{codePointLength(evidence.trim())}/2000</span></div><p id="evidence-error" className="error-message">{error?.fields?.evidence}</p></> : <p className="muted">Archive means this milestone is no longer relevant, but its history is retained. There is no restore action.</p>}</>}
    {reviewed && <div className="reviewed-state" role="status"><p>Latest saved version reviewed. Your draft is kept; compare it before confirming.</p><strong>{base?.title}</strong><p className="goal-outcome">{base?.successCondition}</p></div>}
    {error && <div role="alert" className="dialog-error"><p>{error.message}</p>{error.current && <div className="latest-goal"><p className="outcome-label">Latest saved version · {error.current.state}</p><strong>{error.current.title}</strong><p className="goal-outcome">{error.current.successCondition}</p></div>}{conflict && !["TERMINAL", "GOAL_ARCHIVED", "MUTATION_ID"].includes(error.kind ?? "") && <button type="button" className="quiet-button" disabled={pending} onClick={() => void review()}>Review latest saved version</button>}{error.code === "UNAUTHENTICATED" && <a href="/sign-in">Sign in again</a>}</div>}
    <div className="dialog-actions"><button type="button" className="quiet-button" data-initial-focus={state.kind === "archive" ? true : undefined} disabled={locked} onClick={onClose}>{conflict ? "Close without saving" : "Cancel"}</button><button className="primary-button" disabled={pending || Boolean(conflict) || ["NOT_FOUND", "UNAUTHENTICATED"].includes(error?.code ?? "")}>{pending ? "Saving…" : uncertain ? "Retry same change" : state.kind === "complete" ? "Confirm completion" : state.kind === "archive" ? "Archive milestone" : "Save milestone"}</button></div>
  </form></dialog>;
}
