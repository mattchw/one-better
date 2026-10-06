"use client";
import { goalGroupKey, goalTitle } from '@/modules/planning/general';

import { memo, useCallback, useEffect, useId, useRef, useState, type RefObject } from "react";
import { createPortal } from "react-dom";
import FullCalendar, { type CalendarRef, type EventInput, type EventDisplayInfo } from "@fullcalendar/react";
import timeGridPlugin from "@fullcalendar/react/timegrid";
import interactionPlugin from "@fullcalendar/react/interaction";
import classicTheme from "@fullcalendar/react/themes/classic";
import { Temporal } from "@js-temporal/polyfill";
import type { BusyInterval } from "@/modules/calendar/domain";
import type { SchedulingView } from "@/modules/scheduling/domain";
import { addDays } from "@/modules/planning/domain";
import { outsideCurrentHours, goalTone } from "./calendar-layout";
import type { FocusableHoursSchedule } from "@/modules/availability/domain";
import { hoverPlacement, placementInPlan, type PlacementPrefill } from "./calendar-hover-placement";

export type { PlacementPrefill } from "./calendar-hover-placement";
const stamp = (instant: string, zone: string) => new Intl.DateTimeFormat("en-GB", {
  timeZone: zone, hour: "2-digit", minute: "2-digit", timeZoneName: "shortOffset",
}).format(new Date(instant));
const dateAt = (date: Date, zone: string) => Temporal.Instant.fromEpochMilliseconds(date.getTime()).toZonedDateTimeISO(zone);

type Props = {
  week: string; zone: string; placementZone: string; accountZone: string; now: number;
  day: string | null; weekends: boolean; selected: string | null;
  blocks: SchedulingView["blocks"]; busy: BusyInterval[]; focusable: BusyInterval[];
  hours: FocusableHoursSchedule | null; stale: boolean; canSchedule: boolean;
  onSelect: (id: string) => void;
  onPlace: (placement: PlacementPrefill, trigger: HTMLElement) => void;
};

