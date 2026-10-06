import {expect,it} from 'vitest';
import {remainingOpenMinutes,suggestWeek} from '../../src/modules/planning/quick-schedule';
import {deriveFocusAvailability} from '../../src/modules/availability/domain';
import {context,block} from '../scheduling-fixtures';
const ctx=context(), now=Date.parse('2026-10-05T07:00:00Z');
function input(){return {week:'2026-10-05',timezone:'Europe/London',now,availability:deriveFocusAvailability(ctx.hours,{...ctx.calendar,fetchedAt:new Date(now).toISOString()},now),occupied:[],choices:[{actionId:'first',budgetMinutes:240},{actionId:'second',budgetMinutes:180}]};}
it('suggested week places only selected budgets, spreads days and never overlaps busy/local blocks',()=>{
 const value=input();value.availability.open=[{start:'2026-10-05T08:00:00Z',end:'2026-10-05T12:00:00Z'},{start:'2026-10-06T08:00:00Z',end:'2026-10-06T12:00:00Z'}];
 const occupied=block({start:'2026-10-05T08:00:00Z',end:'2026-10-05T09:00:00Z'});
 const result=suggestWeek({...value,occupied:[occupied]});expect(result.available).toBe(true);expect(result.unplacedMinutes).toBe(0);expect(new Set(result.blocks.map(b=>b.date)).size).toBe(2);
 for(const b of result.blocks){expect(b.minutes).toBeLessThanOrEqual(90);expect(Date.parse(b.start)).toBeGreaterThan(now);expect(value.availability.open.some(w=>b.start>=w.start&&b.end<=w.end)).toBe(true);expect(Date.parse(b.start)<Date.parse(occupied.end)&&Date.parse(b.end)>Date.parse(occupied.start)).toBe(false);}
 for(const c of value.choices)expect(result.blocks.filter(b=>b.actionId===c.actionId).reduce((n,b)=>n+b.minutes,0)).toBe(c.budgetMinutes);
 for(let i=0;i<result.blocks.length;i++)for(let j=i+1;j<result.blocks.length;j++)expect(result.blocks[i].start<result.blocks[j].end&&result.blocks[i].end>result.blocks[j].start).toBe(false);
 expect(suggestWeek({...value,occupied:[occupied]})).toEqual(result);
});
it('unknown/stale/incomplete coverage abstains and shortage remains explicitly unplaced',()=>{
 for(const status of ['stale','unavailable','incomplete','not_configured'] as const)expect(suggestWeek({...input(),availability:{...input().availability,status}})).toMatchObject({available:false,blocks:[],unplacedMinutes:420});
 expect(suggestWeek({...input(),availability:null})).toMatchObject({available:false,blocks:[]});
 const availability={...input().availability,open:[{start:'2026-10-05T08:00:00Z',end:'2026-10-05T08:30:00Z'}]};
 expect(suggestWeek({...input(),availability})).toMatchObject({unplacedMinutes:390,blocks:[{minutes:30}]});
 expect(suggestWeek({...input(),choices:[{actionId:'tiny',budgetMinutes:7}]})).toMatchObject({blocks:[],unplacedMinutes:7});
});
it('started windows are skipped; ambiguous DST boundaries are never silently shifted',()=>{
 const value=input();value.now=Date.parse('2026-10-05T11:07:00Z');value.availability.open=[{start:'2026-10-05T08:00:00Z',end:'2026-10-05T12:00:00Z'}];
 const result=suggestWeek(value);expect(result.blocks[0].startTime).toBe('12:15');expect(result.unplacedMinutes).toBe(375);
 const folded=suggestWeek({...value,now:Date.parse('2026-10-24T00:00Z'),week:'2026-10-19',availability:{...value.availability,weekStartDate:'2026-10-19',open:[{start:'2026-10-25T01:15:00Z',end:'2026-10-25T01:45:00Z'}]}});
 expect(folded.blocks).toEqual([]);expect(folded.unplacedMinutes).toBe(420);
});

it('remaining capacity excludes elapsed time and existing local blocks, with unknown coverage kept unknown',()=>{
 const value={...input(),now:Date.parse('2026-10-05T10:00:00Z'),occupied:[block({start:'2026-10-06T09:00:00Z',end:'2026-10-06T10:00:00Z'})]};
 expect(remainingOpenMinutes(value)).toBe(37*60);expect(remainingOpenMinutes({...value,availability:null})).toBeNull();
});
