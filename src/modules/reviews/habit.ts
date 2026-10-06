import { addDays } from '../planning/domain';
import { localDate } from '../focus/domain';
export function deriveHabitProgress(input:{timezone:string;now:string;sessions:{startedAt:string;endedAt:string|null}[];reflections:{localDate:string;status:'draft'|'finalized';finalizedAt:string|null}[]}) {
 const today=localDate(input.now,input.timezone),now=Date.parse(input.now),days=new Set<string>();
 for(const s of input.sessions)if(s.endedAt&&Date.parse(s.endedAt)<=now&&Date.parse(s.endedAt)>Date.parse(s.startedAt))days.add(localDate(s.endedAt,input.timezone));
 for(const r of input.reflections)if(r.status==='finalized'&&r.finalizedAt&&Date.parse(r.finalizedAt)<=now&&r.localDate<=today)days.add(localDate(r.finalizedAt,input.timezone));
 const dates=[...days].filter(d=>d<=today).sort();
 let best=0,run=0,previous='';
 for(const date of dates){run=previous&&date===addDays(previous,1)?run+1:1;best=Math.max(best,run);previous=date;}
 let current=0,at=days.has(today)?today:addDays(today,-1);
 while(days.has(at)){current++;at=addDays(at,-1);}
 return {today,timezone:input.timezone,current,best,todayDone:days.has(today),recent:Array.from({length:7},(_,i)=>{const date=addDays(today,i-6);return {date,done:days.has(date)};})};
}
export type HabitProgress=ReturnType<typeof deriveHabitProgress>;