// The library owns layout only. Events are read models; editable/dragging are disabled.
export default function CalendarTimeGrid(props: Props) {
  const { week, zone, accountZone, now, day, weekends, selected, blocks, busy, hours } = props;
  const calendar = useRef<CalendarRef>(null), container = useRef<HTMLDivElement>(null);
  const tooltipId = useId();
  const [hover, setHover] = useState<{ id: string; left: number; top: number; below: boolean } | null>(null);
  const [ghost, setGhost] = useState<{ placement: PlacementPrefill; left: number; top: number; width: number; height: number } | null>(null);
  const hoveredBlock = blocks.find(block => block.id === hover?.id);
  const occupied = blocks.filter(block => block.state === "planned");
  const clearHover = useCallback(() => { setHover(null); setGhost(null); }, []);
  const showDetails = useCallback((id: string, el: HTMLElement) => {
    const rect = el.getBoundingClientRect(), width = Math.min(320, window.innerWidth - 24);
    setGhost(null);
    setHover({ id, left: Math.max(12, Math.min(rect.left, window.innerWidth - width - 12)), top: rect.top > 260 ? rect.top - 8 : rect.bottom + 8, below: rect.top <= 260 });
  }, []);
  useEffect(() => {
    const clear = () => { setHover(null); setGhost(null); };
    const frame = requestAnimationFrame(clear);
    window.addEventListener("resize", clear);
    window.addEventListener("scroll", clear, true);
    return () => { cancelAnimationFrame(frame); window.removeEventListener("resize", clear); window.removeEventListener("scroll", clear, true); };
  }, [week, day, weekends, props.canSchedule, blocks, busy]);
  useEffect(() => {
    const frame = requestAnimationFrame(() => calendar.current?.getApi().scrollToTime("08:00:00"));
    return () => cancelAnimationFrame(frame);
  }, [week, day, weekends]);
  useEffect(() => {
    container.current?.querySelectorAll<HTMLElement>("[data-calendar-block]").forEach(el => el.setAttribute("aria-pressed", String(el.dataset.calendarBlock === selected)));
  }, [selected]);
  useEffect(() => {
    container.current?.querySelectorAll<HTMLElement>("[data-calendar-block]").forEach(el => {
      if (el.dataset.calendarBlock === hover?.id) el.setAttribute("aria-describedby", tooltipId);
      else el.removeAttribute("aria-describedby");
    });
  }, [hover?.id, tooltipId]);
  return <div ref={container} className="calendar-engine" aria-label={`Scrollable ${day ? "day" : "week"} time grid`} tabIndex={0}
    onPointerLeave={clearHover} onKeyDown={e => { if (e.key === "Escape") clearHover(); }}
    onFocusCapture={e => { const el = (e.target as HTMLElement).closest<HTMLElement>("[data-calendar-block]"); if (el?.dataset.calendarBlock) showDetails(el.dataset.calendarBlock, el); }}
    onBlurCapture={e => { if (!(e.relatedTarget instanceof Node) || !(e.target as HTMLElement).closest("[data-calendar-block]")?.contains(e.relatedTarget)) setHover(null); }}
    onPointerMove={e => {
      if (e.pointerType === "touch" || !props.canSchedule || (e.target as HTMLElement).closest("[data-calendar-block]")) { setGhost(null); return; }
      const root = container.current!, bounds = root.getBoundingClientRect();
      const lane = Array.from(root.querySelectorAll<HTMLElement>("[data-calendar-date]")).find(el => { const r = el.getBoundingClientRect(); return e.clientX >= r.left && e.clientX < r.right && e.clientY >= r.top && e.clientY < r.bottom; });
      const slot = Array.from(root.querySelectorAll<HTMLElement>("[data-slot-time]")).find(el => { const r = el.getBoundingClientRect(); return e.clientY >= r.top && e.clientY < r.bottom; });
      if (!lane || !slot) { setGhost(null); return; }
      const [hour, minute] = slot.dataset.slotTime!.split(":").map(Number);
      const placement = hoverPlacement(lane.dataset.calendarDate!, hour * 60 + minute, zone, now, occupied);
      if (!placement || !placementInPlan(placement, zone, props.placementZone, week)) { setGhost(null); return; }
      const r = slot.getBoundingClientRect(), column = lane.getBoundingClientRect();
      const [endHour, endMinute] = placement.endTime.split(":").map(Number);
      const height = Math.min(r.height * (endHour * 60 + endMinute - hour * 60 - minute) / 30, bounds.bottom - r.top);
      if (r.top < bounds.top || height < 20) { setGhost(null); return; }
      setHover(null);
      setGhost(previous => previous?.placement.date === placement.date && previous.placement.startTime === placement.startTime && previous.placement.endTime === placement.endTime ? previous : { placement, left: column.left - bounds.left + 4, top: r.top - bounds.top, width: column.width - 8, height });
    }}>
    <CalendarSurface value={props} calendar={calendar} onHover={showDetails} onClear={clearHover}/>
    {ghost && <div className="calendar-placement-ghost" data-placement-preview aria-hidden="true" style={{ left: ghost.left, top: ghost.top, width: ghost.width, height: ghost.height }}><span>{ghost.placement.startTime}–{ghost.placement.endTime}</span><strong>+ Time block</strong></div>}
    {hover && hoveredBlock && createPortal(<div id={tooltipId} className="calendar-hover-details" role="tooltip" style={{ left: hover.left, top: hover.top, transform: hover.below ? undefined : "translateY(-100%)" }}>
      <p>{new Intl.DateTimeFormat("en-GB", { timeZone: zone, weekday: "short", day: "numeric", month: "short" }).format(new Date(hoveredBlock.start))} · {stamp(hoveredBlock.start, zone)}–{stamp(hoveredBlock.end, zone)}</p>
      <strong>{hoveredBlock.snapshot.action.title}</strong>
      <p>{goalTitle(hoveredBlock.snapshot.goal)}{hoveredBlock.snapshot.milestone && ` · ${hoveredBlock.snapshot.milestone.title}`}</p>
      {hoveredBlock.snapshot.action.doneWhen && <p className="calendar-hover-done">Done when: {hoveredBlock.snapshot.action.doneWhen}</p>}
      {hoveredBlock.reviewRequired && <p>Review required · commitment removed</p>}
      {outsideCurrentHours(hoveredBlock, hours, accountZone) && <span className="outside-hours-tag">Outside Focusable Hours</span>}
    </div>, document.body)}
  </div>;
}

