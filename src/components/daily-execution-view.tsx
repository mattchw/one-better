"use client";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { activeChangesDay, intervalMilliseconds, type DailyExecution, type DailyReflection } from "@/modules/reviews/domain";
import { localDate } from "@/modules/focus/domain";
import { addDays, currentWeek, mondayOf } from "@/modules/planning/domain";
import { recordedTime } from "./focus-view";
import { request, errorInfo, type CommandError } from "./mutation-client";
import { ReviewDashboard } from "./review-dashboard";
import { deriveReviewAnalytics } from "@/modules/weekly-reviews/analytics";
import { FeedbackMetrics, FeedbackDetails, FinalizedLabel } from "./feedback-presentation";

const timestamp = (instant: string, timezone: string) => new Intl.DateTimeFormat("en-GB", { timeZone: timezone, weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZoneName: "shortOffset" }).format(new Date(instant));
const dateTitle = (date: string) => new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", weekday: "long", day: "numeric", month: "long", year: "numeric" }).format(new Date(`${date}T12:00:00Z`));
const labels = { completed: "Completed as planned", partial: "Partial progress", abandoned: "Abandoned" };
type Entry = DailyExecution["scheduled"][number];
type Pending = { url: string; method: "PUT" | "POST"; body: object; finishing: boolean };
function Summary({ scheduled, recorded, live, sessions }: { scheduled: number; recorded: number; live: boolean; sessions?: number }) {
  return <FeedbackMetrics label="Daily execution summary" className="daily-metrics" items={[{label:"Scheduled focus",value:recordedTime(scheduled)},{label:`Recorded focus${live ? " so far" : ""}`,value:recordedTime(recorded)},...(sessions === undefined ? [] : [{label:"Sessions",value:sessions}])]}/>;
}
function ExecutionEntry({ entry, view, now }: { entry: Entry; view: DailyExecution; now: string }) {
  const actual = entry.sessions.reduce((n, v) => n + intervalMilliseconds(v.session.startedAt, v.session.endedAt ?? now, view.range), 0);
  const counts = {completed:0,partial:0,abandoned:0,active:0};
  for (const {session} of entry.sessions) counts[session.outcome ?? "active"]++;
  return <article className="daily-block feedback-work-card" data-daily-block={entry.block.id}>
    <div className="feedback-work-heading"><h3>{entry.block.snapshot.action.title}</h3>{entry.block.state === "cancelled" && <span className="feedback-status">Cancelled before execution</span>}</div>
    <p className="feedback-goal">Goal · {entry.block.snapshot.goal.title}</p>
    <p className="feedback-schedule">{timestamp(entry.block.start, view.timezone)} → {timestamp(entry.block.end, view.timezone)}</p>
    <div className="feedback-work-result"><strong>Recorded {recordedTime(actual)}{liveContribution(entry,view,now) ? " so far" : ""}</strong>{Object.entries(counts).filter(([,count])=>count>0).map(([kind,count])=><span className="feedback-status" key={kind}>{kind === "active" ? "Active session" : labels[kind as keyof typeof labels]}{count > 1 ? ` · ${count}` : ""}</span>)}</div>
    {entry.sessionCount === 0 ? <p className="feedback-no-session">No focus session recorded</p> : entry.sessions.length === 0 ? <p className="feedback-no-session">Sessions for this block occurred on other dates. No recorded time on this date.</p> : null}
    <FeedbackDetails className="daily-sessions" title={entry.sessions.length ? `Session details · ${entry.sessions.length}` : "Details"}>
      <p className="small-note">{entry.block.state === "cancelled" ? "Cancelled interval · excluded from scheduled total" : "Scheduled on this date"}: {recordedTime(entry.scheduledMilliseconds)}</p>
      <p className="small-note">Recorded on this date · {recordedTime(actual)}</p>
      {entry.planTimezone !== view.timezone && <p className="small-note">Shown in {view.timezone}; planning timezone {entry.planTimezone}.</p>}
      <h4>Frozen context</h4><p>{entry.block.snapshot.goal.outcome}</p>{entry.block.snapshot.milestone && <p>Milestone · {entry.block.snapshot.milestone.title} · {entry.block.snapshot.milestone.successCondition}</p>}{entry.block.snapshot.action.doneWhen && <p>Done when · {entry.block.snapshot.action.doneWhen}</p>}
      {entry.sessions.map(({ session }) => <article key={session.id} data-daily-session={session.id}><p><strong>{session.outcome ? labels[session.outcome] : "Active session"}</strong> · {recordedTime(intervalMilliseconds(session.startedAt, session.endedAt ?? now, view.range))} on this date</p><p className="small-note">{timestamp(session.startedAt, view.timezone)} → {session.endedAt ? timestamp(session.endedAt, view.timezone) : "Still active"}</p>{!session.endedAt && view.localDate < localDate(now, view.timezone) && <p className="small-note">This date&apos;s contribution is fixed at its day boundary.</p>}{session.endNote && <p className="focus-note">{session.endNote}</p>}</article>)}
      <a className="text-link" href={`/focus?block=${entry.block.id}`}>View block in Focus</a>
    </FeedbackDetails>
  </article>;
}
const liveContribution=(entry:Entry,view:DailyExecution,now:string)=>entry.sessions.some(v=>activeChangesDay(v.session,view.localDate,view.timezone,now));

