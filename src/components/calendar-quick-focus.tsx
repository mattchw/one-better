import type {ClientSchedule} from '@/client/calendar-state';
import {Temporal} from '@js-temporal/polyfill';
import { goalGroupKey, goalTitle } from '@/modules/planning/general';
/* Read-only entry into the existing guarded Focus workflow. */
import type { FocusWorkspace } from "@/modules/focus/domain";
import { elapsedMinutes } from "@/modules/scheduling/domain";
import { goalTone } from "./calendar-layout";
import { duration } from "./planning-presentation";
import { Metric, Panel } from "./workspace-ui";

export function CalendarQuickFocus({ execution, schedule, week, now, onInspect }: { execution: FocusWorkspace | null;schedule?:ClientSchedule|null; week: string; now: number; onInspect: (id: string) => void }) {
  const active = execution?.active;

  const details=execution?.todayBlocks.map(detail=>{const block=schedule?.blocks.find(b=>b.id===detail.block.id);if(!block)return detail;const commitment=schedule?.commitments.find(c=>c.id===block.commitmentId);return {...detail,block,canStart:detail.canStart&&!block.pending&&block.state==='planned'&&Temporal.Instant.from(block.start).toZonedDateTimeISO(schedule?.userTimezone??detail.timezone).toPlainDate().equals(Temporal.Instant.fromEpochMilliseconds(now).toZonedDateTimeISO(schedule?.userTimezone??detail.timezone).toPlainDate()),scheduledMinutes:commitment?.scheduledMinutes??detail.scheduledMinutes};})??[];
  const candidates = details.filter(detail => detail.canStart && detail.weekStartDate === week && !detail.sessions.some(session => session.endedAt)) ?? [];
  const current = candidates.find(detail => Date.parse(detail.block.start) <= now && now < Date.parse(detail.block.end));
  const next = candidates.find(detail => Date.parse(detail.block.start) > now);
  const detail = active?.detail ?? current ?? next;
  const block = detail?.block;
  const time = (value: string) => new Intl.DateTimeFormat("en-GB", { timeZone: detail!.timezone, hour: "2-digit", minute: "2-digit" }).format(new Date(value));
  return <Panel className={`calendar-quick-focus ${block ? `tone-${goalTone(goalGroupKey(block.snapshot.goal))}` : ""}`} label="Quick focus">
    <div className="canvas-section-heading"><p className="summary-eyebrow">Quick focus</p>{detail && <span className={`block-detail-status ${active ? "focus-running-badge" : ""}`}>{active ? "● In focus" : current ? "Scheduled now" : "Up next today"}</span>}</div>
    {detail && block ? <>
      <p className="selected-goal"><span className="goal-dot" aria-hidden="true"/>{goalTitle(block.snapshot.goal)}</p>
      {block.snapshot.milestone && <p className="work-milestone">◇ {block.snapshot.milestone.title}</p>}
      <h2>{block.snapshot.action.title}</h2>
      <p className="selected-time">{new Intl.DateTimeFormat("en-GB", { timeZone: detail.timezone, weekday: "short", day: "numeric", month: "short" }).format(new Date(block.start))} · {time(block.start)} – {time(block.end)} ({duration(elapsedMinutes(block))})</p>
      {active && <p className="quick-focus-elapsed"><strong>{duration(Math.max(0, Math.floor((now - Date.parse(active.session.startedAt)) / 60000)))}</strong> focused so far</p>}
      <a className="primary-button start-focus-button" href={`/focus?block=${block.id}`}>{active ? "Continue focus →" : "▶ Start focus"}</a>
      <dl className="block-detail-metrics"><Metric label="Commitment budget" value={detail.budgetMinutes === null ? "Removed from plan" : duration(detail.budgetMinutes)}/><Metric label="Scheduled this week" value={duration(detail.scheduledMinutes)}/><Metric label="Still to place" value={detail.budgetMinutes === null ? "—" : detail.scheduledMinutes >= detail.budgetMinutes ? "Fully scheduled" : duration(detail.budgetMinutes - detail.scheduledMinutes)}/></dl>
      {block.snapshot.action.doneWhen && <div className="selected-done"><strong>Done when</strong><p>{block.snapshot.action.doneWhen}</p></div>}
      {detail.weekStartDate !== week && <p className="canvas-description">This session belongs to the week of {detail.weekStartDate}.</p>}
      {detail.weekStartDate === week && <button className="quiet-button quick-focus-details" onClick={() => onInspect(block.id)}>View block details →</button>}
    </> : <div className="quick-focus-empty"><h2>One block at a time.</h2><p className="canvas-description">{execution ? "Select a scheduled block to focus, or make room for one in your plan." : "Focus context could not be loaded. Open Focus to recover your session."}</p><a className="quiet-button" href="/focus">Open Focus →</a></div>}
  </Panel>;
}
