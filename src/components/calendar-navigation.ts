import { Temporal } from '@js-temporal/polyfill';
import { ApplicationError } from '../domain/errors';
import { calendarDate, mondayOf, addDays } from '../modules/planning/domain';
import type { BusyInterval } from '../modules/calendar/domain';
export type CalendarScale = 'month' | 'week' | 'day';
export function calendarSelection(input: {view?:string;date?:string;week?:string}, timezone:string, now:number) {
 const view=input.view??'week';
 if(!['month','week','day'].includes(view))throw new ApplicationError('VALIDATION','Choose Month, Week or Day.');
 const date=input.date??input.week??Temporal.Instant.fromEpochMilliseconds(now).toZonedDateTimeISO(timezone).toPlainDate().toString();
 if(!calendarDate(date))throw new ApplicationError('VALIDATION','Choose a valid calendar date.');
 return {scale:view as CalendarScale,date,week:mondayOf(date)};
}
export function calendarRange(date:string,scale:CalendarScale,timezone:string) {
 if(!calendarDate(date))throw new ApplicationError('VALIDATION','Choose a valid calendar date.');
 const day=Temporal.PlainDate.from(date),first=scale==='month'?day.with({day:1}):scale==='week'?Temporal.PlainDate.from(mondayOf(date)):day;
 const start=scale==='month'?Temporal.PlainDate.from(mondayOf(first.toString())):first;
 const boundary=scale==='month'?first.add({months:1}):first.add({days:scale==='week'?7:1});
 const end=scale==='month'&&boundary.dayOfWeek!==1?boundary.add({days:8-boundary.dayOfWeek}):boundary;
 return {first:start.toString(),last:end.toString(),start:start.toZonedDateTime(timezone).toInstant().toString(),end:end.toZonedDateTime(timezone).toInstant().toString(),dates:Array.from({length:start.until(end).days},(_,i)=>start.add({days:i}).toString())};
}
export function calendarNavigate(date:string,scale:CalendarScale,direction:number) {
 return Temporal.PlainDate.from(date).add(scale==='month'?{months:direction}:{days:direction*(scale==='week'?7:1)}).toString();
}
export function calendarHref(scale:CalendarScale,date:string) {return `/calendar?view=${scale}&date=${date}`;}
export function dayMilliseconds(interval:BusyInterval,date:string,zone:string) {
 const range=calendarRange(date,'day',zone);
 return Math.max(0,Math.min(Date.parse(interval.end),Date.parse(range.end))-Math.max(Date.parse(interval.start),Date.parse(range.start)));
}
export function calendarHeading(date:string,scale:CalendarScale) {
 const label=(date:string,format:Intl.DateTimeFormatOptions)=>new Intl.DateTimeFormat('en-GB',{timeZone:'UTC',...format}).format(new Date(`${date}T12:00Z`));
 if(scale==='month')return label(date,{month:'long',year:'numeric'});
 if(scale==='day')return label(date,{weekday:'long',day:'numeric',month:'long'});
 const week=mondayOf(date);return `${label(week,{day:'numeric',month:'short'})} – ${label(addDays(week,6),{day:'numeric',month:'short'})}`;
}
