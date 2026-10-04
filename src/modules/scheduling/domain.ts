import { sessionMilliseconds, type FocusSession } from "../focus/domain";
import { Temporal } from "@js-temporal/polyfill";
import { z } from "zod";
import { ApplicationError } from "../../domain/errors";
import { currentWeek, calendarDate, type PlanningSnapshot, type WeeklyPlan } from "../planning/domain";
import { canAmend, type EffectivePlan } from "../amendments/domain";
import { expandFocusableDay, intersectIntervals, type FocusableHoursSchedule } from "../availability/domain";
import { freshnessMinutes, weekRange, type Availability, type BusyInterval } from "../calendar/domain";

export type TimeBlock = { id: string; planId: string; commitmentId: string; start: string; end: string; state: "planned" | "cancelled"; version: number; createdAt: string; updatedAt: string; cancelledAt: string | null; snapshot: PlanningSnapshot };
export type OwnedBlock = TimeBlock & { ownerId: string };
export const timeSchema = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use HH:mm within one day (00:00–23:59).");
const placement = { commitmentId: z.uuid(), date: z.string().refine(calendarDate, "Choose a valid local date."), startTime: timeSchema, endTime: timeSchema };
const version = z.number().int().min(1).max(2147483646);
export const previewSchema = z.strictObject({ ...placement, blockId: z.uuid().optional(), expectedVersion: version.optional() }).refine(v => !!v.blockId === !!v.expectedVersion, "An edited block needs its saved version.");
const approval = { mutationId: z.uuid(), expectedPlanVersion: version, reviewKey: z.string().regex(/^[a-f0-9]{64}$/), acknowledgeOutsideHours: z.boolean(), acknowledgeBusy: z.boolean() };
export const createBlockSchema = z.strictObject({ ...placement, ...approval });
export const editBlockSchema = z.strictObject({ ...placement, ...approval, expectedVersion: version });
export const cancelBlockSchema = z.strictObject({ mutationId: z.uuid(), expectedVersion: version });
export type Placement = z.infer<typeof previewSchema>;
export type SchedulingContext = { plan: WeeklyPlan; effective: EffectivePlan; userTimezone: string; hours: FocusableHoursSchedule | null; calendar: Availability; blocks: TimeBlock[]; calendarIdentity: string; execution?: Pick<FocusSession,"timeBlockId"|"startedAt"|"endedAt">[] };
export type PlacementReview = { interval: BusyInterval; adjustments: string[]; outsideHours: boolean; hoursConfigured: boolean; busyConflict: boolean | null; calendarStatus: "fresh" | "stale" | "unknown"; fetchedAt: string | null; budgetMinutes: number; scheduledMinutes: number; resultingMinutes: number; planVersion: number; reviewKey: string };
export const elapsedMinutes = (v: BusyInterval) => Number(Temporal.Instant.from(v.end).epochNanoseconds - Temporal.Instant.from(v.start).epochNanoseconds) / 60_000_000_000;
export function overlaps(a: BusyInterval, b: BusyInterval) { return Temporal.Instant.compare(a.start, b.end) < 0 && Temporal.Instant.compare(b.start, a.end) < 0; }
export function resolvePlacement(plan: Pick<WeeklyPlan,"weekStartDate"|"timezone">, value: Pick<Placement,"date"|"startTime"|"endTime">) {
  if (value.startTime >= value.endTime) throw new ApplicationError("VALIDATION", "Start must be before end on the same local date. Overnight blocks are not supported.");
  const range = weekRange(plan.weekStartDate, plan.timezone);
  if (!range.days.some(d => d.date === value.date)) throw new ApplicationError("VALIDATION", "Choose a date inside this planning week.");
  const adjustments: string[] = [];
  const boundary = (time: string) => {
    const local = Temporal.PlainDateTime.from(`${value.date}T${time}`);
    const resolved = local.toZonedDateTime(plan.timezone, { disambiguation: "compatible" });
    if (resolved.toPlainDate().toString() !== value.date) throw new ApplicationError("VALIDATION", "The clock change moves this boundary outside the chosen date.");
    if (local.toZonedDateTime(plan.timezone,{disambiguation:"earlier"}).epochNanoseconds !== local.toZonedDateTime(plan.timezone,{disambiguation:"later"}).epochNanoseconds) adjustments.push(`${time} resolves to ${resolved.toPlainTime().toString({smallestUnit:"minute"})} (${resolved.offset}).`);
    return resolved.toInstant().toString();
  };
  const interval = { start: boundary(value.startTime), end: boundary(value.endTime) };
  if (Temporal.Instant.compare(interval.start, interval.end) >= 0) throw new ApplicationError("VALIDATION", "These times have no positive elapsed duration after the clock change. Choose different boundaries.");
  if (Temporal.Instant.compare(interval.start,range.start)<0 || Temporal.Instant.compare(interval.end,range.end)>0) throw new ApplicationError("VALIDATION", "Keep the entire block inside its planning week.");
  return { interval, adjustments };
}
export function ownedBlock(value: OwnedBlock | null, owner: string): TimeBlock {
  if (!value || value.ownerId !== owner) throw new ApplicationError("NOT_FOUND", "This time block is unavailable.");
  const { ownerId: _owner, ...dto } = value; void _owner; return dto;
}
export function requireScheduling(context: SchedulingContext, now: string) {
  if (!canAmend(context.plan, now, context.userTimezone)) throw new ApplicationError("CONFLICT", "Only current or future committed weeks can be scheduled.", {kind:"READ_ONLY_WEEK"});
}
export function requireFutureBlock(block: TimeBlock, expectedVersion: number, now: string) {
  if (block.version !== expectedVersion) throw new ApplicationError("CONFLICT", "This time block changed elsewhere. Review the latest saved block before retrying.", {kind:"BLOCK_VERSION",current:block});
  if (block.state !== "planned") throw new ApplicationError("CONFLICT", "Cancelled blocks are preserved and cannot change.", {kind:"CANCELLED"});
  if (Temporal.Instant.compare(block.start, now) <= 0) throw new ApplicationError("CONFLICT", "This block has started. Its schedule is preserved for later review.", {kind:"STARTED"});
}
export function evaluatePlacement(context: SchedulingContext, value: Placement, now: string): Omit<PlacementReview,"reviewKey"> {
  requireScheduling(context, now);
  const commitment = context.effective.commitments.find(c => c.id === value.commitmentId);
  if (!commitment) throw new ApplicationError("NOT_FOUND", "This current commitment is unavailable.");
  if (value.blockId) {
    const existing = context.blocks.find(b => b.id === value.blockId);
    if (!existing) throw new ApplicationError("NOT_FOUND", "This time block is unavailable.");
    requireFutureBlock(existing, value.expectedVersion!, now);
    requireUnexecuted(context, existing.id);
    if (existing.commitmentId !== value.commitmentId) throw new ApplicationError("VALIDATION", "A block cannot move to another commitment. Cancel it and create another.");
  }
  const {interval,adjustments} = resolvePlacement(context.plan,value);
  if (Temporal.Instant.compare(interval.start,now)<=0) throw new ApplicationError("VALIDATION", "Choose a future start time. Past schedule history cannot be created or rewritten.");
  if (context.blocks.some(b => b.state === "planned" && b.id !== value.blockId && overlaps(b,interval))) throw new ApplicationError("CONFLICT", "This overlaps another planned local time block. Choose different times.", {kind:"LOCAL_OVERLAP"});
  // A Plan-local day can span two User-local dates after a timezone change.
  const localDate = Temporal.Instant.from(interval.start).toZonedDateTimeISO(context.userTimezone).toPlainDate();
  const lastDate = Temporal.Instant.from(interval.end).toZonedDateTimeISO(context.userTimezone).toPlainDate();
  const focusable: BusyInterval[] = [];
  for (let day=localDate; Temporal.PlainDate.compare(day,lastDate)<=0; day=day.add({days:1})) focusable.push(...expandFocusableDay(context.hours?.windows ?? [],day.toString(),context.userTimezone).intervals);
  const covered = intersectIntervals(focusable,[interval]).reduce((n,v)=>n+elapsedMinutes(v),0);
  const outsideHours = Math.abs(covered-elapsedMinutes(interval))>1e-8;
  const calendar = context.calendar, range = weekRange(calendar.weekStartDate,calendar.timezone);
  const known = (calendar.status === "fresh" || calendar.status === "stale") && calendar.intervals !== null && Temporal.Instant.compare(interval.start,range.start)>=0 && Temporal.Instant.compare(interval.end,range.end)<=0;
  const calendarStatus = !known ? "unknown" : calendar.status === "stale" || !!calendar.error || !calendar.fetchedAt || Date.parse(now)-Date.parse(calendar.fetchedAt)>=freshnessMinutes*60_000 ? "stale" : "fresh";
  const scheduledMinutes = context.blocks.filter(b=>b.state==="planned" && b.planId===context.plan.id && b.commitmentId===commitment.id).reduce((n,b)=>n+elapsedMinutes(b),0);
  const replaced = value.blockId ? context.blocks.find(b=>b.id===value.blockId)! : null;
  return {interval,adjustments,outsideHours,hoursConfigured:!!context.hours?.windows.length,busyConflict:known ? calendar.intervals!.some(v=>overlaps(v,interval)) : null,calendarStatus,fetchedAt:known?calendar.fetchedAt:null,budgetMinutes:commitment.budgetMinutes,scheduledMinutes,resultingMinutes:scheduledMinutes-(replaced?elapsedMinutes(replaced):0)+elapsedMinutes(interval),planVersion:context.plan.version};
}
export function requireUnexecuted(context: SchedulingContext, id: string) {
  if (context.execution?.some(s=>s.timeBlockId===id)) throw new ApplicationError("CONFLICT", "Focus execution has begun for this block. Its original schedule is preserved; create another block if needed.", {kind:"EXECUTION_LOCKED"});
}
export function schedulingView(context: SchedulingContext, now: string) {
  const canSchedule = canAmend(context.plan,now,context.userTimezone);
  const blocks = context.blocks.filter(b=>b.planId===context.plan.id).map(block=>({...block,executionLocked:!!context.execution?.some(s=>s.timeBlockId===block.id),recordedMilliseconds:(context.execution??[]).filter(s=>s.timeBlockId===block.id).reduce((n,s)=>n+sessionMilliseconds(s),0),canFocus:canSchedule&&context.plan.weekStartDate===currentWeek(now,context.userTimezone)&&block.state==="planned",reviewRequired:block.state==="planned" && !context.effective.commitments.some(c=>c.id===block.commitmentId),canCancel:!context.execution?.some(s=>s.timeBlockId===block.id) && canSchedule && block.state==="planned" && Temporal.Instant.compare(block.start,now)>0,canEdit:!context.execution?.some(s=>s.timeBlockId===block.id) && canSchedule && block.state==="planned" && Temporal.Instant.compare(block.start,now)>0 && context.effective.commitments.some(c=>c.id===block.commitmentId)}));
  const commitments = context.effective.commitments.map(c=>({ ...c,recordedMilliseconds:blocks.filter(b=>b.commitmentId===c.id).reduce((n,b)=>n+b.recordedMilliseconds,0),scheduledMinutes:blocks.filter(b=>b.state==="planned" && b.commitmentId===c.id).reduce((n,b)=>n+elapsedMinutes(b),0) }));
  return {planId:context.plan.id,weekStartDate:context.plan.weekStartDate,timezone:context.plan.timezone,userTimezone:context.userTimezone,planVersion:context.plan.version,canSchedule,commitments,blocks};
}
export type SchedulingView = ReturnType<typeof schedulingView>;
