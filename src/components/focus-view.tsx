"use client";
import { goalTitle } from '@/modules/planning/general';
/* Native links preserve transient-note and unconfirmed-command unload guards. */
import { useCallback, useEffect, useRef, useState } from "react";
import { elapsedMinutes } from "@/modules/scheduling/domain";
import { sessionMilliseconds, type FocusDetail, type FocusSession, type FocusWorkspace } from "@/modules/focus/domain";
import { duration } from "./planning-presentation";
import { errorInfo, request, type CommandError } from "./mutation-client";
import { AppHeader } from "./app-header";
export const recordedTime = (ms: number) => ms === 0 ? "0m" : ms < 60000 ? "<1m" : duration(Math.floor(ms / 60000));
const timestamp = (value: string, zone: string) => new Intl.DateTimeFormat("en-GB", { timeZone: zone, weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZoneName: "shortOffset" }).format(new Date(value));
const time = (value: string, zone: string) => new Intl.DateTimeFormat("en-GB", { timeZone: zone, hour: "2-digit", minute: "2-digit", timeZoneName: "shortOffset" }).format(new Date(value));
const timerText = (ms: number) => { const seconds = Math.max(0, Math.floor(ms / 1000)); return `${Math.floor(seconds / 3600).toString().padStart(2, "0")}:${String(Math.floor(seconds / 60) % 60).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`; };
const labels = { completed: "Completed as planned", partial: "Partial progress", abandoned: "Abandoned" };
type Pending = { url: string; body: object; kind: "start" | "end" };
type Summary = { detail: FocusDetail; session: FocusSession };
function TaskContext({ detail }: { detail: FocusDetail }) { return <div className="focus-task-context"><p>Goal · {goalTitle(detail.block.snapshot.goal)}</p>{detail.block.snapshot.milestone && <p>Milestone · {detail.block.snapshot.milestone.title}</p>}</div>; }
function SessionHistory({ detail }: { detail: FocusDetail }) {
  const ended = detail.sessions.filter(s => s.endedAt);
  return ended.length ? <details className="focus-history"><summary>Session history · {ended.length}</summary>{ended.map(s => <article key={s.id} data-focus-session={s.id}><p><strong>{labels[s.outcome!]}</strong> · {recordedTime(sessionMilliseconds(s))}</p><p className="small-note">{timestamp(s.startedAt, detail.timezone)} → {timestamp(s.endedAt!, detail.timezone)}</p>{s.endNote && <p className="focus-note">{s.endNote}</p>}</article>)}</details> : null;
}
function EndDialog({ active, elapsed, initialNote, busy, pending, error, onClose, onEnd, onRetry }: { active: NonNullable<FocusWorkspace["active"]>; elapsed: number; initialNote: string; busy: boolean; pending: boolean; error: CommandError<FocusSession> | null; onClose: (note: string) => void; onEnd: (outcome: string, note: string) => void; onRetry: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null), first = useRef<HTMLSelectElement>(null);
  const [outcome, setOutcome] = useState(""), [note, setNote] = useState(initialNote);
  const count = Array.from(note.trim()).length;
  useEffect(() => { dialog.current?.showModal(); first.current?.focus(); const guard = (e: BeforeUnloadEvent) => e.preventDefault(); window.addEventListener("beforeunload", guard); return () => window.removeEventListener("beforeunload", guard); }, []);
  return <dialog ref={dialog} className="editor-dialog focus-end-dialog r3-end-dialog" aria-labelledby="end-title" onCancel={e => { e.preventDefault(); if (!busy && !pending) onClose(note); }}>
    <p className="eyebrow">A moment to close the loop</p><h2 id="end-title">End this focus session</h2>
    <div className="focus-end-context"><strong>{recordedTime(elapsed)} elapsed so far</strong><p>{active.detail.block.snapshot.action.title}</p></div>
    <form onSubmit={e => { e.preventDefault(); onEnd(outcome, note); }}><p className="focus-outcome-question">How did this session go?</p><label>Session outcome<select ref={first} required value={outcome} disabled={busy || pending} onChange={e => setOutcome(e.target.value)}><option value="">Choose an outcome</option>{Object.entries(labels).map(([key, value]) => <option key={key} value={key}>{value}</option>)}</select></label>
      <label>End note <span className="optional-label">optional · up to 1,000 characters</span><textarea value={note} disabled={busy || pending} onChange={e => setNote(e.target.value)} rows={4}/></label>
      {count > 1000 && <p role="alert" className="small-note">Shorten the end note to 1,000 characters before saving. Your text is retained.</p>}
      <p className="small-note">This records the session outcome. Your Action stays unchanged.</p>
      {error && <p role="alert" className="dialog-error">{error.message}</p>}{pending && <button type="button" className="quiet-button" disabled={busy} onClick={onRetry}>Retry same command</button>}
      <div className="dialog-actions"><button type="button" className="quiet-button" disabled={busy || pending} onClick={() => onClose(note)}>Keep focusing</button><button className="primary-button" disabled={!outcome || busy || pending || count > 1000}>Save session outcome</button></div>
    </form>
  </dialog>;
}
function RemovedDialog({ detail, ack, onAck, busy, pending, error, onClose, onStart, onRetry }: { detail: FocusDetail; ack: boolean; onAck: (value: boolean) => void; busy: boolean; pending: boolean; error: CommandError<FocusSession> | null; onClose: () => void; onStart: () => void; onRetry: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null), checkbox = useRef<HTMLInputElement>(null);
  useEffect(() => { dialog.current?.showModal(); checkbox.current?.focus(); }, []);
  return <dialog ref={dialog} className="editor-dialog focus-review" aria-labelledby="removed-title" onCancel={e => { e.preventDefault(); if (!busy && !pending) onClose(); }}><h2 id="removed-title">Review before starting</h2><p>This scheduled block belongs to work that is no longer in your current weekly plan.</p><p><strong>{detail.block.snapshot.action.title}</strong></p><label className="block-ack"><input ref={checkbox} type="checkbox" checked={ack} disabled={busy || pending} onChange={e => onAck(e.target.checked)}/>I understand this work is outside my current plan</label>{error && <p role="alert" className="dialog-error">{error.message}</p>}{pending && <button className="quiet-button" disabled={busy} onClick={onRetry}>Retry same command</button>}<div className="dialog-actions"><button className="quiet-button" disabled={busy || pending} onClick={onClose}>Keep schedule</button><button className="primary-button" disabled={!ack || busy || pending} onClick={onStart}>Start focus anyway</button></div></dialog>;
}
export function FocusView({ initial, selected, accountName }: { initial: FocusWorkspace; selected?: string; accountName: string }) {
  const [view, setView] = useState(initial), [now, setNow] = useState(Date.parse(initial.serverNow)), [busy, setBusy] = useState(false), [pending, setPending] = useState<Pending | null>(null), [error, setError] = useState<CommandError<FocusSession> | null>(null), [ending, setEnding] = useState(false), [warning, setWarning] = useState<FocusDetail | null>(null), [ack, setAck] = useState(false), [notice, setNotice] = useState(""), [completed, setCompleted] = useState<Summary | null>(null);
  const [scratch, setScratch] = useState<{ sessionId: string; text: string } | null>(null);
  const sample = useRef({ server: Date.parse(initial.serverNow), client: 0 }), endButton = useRef<HTMLButtonElement>(null), returnButton = useRef<HTMLButtonElement>(null), summaryHeading = useRef<HTMLHeadingElement>(null), startTrigger = useRef<HTMLButtonElement | null>(null), wasEnding = useRef(false), channel = useRef<BroadcastChannel | null>(null), inFlight = useRef(false), editing = useRef(false), readRevision = useRef(0), previousActive = useRef(initial.active?.session.id);
  const url = `/api/focus${selected ? `?block=${selected}` : ""}`;
  const refresh = useCallback(async (force = false) => { const revision = ++readRevision.current, current = await request<FocusWorkspace>(url); if (revision !== readRevision.current || editing.current && !force) return current; sample.current = { server: Date.parse(current.serverNow), client: Date.now() }; setNow(sample.current.server); setView(current); return current; }, [url]);
  useEffect(() => { sample.current.client = Date.now(); const tick = () => setNow(sample.current.server + Date.now() - sample.current.client); const timer = setInterval(tick, 1000); const recover = () => { tick(); if (document.visibilityState === "visible" && !inFlight.current && !editing.current) void refresh().catch(e => setError(errorInfo<FocusSession>(e))); }; const poll = setInterval(recover, 15000); document.addEventListener("visibilitychange", recover); window.addEventListener("focus", recover); const broadcast = new BroadcastChannel("focus-session-changed"); channel.current = broadcast; broadcast.onmessage = recover; return () => { clearInterval(timer); clearInterval(poll); document.removeEventListener("visibilitychange", recover); window.removeEventListener("focus", recover); broadcast.close(); channel.current = null; }; }, [refresh]);
  useEffect(() => { if (!scratch?.text && !pending) return; const guard = (e: BeforeUnloadEvent) => e.preventDefault(); window.addEventListener("beforeunload", guard); return () => window.removeEventListener("beforeunload", guard); }, [scratch?.text, pending]);
  useEffect(() => { if (ending) { wasEnding.current = true; return; } if (wasEnding.current) { wasEnding.current = false; (endButton.current ?? returnButton.current)?.focus(); } }, [ending]);
  useEffect(() => { if (completed && !view.active) summaryHeading.current?.focus(); }, [completed, view.active]);
  useEffect(() => { if (view.active?.session.id && previousActive.current !== view.active.session.id) document.getElementById("active-focus")?.focus(); previousActive.current = view.active?.session.id; }, [view.active?.session.id]);
  async function send(command: Pending) {
    if (inFlight.current) return; inFlight.current = true; ++readRevision.current; setBusy(true); setPending(command); setError(null);
    try {
      const result = await request<{ session: FocusSession }>(command.url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(command.body) });
      const current = await refresh(true);
      if (command.kind === "end") {
        const detail = view.active?.detail;
        if (detail) setCompleted({ detail: { ...detail, sessions: [...detail.sessions.filter(s => s.id !== result.session.id), result.session], recordedMilliseconds: detail.recordedMilliseconds + sessionMilliseconds(result.session) }, session: result.session });
        setScratch(draft => draft?.sessionId === result.session.id ? null : draft);
        setNotice("Session recorded. Your Action, weekly budget and scheduled time are unchanged.");
      } else { setCompleted(null); setNotice(current.active ? "" : "The original start was confirmed. The session has since ended; saved history is preserved."); }
      editing.current = false; setEnding(false); setWarning(null); setAck(false); setPending(null); channel.current?.postMessage("changed");
    } catch (e) { const info = errorInfo<FocusSession>(e); setError(info); if (info.code !== "UNCERTAIN" && info.code !== "DATABASE_UNAVAILABLE") { setPending(null); if (info.kind === "ACTIVE_SESSION") await refresh().catch(() => {}); } }
    finally { inFlight.current = false; setBusy(false); }
  }
  function start(detail: FocusDetail, acknowledgeRemoved = false) { if (detail.reviewRequired && !acknowledgeRemoved) { setWarning(detail); setAck(false); setError(null); return; } void send({ kind: "start", url: `/api/time-blocks/${detail.block.id}/focus-sessions`, body: { mutationId: crypto.randomUUID(), expectedBlockVersion: detail.block.version, acknowledgeRemoved } }); }
  function closeWarning() { setWarning(null); startTrigger.current?.focus(); }
  const active = view.active, elapsed = active ? sessionMilliseconds(active.session, new Date(now).toISOString()) : 0;
  const scratchText = scratch?.sessionId === active?.session.id ? scratch?.text ?? "" : "";
  const ordered = view.todayBlocks.filter(d => d.block.state === "planned").toSorted((a, b) => Date.parse(a.block.start) - Date.parse(b.block.start) || a.block.id.localeCompare(b.block.id));
  const selectedDetail = view.selected?.block.state === "planned" && view.selected.canStart ? view.selected : null;
  const relevant = ordered.filter(d => Date.parse(d.block.end) > now && !d.sessions.some(s => s.endedAt));
  const next = selectedDetail ?? relevant.find(d => Date.parse(d.block.start) <= now) ?? relevant[0];
  const later = relevant.filter(d => d.block.id !== next?.block.id), earlier = ordered.filter(d => d.block.id !== next?.block.id && !later.some(v => v.block.id === d.block.id));
  function card(detail: FocusDetail, featured = false) { return <article className={`focus-block r3-block ${featured ? "focus-next-block" : "focus-compact-block"}`} data-focus-block={detail.block.id} key={detail.block.id}>
    <p className="focus-block-time">{timestamp(detail.block.start, detail.timezone)} – {time(detail.block.end, detail.timezone)} <span>· {duration(elapsedMinutes(detail.block))}</span></p><h2>{detail.block.snapshot.action.title}</h2><TaskContext detail={detail}/>
    {featured && detail.block.snapshot.action.doneWhen && <p className="focus-done-when"><strong>Done when</strong> {detail.block.snapshot.action.doneWhen}</p>}
    {detail.reviewRequired && <p className="calendar-warning">This scheduled block belongs to work that is no longer in your current weekly plan.</p>}
    <div className="focus-block-actions">{detail.canStart ? <button className="primary-button" disabled={busy || !!pending} onClick={e => { startTrigger.current = e.currentTarget; start(detail); }}>Start focus</button> : <p className="small-note">Only planned blocks in your current local week can start.</p>}{detail.recordedMilliseconds > 0 && <span className="small-note">Recorded session time · {recordedTime(detail.recordedMilliseconds)}</span>}</div><SessionHistory detail={detail}/>
  </article>; }
  return <div className={`workspace focus-page r3-focus-page ${active ? "focus-mode-page" : "focus-launch-page"}`}>
    <a className="skip-link" href="#main">Skip to content</a>
    <AppHeader section="focus" accountName={accountName}/>
    <main id="main" className={active ? "focus-mode-main" : "workspace-main focus-launch-main"}>
      <div className={`focus-workspace ${active ? "focus-is-active" : ""}`}>
        {!active && !completed && <div className="focus-launch-heading"><div><p className="eyebrow">One deliberate block at a time</p><h1>What am I focusing on next?</h1><p className="small-note">Today · {view.today} · {view.timezone}</p></div><button ref={returnButton} className="quiet-button" disabled={busy || !!pending} onClick={() => void refresh().then(() => setError(null)).catch(e => setError(errorInfo<FocusSession>(e)))}>Refresh focus</button></div>}
        {notice && !completed && <p role="status" className="plan-notice">{notice}</p>}
        {error && !ending && !(warning && !active) && <div role="alert" className="focus-error"><p>{error.message}</p>{pending && <button className="quiet-button" disabled={busy} onClick={() => void send(pending)}>Retry same command</button>}{error.kind === "ACTIVE_SESSION" && <button className="quiet-button" onClick={() => { setError(null); document.getElementById("active-focus")?.focus(); }}>Return to focus</button>}</div>}
        {active ? <section id="active-focus" tabIndex={-1} className="active-focus r3-active-focus" aria-label="Active focus session" data-active-session={active.session.id}>
          <div className="focus-mode-hero"><div className="focus-timer"><span>Elapsed session time</span><output aria-label="Elapsed session time" aria-live="off">{timerText(elapsed)}</output></div><p className="focus-current-label">Current task</p><h1>{active.detail.block.snapshot.action.title}</h1><TaskContext detail={active.detail}/>{active.detail.reviewRequired && <p className="calendar-warning">This commitment was removed from the current plan. Your running session continues.</p>}</div>
          <div className="focus-mode-body"><div className="focus-mode-context"><div className="focus-original-schedule"><h2>Scheduled</h2><p>{timestamp(active.detail.block.start, active.detail.timezone)} – {time(active.detail.block.end, active.detail.timezone)} · {duration(elapsedMinutes(active.detail.block))}</p><p className="small-note">Started · {timestamp(active.session.startedAt, active.detail.timezone)}</p>{now > Date.parse(active.detail.block.end) && <p className="focus-overrun">Session has continued {recordedTime(now - Date.parse(active.detail.block.end))} beyond the block.</p>}</div>
            <dl className="focus-metrics"><div><dt>Weekly commitment</dt><dd>{active.detail.budgetMinutes === null ? "Removed from current plan" : `${duration(active.detail.budgetMinutes)} budget`}</dd></div><div><dt>Scheduled this week</dt><dd>{duration(active.detail.scheduledMinutes)}</dd></div><div><dt>Recorded so far</dt><dd>{recordedTime(active.detail.commitmentRecordedMilliseconds + elapsed)}</dd></div></dl>
          </div><div className="focus-scratchpad"><label htmlFor="scratch-notes">Notes <span>Scratchpad</span></label><textarea id="scratch-notes" aria-describedby="scratch-help" placeholder="A thought, a blocker, a next step…" value={scratchText} disabled={busy || !!pending} onChange={e => setScratch({ sessionId: active.session.id, text: e.target.value })}/><p id="scratch-help">Kept in this tab until you leave or reload. Added to your end note when you finish.</p></div></div>
          <div className="focus-mode-actions"><button className="text-button focus-refresh" disabled={busy || !!pending || ending} onClick={() => void refresh().then(() => setError(null)).catch(e => setError(errorInfo<FocusSession>(e)))}>Refresh focus</button><button ref={endButton} className="primary-button" disabled={busy || !!pending} onClick={() => { editing.current = true; setError(null); setEnding(true); }}>End focus</button></div>
        </section> : completed ? <section className="focus-completion" aria-label="Session recorded" data-session-summary={completed.session.id}><p className="eyebrow">A little progress, recorded</p><h1 ref={summaryHeading} tabIndex={-1}>{recordedTime(sessionMilliseconds(completed.session))} recorded</h1><h2>{completed.detail.block.snapshot.action.title}</h2><p className="focus-outcome-label">{labels[completed.session.outcome!]}</p><p className="small-note" role="status">Session recorded. Your Action, weekly budget and scheduled time are unchanged.</p><div className="focus-completion-links"><a className="primary-button" href="/today">Back to today</a><a className="quiet-button" href="/calendar">Back to Calendar</a></div><button ref={returnButton} className="text-button" onClick={() => { setCompleted(null); setNotice(""); }}>Choose another block</button><SessionHistory detail={completed.detail}/></section> : <div className="focus-launch-content">
          {!ordered.length && <section className="focus-launch-empty"><span className="focus-empty-mark" aria-hidden="true">↗</span><h2>Nothing scheduled for focus today.</h2><p>Make room for important work from your Calendar.</p><a className="primary-button" href="/calendar">Open Calendar</a></section>}
          {next && <section className="focus-next" aria-label="Next focus block"><p className="focus-section-label">Next{selectedDetail ? " · selected from your schedule" : ""}</p>{card(next, true)}</section>}
          {later.length > 0 && <section className="focus-later" aria-label="Later today"><h2 className="focus-section-label">Later today</h2>{later.map(d => card(d))}</section>}
          {earlier.length > 0 && <details className="focus-earlier"><summary>Earlier today · {earlier.length}</summary><div>{earlier.map(d => card(d))}</div></details>}
          {view.selected && view.selected.block.id !== next?.block.id && !ordered.some(d => d.block.id === view.selected!.block.id) && <section className="focus-selected" aria-label="Selected scheduled block"><h2 className="focus-section-label">Selected scheduled block</h2>{card(view.selected)}</section>}
          {scratch?.text && <section className="focus-orphan-notes"><h2>Unsaved scratch notes</h2><p className="small-note">Your previous session is no longer active. These notes remain in this tab and have not been saved.</p><textarea aria-label="Unsaved scratch notes" value={scratch.text} readOnly/><button className="text-button" onClick={() => setScratch(null)}>Discard scratch notes</button></section>}
        </div>}
      </div>
      {!completed&&<aside className="focus-day-rail" aria-label="Today's blocks">
        <section className="reference-panel"><p className="eyebrow">Today · {view.timezone}</p><h2>{view.todayBlocks.length} {view.todayBlocks.length===1?'block':'blocks'}</h2>
          {view.todayBlocks.length ? view.todayBlocks.map(detail=><div className={`focus-day-item ${active?.detail.block.id===detail.block.id?'is-current':''}`} key={detail.block.id}>
            <p>{time(detail.block.start,detail.timezone)} – {time(detail.block.end,detail.timezone)}{active?.detail.block.id===detail.block.id&&<span>● Now</span>}</p><strong>{detail.block.snapshot.action.title}</strong>
          </div>) : <p className="small-note">Give one task time on your Calendar. It will show up here.</p>}
        </section>
        <section className="reference-panel reference-prompt"><h3>One task at a time</h3><p>{active?'Your session is running. Keep a note of the next small step before you finish.':'Start from a scheduled block. Your recorded session gives you something concrete to reflect on.'}</p><a className="canvas-secondary-link" href="/calendar">See today on Calendar →</a></section>
      </aside>}
    </main>
    {warning && !active && <RemovedDialog detail={warning} ack={ack} onAck={setAck} busy={busy} pending={!!pending} error={error} onClose={closeWarning} onStart={() => start(warning, true)} onRetry={() => { if (pending) void send(pending); }}/>} 
    {ending && active && <EndDialog active={active} elapsed={elapsed} initialNote={scratchText} busy={busy} pending={!!pending} error={error} onClose={note => { setScratch({ sessionId: active.session.id, text: note }); editing.current = false; setEnding(false); void refresh().catch(e => setError(errorInfo<FocusSession>(e))); }} onRetry={() => { if (pending) void send(pending); }} onEnd={(outcome, endNote) => void send({ kind: "end", url: `/api/focus-sessions/${active.session.id}/end`, body: { mutationId: crypto.randomUUID(), expectedVersion: active.session.version, outcome, endNote } })}/>}
  </div>;
}
