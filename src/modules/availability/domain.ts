import { Temporal } from "@js-temporal/polyfill";
import { z } from "zod";
import { timezoneSchema } from "../../domain/timezone";
import { busyTotals, freshnessMinutes, mergeBusyIntervals, validate, weekRange, type Availability, type BusyInterval } from "../calendar/domain";
export const sparePercentSchema = z.union([z.literal(0), z.literal(25), z.literal(40)]);
export type SparePercent = z.infer<typeof sparePercentSchema>;
export function reserveForBudget(minutes: number, percent: number) { return Math.ceil(minutes * percent / (100 - percent)); }
export type FocusableWindow = { weekday: number; startMinute: number; endMinute: number };
export type FocusableHoursSchedule = { id: string; version: number; windows: FocusableWindow[]; sparePercent?: SparePercent; createdAt: string; updatedAt: string };
export type HoursSettings = { schedule: FocusableHoursSchedule | null; timezone: string };
export const weekdayNames = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
export const maxWindows = 70;
const windowSchema = z.strictObject({ weekday: z.number().int().min(1).max(7), startMinute: z.number().int().min(0).max(1439), endMinute: z.number().int().min(1).max(1440) }).refine(w => w.startMinute < w.endMinute, "Start must be before end on the same day. Split overnight hours across two days.");
export const windowsSchema = z.array(windowSchema).max(maxWindows).superRefine((windows, ctx) => {
  for (let day = 1; day <= 7; day++) {
    const entries = windows.map((w, index) => ({ ...w, index })).filter(w => w.weekday === day).sort((a,b) => a.startMinute - b.startMinute);
    for (let i = 1; i < entries.length; i++) if (entries[i].startMinute < entries[i-1].endMinute) ctx.addIssue({ code: "custom", path: [entries[i].index], message: `${weekdayNames[day-1]} windows overlap. Adjust or remove a window.` });
  }
});
export const saveHoursSchema = z.strictObject({ mutationId: z.uuid(), scheduleId: z.uuid().nullable(), expectedVersion: z.number().int().min(0).max(2147483646), windows: windowsSchema, sparePercent: sparePercentSchema.optional() }).refine(v => (v.scheduleId === null) === (v.expectedVersion === 0), "Review the saved hours before saving.");
export const wallTime = (minutes: number) => `${String(Math.floor(minutes/60)).padStart(2,"0")}:${String(minutes%60).padStart(2,"0")}`;
export function wallMinutes(value: string): number | null {
  if (value === "24:00") return 1440;
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(value)) return null;
  const [hour, minute] = value.split(":").map(Number); return hour * 60 + minute;
}
const ns = (instant: string) => Temporal.Instant.from(instant).epochNanoseconds;
const str = (instant: bigint) => Temporal.Instant.fromEpochNanoseconds(instant).toString();
// Shared day expansion keeps scheduling and recurring availability on one DST policy.
export function expandFocusableDay(windows: FocusableWindow[], localDate: string, timezone: string) {
  const date = Temporal.PlainDate.from(localDate);
  const day = { start: date.toZonedDateTime(timezone).toInstant().toString(), end: date.add({ days: 1 }).toZonedDateTime(timezone).toInstant().toString() };
  const intervals: BusyInterval[] = [], adjustments: string[] = [];
  for (const window of windows.filter(w => w.weekday === date.dayOfWeek)) {
    const boundary = (minute: number) => {
      const local = minute === 1440 ? date.add({ days: 1 }).toPlainDateTime("00:00") : date.toPlainDateTime(wallTime(minute));
      const zoned = local.toZonedDateTime(timezone, { disambiguation: "compatible" });
      if (local.toZonedDateTime(timezone, { disambiguation: "earlier" }).epochNanoseconds !== local.toZonedDateTime(timezone, { disambiguation: "later" }).epochNanoseconds) adjustments.push(`${date}: ${wallTime(minute)} uses ${zoned.toPlainTime().toString({ smallestUnit: "minute" })} (${zoned.offset}).`);
      return zoned.epochNanoseconds;
    };
    const start = boundary(window.startMinute), end = boundary(window.endMinute);
    const lo = start > ns(day.start) ? start : ns(day.start), hi = end < ns(day.end) ? end : ns(day.end);
    if (lo < hi) intervals.push({ start: str(lo), end: str(hi) });
    else adjustments.push(`${date}: ${wallTime(window.startMinute)}–${wallTime(window.endMinute)} has no elapsed time after the clock change; omitted for this date.`);
  }
  // Some timezone transitions skip a whole local date. Its day range is empty;
  // retain the omitted-window notices without passing an empty range to union.
  return { intervals: ns(day.start) < ns(day.end) ? mergeBusyIntervals(intervals, day) : [], adjustments };
}
export function expandFocusableWindows(windows: FocusableWindow[], week: string, timezone: string) {
  validate(windowsSchema, windows); validate(timezoneSchema, timezone); const range = weekRange(week, timezone);
  const days = range.days.map(day => expandFocusableDay(windows, day.date, timezone));
  return { range, intervals: mergeBusyIntervals(days.flatMap(d => d.intervals), range), adjustments: days.flatMap(d => d.adjustments) };
}
// Inputs are normalized unions; all operations use half-open instant boundaries.
export function intersectIntervals(left: BusyInterval[], right: BusyInterval[]): BusyInterval[] {
  const result: BusyInterval[] = [];
  for (const a of left) for (const b of right) { const start = ns(a.start) > ns(b.start) ? ns(a.start) : ns(b.start); const end = ns(a.end) < ns(b.end) ? ns(a.end) : ns(b.end); if (start < end) result.push({ start: str(start), end: str(end) }); }
  return result;
}
export function subtractIntervals(windows: BusyInterval[], blocked: BusyInterval[]): BusyInterval[] {
  const result: BusyInterval[] = [];
  for (const window of windows) {
    let cursor = ns(window.start); const end = ns(window.end);
    for (const block of blocked) { const lo = ns(block.start), hi = ns(block.end); if (hi <= cursor || lo >= end) continue; if (lo > cursor) result.push({ start: str(cursor), end: str(lo) }); if (hi > cursor) cursor = hi; if (cursor >= end) break; }
    if (cursor < end) result.push({ start: str(cursor), end: str(end) });
  }
  return result;
}
export type FocusAvailability = {
  weekStartDate: string; timezone: string; scheduleVersion: number;
  status: "not_configured" | "available" | "stale" | "unavailable" | "incomplete";
  focusableMinutes: number; blockedMinutes: number | null; openMinutes: number | null;
  focusable: BusyInterval[]; blocked: BusyInterval[] | null; open: BusyInterval[] | null;
  days: { date: string; focusableMinutes: number; blockedMinutes: number | null; openMinutes: number | null; focusable: BusyInterval[]; blocked: BusyInterval[] | null; open: BusyInterval[] | null }[];
  fetchedAt: string | null; error: Availability["error"]; adjustments: string[];
};
export function deriveFocusAvailability(schedule: FocusableHoursSchedule | null, calendar: Availability, now = Date.now()): FocusAvailability {
  const { range, intervals: focusable, adjustments } = expandFocusableWindows(schedule?.windows ?? [], calendar.weekStartDate, calendar.timezone);
  const configured = !!schedule?.windows.length;
  const known = configured && (calendar.status === "fresh" || calendar.status === "stale") && calendar.intervals !== null;
  const busy = known ? mergeBusyIntervals(calendar.intervals!, range) : null;
  const blocked = busy ? mergeBusyIntervals(intersectIntervals(focusable, busy), range) : null;
  const open = blocked ? subtractIntervals(focusable, blocked) : null;
  const totals = (v: BusyInterval[]) => busyTotals(v, range);
  const focusTotals = totals(focusable), blockedTotals = blocked && totals(blocked), openTotals = open && totals(open);
  const status = !configured ? "not_configured" : known ? calendar.status === "stale" || !!calendar.error || !calendar.fetchedAt || now - Date.parse(calendar.fetchedAt) >= freshnessMinutes*60_000 ? "stale" : "available" : calendar.error === "incomplete" ? "incomplete" : "unavailable";
  return { weekStartDate: calendar.weekStartDate, timezone: calendar.timezone, scheduleVersion: schedule?.version ?? 0, status, focusableMinutes: focusTotals.totalBusyMinutes, blockedMinutes: blockedTotals?.totalBusyMinutes ?? null, openMinutes: openTotals?.totalBusyMinutes ?? null, focusable, blocked, open, fetchedAt: known ? calendar.fetchedAt : null, error: calendar.error, adjustments,
    days: range.days.map((day,i) => ({ date: day.date, focusableMinutes: focusTotals.days[i].busyMinutes, blockedMinutes: blockedTotals?.days[i].busyMinutes ?? null, openMinutes: openTotals?.days[i].busyMinutes ?? null, focusable: intersectIntervals(focusable, [day]), blocked: blocked && intersectIntervals(blocked, [day]), open: open && intersectIntervals(open, [day]) })) };
}
