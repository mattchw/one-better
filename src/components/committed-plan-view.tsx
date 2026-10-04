"use client";
import { useEffect, useRef, useState } from "react";
import { amendSchema, effectivePlan, planDifference, type AmendmentHistory, type EffectivePlan } from "@/modules/amendments/domain";
import type { PlanningSnapshot, PlanningSource, SourceGuard, WeeklyPlan } from "@/modules/planning/domain";
import { errorInfo, request, type CommandError } from "./mutation-client";
import { FocusAvailabilityPanel } from "./focus-availability";
import { TimeBlocksView } from "./time-blocks-view";
import { Capacity, Context, duration } from "./planning-presentation";
type Choice = { actionId: string; budget: string; context: PlanningSnapshot; source?: SourceGuard };
const choices = (plan: EffectivePlan): Choice[] => plan.commitments.map(c => ({ actionId: c.actionId, budget: String(c.budgetMinutes), context: structuredClone(c.snapshot) }));
function Snapshot({ plan, calendarWeek }: { plan: EffectivePlan; calendarWeek?: string }) {
  return <><Capacity capacity={plan.provisionalCapacityMinutes} reserve={plan.reserveMinutes} budgets={plan.commitments.map(c => c.budgetMinutes)} />{calendarWeek && <FocusAvailabilityPanel week={calendarWeek} manualCapacity={plan.provisionalCapacityMinutes} />}<div className="commitment-list">{plan.commitments.map(c => <article className="commitment-card" data-commitment-id={c.id} key={c.actionId}><p className="commitment-budget">{duration(c.budgetMinutes)} this week</p><Context value={c.snapshot} /></article>)}</div>{!plan.commitments.length && <p className="historical-notice">No focus work committed. Making room for reality is a legitimate plan.</p>}</>;
}
function SnapshotDetails({ label, plan, original = false }: { label: string; plan: EffectivePlan; original?: boolean }) {
  const [open, setOpen] = useState(false);
  return <details data-original-plan={original || undefined} onToggle={e => setOpen(e.currentTarget.open)}><summary>{label}</summary>{open && <Snapshot plan={plan} />}</details>;
}
function Difference({ previous, next }: { previous: EffectivePlan; next: EffectivePlan }) {
  const diff = planDifference(previous, next);
  return <div className="amendment-difference"><h3>Changes</h3><ul>{diff.capacity && <li>Capacity: {duration(diff.capacity.previous)} → {duration(diff.capacity.next)}</li>}{diff.reserve && <li>Reserve: {duration(diff.reserve.previous)} → {duration(diff.reserve.next)}</li>}{diff.dropped.map(c => <li key={`drop-${c.actionId}`}>Dropped: {c.snapshot.action.title} · {duration(c.budgetMinutes)}</li>)}{diff.budgets.map(c => <li key={`budget-${c.actionId}`}>Budget: {c.title} · {duration(c.previous)} → {duration(c.next)}</li>)}{diff.added.map(c => <li key={`add-${c.actionId}`}>Added: {c.snapshot.action.title} · {duration(c.budgetMinutes)}</li>)}</ul>{!diff.changed && <p>No planning changes yet. A reason alone does not create an amendment.</p>}<p>Committed total: {duration(diff.previousSummary.totalMinutes)} → {duration(diff.nextSummary.totalMinutes)}</p><p>Uncommitted: {duration(diff.previousSummary.remainingMinutes)} → {duration(diff.nextSummary.remainingMinutes)}</p></div>;
}
function Confirmation({ previous, next, reason, onCancel, onConfirm }: { previous: EffectivePlan; next: EffectivePlan; reason: string; onCancel: () => void; onConfirm: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null); const cancel = useRef<HTMLButtonElement>(null);
  useEffect(() => { dialog.current?.showModal(); cancel.current?.focus(); }, []);
  return <dialog ref={dialog} className="goal-dialog plan-review" aria-labelledby="amendment-confirm-title" onCancel={onCancel}><p className="eyebrow">Planning may change. History stays.</p><h2 id="amendment-confirm-title">Review amendment</h2><p className="amendment-reason">Reason: {reason}</p><Difference previous={previous} next={next} /><p className="small-note">Confirmation appends one complete snapshot. Your original commitment and earlier amendments stay intact.</p><div className="dialog-actions"><button ref={cancel} className="quiet-button" onClick={onCancel}>Keep adjusting</button><button className="primary-button" onClick={onConfirm}>Confirm amendment</button></div></dialog>;
}
export function CommittedPlanView({ plan, initialHistory, onEditing }: { plan: WeeklyPlan; initialHistory?: AmendmentHistory; onEditing: (open: boolean) => void }) {
  const [schedulingEditing, setSchedulingEditing] = useState(false);
  const [history, setHistory] = useState(initialHistory); const [error, setError] = useState<CommandError | null>(null); const [busy, setBusy] = useState(false); const [editor, setEditor] = useState(false); const [stale, setStale] = useState(false); const [review, setReview] = useState(false);
  const [capacity, setCapacity] = useState(""); const [reserve, setReserve] = useState(""); const [selected, setSelected] = useState<Choice[]>([]); const [reason, setReason] = useState(""); const [candidates, setCandidates] = useState<PlanningSource[]>([]); const [notice, setNotice] = useState("");
  const [pending, setPending] = useState<object | null>(null); const trigger = useRef<HTMLButtonElement>(null); const first = useRef<HTMLInputElement>(null); const wasEditing = useRef(false);
  const url = `/api/weekly-plans/${plan.id}/amendments`;
  useEffect(() => { if (initialHistory) return; let active = true; request<AmendmentHistory>(url).then(value => { if (active) setHistory(value); }).catch(failure => { if (active) setError(errorInfo(failure)); }); return () => { active = false; }; }, [initialHistory, url]);
  useEffect(() => { onEditing(editor || !!pending || schedulingEditing); return () => onEditing(false); }, [editor, pending, onEditing, schedulingEditing]);
  useEffect(() => { if (!editor) { if (wasEditing.current) trigger.current?.focus(); wasEditing.current = false; return; } wasEditing.current = true; first.current?.focus(); const guard = (event: BeforeUnloadEvent) => event.preventDefault(); window.addEventListener("beforeunload", guard); return () => window.removeEventListener("beforeunload", guard); }, [editor]);
  const locked = busy || !!pending;
  const cap = Number(capacity), res = Number(reserve);
  const numeric = /^\d+$/.test(capacity) && /^\d+$/.test(reserve) && selected.every(c => /^\d+$/.test(c.budget));
  const next: EffectivePlan = { provisionalCapacityMinutes: cap, reserveMinutes: res, commitments: selected.map(c => ({ id: c.actionId, actionId: c.actionId, budgetMinutes: Number(c.budget), source: c.source ?? history?.effective.commitments.find(p => p.actionId === c.actionId)?.source as SourceGuard, snapshot: c.context })) };
  const input = { expectedVersion: history?.baseline.version, provisionalCapacityMinutes: cap, reserveMinutes: res, reason, commitments: selected.map(c => ({ actionId: c.actionId, budgetMinutes: Number(c.budget), ...(c.source ? { source: c.source } : {}) })) };
  const valid = numeric && amendSchema.safeParse({ ...input, mutationId: "00000000-0000-4000-8000-000000000001" }).success && !!history && history.canAmend && planDifference(history.effective, next).changed && planDifference(history.effective, next).nextSummary.remainingMinutes >= 0 && !stale && !locked;
  async function load() { setBusy(true); setError(null); try {
    const latest = await request<AmendmentHistory>(url);
    if (editor && history && latest.baseline.version !== history.baseline.version) {
      setStale(true); setError({ code: "CONFLICT", kind: "EFFECTIVE_VERSION", message: "The Current Plan changed elsewhere. Review it and start again before confirming." });
    } else setHistory(latest);
  } catch (e) { setError(errorInfo(e)); } finally { setBusy(false); } }
  async function pool() { const value = await request<{ candidates: PlanningSource[] }>("/api/weekly-plans/candidates"); setCandidates(value.candidates); }
  async function begin(reset = false) {
    setBusy(true); setError(null);
    try {
      const latest = await request<AmendmentHistory>(url); await pool(); setHistory(latest);
      if (!latest.canAmend) { setError({ code: "CONFLICT", message: "This week has finished and is read-only." }); return; }
      setCapacity(String(latest.effective.provisionalCapacityMinutes)); setReserve(String(latest.effective.reserveMinutes)); setSelected(choices(latest.effective)); setReason(""); setStale(false); setEditor(true); setNotice(reset ? "Started again from the latest Current Plan. Reapply your changes deliberately." : "");
    } catch (e) { setError(errorInfo(e)); } finally { setBusy(false); }
  }
  function close() { setEditor(false); setReview(false); setError(null); setNotice("Amendment cancelled. Your saved plan is unchanged."); trigger.current?.focus(); }
  async function confirm(command: object) {
    setPending(command); setBusy(true); setReview(false); setError(null);
    try {
      await request(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(command) });
      // Original receipt replay is followed by a fresh read of current truth.
      setHistory(await request<AmendmentHistory>(url)); setPending(null); setEditor(false); setStale(false); setNotice("Amendment confirmed. Current Plan updated; original history preserved."); trigger.current?.focus();
    } catch (e) {
      const info = errorInfo(e); setError(info);
      if (info.kind === "EFFECTIVE_VERSION") setStale(true);
      if (info.code !== "UNCERTAIN" && info.code !== "DATABASE_UNAVAILABLE") setPending(null);
    } finally { setBusy(false); }
  }
  const stamp = (instant: string) => new Intl.DateTimeFormat("en-GB", { timeZone: plan.timezone, dateStyle: "long", timeStyle: "short" }).format(new Date(instant));
  return <section className="committed-plan">
    {notice && <p role="status" className="plan-notice">{notice}</p>}
    {error && <div role="alert" className="dialog-error"><p>{error.message}</p>{error.fields && <ul>{Object.values(error.fields).map((v,i) => <li key={i}>{v}</li>)}</ul>}{pending ? <button className="quiet-button" disabled={busy} onClick={() => void confirm(pending)}>Retry same command</button> : stale ? <><p>Your unsaved proposal is retained below. It cannot overwrite the newer plan. Starting again discards it and copies the latest Current Plan.</p><button className="quiet-button" disabled={busy} onClick={() => void begin(true)}>Review latest Current Plan and start again</button></> : <button className="quiet-button" disabled={busy} onClick={() => void load()}>Retry loading saved plan</button>}</div>}
    {!history ? <p>Loading your Current Plan…</p> : <>
      <div className="planning-section-heading"><div><p className="eyebrow">Current Plan</p><h2>{history.amendments.length ? `Committed · ${history.amendments.length} amendment${history.amendments.length === 1 ? "" : "s"}` : "Your original commitments"}</h2></div>{history.canAmend && !editor && <button ref={trigger} className="primary-button" disabled={busy || schedulingEditing} onClick={() => void begin()}>Amend plan</button>}</div>
      {!history.canAmend && <p className="historical-notice">This week has finished. Its Current Plan and original commitment remain read-only.</p>}
      {!editor ? <><Capacity capacity={history.effective.provisionalCapacityMinutes} reserve={history.effective.reserveMinutes} budgets={history.effective.commitments.map(c => c.budgetMinutes)} />{history.canAmend && <FocusAvailabilityPanel week={plan.weekStartDate} manualCapacity={history.effective.provisionalCapacityMinutes} />}<TimeBlocksView planId={plan.id} version={history.baseline.version} onEditing={setSchedulingEditing} /></> : <div className="amendment-editor">
        <h2>Amend weekly plan</h2><p>Start with your Current Plan. Change only what reality calls for; historical context stays preserved.</p>
        <div className="planning-capacity"><div><label htmlFor="amend-capacity">Revised weekly focus capacity in minutes</label><input ref={first} id="amend-capacity" type="number" min="0" max="10080" step="1" value={capacity} disabled={locked} onChange={e => setCapacity(e.target.value)} /><label htmlFor="amend-reserve">Revised protected reserve in minutes</label><input id="amend-reserve" type="number" min="0" max="10079" step="1" value={reserve} disabled={locked} onChange={e => setReserve(e.target.value)} /><p className="small-note">Zero capacity is valid with zero reserve and no commitments.</p></div>{numeric && cap >= 0 && res >= 0 && <Capacity capacity={cap} reserve={res} budgets={selected.map(c => Number(c.budget) || 0)} />}</div>
        <FocusAvailabilityPanel week={plan.weekStartDate} manualCapacity={numeric ? cap : undefined} />
        <div className="commitment-list">{selected.map(c => <article className="commitment-card" data-amend-action={c.actionId} key={c.actionId}><Context value={c.context} /><div className="budget-editor"><label htmlFor={`amend-budget-${c.actionId}`}>Revised budget in minutes</label><input id={`amend-budget-${c.actionId}`} type="number" min="1" max="10080" step="1" value={c.budget} disabled={locked} onChange={e => setSelected(selected.map(s => s.actionId === c.actionId ? { ...s, budget: e.target.value } : s))} /><button className="text-button" disabled={locked} onClick={() => setSelected(selected.filter(s => s.actionId !== c.actionId))}>Drop commitment</button></div></article>)}</div>
        <div className="planning-section-heading"><h3>Add eligible work only when needed</h3><button className="quiet-button" disabled={locked} onClick={() => { setBusy(true); pool().catch(e => setError(errorInfo(e))).finally(() => setBusy(false)); }}>Refresh eligible Actions</button></div><div className="candidate-list">{candidates.filter(c => !selected.some(s => s.actionId === c.actionId)).map(c => <article className="candidate-card" data-amend-candidate={c.actionId} key={c.actionId}><Context value={c.context} /><button className="quiet-button" disabled={locked || selected.length >= 50} onClick={() => {
          const carried = history.effective.commitments.find(p => p.actionId === c.actionId);
          setSelected([...selected, carried ? { actionId: c.actionId, budget: String(carried.budgetMinutes), context: carried.snapshot } : { actionId: c.actionId, budget: "", context: c.context, source: c.source }]);
        }}>Add to revised plan</button></article>)}</div>
        <label className="amendment-reason-label" htmlFor="amend-reason">Reason for this amendment</label><textarea id="amend-reason" rows={3} value={reason} disabled={locked} onChange={e => setReason(e.target.value)} aria-describedby="amend-reason-help" /><p id="amend-reason-help" className="small-note">A short explanation for your future review. Required · up to 500 characters.</p>
        {numeric && selected.every(c => Number(c.budget) > 0) && <Difference previous={history.effective} next={next} />}
        <div className="planning-save"><button className="quiet-button" disabled={locked} onClick={close}>Cancel amendment</button><button className="primary-button" disabled={!valid} onClick={() => setReview(true)}>Review amendment</button></div><p className="small-note">Nothing saves until you confirm. Use whole minutes, a reason and a real planning change within capacity.</p>
      </div>}
      <div className="plan-history"><h2>Plan history</h2><SnapshotDetails original label={`Original Plan · ${stamp(history.baseline.committedAt!)}`} plan={effectivePlan(history.baseline, [])} />{history.amendments.map((amendment, index) => <article className="amendment-history-entry" data-amendment-sequence={amendment.sequenceNumber} key={amendment.id}><h3>Amendment {amendment.sequenceNumber}</h3><p className="small-note">{stamp(amendment.createdAt)}</p><p className="amendment-reason">{amendment.reason}</p><Difference previous={index ? history.amendments[index-1] : effectivePlan(history.baseline, [])} next={amendment} /><SnapshotDetails label="Inspect full snapshot" plan={amendment} /></article>)}</div>
      {review && <Confirmation previous={history.effective} next={next} reason={reason.trim()} onCancel={() => setReview(false)} onConfirm={() => void confirm({ ...input, mutationId: crypto.randomUUID() })} />}
    </>}
  </section>;
}