export function DailyExecutionView({ initial }: { initial: DailyExecution }) {
  const router = useRouter();
  const [view, setView] = useState(initial), [saved, setSaved] = useState(initial.reflection), [note, setNote] = useState(initial.reflection?.note ?? "");
  const [now, setNow] = useState(initial.serverNow), [busy, setBusy] = useState(false), [pending, setPending] = useState<Pending | null>(null);
  const [error, setError] = useState<CommandError<DailyReflection> | null>(null), [conflict, setConflict] = useState(false), [notice, setNotice] = useState("");
  const [reviewing, setReviewing] = useState(false), [attempted, setAttempted] = useState<string | null>(null), [chosenDate, setChosenDate] = useState(initial.localDate);
  const savedRef = useRef(saved), flight = useRef(false), revision = useRef(0), modal = useRef<HTMLDialogElement>(null), cancel = useRef<HTMLButtonElement>(null), finish = useRef<HTMLButtonElement>(null), wasReviewing = useRef(false);
  const sample = useRef({ server: Date.parse(initial.serverNow), client: 0 });
  const dirty = note !== (saved?.note ?? ""), blocked = busy || !!pending;
  const url = `/api/daily-execution?date=${initial.localDate}`;
  const adopt = useCallback((reflection: DailyReflection | null, replaceNote: boolean) => { savedRef.current = reflection; setSaved(reflection); if (replaceNote) setNote(reflection?.note ?? ""); }, []);
  const refresh = useCallback(async (mode: "facts" | "saved" = "facts") => {
    const read = ++revision.current, current = await request<DailyExecution>(url);
    if (read !== revision.current) return current;
    setView(current); sample.current = { server: Date.parse(current.serverNow), client: Date.now() }; setNow(current.serverNow);
    if (mode === "saved") adopt(current.reflection, true);
    else if (current.reflection?.id !== savedRef.current?.id || current.reflection?.version !== savedRef.current?.version) {
      setConflict(true); setError({ code: "CONFLICT", kind: "REFLECTION_VERSION", message: "This reflection changed elsewhere. Your attempted note is retained. Review the latest saved note before continuing.", current: current.reflection ?? undefined });
    }
    return current;
  }, [url, adopt]);
  useEffect(() => {
    sample.current.client = Date.now();
    const tick = () => setNow(new Date(sample.current.server + Date.now() - sample.current.client).toISOString());
    const recover = () => { tick(); if (document.visibilityState === "visible" && !flight.current) void refresh().catch(e => setError(errorInfo<DailyReflection>(e))); };
    const timer = setInterval(tick, 1000), poll = setInterval(recover, 15000), channel = new BroadcastChannel("focus-session-changed");
    channel.onmessage = recover; document.addEventListener("visibilitychange", recover); window.addEventListener("focus", recover);
    return () => { clearInterval(timer); clearInterval(poll); channel.close(); document.removeEventListener("visibilitychange", recover); window.removeEventListener("focus", recover); };
  }, [refresh]);
  useEffect(() => { if (!dirty && !pending) return; const guard = (e: BeforeUnloadEvent) => e.preventDefault(); window.addEventListener("beforeunload", guard); return () => window.removeEventListener("beforeunload", guard); }, [dirty, pending]);
  useEffect(() => { if (reviewing) { wasReviewing.current = true; modal.current?.showModal(); cancel.current?.focus(); } else if (wasReviewing.current) { wasReviewing.current = false; finish.current?.focus(); } }, [reviewing]);

  async function send(command: Pending) {
    if (flight.current) return; flight.current = true; ++revision.current; setBusy(true); setPending(command); setError(null);
    try {
      await request<{ reflection: DailyReflection }>(command.url, { method: command.method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(command.body) });
      await refresh("saved"); setPending(null); setConflict(false); setReviewing(false);
      setNotice(command.finishing ? "Daily reflection finished. Your execution and weekly plan are unchanged." : "Draft saved. You can come back to it later.");
    } catch (e) {
      const info = errorInfo<DailyReflection>(e); setError(info);
      if (!["UNCERTAIN", "DATABASE_UNAVAILABLE"].includes(info.code)) { setPending(null); if (["REFLECTION_VERSION", "REFLECTION_FINALIZED"].includes(info.kind ?? "")) setConflict(true); }
    } finally { flight.current = false; setBusy(false); }
  }
  async function latest() {
    if (flight.current) return; setBusy(true);
    try { const current = await refresh(); if (current.reflection?.status === "finalized") { setAttempted(note); adopt(current.reflection, true); } else adopt(current.reflection, false); setConflict(false); setReviewing(false); setError(null); setNotice("Latest saved reflection reviewed. Your attempted note is retained for an explicit save."); }
    catch (e) { setError(errorInfo<DailyReflection>(e)); } finally { setBusy(false); }
  }
  async function reviewFinish() {
    if (blocked || dirty || conflict || !saved?.note.trim()) return; setBusy(true); setError(null);
    try { const current = await refresh(); if (current.reflection?.id !== saved.id || current.reflection.version !== saved.version) return; if (current.live) { setError({ code: "CONFLICT", kind: "ACTIVE_EXECUTION", message: "You still have an active focus session. End it before finishing today's reflection." }); return; } setReviewing(true); }
    catch (e) { setError(errorInfo<DailyReflection>(e)); } finally { setBusy(false); }
  }
  const today = localDate(now, view.timezone), liveSession = [...view.scheduled, ...view.otherWork].flatMap(b => b.sessions).find(v => !v.session.endedAt)?.session ?? null;
  const live = activeChangesDay(liveSession, view.localDate, view.timezone, now);
  const recorded = [...view.scheduled, ...view.otherWork].flatMap(b => b.sessions).reduce((n, v) => n + intervalMilliseconds(v.session.startedAt, v.session.endedAt ?? now, view.range), 0);
  const navBlocked = blocked || dirty, canReflect = view.localDate <= today;
  const analytics=deriveReviewAnalytics({startDate:view.localDate,days:1,timezone:view.timezone,now,plan:null,
    blocks:[...view.scheduled,...view.otherWork].map(e=>e.block),sessions:[...view.scheduled,...view.otherWork].flatMap(e=>e.sessions.map(s=>s.session)),reflections:view.reflection?[view.reflection]:[]});
  const dayLink = (date: string, label: string) => <a href={`/today?date=${date}`} aria-disabled={navBlocked} onClick={e => { if (navBlocked) e.preventDefault(); }}>{label}</a>;
  const reviewLink = (href: string, label: string) => <a href={href} aria-disabled={navBlocked} onClick={e => { if (navBlocked) e.preventDefault(); }}>{label}</a>;
  return <div className="daily-workspace reference-review feedback-workspace feedback-daily">
    <nav className="review-mode-tabs" aria-label="Review mode"><a href="/today" aria-current="page" aria-disabled={navBlocked} onClick={e => { if (navBlocked) e.preventDefault(); }}>Daily</a>{reviewLink("/review", "Weekly")}</nav>
    <div className="focus-heading"><div><p className="eyebrow">Understand the day</p><h1>{view.localDate === today ? "Today" : "Daily execution"}</h1><h2 className="feedback-date">{dateTitle(view.localDate)}</h2></div><button className="quiet-button" disabled={blocked} onClick={() => void refresh().catch(e => setError(errorInfo<DailyReflection>(e)))}>Refresh day</button></div>
    <div className="review-toolbar">    
    <nav className="daily-navigation" aria-label="Review dates">{view.localDate > "2000-01-01" && dayLink(addDays(view.localDate, -1), "← Previous day")}{dayLink(today, "Today")}{view.localDate < "9999-12-31" && dayLink(addDays(view.localDate, 1), "Next day →")}</nav>
    <form className="daily-date-picker" onSubmit={e => { e.preventDefault(); if (!navBlocked) router.push(`/today?date=${chosenDate}`); }}><label htmlFor="review-date">Review date</label><input id="review-date" type="date" min="2000-01-01" max="9999-12-31" required value={chosenDate} disabled={navBlocked} onChange={e => setChosenDate(e.target.value)}/><button className="quiet-button" disabled={navBlocked}>Open date</button></form>
</div>
    {navBlocked && <p className="small-note">Save or discard your unsaved note before changing day. An unconfirmed command must be retried first.</p>}
    {notice && <p role="status" className="plan-notice">{notice}</p>}
    {error && !reviewing && <div role="alert" className="daily-error"><p>{error.message}</p>{pending && <button className="quiet-button" disabled={busy} onClick={() => void send(pending)}>Retry same command</button>}{conflict && <><p className="focus-note">Latest saved note: {error.current?.note ?? view.reflection?.note ?? "Not available"}</p><button className="quiet-button" disabled={blocked} onClick={() => void latest()}>Review latest saved reflection</button></>}</div>}
    <ReviewDashboard data={analytics} weekly={false} navigationBlocked={navBlocked} summary={<Summary scheduled={view.scheduledMilliseconds} recorded={recorded} live={live} sessions={[...view.scheduled,...view.otherWork].reduce((n,e)=>n+e.sessions.length,0)}/>}/>
    <div className="feedback-layout"><div className="feedback-main-column">
    <section className="feedback-work-list review-scheduled" aria-label="Scheduled work"><div className="feedback-section-heading"><h2>What happened</h2><span>{view.scheduled.length} scheduled {view.scheduled.length === 1 ? "block" : "blocks"}</span></div>{view.scheduled.length ? view.scheduled.map(entry => <ExecutionEntry key={entry.block.id} entry={entry} view={view} now={now}/>) : <p>No scheduled blocks for this date.</p>}</section>
    {view.otherWork.length > 0 && <section className="feedback-work-list" aria-label="Recorded work from other scheduled dates"><h2>Recorded work from other scheduled dates</h2>{view.otherWork.map(entry => <ExecutionEntry key={entry.block.id} entry={entry} view={view} now={now}/>)}</section>}
    {recorded === 0 && !live && <p className="small-note">No focus time recorded on this date. The app cannot tell whether other work happened.</p>}
    </div><aside className="feedback-reflection-column review-reflection-rail" aria-label="Reflection and next steps">
    <section className="daily-reflection feedback-reflection" aria-label="Daily reflection"><div className="feedback-section-heading"><h2>Daily reflection</h2>{saved?.status === "finalized" && <FinalizedLabel/>}</div>
      {saved?.status === "finalized" ? <><p className="small-note">Finished {timestamp(saved.finalizedAt!, view.timezone)}</p><p className="focus-note" data-finalized-reflection={saved.id}>{saved.note}</p>{attempted !== null && <details><summary>Your unsaved attempted note</summary><p className="focus-note">{attempted}</p></details>}</> : !canReflect ? <p>Reflection is available on this day or later.</p> : <>
        <p className="small-note">What moved forward? What got in the way? What should you remember tomorrow?</p>
        <label htmlFor="reflection-note" className="sr-only">Reflection</label><textarea id="reflection-note" placeholder="What would make tomorrow one small step better?" rows={5} value={note} disabled={blocked} onChange={e => { setNote(e.target.value); setNotice(""); }} aria-describedby="reflection-help"/>
        <p id="reflection-help" className="small-note">One plain-text note · up to 4,000 characters · explicit saves, no autosave. {saved ? "Saved draft." : "No reflection saved yet."}{dirty ? " Unsaved changes." : ""}</p>
        {Array.from(note.trim()).length > 4000 && <p role="alert">Use 4,000 characters or fewer.</p>}
        {live && <p className="small-note">You still have an active focus session. <a href="/focus">End it in Focus</a> before finishing today&apos;s reflection.</p>}
        <div className="dialog-actions"><button className="quiet-button" disabled={blocked || conflict || Array.from(note.trim()).length > 4000} onClick={() => void send({ url: "/api/daily-reflections", method: "PUT", finishing: false, body: { mutationId: crypto.randomUUID(), localDate: view.localDate, reflectionId: saved?.id ?? null, expectedVersion: saved?.version ?? 0, note } })}>Save draft</button>{dirty && <button className="quiet-button" disabled={blocked} onClick={() => { setNote(saved?.note ?? ""); setNotice(""); }}>Discard unsaved changes</button>}<button ref={finish} className="primary-button" disabled={blocked || conflict || dirty || !saved?.note.trim() || live} onClick={() => void reviewFinish()}>Finish daily reflection</button></div>
        {dirty && <p className="small-note">Save your note before finishing. Finished text cannot be edited or reopened.</p>}
      </>}
    </section>
    <p className="feedback-fact-note">{view.timezone} · Recorded focus is elapsed session time, not productivity. Outcomes do not complete Actions.</p>
    <section className="feedback-insights" aria-label="Insights"><h2>Insights</h2><span>Coming later</span></section>
    {mondayOf(view.localDate) === currentWeek(now, view.timezone) && <p><a href={`/planning?week=${mondayOf(view.localDate)}`}>Review the rest of this week&apos;s plan</a></p>}
    </aside></div>
    {reviewing && saved && <dialog ref={modal} className="goal-dialog daily-finish-dialog" aria-labelledby="finish-reflection-title" onCancel={e => { e.preventDefault(); if (!blocked) setReviewing(false); }}><h2 id="finish-reflection-title">Finish daily reflection?</h2><p>{dateTitle(view.localDate)}</p><Summary scheduled={view.scheduledMilliseconds} recorded={recorded} live={live}/><p className="focus-note">{saved.note}</p><p className="small-note">Your reflection becomes read-only. Your sessions, Actions and weekly plan stay unchanged. Execution summaries remain derived from recorded facts.</p>{error && <p role="alert">{error.message}</p>}{pending && <button className="quiet-button" disabled={busy} onClick={() => void send(pending)}>Retry same command</button>}<div className="dialog-actions"><button ref={cancel} className="quiet-button" disabled={blocked} onClick={() => setReviewing(false)}>Keep draft</button><button className="primary-button" disabled={blocked || live || conflict} onClick={() => void send({ url: `/api/daily-reflections/${saved.id}/finalize`, method: "POST", finishing: true, body: { mutationId: crypto.randomUUID(), expectedVersion: saved.version } })}>Confirm finish</button></div>{conflict && <button className="quiet-button" disabled={blocked} onClick={() => void latest()}>Review latest saved reflection</button>}</dialog>}
  </div>;
}
