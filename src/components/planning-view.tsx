"use client";
import {FocusCycleContext} from "./focus-cycle-context";
import type {CycleWorkspace} from "@/modules/focus-cycles/domain";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { CarryForwardPanel } from "./carry-forward-panel";
import type { CarryIntent } from "@/modules/weekly-reviews/domain";
import { FocusAvailabilityPanel } from "./focus-availability";
import { Capacity, Context, duration } from "./planning-presentation";
import { CommittedPlanView } from "./committed-plan-view";
import type { AmendmentHistory } from "@/modules/amendments/domain";
import { addDays, calendarDate, mondayOf, sourceIssues, type PlanningSnapshot, type PlanningSource, type PlanningView as PlanView, type SourceGuard, type SourceIssue, type WeeklyPlan, type WeekWorkspace } from "@/modules/planning/domain";
import { errorInfo, request, type CommandError } from "./mutation-client";
const weekLabel = (week: string) => new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", day: "numeric", month: "long", year: "numeric" }).format(new Date(`${week}T00:00:00Z`));
type DraftSelection = { actionId: string; source: SourceGuard; budget: string; context: PlanningSnapshot | null };
type PlanError = CommandError<WeeklyPlan> & { issues?: SourceIssue[] };
type Pending = { url: string; method: "POST" | "PATCH"; input: object; label: string };
function Review({ plan, sources, onCancel, onCommit }: { plan: WeeklyPlan; sources: PlanningSource[]; onCancel: () => void; onCommit: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null); const cancel = useRef<HTMLButtonElement>(null);
  useEffect(() => { dialog.current?.showModal(); cancel.current?.focus(); }, []);
  return <dialog ref={dialog} className="goal-dialog plan-review" aria-labelledby="plan-review-title" onCancel={onCancel}><p className="eyebrow">Establish your original baseline</p><h2 id="plan-review-title">Review week of {weekLabel(plan.weekStartDate)}</h2><p>This is what I intend to move forward this week.</p><Capacity capacity={plan.provisionalCapacityMinutes} reserve={plan.reserveMinutes} budgets={plan.commitments.map((c) => c.budgetMinutes)} />{plan.commitments.map((c) => <div className="review-commitment" key={c.id}><strong>{duration(c.budgetMinutes)} this week</strong><Context value={sources.find((s) => s.actionId === c.actionId)!.context} /></div>)}<p className="small-note">Committing preserves capacity, reserve, budgets and this context as an immutable baseline. Later changes create immutable amendments.</p><div className="dialog-actions"><button ref={cancel} className="quiet-button" onClick={onCancel}>Keep drafting</button><button className="primary-button" onClick={onCommit}>Commit this week</button></div></dialog>;
}
export function PlanningView({ initialWorkspace, initialCandidates, initialHistory, initialCarries = [], initialCycles }: { initialCycles?:CycleWorkspace; initialCarries?: CarryIntent[]; initialWorkspace: WeekWorkspace; initialCandidates: PlanningSource[]; initialHistory?: AmendmentHistory }) {
  const [cycles,setCycles]=useState(initialCycles);
  const [amendmentOpen, setAmendmentOpen] = useState(false);
  const [workspace, setWorkspace] = useState(initialWorkspace); const [candidates, setCandidates] = useState(initialCandidates);
  const plan = workspace.view?.plan ?? null;
  const selectionsFrom = (view: PlanView | null): DraftSelection[] => view?.plan.commitments.map((c) => ({ actionId: c.actionId, source: c.source, budget: String(c.budgetMinutes), context: c.snapshot ?? view.sources.find((s) => s.actionId === c.actionId)?.context ?? null })) ?? [];
  const [capacity, setCapacity] = useState(plan ? String(plan.provisionalCapacityMinutes) : ""); const [reserve, setReserve] = useState(plan ? String(plan.reserveMinutes) : "");
  const [selected, setSelected] = useState<DraftSelection[]>(selectionsFrom(workspace.view)); const [dirty, setDirty] = useState(false);
  const [error, setError] = useState<PlanError | null>(null); const [notice, setNotice] = useState(""); const [busy, setBusy] = useState(false); const [pending, setPending] = useState<Pending | null>(null);
  const [review, setReview] = useState(false); const [picked, setPicked] = useState(workspace.weekStartDate);
  const [latestSource, setLatestSource] = useState<PlanningSource | null>(null); const [sourceRead, setSourceRead] = useState<PlanningSource[]>(workspace.view?.sources ?? []);
  const locked = busy || !!pending; const committed = plan?.state === "committed";
  const issues = sourceIssues(selected, [...sourceRead.filter((s) => selected.some((c) => c.actionId === s.actionId)), ...candidates.filter((s) => !sourceRead.some((v) => v.actionId === s.actionId))]);
  const cap = Number(capacity), res = Number(reserve); const numbersValid = /^\d+$/.test(capacity) && cap > 0 && cap <= 10080 && /^\d+$/.test(reserve) && res >= 0 && res < cap;
  const budgetsValid = selected.every((c) => /^\d+$/.test(c.budget) && Number(c.budget) > 0 && Number(c.budget) <= 10080);
  const remaining = cap - res - selected.reduce((sum, c) => sum + (Number(c.budget) || 0), 0);
  const canReview = !!plan && !committed && !dirty && numbersValid && budgetsValid && selected.length > 0 && remaining >= 0 && !issues.length && !locked;
  const sequence = useRef(0);
  useEffect(() => { if (!dirty && !pending) return; const guard = (event: BeforeUnloadEvent) => { event.preventDefault(); }; window.addEventListener("beforeunload", guard); return () => window.removeEventListener("beforeunload", guard); }, [dirty, pending]);
  function changed() { setDirty(true); setNotice(""); setError(null); setLatestSource(null); }
  function applyWorkspace(next: WeekWorkspace, pool: PlanningSource[]) {
    setWorkspace(next); setCandidates(pool); setSourceRead(next.view?.sources ?? []); setCapacity(next.view ? String(next.view.plan.provisionalCapacityMinutes) : ""); setReserve(next.view ? String(next.view.plan.reserveMinutes) : ""); setSelected(selectionsFrom(next.view)); setDirty(false); setLatestSource(null);
  }
  async function readLatest() { setCycles(await request<CycleWorkspace>("/api/focus-cycles")); const [next, pool] = await Promise.all([request<WeekWorkspace>(`/api/weekly-plans?week=${workspace.weekStartDate}`), request<{ candidates: PlanningSource[] }>("/api/weekly-plans/candidates")]); return { next, pool: pool.candidates }; }
  async function execute(command: Pending) {
    setPending(command); setBusy(true); setError(null); setReview(false); const serial = ++sequence.current;
    try {
      await request<{ plan: WeeklyPlan }>(command.url, { method: command.method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(command.input) });
      // Receipt replay returns its original snapshot. Read current state before rendering controls.
      const { next, pool } = await readLatest(); if (serial !== sequence.current) return;
      applyWorkspace(next, pool); setPending(null); setNotice(command.label);
    } catch (failure) {
      if (serial !== sequence.current) return; const info = errorInfo<WeeklyPlan>(failure) as PlanError; setError(info);
      if (info.code !== "UNCERTAIN" && info.code !== "DATABASE_UNAVAILABLE") setPending(null);
    } finally { if (serial === sequence.current) setBusy(false); }
  }
  async function refresh(mode: "discard" | "version" | "source", actionId?: string) {
    setBusy(true); setError(null); const serial = ++sequence.current;
    try {
      const { next, pool } = await readLatest(); if (serial !== sequence.current) return;
      if (mode === "discard") applyWorkspace(next, pool);
      else if (mode === "version") { setWorkspace(next); setCandidates(pool); setSourceRead(next.view?.sources ?? []); setDirty(true); setNotice(next.view?.plan.state === "committed" ? "The saved plan is already committed. Your unsaved choices are retained below for reference." : "Latest saved version reviewed. Your unsaved capacity, reserve and choices are retained; save deliberately to replace that draft."); }
      else { setCandidates(pool); setSourceRead(next.view?.sources ?? []); const value = pool.find((s) => s.actionId === actionId) ?? next.view?.sources.find((s) => s.actionId === actionId); setLatestSource(value?.eligible ? value : null); setNotice(!actionId ? "Eligible Actions refreshed. Your selections remain unchanged." : value?.eligible ? "Review the latest source below before accepting it into your draft." : "This source is no longer eligible. Remove its commitment before saving or committing."); }
    } catch (failure) { if (serial === sequence.current) setError(errorInfo<WeeklyPlan>(failure)); }
    finally { if (serial === sequence.current) setBusy(false); }
  }
  function save() {
    if (!numbersValid || !budgetsValid) { setError({ code: "VALIDATION", message: "Use whole minutes: capacity 1–10,080, reserve 0–capacity minus 1, and each budget 1–10,080." }); return; }
    void execute(plan ? { url: `/api/weekly-plans/${plan.id}`, method: "PATCH", input: { mutationId: crypto.randomUUID(), expectedVersion: plan.version, provisionalCapacityMinutes: cap, reserveMinutes: res, commitments: selected.map((c) => ({ actionId: c.actionId, budgetMinutes: Number(c.budget), source: c.source })) }, label: remaining < 0 ? "Draft saved. Resolve over-capacity before committing." : "Draft saved. Leaving breathing room is a deliberate choice." } : { url: "/api/weekly-plans", method: "POST", input: { mutationId: crypto.randomUUID(), weekStartDate: workspace.weekStartDate, provisionalCapacityMinutes: cap, reserveMinutes: res }, label: "Draft created. Choose a small amount of meaningful work." });
  }
  async function applyCarry(intent: CarryIntent, budgetMinutes: number) {
    if (!plan || plan.state !== "draft" || locked || dirty) return;
    setBusy(true);setError(null);
    try {
      const pool = await request<{ candidates: PlanningSource[] }>("/api/weekly-plans/candidates");
      const source = pool.candidates.find(s => s.actionId === intent.actionId);
      if (!source) { setError({code:"CONFLICT",message:"This Action changed after the review and is no longer available for planning."});setBusy(false);return; }
      await execute({url:`/api/weekly-plans/${plan.id}`,method:"PATCH",input:{mutationId:crypto.randomUUID(),expectedVersion:plan.version,provisionalCapacityMinutes:plan.provisionalCapacityMinutes,reserveMinutes:plan.reserveMinutes,carry:{reviewId:intent.reviewId,commitmentId:intent.commitmentId},commitments:[...plan.commitments.map(c=>({actionId:c.actionId,budgetMinutes:c.budgetMinutes,source:c.source})),{actionId:intent.actionId,budgetMinutes,source:source.source}]},label:"Carried Action added to this week's saved Draft. Its review proposal remains unchanged."});
    } catch(failure) {setError(errorInfo<WeeklyPlan>(failure));setBusy(false);}
  }
  function navigation(week: string, label: string) { return locked || dirty || amendmentOpen ? <span className="week-disabled" aria-disabled="true">{label}</span> : <Link className="quiet-button" href={`/planning?week=${week}`}>{label}</Link>; }
  const selectedIds = new Set(selected.map((c) => c.actionId));
  return <section className="planning-workspace">
    <p className="eyebrow">Possible work → deliberate commitments</p><h1>Make room for what matters.</h1><p className="planning-intro">Choose a little work that moves your Goals forward. Protect reserve before deciding what fits.</p>
    <FocusCycleContext workspace={cycles} locked={locked||dirty||amendmentOpen}/><nav className="week-navigation" aria-label="Planning weeks">{navigation(addDays(workspace.weekStartDate, -7), "← Previous week")}{navigation(workspace.currentWeekStartDate, "Current week")}{navigation(addDays(workspace.weekStartDate, 7), "Next week →")}</nav>
    <div className="week-picker"><label htmlFor="planning-week">Choose a week containing</label><input id="planning-week" type="date" min="2000-01-03" max="9999-12-27" value={picked} disabled={locked || dirty || amendmentOpen} onChange={(e) => setPicked(e.target.value)} />{calendarDate(picked) && navigation(mondayOf(picked), "Open week")}</div>
    {dirty && <p className="muted">You have unsaved choices. Save or discard them before changing weeks.</p>}
    <div className="plan-heading"><h2>Week of {weekLabel(workspace.weekStartDate)}</h2><span className={`plan-state ${committed ? "is-committed" : ""}`}>{plan ? plan.state : "Not planned"}</span></div><p className="small-note">Monday–Sunday · {workspace.timezone} · calendar week, not a scheduled timetable</p>
    {notice && <p className="plan-notice" role="status">{notice}</p>}
    {error && <div className="dialog-error" role="alert"><p>{error.message}</p>{error.fields && <ul>{Object.values(error.fields).map((value, i) => <li key={i}>{value}</li>)}</ul>}{error.issues?.map((issue) => <p key={issue.actionId}>{selected.find((s) => s.actionId === issue.actionId)?.context?.action.title ?? "Selected Action"}: {issue.message}</p>)}{pending ? <button className="quiet-button" disabled={busy} onClick={() => void execute(pending)}>Retry same command</button> : error.kind === "VERSION" || error.kind === "COMMITTED" || error.kind === "WEEK_EXISTS" ? <button className="quiet-button" disabled={busy} onClick={() => void refresh(error.kind === "WEEK_EXISTS" ? "discard" : "version")}>Review latest saved plan</button> : <button className="quiet-button" disabled={busy} onClick={() => void refresh("version")}>Refresh saved context</button>}</div>}
    <CarryForwardPanel intents={initialCarries} planState={plan?.state??null} included={selected.map(c=>c.actionId)} locked={locked||dirty} onAdd={(intent,budget)=>void applyCarry(intent,budget)}/>
    {committed && plan ? <>
      <CommittedPlanView key={plan.id} plan={plan} initialHistory={initialHistory?.baseline.id === plan.id ? initialHistory : undefined} onEditing={setAmendmentOpen} />
      {dirty && <details><summary>Retained unsaved choices for reference</summary><p>Capacity {capacity} minutes · reserve {reserve} minutes</p>{selected.map((c) => <p key={c.actionId}>{c.context?.action.title ?? "Unavailable Action"} · {c.budget} minutes</p>)}</details>}
    </> : !plan && !workspace.canCreate ? <><div className="goal-empty"><h3>No saved plan for this week.</h3><p>This week has finished. Open an existing historical plan or choose the current week.</p></div>{workspace.weekStartDate >= workspace.currentWeekStartDate && <FocusAvailabilityPanel week={workspace.weekStartDate} manualCapacity={numbersValid ? cap : undefined} />}</> : <>
      <div className="planning-capacity"><div><h3>1. Set realistic capacity</h3><p className="muted">Your manual estimate of focus-capable effort this week. Leave ordinary life out of this number.</p><label htmlFor="plan-capacity">Weekly focus capacity in minutes</label><input id="plan-capacity" inputMode="numeric" type="number" min="1" max="10080" step="1" disabled={locked} value={capacity} onChange={(e) => { setCapacity(e.target.value); changed(); }} /><h3>2. Protect reserve</h3><p className="muted">Capacity intentionally left for interruptions, fatigue, overruns and thinking.</p><label htmlFor="plan-reserve">Protected reserve in minutes</label><input id="plan-reserve" inputMode="numeric" type="number" min="0" max="10079" step="1" disabled={locked} value={reserve} onChange={(e) => { setReserve(e.target.value); changed(); }} /></div>{numbersValid && <Capacity capacity={cap} reserve={res} budgets={selected.map((c) => Number(c.budget) || 0)} />}</div>
      {workspace.weekStartDate >= workspace.currentWeekStartDate && <FocusAvailabilityPanel week={workspace.weekStartDate} manualCapacity={numbersValid ? cap : undefined} />}
      {!plan ? <button className="primary-button" disabled={locked} onClick={save}>Create weekly draft</button> : <>
        <div className="planning-section-heading"><div><h3>3. Choose what to move forward</h3><p className="muted">Possible work stays possible until you choose it. A small focused plan is enough.</p></div><button className="quiet-button" disabled={locked} onClick={() => void refresh("source")}>Refresh eligible Actions</button></div>
        <h3>Your selected commitments</h3>{!selected.length && <p className="muted">Nothing chosen yet. Add one meaningful Action from the options below.</p>}
        <div className="commitment-list">{selected.map((c) => <article className="commitment-card" data-selected-action={c.actionId} key={c.actionId}>{c.context ? <Context value={c.context} /> : <p>This source Action is unavailable.</p>}<div className="budget-editor"><label htmlFor={`budget-${c.actionId}`}>This week’s budget in minutes</label><input id={`budget-${c.actionId}`} type="number" min="1" max="10080" step="1" inputMode="numeric" value={c.budget} disabled={locked} onChange={(e) => { setSelected(selected.map((s) => s.actionId === c.actionId ? { ...s, budget: e.target.value } : s)); changed(); }} /><button className="text-button" disabled={locked} onClick={() => { setSelected(selected.filter((s) => s.actionId !== c.actionId)); changed(); }}>Remove commitment</button></div>{issues.find((i) => i.actionId === c.actionId) && <div className="dialog-error"><p>{issues.find((i) => i.actionId === c.actionId)!.message}</p><button className="quiet-button" disabled={locked} onClick={() => void refresh("source", c.actionId)}>Review latest source</button></div>}</article>)}</div>
        {latestSource && <div className="source-review"><p className="eyebrow">Latest source · review before accepting</p><Context value={latestSource.context} /><button className="quiet-button" disabled={locked} onClick={() => { setSelected(selected.map((s) => s.actionId === latestSource.actionId ? { ...s, source: latestSource.source, context: latestSource.context } : s)); changed(); }}>Accept reviewed source</button></div>}
        <div className="planning-save"><button className="primary-button" disabled={locked} onClick={save}>Save draft</button><button className="quiet-button" disabled={locked || !dirty} onClick={() => void refresh("discard")}>Discard unsaved choices</button><button className="primary-button" disabled={!canReview} onClick={() => setReview(true)}>Review and commit</button></div>
        <p className="small-note">{dirty ? "Save these choices before reviewing your baseline." : !selected.length ? "Choose at least one commitment before review." : remaining < 0 ? "Resolve over-capacity before review." : issues.length ? "Review changed sources before committing." : "Review the saved plan, then explicitly establish your baseline."}</p>
        <h3 className="planning-section-title">Eligible Actions · choose deliberately</h3><div className="candidate-list">{candidates.filter((c) => !selectedIds.has(c.actionId)).map((c) => <article className="candidate-card" key={c.actionId} data-candidate-action={c.actionId}><Context value={c.context} />{cycles?.current&&<p className="small-note cycle-work-label">{cycles.current.goals.some(g=>g.goalId===c.context?.goal.id&&!g.archivedAt)?"Current Focus Cycle":"Other Goal · available for deliberate planning"}</p>}<button className="quiet-button" disabled={locked || selected.length >= 50} onClick={() => { setSelected([...selected, { actionId: c.actionId, source: c.source, context: c.context, budget: "" }]); changed(); }}>Add to this week</button></article>)}</div>{candidates.filter((c) => !selectedIds.has(c.actionId)).length === 0 && <p className="muted">No other eligible Actions. Create or review Actions in your Goals when needed.</p>}
      </>}
    </>}
    {workspace.savedWeeks.length > 0 && <details className="saved-weeks"><summary>Saved weeks</summary><nav aria-label="Saved plans">{workspace.savedWeeks.map((w) => <div key={w.id}>{navigation(w.weekStartDate, `${weekLabel(w.weekStartDate)} · ${w.state}`)}</div>)}</nav></details>}
    {review && plan && <Review plan={plan} sources={workspace.view!.sources} onCancel={() => setReview(false)} onCommit={() => void execute({ url: `/api/weekly-plans/${plan.id}/commit`, method: "POST", input: { mutationId: crypto.randomUUID(), expectedVersion: plan.version }, label: "Your original baseline is committed and preserved." })} />}
  </section>;
}
