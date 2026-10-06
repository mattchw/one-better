import {it,expect} from 'vitest';
import {deriveHabitProgress} from '../../src/modules/reviews/habit';
const now='2026-10-05T12:00:00Z',timezone='Europe/London';
const session=(endedAt:string)=>({startedAt:new Date(Date.parse(endedAt)-60000).toISOString(),endedAt});
const reflection=(localDate:string,status:'finalized'|'draft'='finalized',finalizedAt:string|null=`${localDate}T10:00:00Z`)=>({localDate,status,finalizedAt});
it('counts showing up once per local day, across focus and finalized reflection, without a productivity score',()=>{
 const result=deriveHabitProgress({now,timezone,sessions:[session('2026-10-03T10:00Z'),session('2026-10-05T11:00Z'),session('2026-10-05T11:10Z')],reflections:[reflection('2026-10-04'),reflection('2026-10-05')]});
 expect(result.current).toBe(3);expect(result.best).toBe(3);expect(result.todayDone).toBe(true);expect(result.recent.filter(d=>d.done)).toHaveLength(3);expect(result).not.toHaveProperty('score');
});
it('allows today to be unfinished and breaks only after a missed day',()=>{
 const input={now,timezone,sessions:[],reflections:[reflection('2026-10-03'),reflection('2026-10-04')]};
 expect(deriveHabitProgress(input).current).toBe(2);expect(deriveHabitProgress({...input,now:'2026-10-06T12:00Z'}).current).toBe(0);
});
it('excludes active/future sessions, drafts, future dates and reflections finalized after the observation time',()=>{
 const result=deriveHabitProgress({now,timezone,sessions:[{startedAt:now,endedAt:null},session('2026-10-06T10:00Z')],reflections:[reflection('2026-10-05','draft',null),reflection('2026-10-06'),reflection('2026-10-04','finalized','2026-10-06T10:00Z')]});
 expect(result.current).toBe(0);expect(result.best).toBe(0);
});
it('uses the finish day in the account time zone across midnight and DST',()=>{
 const result=deriveHabitProgress({timezone,now:'2026-03-30T23:10Z',sessions:[session('2026-03-28T23:10Z'),session('2026-03-29T23:10Z'),session('2026-03-30T23:05Z')],reflections:[reflection('2026-03-29','finalized','2026-03-29T20:00Z')]});
 expect(result.today).toBe('2026-03-31');expect(result.current).toBe(4);
});

it('backfilled reflections count the day of finalization once, without retroactively repairing a streak',()=>{
 const result=deriveHabitProgress({now,timezone,sessions:[],reflections:[reflection('2026-10-02','finalized',now),reflection('2026-10-03','finalized',now),reflection('2026-10-04','finalized',now)]});
 expect(result.current).toBe(1);expect(result.best).toBe(1);expect(result.recent.filter(d=>d.done).map(d=>d.date)).toEqual(['2026-10-05']);
});
