import { expect,it } from "vitest";
import { deriveReviewAnalytics } from "../../src/modules/weekly-reviews/analytics";
import { block } from "../scheduling-fixtures";
import { focusSession } from "../focus-fixtures";
const minute=60000;
const empty={startDate:"2026-10-05",days:7,timezone:"Europe/London",now:"2026-10-12T12:00Z",blocks:[],sessions:[],plan:null,reflections:[]};
it("empty, uncommitted and future periods distinguish absent budgets from zero actuals",()=>{
 const v=deriveReviewAnalytics({...empty,now:"2026-10-04T12:00Z"});
 expect(v.budgetMinutes).toBeNull();expect(v.recordedMilliseconds).toBe(0);expect(v.goals).toEqual([]);expect(v.daily.every(d=>d.future)).toBe(true);
});
it("daily and Goal totals reconcile, cancelled time is excluded, subminute precision and notes stay private",()=>{
 const b=block(),cancelled=block({state:"cancelled"}),s=focusSession({timeBlockId:b.id,startedAt:"2026-10-06T09:00Z",endedAt:"2026-10-06T09:00:40Z",outcome:"partial",endNote:"PRIVATE NOTE"});
 const input={...empty,blocks:[b,b,cancelled],sessions:[s,s],plan:{originalMinutes:180,commitments:[{budgetMinutes:120,snapshot:b.snapshot}],reserveMinutes:60},reflections:[{localDate:"2026-10-06",status:"draft" as const}]};
 const before=structuredClone(input),v=deriveReviewAnalytics(input);
 expect(v.scheduledMilliseconds).toBe(90*minute);expect(v.recordedMilliseconds).toBe(40000);expect(v.sessionCount).toBe(1);expect(v.cancelledBlocks).toBe(1);
 expect(v.goals[0]).toMatchObject({budgetMinutes:120,scheduledMilliseconds:90*minute,recordedMilliseconds:40000});
 expect(v.daily.reduce((n,d)=>n+d.recordedMilliseconds,0)).toBe(v.recordedMilliseconds);expect(v.outcomes).toEqual({completed:0,partial:1,abandoned:0,active:0});
 expect(JSON.stringify(v)).not.toContain("PRIVATE NOTE");expect(input).toEqual(before);
});
it("cross-week effort belongs to actual dates and active future contributions are clipped to observation time",()=>{
 const b=block({start:"2026-10-04T21:00Z",end:"2026-10-04T22:00Z"}),s=focusSession({timeBlockId:b.id,startedAt:"2026-10-04T22:40Z"});
 const v=deriveReviewAnalytics({...empty,now:"2026-10-05T00:00Z",blocks:[b],sessions:[s]});
 expect(v.recordedMilliseconds).toBe(60*minute);expect(v.scheduledMilliseconds).toBe(0);expect(v.outcomes.active).toBe(1);expect(v.daily.slice(1).every(d=>d.recordedMilliseconds===0)).toBe(true);
 expect(deriveReviewAnalytics({...empty,blocks:[b],sessions:[{...s,timeBlockId:"foreign"}]}).recordedMilliseconds).toBe(0);
});
it("DST fall-back counts real elapsed time and splits local midnight without double counting",()=>{
 const b=block({start:"2026-10-25T00:30Z",end:"2026-10-25T02:30Z"}),s=focusSession({timeBlockId:b.id,startedAt:"2026-10-25T00:30Z",endedAt:"2026-10-25T02:30Z",outcome:"completed"});
 const v=deriveReviewAnalytics({...empty,startDate:"2026-10-19",now:"2026-10-26T09:00Z",blocks:[b],sessions:[s]});
 expect(v.scheduledMilliseconds).toBe(120*minute);expect(v.recordedMilliseconds).toBe(120*minute);expect(v.daily[6].recordedMilliseconds).toBe(120*minute);
});
