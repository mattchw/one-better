import { randomUUID } from "node:crypto";
import { plan, source, now } from "./planning-fixtures";
import type { SchedulingContext, TimeBlock } from "../src/modules/scheduling/domain";
export { now };
export const placement = { commitmentId:plan.commitments[0].id,date:"2026-10-06",startTime:"10:00",endTime:"11:30" };
export function context():SchedulingContext {
  return {plan:{...structuredClone(plan),state:"committed",weekStartDate:"2026-10-05",committedAt:now,version:3,commitments:plan.commitments.map(c=>({...c,snapshot:structuredClone(source.context)}))},effective:{provisionalCapacityMinutes:720,reserveMinutes:180,commitments:plan.commitments.map(c=>({id:c.id,actionId:c.actionId,budgetMinutes:c.budgetMinutes,source:c.source,snapshot:structuredClone(source.context)}))},userTimezone:"Europe/London",hours:{id:randomUUID(),version:1,windows:Array.from({length:5},(_,i)=>({weekday:i+1,startMinute:540,endMinute:1020})),createdAt:now,updatedAt:now},calendar:{weekStartDate:"2026-10-05",timezone:"Europe/London",status:"fresh",intervals:[],totalBusyMinutes:0,days:[],fetchedAt:now,error:null},calendarIdentity:"fixture",blocks:[]};
}
export function block(extra:Partial<TimeBlock>={}):TimeBlock {return {id:randomUUID(),planId:plan.id,commitmentId:placement.commitmentId,start:"2026-10-06T09:00:00Z",end:"2026-10-06T10:30:00Z",state:"planned",version:1,createdAt:now,updatedAt:now,cancelledAt:null,snapshot:structuredClone(source.context),...extra};}
