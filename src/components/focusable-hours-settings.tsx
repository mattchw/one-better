"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { saveHoursSchema, wallMinutes, wallTime, weekdayNames, maxWindows, windowsSchema, type SparePercent, type HoursSettings } from "@/modules/availability/domain";
import { request, errorInfo, type CommandError } from "./mutation-client";
type EditorWindow = { key: string; weekday: number; start: string; end: string };
export function FocusableHoursSettings({ initial }: { initial: HoursSettings }) {
  const from = (settings: HoursSettings): EditorWindow[] => settings.schedule?.windows.map((w,i) => ({ key: `saved-${i}`, weekday: w.weekday, start: wallTime(w.startMinute), end: wallTime(w.endMinute) })) ?? [];
  const [spare, setSpare] = useState<SparePercent>(initial.schedule?.sparePercent ?? 25);
  const [saved, setSaved] = useState(initial); const [windows, setWindows] = useState(from(initial)); const [dirty, setDirty] = useState(false); const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<object | null>(null); const [error, setError] = useState<CommandError | null>(null); const [stale, setStale] = useState(false); const [notice, setNotice] = useState("");
  const locked = busy || !!pending;
  useEffect(() => { if (!dirty && !pending) return; const guard = (e: BeforeUnloadEvent) => e.preventDefault(); window.addEventListener("beforeunload", guard); return () => window.removeEventListener("beforeunload", guard); }, [dirty,pending]);
  function changed() { setDirty(true); setNotice(""); if (!stale) setError(null); }
  async function execute(command: object) {
    setBusy(true); setPending(command); setError(null);
    try {
      await request("/api/focusable-hours", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(command) });
      const latest = await request<HoursSettings>("/api/focusable-hours"); setSaved(latest); setWindows(from(latest)); setSpare(latest.schedule?.sparePercent ?? 25); setDirty(false); setPending(null); setStale(false); setNotice("Focusable Hours saved. Your weekly plans remain unchanged.");
    } catch (failure) { const info = errorInfo(failure); setError(info); if (info.kind === "HOURS_VERSION") setStale(true); if (!["UNCERTAIN", "DATABASE_UNAVAILABLE"].includes(info.code)) setPending(null); }
    finally { setBusy(false); }
  }
  function save() {
    const command = { mutationId: crypto.randomUUID(), scheduleId: saved.schedule?.id ?? null, expectedVersion: saved.schedule?.version ?? 0, sparePercent: spare, windows: windows.map(w => ({ weekday: w.weekday, startMinute: wallMinutes(w.start), endMinute: wallMinutes(w.end) })) };
    const valid = saveHoursSchema.safeParse(command);
    if (!valid.success) { setError({ code: "VALIDATION", message: "Use HH:mm on the same day (24:00 is allowed only as an end). Remove overlaps.", fields: Object.fromEntries(valid.error.issues.map((issue,i) => [String(i),issue.message])) }); return; }
    void execute(valid.data);
  }
  async function latest(retain: boolean) {
    setBusy(true);
    try { const result = await request<HoursSettings>("/api/focusable-hours"); setSaved(result); if (!retain) { setWindows(from(result)); setSpare(result.schedule?.sparePercent ?? 25); setDirty(false); } setStale(false); setError(null); setNotice(retain ? "Latest saved hours reviewed. Your unsaved windows are retained; save deliberately to replace them." : "Latest saved hours loaded."); }
    catch (e) { setError(errorInfo(e)); } finally { setBusy(false); }
  }
  const preview = windowsSchema.safeParse(windows.map(w => ({ weekday: w.weekday, startMinute: wallMinutes(w.start), endMinute: wallMinutes(w.end) })));
  const duration = (minutes: number) => `${Math.floor(minutes / 60)}h${minutes % 60 ? ` ${minutes % 60}m` : ""}`;
  const total = preview.success ? preview.data.reduce((sum, w) => sum + w.endMinute - w.startMinute, 0) : null;
  return <section className="hours-settings" aria-labelledby="availability-title">
    <div className="settings-intro"><h2 id="availability-title">Hours</h2><p>When can you do focused work?</p></div>
    <div className="settings-hours-summary"><div><span>Weekly focusable hours{dirty ? " · unsaved" : ""}</span><strong>{total === null ? "Check times" : duration(total)}</strong></div><div><span>Local time zone</span><strong>{saved.timezone}</strong></div></div>
    <div className="settings-section-heading"><h3>Focusable hours</h3><p>Add the windows that work for you. Leave other days empty.</p></div>
    {!saved.schedule?.windows.length && <p className="hours-setup">No Focusable Hours configured. Add only the windows that suit you; there are no assumed working hours.</p>}
    {notice && <p role="status" className="plan-notice">{notice}</p>}
    {error && <div role="alert" className="dialog-error"><p>{error.message}</p>{error.fields && <ul>{Object.values(error.fields).map((v,i) => <li key={i}>{v}</li>)}</ul>}{pending ? <button className="quiet-button" disabled={busy} onClick={() => void execute(pending!)}>Retry same hours save</button> : stale ? <><p>Your unsaved windows are retained. Review before replacing the newer saved hours.</p><button className="quiet-button" disabled={busy} onClick={() => void latest(true)}>Review latest saved hours</button></> : null}</div>}
    <div className="hours-week">{weekdayNames.map((name,i) => <fieldset className="hours-day" key={name} disabled={locked}><legend>{name}</legend><div className="hours-day-body">{!windows.some(w => w.weekday === i+1) && <p className="small-note">No focusable time</p>}{windows.filter(w => w.weekday === i+1).map((w,index) => <div className="hours-window" key={w.key}><label>Start <span className="sr-only">{name} window {index+1}</span><input aria-label={`${name} window ${index+1} start`} placeholder="09:00" inputMode="text" maxLength={5} value={w.start} onChange={e => { setWindows(windows.map(v => v.key === w.key ? { ...v, start: e.target.value } : v)); changed(); }} /></label><span aria-hidden="true">–</span><label>End <span className="sr-only">{name} window {index+1}</span><input aria-label={`${name} window ${index+1} end`} placeholder="12:00" inputMode="text" maxLength={5} value={w.end} onChange={e => { setWindows(windows.map(v => v.key === w.key ? { ...v, end: e.target.value } : v)); changed(); }} /></label><button className="text-button" aria-label={`Remove ${name} window ${index+1}`} onClick={() => { setWindows(windows.filter(v => v.key !== w.key)); changed(); }}>Remove</button></div>)}<button className="quiet-button hours-add" aria-label={`Add ${name} window`} disabled={locked || windows.length >= maxWindows} onClick={() => { setWindows([...windows, { key: crypto.randomUUID(), weekday: i+1, start: "", end: "" }]); changed(); }}>+ Window</button></div></fieldset>)}</div>
    <details className="settings-time-help"><summary>Local times and daylight saving</summary><p className="small-note">Use HH:mm; 24:00 is allowed only as an end. Split overnight hours across two days. Correct overlaps; adjacent windows may stay distinct. Repeated times use their earlier occurrence and skipped times move forward by the gap. The weekly advisory explains affected boundaries.</p></details>
    <fieldset className="settings-spare" disabled={locked}><legend>Spare time</legend><p className="canvas-description">Leave room for the week to change. Used when suggesting a new weekly plan.</p><div>{([0,25,40] as const).map(value => <label key={value}><input type="radio" name="spare-time" checked={spare === value} onChange={() => { setSpare(value); changed(); }}/><span>{value === 0 ? "None" : value === 25 ? "Some (25%)" : "Lots (40%)"}</span></label>)}</div></fieldset>
    <div className="planning-save"><button className="primary-button" disabled={locked || stale || !dirty} onClick={save}>{busy ? "Saving…" : "Save Focusable Hours"}</button><button className="quiet-button" disabled={locked || !dirty} onClick={() => void latest(false)}>Discard unsaved hours</button>{locked || dirty ? <span aria-disabled="true">Save or discard before returning to planning</span> : <Link href="/planning">Return to weekly planning</Link>}</div>

  </section>;
}
