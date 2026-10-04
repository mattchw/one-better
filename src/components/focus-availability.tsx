"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { Temporal } from "@js-temporal/polyfill";
import { deriveFocusAvailability, type FocusableHoursSchedule } from "@/modules/availability/domain";
import type { FocusWorkspace } from "@/modules/availability/service";
import type { CalendarWorkspace, BusyInterval } from "@/modules/calendar/domain";
import { CalendarLoad, busyDuration } from "./calendar-load";
import { request } from "./mutation-client";
function intervals(values: BusyInterval[] | null, date: string, timezone: string) {
  if (values === null) return "Unknown"; if (!values.length) return "None";
  const day = Temporal.PlainDate.from(date);
  const showOffset = day.toZonedDateTime(timezone).offset !== day.add({ days: 1 }).toZonedDateTime(timezone).offset;
  const boundary = (instant: string) => { const local = Temporal.Instant.from(instant).toZonedDateTimeISO(timezone); return local.toPlainDate().toString() !== date && local.hour === 0 && local.minute === 0 ? "24:00" : `${String(local.hour).padStart(2,"0")}:${String(local.minute).padStart(2,"0")}${showOffset ? ` ${local.offset}` : ""}`; };
  return values.map(v => `${boundary(v.start)}–${boundary(v.end)}`).join(" · ");
}
export function FocusAvailabilityPanel({ week, manualCapacity }: { week: string; manualCapacity?: number }) {
  const [schedule, setSchedule] = useState<FocusableHoursSchedule | null>(null); const [context, setContext] = useState<CalendarWorkspace | null>(null); const [loaded, setLoaded] = useState(false); const [error, setError] = useState(false); const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 30_000); return () => clearInterval(timer); }, []);
  useEffect(() => { let active = true; request<FocusWorkspace>(`/api/focus-availability?week=${week}`).then(v => { if (active) { setSchedule(v.schedule); setContext(v.calendar); setLoaded(true); } }).catch(() => { if (active) setError(true); }); return () => { active = false; }; }, [week]);
  const data = context?.availability && deriveFocusAvailability(schedule, context.availability, now);
  return <section id="focusable-availability" className="focus-availability" aria-label="Focusable availability"><div className="calendar-heading"><h3>Availability within your Focusable Hours</h3><Link href="/availability">{data?.status === "not_configured" ? "Set up Focusable Hours" : "Edit Focusable Hours"}</Link></div>
    {!loaded && !error && <p className="muted">Loading availability…</p>}{error && <p role="alert">Availability could not be loaded. <a href={`/planning?week=${week}`}>Reload this week</a>. Your weekly plan remains unchanged.</p>}
    {data?.status === "not_configured" && <p className="muted">No Focusable Hours configured. Describe when focused work could fit to calculate Calendar-open focus time.</p>}
    {data && data.status !== "not_configured" && <><p className="small-note">Current recurring settings · {data.timezone} · {data.status === "available" ? "Fresh Calendar timing" : data.status === "stale" ? "Stale · previously fetched Calendar timing" : data.status === "incomplete" ? "Incomplete Calendar timing" : "Calendar information unavailable"}</p><dl className="focus-metrics"><div><dt>Focusable hours</dt><dd>{busyDuration(data.focusableMinutes)}</dd></div><div><dt>Busy inside focusable hours</dt><dd>{data.blockedMinutes === null ? "Unknown" : busyDuration(data.blockedMinutes)}</dd></div><div><dt>Calendar-open focus time</dt><dd>{data.openMinutes === null ? "Unknown" : busyDuration(data.openMinutes)}</dd></div></dl>
      {data.openMinutes === null && <p className="small-note">No complete Calendar timing is available yet. Missing data does not mean free time. Your recurring hours remain configured.</p>}
      {data.status === "stale" && <p className="calendar-warning">Open intervals use the last complete snapshot. Refresh Calendar load below before relying on them.</p>}
      {data.status === "available" && manualCapacity !== undefined && manualCapacity > data.openMinutes! && <p className="capacity-advisory" role="status">Your current capacity is higher than the Calendar-open time inside your Focusable Hours. This is advisory; your plan remains your decision.</p>}
      {data.adjustments.length > 0 && <details className="calendar-warning"><summary>Timezone adjustments affect these windows</summary><ul>{data.adjustments.map((v,i) => <li key={i}>{v}</li>)}</ul></details>}
    </>}
    {loaded && <details className="focus-daily"><summary>See daily focusable, busy and open intervals</summary>{data && data.status !== "not_configured" && <div className="focus-day-list">{data.days.map(day => <article key={day.date} data-focus-date={day.date}><h4>{new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", weekday: "long", day: "numeric", month: "short" }).format(new Date(`${day.date}T12:00:00Z`))}</h4><dl><dt>Focusable</dt><dd>{intervals(day.focusable, day.date, data.timezone)} · {busyDuration(day.focusableMinutes)}</dd><dt>Busy inside</dt><dd>{intervals(day.blocked, day.date, data.timezone)}{day.blockedMinutes !== null && ` · ${busyDuration(day.blockedMinutes)}`}</dd><dt>Open</dt><dd>{intervals(day.open, day.date, data.timezone)}{day.openMinutes !== null && ` · ${busyDuration(day.openMinutes)}`}</dd></dl></article>)}</div>}<CalendarLoad week={week} initialWorkspace={context!} onWorkspace={setContext} /></details>}
    <p className="small-note">Calendar-open time is advisory. Your weekly capacity remains your decision. Empty time is not an instruction to fill it.</p>

  </section>;
}