// Hover state must not reset the calendar layout or its scroll position mid-click.
const CalendarSurface = memo(function CalendarSurface({ value: props, calendar, onHover, onClear }: {
  value: Props; calendar: RefObject<CalendarRef | null>;
  onHover: (id: string, el: HTMLElement) => void; onClear: () => void;
}) {
  const { week, zone, accountZone, now, day, weekends, selected, blocks, busy, focusable, hours, stale } = props;
  const occupied = blocks.filter(block => block.state === "planned");
  const events: EventInput[] = [
    ...focusable.map((interval, index) => ({
      ...interval, id: `hours-${index}`, display: "background", extendedProps: { kind: "hours" },
    })),
    ...busy.map((interval, index) => ({
      ...interval, id: `busy-${index}`, display: "background", extendedProps: { kind: "busy" },
    })),
    ...blocks.map(block => ({
      id: block.id, start: block.start, end: block.end, title: block.snapshot.action.title,
      extendedProps: { kind: "block", block, outside: outsideCurrentHours(block, hours, accountZone) },
    })),
  ];

  function eventLabel(info: EventDisplayInfo) {
    const block = info.event.extendedProps.block as SchedulingView["blocks"][number];
    return `${block.snapshot.action.title}, ${stamp(block.start, zone)} to ${stamp(block.end, zone)}${block.reviewRequired ? ", review required" : ""}${info.event.extendedProps.outside ? ", outside Focusable Hours" : ""}`;
  }

  return <FullCalendar
      ref={calendar}
      key={`${week}-${day ?? "week"}-${weekends}`}
      plugins={[classicTheme, timeGridPlugin, interactionPlugin]}
      initialView={day ? "timeGridDay" : "timeGridWeek"}
      initialDate={day ?? week}
      visibleRange={{ start: day ?? week, end: addDays(day ?? week, day ? 1 : 7) }}
      timeZone={zone}
      locale="en-GB"
      firstDay={1}
      weekends={day ? true : weekends}
      headerToolbar={false}
      allDaySlot={false}
      height="100%"
      slotMinTime="00:00:00"
      slotMaxTime="24:00:00"
      scrollTime="08:00:00"
      slotDuration="00:30:00"
      slotHeaderInterval="01:00:00"
      slotMinHeight={36}
      slotHeaderFormat={{ hour: "2-digit", minute: "2-digit", hour12: false }}
      slotHeaderClass="calendar-slot-label"
      slotLaneClass={info => info.isMinor ? "calendar-half-hour-line" : "calendar-hour-line"}
      slotLaneDidMount={info => { info.el.dataset.slotTime = info.el.dataset.time; }}
      dayHeaderClass="calendar-engine-day-heading"
      dayHeaderContent={info => {
        const local = dateAt(info.date, zone), date = local.toPlainDate(), today = dateAt(new Date(now), zone).toPlainDate();
        const clockChange = Number(date.add({ days: 1 }).toZonedDateTime(zone).epochMilliseconds) - Number(date.toZonedDateTime(zone).epochMilliseconds) !== 86400000;
        return <span className={`calendar-date-heading ${date.equals(today) ? "is-today" : ""}`}>
          <span>{new Intl.DateTimeFormat("en-GB", { weekday: "short", timeZone: zone }).format(info.date)}</span>
          <strong>{local.day}</strong>{date.equals(today) && <small>Today</small>}
          {clockChange && <small>Clock change</small>}
        </span>;
      }}
      dayLaneDidMount={info => { info.el.dataset.calendarDate = dateAt(info.date, zone).toPlainDate().toString(); }}
      now={new Date(now)}
      nowIndicator
      nowIndicatorLineClass="calendar-now"
      nowIndicatorDotClass="calendar-now-dot"
      events={events}
      editable={false}
      selectable={false}
      eventInteractive
      eventMinHeight={26}
      eventShortHeight={48}
      slotEventOverlap={false}
      eventClass={info => {
        const block = info.event.extendedProps.block as SchedulingView["blocks"][number];
        return `calendar-block tone-${goalTone(goalGroupKey(block.snapshot.goal))} ${selected === block.id ? "is-selected" : ""} ${block.reviewRequired ? "needs-review" : ""}`;
      }}
      eventContent={info => {
        const block = info.event.extendedProps.block as SchedulingView["blocks"][number];
        return <div id={`calendar-label-${block.id}`} aria-label={eventLabel(info)} className="calendar-block-content">
          <span className="calendar-block-time"><i aria-hidden="true"/>{stamp(block.start, zone).split(" ")[0]}–{stamp(block.end, zone).split(" ")[0]}{day&&block.canFocus&&<a className="day-start-focus" href={`/focus?block=${block.id}`} onClick={e=>e.stopPropagation()}>▶ Start focus</a>}</span>
          <strong>{block.snapshot.action.title}</strong>
          {block.reviewRequired && <span className="calendar-block-state">Review required</span>}
          {info.event.extendedProps.outside && <span className="calendar-block-outside">◆ Outside hours</span>}
          <span className="calendar-block-goal">{goalTitle(block.snapshot.goal)}</span>
          {day&&block.snapshot.milestone&&<span className="calendar-block-goal">◇ {block.snapshot.milestone.title}</span>}
        </div>;
      }}
      eventDidMount={info => {
        info.el.dataset.calendarBlock = info.event.id;
        info.el.setAttribute("aria-labelledby", `calendar-label-${info.event.id}`);
        info.el.setAttribute("aria-label", eventLabel(info));
        info.el.setAttribute("aria-pressed", String(selected === info.event.id));
      }}
      eventMouseEnter={info => onHover(info.event.id, info.el)}
      eventMouseLeave={onClear}
      eventClick={info => {
        onClear();
        props.onSelect(info.event.id);
        info.el.closest(".calendar-engine")?.querySelectorAll("[aria-pressed]").forEach(el => el.setAttribute("aria-pressed", String(el === info.el)));
      }}
      backgroundEventClass={info => info.event.extendedProps.kind === "busy" ? `busy-interval ${stale ? "is-stale" : ""}` : "availability-background"}
      backgroundEventContent={info => info.event.extendedProps.kind === "busy" ? <span>Busy{stale ? " · stale" : ""}</span> : null}
      backgroundEventDidMount={info => {
        info.el.setAttribute("role", "img");
        const kind = info.event.extendedProps.kind === "busy" ? "Google busy" : "Focusable Hours";
        const weekday = new Intl.DateTimeFormat("en-GB", { timeZone: zone, weekday: "long" }).format(info.event.start!);
        info.el.setAttribute("aria-label", `${kind} ${weekday} ${stamp(info.event.start!.toISOString(), zone)} to ${stamp(info.event.end!.toISOString(), zone)}${stale && kind === "Google busy" ? " · stale timing" : ""}`);
      }}
      dateClick={info => {
        if (!props.canSchedule || info.allDay) return;
        const local = dateAt(info.date, zone), start = local.hour * 60 + local.minute;
        const placement = hoverPlacement(local.toPlainDate().toString(), start, zone, now, occupied);
        const planPlacement = placement && placementInPlan(placement, zone, props.placementZone, week);
        if (!planPlacement) return;
        onClear();
        props.onPlace(planPlacement, info.dayEl);
      }}
    />;
});
