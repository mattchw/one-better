"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { failureMessages, freshnessMinutes, type CalendarWorkspace, type Availability } from "@/modules/calendar/domain";
import { duration } from "./planning-presentation";
import { errorInfo, request } from "./mutation-client";
export function busyDuration(minutes: number) { return minutes > 0 && minutes < 1 ? "<1m" : duration(Math.round(minutes)); }
export function CalendarLoad({ week, initialWorkspace, onWorkspace }: { week: string; initialWorkspace?: CalendarWorkspace; onWorkspace?: (workspace: CalendarWorkspace) => void }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 30_000); return () => clearInterval(timer); }, []);
  const [workspace, setWorkspace] = useState<CalendarWorkspace | null>(initialWorkspace ?? null); const [busy, setBusy] = useState(false); const [error, setError] = useState("");
  useEffect(() => { let active = true; request<CalendarWorkspace>(`/api/calendar?week=${week}`).then(value => { if (active) setWorkspace(value); }).catch(() => { if (active) setError("Calendar context could not be loaded. Your weekly plan remains independent."); }); return () => { active = false; }; }, [week]);
  useEffect(() => { if (workspace) onWorkspace?.(workspace); }, [workspace, onWorkspace]);
  async function refresh() {
    setBusy(true); setError("");
    try {
      const current = await request<CalendarWorkspace>(`/api/calendar?week=${week}`); setWorkspace(current);
      if (current.connection?.state === "connected") { const result = await request<{ availability: Availability }>(`/api/calendar/${current.connection.id}/availability`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ weekStartDate: week }) }); const latest = await request<CalendarWorkspace>(`/api/calendar?week=${week}`); setWorkspace(current.connection.id === latest.connection?.id && current.connection.version === latest.connection.version && JSON.stringify(current.connection.selectedCalendarIds) === JSON.stringify(latest.connection.selectedCalendarIds) ? { ...latest, availability: result.availability } : latest); }
    } catch (failure) { setError(errorInfo(failure).message); setWorkspace(previous => previous ? { ...previous, availability: previous.availability && previous.availability.intervals ? { ...previous.availability, status: "stale" } : previous.availability } : null); }
    finally { setBusy(false); }
  }
  const data = workspace?.availability; const connection = workspace?.connection;
  const stale = data?.status === "stale" || !!data?.fetchedAt && now - Date.parse(data.fetchedAt) >= freshnessMinutes * 60_000;
  return <aside className="calendar-load" aria-label="Calendar load">
    <div className="calendar-heading"><h3>Calendar load</h3>{connection?.state === "connected" && connection.selectedCalendarIds.length > 0 && <button className="quiet-button" disabled={busy} onClick={() => void refresh()}>{busy ? "Refreshing…" : "Refresh Calendar load"}</button>}</div>
    {!workspace && !error && <p className="muted">Loading Calendar context…</p>}
    {error && <div role="alert"><p>{error}</p><button className="text-button" disabled={busy} onClick={() => void refresh()}>Retry Calendar context</button></div>}
    {workspace && (!connection || connection.state === "disconnected") && <p className="muted">Optional Calendar context: <Link href="/integrations">connect Google Calendar</Link> to see existing busy time.</p>}
    {connection?.state === "reauthorization_required" && <p><Link href="/integrations">Reconnect Google Calendar</Link>. Previously fetched timing may be out of date.</p>}
    {connection?.state === "connected" && !connection.selectedCalendarIds.length && <p><Link href="/integrations">Choose calendars in Integrations</Link> to retrieve busy time.</p>}
    {data && data.status !== "not_configured" && <>
      {data.error && <p className="calendar-warning" role="alert">{failureMessages[data.error]}</p>}
      {data.intervals ? <>
        <p className="small-note">{!stale ? "Fresh" : "Stale · previously fetched"} · Last successful fetch {new Intl.DateTimeFormat("en-GB", { timeZone: data.timezone, dateStyle: "medium", timeStyle: "short" }).format(new Date(data.fetchedAt!))} · {data.timezone}</p>
        <dl className="calendar-days">{data.days.map(day => <div key={day.date}><dt>{new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", weekday: "short" }).format(new Date(`${day.date}T12:00:00Z`))}</dt><dd>{busyDuration(day.busyMinutes)} busy</dd></div>)}</dl>
        <p className="calendar-total">Google-reported busy time: <strong>{busyDuration(data.totalBusyMinutes!)}</strong></p>
        {stale && <p className="small-note">Refresh to retrieve current timing. Freshness lasts {freshnessMinutes} minutes; failures also mark previous timing stale.</p>}
        {data.days.some(day => !Number.isInteger(day.busyMinutes)) && <p className="small-note">Displayed durations round to the nearest minute.</p>}
      </> : <p className="muted">Calendar availability is unavailable. {data.error ? "No complete timing is available yet." : "Refresh to retrieve this week’s busy time."} Missing data does not mean free time.</p>}
    </>}
    {connection && connection.state !== "disconnected" && <p className="small-note">Calendar load is advisory. Your focus capacity remains your decision. <Link href="/integrations">Calendar settings</Link></p>}
  </aside>;
}
