import { Temporal } from "@js-temporal/polyfill";
import { addDays } from "../modules/planning/domain";
import { expandFocusableDay, intersectIntervals, type FocusableHoursSchedule } from "../modules/availability/domain";
import { elapsedMinutes, type TimeBlock } from "../modules/scheduling/domain";
import type { BusyInterval } from "../modules/calendar/domain";
export type CalendarSegment = { date: string; startMinute: number; endMinute: number; clockChange: boolean };
const minute = (v: Temporal.ZonedDateTime) => v.hour*60+v.minute+v.second/60;
// Presentation only: clip instants to each displayed local date, including midnight boundaries.
export function calendarSegments(interval: BusyInterval, week: string, timezone: string): CalendarSegment[] {
  const result: CalendarSegment[] = [];
  for(let i=0;i<7;i++) {
    const date=addDays(week,i),day=Temporal.PlainDate.from(date),start=day.toZonedDateTime(timezone),end=day.add({days:1}).toZonedDateTime(timezone);
    const lo=Math.max(Date.parse(interval.start),Number(start.epochMilliseconds)),hi=Math.min(Date.parse(interval.end),Number(end.epochMilliseconds));
    if(lo>=hi)continue;
    const a=Temporal.Instant.fromEpochMilliseconds(lo).toZonedDateTimeISO(timezone),b=Temporal.Instant.fromEpochMilliseconds(hi).toZonedDateTimeISO(timezone);
    const startMinute=minute(a),wallEnd=hi===Number(end.epochMilliseconds)?1440:minute(b);
    // A repeated-hour interval can have equal/reversed wall labels. Keep it visible,
    // label the clock change, and preserve its exact instants in block details.
    result.push({date,startMinute,endMinute:wallEnd>startMinute?wallEnd:Math.min(1440,startMinute+(hi-lo)/60000),clockChange:a.offset!==b.offset || Number(end.epochMilliseconds)-Number(start.epochMilliseconds)!==86400000});
  }
  return result;
}
export function outsideCurrentHours(block: TimeBlock, schedule: FocusableHoursSchedule | null, timezone: string) {
  let day=Temporal.Instant.from(block.start).toZonedDateTimeISO(timezone).toPlainDate();
  const last=Temporal.Instant.from(block.end).toZonedDateTimeISO(timezone).toPlainDate();
  const windows: BusyInterval[]=[];
  for(;Temporal.PlainDate.compare(day,last)<=0;day=day.add({days:1}))windows.push(...expandFocusableDay(schedule?.windows??[],day.toString(),timezone).intervals);
  const covered=intersectIntervals(windows,[block]).reduce((sum,v)=>sum+elapsedMinutes(v),0);
  return Math.abs(covered-elapsedMinutes(block))>1e-8;
}

export function goalTone(id: string) {
  const tones = ["sage", "lavender", "sand", "blue"];
  let hash = 0;
  for (const letter of id) hash = (hash * 31 + letter.charCodeAt(0)) >>> 0;
  return tones[hash % tones.length];
}
