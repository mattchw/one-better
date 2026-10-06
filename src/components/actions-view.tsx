"use client";
import { goalGroupKey, goalTitle } from '@/modules/planning/general';
import { useEffect, useRef, useState, type FormEvent } from "react";
import { actionFieldsSchema, type Action, type ActionState, type ActionView } from "@/modules/actions/domain";
import type { ActionCatalog } from "@/modules/actions/service";
import Link from "next/link";
import { request, errorInfo, type CommandError } from "./mutation-client";
type Kind = "create" | "edit" | "complete" | "archive";
type DialogState = { kind: Kind; view?: ActionView };
const estimate = (minutes: number) => minutes >= 60 ? `${Math.floor(minutes / 60)}h${minutes % 60 ? ` ${minutes % 60}m` : ""}` : `${minutes}m`;
export function ActionsView({ initialCatalog, initialState, timezone, refreshKey, chosen = {}, week, onAddToWeek, onChanged, currentWeek }: { currentWeek?: string; onChanged?: () => void; chosen?: Record<string, number>; week?: string; onAddToWeek?: (action: ActionView, trigger: HTMLElement) => void; initialCatalog: ActionCatalog; initialState: ActionState; timezone: string; refreshKey: number }) {
  const [catalog, setCatalog] = useState(initialCatalog); const [state, setState] = useState(initialState);
  const [dialog, setDialog] = useState<DialogState | null>(null); const [loading, setLoading] = useState(false); const [error, setError] = useState(""); const [notice, setNotice] = useState("");
  const goalId = goalGroupKey(catalog.goal); const sequence = useRef(0); const trigger = useRef<HTMLElement | null>(null); const add = useRef<HTMLButtonElement>(null); const openTab = useRef<HTMLButtonElement>(null);
  async function refresh() {
    const current = ++sequence.current; setLoading(true); setError("");
    try { const latest = await request<ActionCatalog>(`/api/goals/${goalId}/actions`); if (current === sequence.current) { setCatalog(latest); onChanged?.(); } }
    catch (failure) { if (current === sequence.current) setError(errorInfo(failure).code === "UNAUTHENTICATED" ? "Your session expired. Sign in again to see these actions." : "Actions could not be refreshed. Please retry; the previous view may be out of date."); }
    finally { if (current === sequence.current) setLoading(false); }
  }
  useEffect(() => {
    if (!refreshKey) return;
    let cancelled = false; const current = ++sequence.current;
    request<ActionCatalog>(`/api/goals/${goalId}/actions`).then((latest) => { if (!cancelled && current === sequence.current) { setCatalog(latest); setError(""); setLoading(false); } }).catch(() => { if (!cancelled && current === sequence.current) { setError("Actions could not be refreshed. Please retry; the previous view may be out of date."); setLoading(false); } });
    return () => { cancelled = true; };
  }, [refreshKey, goalId]);
  function select(next: ActionState) { setState(next); setNotice(""); const url = new URL(window.location.href); if (next === "open") url.searchParams.delete("actionView"); else url.searchParams.set("actionView", next); window.history.replaceState(null, "", url); void refresh(); }
  function open(value: DialogState, button: HTMLElement) { trigger.current = button; setNotice(""); setDialog(value); }
  function close() { setDialog(null); setTimeout(() => (trigger.current?.isConnected ? trigger.current : add.current ?? openTab.current)?.focus(), 0); }
  async function saved(kind: Kind) { close(); select(kind === "complete" ? "completed" : kind === "archive" ? "archived" : "open"); setNotice(kind === "complete" ? "Action completed. Its definition and estimate are kept." : kind === "archive" ? "Action archived. Its history is retained." : "Action saved."); }
  const visible = catalog.actions.filter((item) => item.action.state === state).sort((a,b) => Number(b.mutability.editable) - Number(a.mutability.editable));
  return <section className="actions-section" aria-labelledby="actions-title">
    <div className="milestones-heading"><div><p className="eyebrow">Concrete next moves</p><h2 id="actions-title">Next actions</h2></div>{catalog.canCreate && <button ref={add} className="primary-button" onClick={(e) => open({ kind: "create" }, e.currentTarget)}>Add action <span aria-hidden="true">+</span></button>}</div>
    <p className="section-intro">What could you actually do? Keep a small pool of useful work, then choose what fits this week.</p>
    {!catalog.canCreate && <p className="historical-notice" role="status">This goal is archived. Its actions are kept unchanged as read-only history.</p>}
    <nav className="goal-tabs" aria-label="Action views">{(["open", "completed", "archived"] as const).map((tab) => <button key={tab} ref={tab === "open" ? openTab : undefined} aria-label={`${tab[0].toUpperCase() + tab.slice(1)} actions`} aria-current={state === tab ? "page" : undefined} onClick={() => select(tab)}>{tab[0].toUpperCase() + tab.slice(1)}</button>)}</nav>
    <p role="status" className="goal-notice">{notice}{loading ? " Loading actions…" : ""}</p>
    {error && <div className="load-error" role="alert"><p>{error}</p><button className="quiet-button" onClick={() => void refresh()}>Retry loading actions</button>{error.includes("session") && <a href="/sign-in">Sign in</a>}</div>}
    {!loading && !error && !visible.length && <div className="goal-empty"><h3>{state === "open" ? "What concrete thing would move this forward?" : state === "completed" ? "No completed actions yet." : "No archived actions yet."}</h3><p>{state === "open" ? "Actions are concrete things you can do to move this goal forward. Keep a small, useful pool of possible work." : "The action’s definition, estimate and context stay here for reference."}</p>{state === "open" && catalog.canCreate && <button className="quiet-button" onClick={(e) => open({ kind: "create" }, e.currentTarget)}>Create an action</button>}</div>}
    {!loading && !error && <div className="action-list">{visible.map((view) => { const item = view.action; const instant = item.completedAt ?? item.archivedAt; return <article className="action-card" key={item.id} data-action-id={item.id} aria-labelledby={`action-${item.id}`}>
      {chosen[item.id] !== undefined && <Link className="action-week-badge" href={`/calendar?week=${week}`}>{week === currentWeek ? "This week" : `Week of ${week}`} · {estimate(chosen[item.id])} →</Link>}<span className="state-caption">{item.state === "open" ? "Executable work" : item.state === "completed" ? "Completed" : "Archived"}</span><h3 id={`action-${item.id}`}>{item.title}</h3>
      <p className="action-context">{view.milestone ? `Milestone: ${view.milestone.title} · ${view.milestone.state}` : "Goal-level action · no milestone"}</p>
      {item.doneWhen && <><p className="outcome-label">Done when</p><p className="goal-outcome">{item.doneWhen}</p></>}
      {item.estimateMinutes !== null && <p className="action-estimate">Effort estimate: <strong>{estimate(item.estimateMinutes)}</strong></p>}
      {instant && <p className="action-timestamp">{item.state === "completed" ? "Completed" : "Archived"} <time dateTime={instant}>{new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: timezone }).format(new Date(instant))}</time></p>}
      {!view.mutability.editable && item.state === "open" && <p className="historical-notice">{view.mutability.message}</p>}
      {view.mutability.editable && onAddToWeek && chosen[item.id] !== undefined && <button className="quiet-button choose-action" onClick={e => onAddToWeek(view, e.currentTarget)}>Choose another week</button>}
      {view.mutability.editable && onAddToWeek && chosen[item.id] === undefined && <button className="primary-button choose-action" onClick={e => onAddToWeek(view, e.currentTarget)}>Add to this week →</button>}
      {view.mutability.editable && <div className="goal-actions"><button className="quiet-button" aria-label={`Edit action ${item.title}`} onClick={(e) => open({ kind: "edit", view }, e.currentTarget)}>Edit</button><div><button className="quiet-button" aria-label={`Complete action ${item.title}`} onClick={(e) => open({ kind: "complete", view }, e.currentTarget)}>Complete</button><button className="text-button" aria-label={`Archive action ${item.title}`} onClick={(e) => open({ kind: "archive", view }, e.currentTarget)}>Archive</button></div></div>}
    </article>; })}</div>}
    {dialog && <ActionDialog state={dialog} catalog={catalog} onClose={close} onSaved={saved} onRefresh={refresh} />}
  </section>;
}
function ActionDialog({ state, catalog, onClose, onSaved, onRefresh }: { state: DialogState; catalog: ActionCatalog; onClose: () => void; onSaved: (kind: Kind) => Promise<void>; onRefresh: () => Promise<void> }) {
  const dialog = useRef<HTMLDialogElement>(null); const command = useRef<object | null>(null); const inFlight = useRef(false);
  const [base, setBase] = useState(state.view); const [title, setTitle] = useState(base?.action.title ?? ""); const [doneWhen, setDoneWhen] = useState(base?.action.doneWhen ?? ""); const [minutes, setMinutes] = useState(base?.action.estimateMinutes?.toString() ?? ""); const [milestoneId, setMilestoneId] = useState(base?.action.milestoneId ?? "");
  const [error, setError] = useState<CommandError<Action> | null>(null); const [pending, setPending] = useState(false); const [reviewed, setReviewed] = useState(false);
  const conflict = error?.code === "CONFLICT"; const uncertain = Boolean(error && ["UNCERTAIN", "DATABASE_UNAVAILABLE", "INTERNAL"].includes(error.code)); const locked = pending || uncertain;
  const blocked = !catalog.canCreate || Boolean(base && !base.mutability.editable); const fields = state.kind === "create" || state.kind === "edit";
  useEffect(() => { const element = dialog.current!; element.showModal(); element.querySelector<HTMLElement>("[data-initial-focus]")?.focus(); return () => element.close(); }, []);
  function changed(apply: () => void) { apply(); command.current = null; setError((prev) => prev?.code === "CONFLICT" ? prev : null); }
  async function submit(event: FormEvent) {
    event.preventDefault(); if (inFlight.current || conflict || (blocked && !uncertain)) return;
    if (!command.current) {
      const parsed = fields ? actionFieldsSchema.safeParse({ title, doneWhen, estimateMinutes: minutes.trim() ? Number(minutes) : null, milestoneId: milestoneId || null }) : null;
      if (parsed && !parsed.success) { const problems: Record<string, string> = {}; for (const issue of parsed.error.issues) problems[String(issue.path[0])] ??= issue.message; setError({ code: "VALIDATION", message: "Check the highlighted fields.", fields: problems }); return; }
      command.current = { mutationId: crypto.randomUUID(), ...(base ? { expectedVersion: base.action.version } : {}), ...(parsed?.success ? parsed.data : {}) };
    }
    inFlight.current = true; setPending(true);
    try { const url = state.kind === "create" ? `/api/goals/${goalGroupKey(catalog.goal)}/actions` : `/api/actions/${base!.action.id}${state.kind === "edit" ? "" : `/${state.kind}`}`;
      await request(url, { method: state.kind === "edit" ? "PATCH" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(command.current) }); await onSaved(state.kind);
    } catch (failure) { const info = errorInfo<Action>(failure); setError(info); if (["GOAL_ARCHIVED", "MILESTONE_TERMINAL"].includes(info.kind ?? "") || info.fields?.milestoneId || info.code === "NOT_FOUND") void onRefresh(); if (["VALIDATION", "CONFLICT", "NOT_FOUND", "FORBIDDEN", "UNAUTHENTICATED"].includes(info.code)) command.current = null; }
    finally { inFlight.current = false; setPending(false); }
  }
  async function review() {
    setPending(true);
    try { const latest = await request<ActionView>(`/api/actions/${base!.action.id}`); setBase(latest); command.current = null; await onRefresh();
      if (!latest.mutability.editable) setError({ code: "CONFLICT", kind: latest.mutability.kind!, message: `${latest.mutability.message} Your draft is kept.`, current: latest.action });
      else { setError(null); setReviewed(true); }
    } catch { setError({ code: "CONFLICT", kind: "VERSION", message: "The latest version could not be loaded. Your draft is kept. Retry reviewing before saving." }); }
    finally { setPending(false); }
  }
  const heading = state.kind === "create" ? "Add an action" : state.kind === "edit" ? "Edit action" : state.kind === "complete" ? "Complete this action?" : "Archive this action?";
  const unavailableSelection = milestoneId && !catalog.assignableMilestones.some((m) => m.id === milestoneId);
  return <dialog ref={dialog} className="goal-dialog" aria-labelledby="action-dialog-title" onCancel={(event) => { event.preventDefault(); if (!locked) onClose(); }}><form onSubmit={submit} noValidate>
    <p className="eyebrow">Concrete work for your goal</p><h2 id="action-dialog-title">{heading}</h2><p className="action-context">Goal: {goalTitle(catalog.goal)}</p>
    {fields ? <><p className="muted">Name something you can do. Add detail only if it helps.</p>
      <label htmlFor="action-title">Title</label><input id="action-title" data-initial-focus disabled={locked} value={title} onChange={(e) => changed(() => setTitle(e.target.value))} aria-invalid={Boolean(error?.fields?.title)} aria-describedby="action-title-error" placeholder="Draft the weekly planning wireframe" /><p id="action-title-error" className="error-message">{error?.fields?.title}</p>
      <label htmlFor="action-done">Done when (optional)</label><textarea id="action-done" rows={3} disabled={locked} value={doneWhen} onChange={(e) => changed(() => setDoneWhen(e.target.value))} aria-invalid={Boolean(error?.fields?.doneWhen)} aria-describedby="action-done-help action-done-error" placeholder="The main planning flow is ready to walk through with one user." /><p className="field-help" id="action-done-help">A clear finish line, if the title alone isn’t enough.</p><p id="action-done-error" className="error-message">{error?.fields?.doneWhen}</p>
      <label htmlFor="action-estimate">Effort estimate in minutes (optional)</label><input id="action-estimate" inputMode="numeric" disabled={locked} value={minutes} onChange={(e) => changed(() => setMinutes(e.target.value))} aria-invalid={Boolean(error?.fields?.estimateMinutes)} aria-describedby="action-estimate-help action-estimate-error" placeholder="45" /><p className="field-help" id="action-estimate-help">Your current estimate of effort, rather than a time commitment.</p><p id="action-estimate-error" className="error-message">{error?.fields?.estimateMinutes}</p>
      <label htmlFor="action-milestone">Milestone (optional)</label><select id="action-milestone" disabled={locked} value={milestoneId} onChange={(e) => changed(() => setMilestoneId(e.target.value))} aria-invalid={Boolean(error?.fields?.milestoneId)} aria-describedby="action-milestone-error"><option value="">Goal-level action · no milestone</option>{unavailableSelection && <option value={milestoneId} disabled>Previous milestone is unavailable for assignment</option>}{catalog.assignableMilestones.map((m) => <option key={m.id} value={m.id}>{m.title}</option>)}</select><p id="action-milestone-error" className="error-message">{error?.fields?.milestoneId}</p>
    </> : <><h3>{base?.action.title}</h3>{base?.action.doneWhen && <><p className="outcome-label">Done when</p><p className="goal-outcome">{base.action.doneWhen}</p></>}{state.kind === "complete" ? <p className="muted">Confirm that this piece of work is done. Its definition and effort estimate will be kept.</p> : <p className="muted">Archive means this action is no longer relevant. Its history is retained, and there is no restore action.</p>}</>}
    {blocked && !uncertain && !conflict && <p className="historical-notice" role="status">{base?.mutability.message ?? "This goal is archived. Your draft is kept but cannot be saved."}</p>}
    {reviewed && <div className="reviewed-state" role="status"><p>Latest saved version reviewed. Your draft is kept; compare it before confirming.</p><strong>{base?.action.title}</strong><p>{base?.action.doneWhen}</p><p>Estimate: {base?.action.estimateMinutes ?? "not set"} minutes · Milestone: {base?.milestone?.title ?? "none"}</p></div>}
    {error && <div className="dialog-error" role="alert"><p>{error.message}</p>{error.current && <div className="latest-goal"><p className="outcome-label">Latest saved version · {error.current.state}</p><strong>{error.current.title}</strong><p>{error.current.doneWhen}</p><p>Effort estimate: {error.current.estimateMinutes ?? "not set"} minutes</p></div>}{conflict && !["GOAL_ARCHIVED", "MILESTONE_TERMINAL", "TERMINAL", "MUTATION_ID"].includes(error.kind ?? "") && <button type="button" className="quiet-button" disabled={pending} onClick={() => void review()}>Review latest saved version</button>}{error.code === "UNAUTHENTICATED" && <a href="/sign-in">Sign in again</a>}</div>}
    <div className="dialog-actions"><button type="button" className="quiet-button" data-initial-focus={!fields ? true : undefined} disabled={locked} onClick={onClose}>{conflict ? "Close without saving" : "Cancel"}</button><button className="primary-button" disabled={pending || Boolean(conflict) || (blocked && !uncertain) || ["NOT_FOUND", "UNAUTHENTICATED"].includes(error?.code ?? "")}>{pending ? "Saving…" : uncertain ? "Retry same change" : state.kind === "complete" ? "Confirm action completion" : state.kind === "archive" ? "Archive action" : "Save action"}</button></div>
  </form></dialog>;
}
