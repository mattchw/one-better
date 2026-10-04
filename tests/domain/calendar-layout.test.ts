import {describe,it,expect} from 'vitest';
import {calendarSegments,outsideCurrentHours} from '../../src/components/calendar-layout';
import type {TimeBlock} from '../../src/modules/scheduling/domain';
import type {FocusableHoursSchedule} from '../../src/modules/availability/domain';
describe('calendar presentation coordinates, with unchanged instants',()=>{
 it('positions a summer instant in the pinned timezone',()=>{expect(calendarSegments({start:'2026-10-05T08:00:00Z',end:'2026-10-05T09:30:00Z'},'2026-10-05','Europe/London')).toEqual([{date:'2026-10-05',startMinute:540,endMinute:630,clockChange:false}]);});
 it('clips across local midnight and excludes dates outside the displayed week',()=>{expect(calendarSegments({start:'2026-10-04T22:30Z',end:'2026-10-05T00:30Z'},'2026-09-28','Europe/London')).toEqual([{date:'2026-10-04',startMinute:1410,endMinute:1440,clockChange:false}]);expect(calendarSegments({start:'2026-10-05T22:30Z',end:'2026-10-06T00:30Z'},'2026-10-05','Europe/London').map(v=>[v.date,v.startMinute,v.endMinute])).toEqual([['2026-10-05',1410,1440],['2026-10-06',0,90]]);});
 it('keeps a repeated-hour block visible and explicitly marks the clock change',()=>{const interval={start:'2026-10-25T00:30Z',end:'2026-10-25T01:15Z'};expect(calendarSegments(interval,'2026-10-19','Europe/London')).toEqual([{date:'2026-10-25',startMinute:90,endMinute:135,clockChange:true}]);expect(interval.end).toBe('2026-10-25T01:15Z');});
 it('distinguishes partial, missing and complete current hours coverage',()=>{const block={start:'2026-10-05T08:30Z',end:'2026-10-05T10:00Z'} as TimeBlock;const schedule={windows:[{weekday:1,startMinute:540,endMinute:720}]} as FocusableHoursSchedule;expect(outsideCurrentHours(block,schedule,'Europe/London')).toBe(false);expect(outsideCurrentHours(block,null,'Europe/London')).toBe(true);expect(outsideCurrentHours({...block,start:'2026-10-05T07:30Z'},schedule,'Europe/London')).toBe(true);});
});
