"use client";
import { useEffect, useRef, useState } from "react";
import { failureMessages, selectionLimit, selectionMissing, type CalendarWorkspace, type Connection } from "@/modules/calendar/domain";
import { errorInfo, request, type CommandError } from "./mutation-client";
type Pending = { url: string; method: "POST" | "PATCH"; body?: object; kind: "list" | "select" | "disconnect" };
function DisconnectDialog({ cancel, confirm }: { cancel: () => void; confirm: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null), cancelButton = useRef<HTMLButtonElement>(null);
  useEffect(() => { dialog.current?.showModal(); cancelButton.current?.focus(); }, []);
  return <dialog ref={dialog} className="goal-dialog" aria-labelledby="calendar-disconnect-title" onCancel={cancel}><h2 id="calendar-disconnect-title">Disconnect Google Calendar?</h2><p>This removes stored Calendar credentials, your selection and cached busy timing. Your Goals, Actions and Plan history stay saved.</p><div className="dialog-actions"><button ref={cancelButton} className="quiet-button" onClick={cancel}>Keep connected</button><button className="primary-button" onClick={confirm}>Disconnect Calendar</button></div></dialog>;
}
export function CalendarSettings({ initial, callback }: { initial: CalendarWorkspace; callback?: string }) {
  const [workspace, setWorkspace] = useState(initial), [selected, setSelected] = useState(initial.connection?.selectedCalendarIds ?? []);
  const [busy, setBusy] = useState(initial.connection?.state === "connected"), [pending, setPending] = useState<Pending | null>(null), [error, setError] = useState<CommandError<Connection> | null>(null), [notice, setNotice] = useState(""), [disconnectOpen, setDisconnectOpen] = useState(false);
  const disconnectButton = useRef<HTMLButtonElement>(null), running = useRef(false), wasDisconnectOpen = useRef(false);
  useEffect(() => { if (!disconnectOpen && wasDisconnectOpen.current) disconnectButton.current?.focus(); wasDisconnectOpen.current = disconnectOpen; }, [disconnectOpen]);
  const connection = workspace.connection; const locked = busy || !!pending;
  const dirty = JSON.stringify([...selected].sort()) !== JSON.stringify([...(connection?.selectedCalendarIds ?? [])].sort());
  function apply(value: Connection) { setWorkspace(previous => ({ ...previous, connection: value })); setSelected(value.selectedCalendarIds); }
  async function execute(command: Pending) {
    if (running.current) return; running.current = true; setBusy(true); setError(null); setPending(command); setDisconnectOpen(false);
    try {
      const result = await request<{ connection: Connection; revocationConfirmed?: boolean }>(command.url, { method: command.method, headers: command.body ? { "Content-Type": "application/json" } : undefined, body: command.body ? JSON.stringify(command.body) : undefined });
      apply(result.connection); setPending(null);
      setNotice(command.kind === "select" ? "Calendar selection saved. Weekly planning stays unchanged." : command.kind === "disconnect" ? result.revocationConfirmed ? "Calendar disconnected. Credentials, selection and cached timing removed." : "Calendar disconnected locally. Google revocation could not be confirmed; you can also remove access in your Google Account." : "Calendar list refreshed. Your saved selection stays yours.");
    } catch (failure) { const info = errorInfo<Connection>(failure); setError(info); if (info.code !== "UNCERTAIN" && info.code !== "DATABASE_UNAVAILABLE") setPending(null); }
    finally { running.current = false; setBusy(false); }
  }
  useEffect(() => {
    if (initial.connection?.state !== "connected") return;
    let active = true;
    // View-entry refresh is a bounded read of provider metadata. There is no
    // authorization redirect or selection change, and no stale draft to replace.
    request<{ connection: Connection }>(`/api/calendar/${initial.connection.id}/calendars`, { method: "POST" }).then(result => {
      if (active) { setWorkspace(previous => ({ ...previous, connection: result.connection })); setSelected(result.connection.selectedCalendarIds); }
    }).catch(failure => { if (active) setError(errorInfo(failure)); }).finally(() => { if (active) setBusy(false); });
    return () => { active = false; };
  }, [initial.connection?.id, initial.connection?.state]);
  useEffect(() => { if (!dirty && !pending) return; const guard = (e: BeforeUnloadEvent) => { e.preventDefault(); }; window.addEventListener("beforeunload", guard); return () => window.removeEventListener("beforeunload", guard); }, [dirty, pending]);
  async function connect() { if (running.current) return; running.current = true; setBusy(true); setError(null); try { const result = await request<{ url: string }>("/api/calendar/connect", { method: "POST" }); window.location.assign(result.url); } catch (failure) { setError(errorInfo(failure)); running.current = false; setBusy(false); } }
  async function reviewLatest() { setBusy(true); try { const next = await request<CalendarWorkspace>("/api/calendar"); setWorkspace(next); setSelected(next.connection?.selectedCalendarIds ?? []); setError(null); setNotice("Latest saved selection reviewed. Reapply your choices deliberately."); } catch (failure) { setError(errorInfo(failure)); } finally { setBusy(false); } }
  const missing = connection ? selectionMissing(connection) : [];
  return <section className="integration-settings" aria-labelledby="integrations-title"><div className="settings-intro"><h2 id="integrations-title">Integrations</h2><p>Bring your calendar into the plan. You choose what informs your availability.</p></div><article className="integration-card"><div className="settings-integration-heading"><span className="settings-provider-mark" aria-hidden="true">G</span><div><h3>Google Calendar</h3><p>See existing busy time alongside your weekly plan.</p></div><span className={`settings-connection-state ${connection?.state === "connected" ? "is-connected" : ""}`}>{connection?.state === "connected" ? "Connected" : connection?.state === "reauthorization_required" ? "Needs attention" : "Not connected"}</span></div><p className="small-note">We use your selected calendars to retrieve busy/free timing. We do not import event titles, descriptions or attendees. Calendar access is separate from your application sign-in.</p>
    {callback && <p role={callback === "success" ? "status" : "alert"}>{callback === "success" ? "Google Calendar connected. Choose which calendars inform planning." : callback === "cancelled" ? "Calendar authorization was cancelled. Your saved connection is unchanged." : "Calendar authorization could not be completed. Retry and grant both Calendar permissions."}</p>}
    {notice && <p role="status">{notice}</p>}
    {error && <div className="dialog-error" role="alert"><p>{error.message}</p>{pending ? <button className="quiet-button" disabled={busy} onClick={() => void execute(pending)}>Retry same Calendar change</button> : error.kind === "CALENDAR_VERSION" ? <button className="quiet-button" disabled={busy} onClick={() => void reviewLatest()}>Review latest saved selection</button> : null}</div>}
    {!workspace.configured && <p className="calendar-warning">Google Calendar is not configured on this local app. Configure the server’s OAuth client and encryption key using the README. Manual weekly planning is ready to use.</p>}
    {(!connection || connection.state !== "connected") && <><p className="muted">{connection?.state === "reauthorization_required" ? "Connection needs attention." : "No Calendar account connected."}</p><button className="primary-button" disabled={locked || !workspace.configured} onClick={() => void connect()}>{connection?.state === "reauthorization_required" ? "Reconnect Google Calendar" : "Connect Google Calendar"}</button></>}
    {connection?.state === "connected" && <>
      <div className="calendar-heading"><h4>Calendars used for availability</h4><button className="quiet-button" disabled={locked || dirty} onClick={() => void execute({ url: `/api/calendar/${connection.id}/calendars`, method: "POST", kind: "list" })}>Refresh calendar list</button></div>
      <p className="small-note">Choose up to {selectionLimit} calendars. No calendar is selected automatically, including your primary calendar.</p>
      {busy && pending?.kind === "list" && <p className="muted">Retrieving your calendar list…</p>}
      {connection.listError && <p className="calendar-warning" role="alert">{failureMessages[connection.listError]}</p>}
      {missing.map(id => <label className="calendar-choice" key={id}><input type="checkbox" checked={selected.includes(id)} disabled={locked} onChange={e => setSelected(e.target.checked ? [...selected, id] : selected.filter(v => v !== id))} /><span>Unavailable calendar · {id}<small>Remove this selection before saving.</small></span></label>)}
      {connection.calendars.map(c => <label className="calendar-choice" key={c.id}><input type="checkbox" checked={selected.includes(c.id)} disabled={locked} onChange={e => { setSelected(e.target.checked ? [...selected, c.id] : selected.filter(v => v !== c.id)); setNotice(""); }} /><span>{c.summary}{c.primary && <small>Primary</small>}{c.accessRole === "freeBusyReader" && <small>Busy timing only</small>}</span></label>)}
      {connection.listFetchedAt && !connection.calendars.length && <p className="muted">No calendars with readable busy timing were returned.</p>}
      {selected.length > selectionLimit && <p role="alert">Choose at most {selectionLimit} calendars.</p>}
      <div className="integration-actions"><button className="primary-button" disabled={locked || !connection.listFetchedAt || selected.length > selectionLimit || selected.some(id => !connection.calendars.some(c => c.id === id)) || error?.kind === "CALENDAR_VERSION"} onClick={() => void execute({ url: `/api/calendar/${connection.id}`, method: "PATCH", body: { expectedVersion: connection.version, calendarIds: selected }, kind: "select" })}>Save calendar selection</button>{dirty || locked ? <span aria-disabled="true">Save your choices before returning to planning</span> : <a href="/planning">Return to weekly planning</a>}</div>
      {dirty && <p className="small-note">You have unsaved calendar choices.</p>}
      <button className="text-button" disabled={locked || dirty} onClick={() => void connect()}>Connect a different Google account</button>
    </>}
    {connection && connection.state !== "disconnected" && <div className="integration-disconnect"><button ref={disconnectButton} className="text-button" disabled={locked} onClick={() => setDisconnectOpen(true)}>Disconnect Google Calendar</button></div>}
    {disconnectOpen && connection && <DisconnectDialog cancel={() => setDisconnectOpen(false)} confirm={() => void execute({ url: `/api/calendar/${connection.id}/disconnect`, method: "POST", kind: "disconnect" })} />}
  </article><p className="settings-integration-note">Calendar access is read-only. One Better reads busy timing and never edits your Google events.</p></section>;
}
