'use client';
import { goalGroupKey } from '@/modules/planning/general';
import {useEffect,useRef,useState} from 'react';
import { calendarRange, type CalendarScale } from './calendar-navigation';
import type { CalendarRangeBlock } from '@/modules/scheduling/calendar-reader';
import { goalTone } from './calendar-layout';
import { duration } from './planning-presentation';
const label=(date:string)=>new Intl.DateTimeFormat('en-GB',{timeZone:'UTC',weekday:'long',day:'numeric',month:'long'}).format(new Date(`${date}T12:00Z`));
export function CalendarMonth({compact,date,zone,today,blocks,selected,locked,onDate,onSelect,onView}:{compact:boolean;date:string;zone:string;today:string;blocks:CalendarRangeBlock[];selected:string|null;locked:boolean;onDate:(date:string)=>void;onSelect:(block:CalendarRangeBlock)=>void;onView:(scale:CalendarScale,date:string)=>void}) {
 const grid=useRef<HTMLDivElement>(null),[rowHeight,setRowHeight]=useState(120);
 const range=calendarRange(date,'month',zone),intervals=blocks.map(block=>({block,start:Date.parse(block.start),end:Date.parse(block.end)}));
 const rows=range.dates.length/7,limit=compact?1:rowHeight>=100?2:rowHeight>=64?1:0;
 useEffect(()=>{const el=grid.current;if(!el)return;const measure=()=>setRowHeight(el.getBoundingClientRect().height/rows);const observer=new ResizeObserver(measure);observer.observe(el);measure();return ()=>observer.disconnect();},[rows]);
 return <div className="calendar-month" aria-label="Month calendar grid">
 <div className="month-weekdays" aria-hidden="true">{['Mon','Tue','Wed','Thu','Fri','Sat','Sun'].map(d=><span key={d}>{d}</span>)}</div>
 <div ref={grid} className="month-days" style={{gridTemplateRows:`repeat(${range.dates.length/7},minmax(0,1fr))`}}>{range.dates.map(day=>{
 const boundary=calendarRange(day,'day',zone),start=Date.parse(boundary.start),end=Date.parse(boundary.end),intersections=intervals.filter(b=>b.start<end&&b.end>start),entries=intersections.map(b=>b.block),minutes=intersections.reduce((n,b)=>n+(Math.min(end,b.end)-Math.max(start,b.start))/60000,0);
 return <section key={day} className={`month-cell ${day.slice(0,7)!==date.slice(0,7)?'month-adjacent':''} ${day===date?'month-selected':''} ${day===today?'month-today':''}`} aria-label={label(day)} onClick={e=>{if(!locked&&!(e.target as HTMLElement).closest('button'))onDate(day);}}>
 <button className="month-date" disabled={locked} aria-label={`Select ${label(day)}`} aria-pressed={day===date} onClick={()=>onDate(day)}>{Number(day.slice(-2))}{day===today&&<span className="month-today-label">Today</span>}</button>
 <div className="month-blocks">{entries.slice(0,limit).map(b=><button key={b.id} data-month-block={b.id} disabled={locked} aria-pressed={selected===b.id} className={`month-block tone-${goalTone(goalGroupKey(b.snapshot.goal))}`} onClick={()=>onSelect(b)} aria-label={b.snapshot.action.title} title={b.snapshot.action.title}>{compact?'•':b.snapshot.action.title}</button>)}</div>
 {entries.length>(limit)&&<button disabled={locked} className="month-overflow" onClick={()=>onView('day',day)}>+{entries.length-(limit)} more</button>}
 {minutes>0&&(rowHeight>=100||entries.length<=1)&&<small className="month-day-total">{duration(minutes)} scheduled</small>}
 </section>;
 })}</div></div>;
}
