import { Temporal } from "@js-temporal/polyfill";
import { z } from "zod";
import { ApplicationError } from "../../domain/errors";
import { timezoneSchema } from "../../domain/timezone";
import { mondayOf, calendarDate } from "../planning/domain";

export const calendarScopes = ["https://www.googleapis.com/auth/calendar.calendarlist.readonly", "https://www.googleapis.com/auth/calendar.events.freebusy"] as const;
export const selectionLimit = 50;
export const freshnessMinutes = 15;
export type Calendar = { id: string; summary: string; primary: boolean; timezone: string | null; accessRole: string };
export type BusyInterval = { start: string; end: string };
export type WeekRange = BusyInterval & { weekStartDate: string; timezone: string; days: { date: string; start: string; end: string }[] };
export type ConnectionState = "connected" | "reauthorization_required" | "disconnected";
export type Connection = { id: string; state: ConnectionState; version: number; calendars: Calendar[]; selectedCalendarIds: string[]; listFetchedAt: string | null; listError: CalendarFailure | null };
export type CalendarFailure = "unavailable" | "incomplete" | "reauthorization_required" | "selection_review";
export const failureMessages: Record<CalendarFailure, string> = {
  unavailable: "Google Calendar could not be reached. Try refreshing again.",
  incomplete: "Calendar availability is incomplete: at least one selected calendar could not be read. Review your selection or retry.",
  reauthorization_required: "Google Calendar needs attention. Reconnect in Integrations.",
  selection_review: "A selected calendar is no longer available. Review your selection in Integrations.",
};
export type Availability = { weekStartDate: string; timezone: string; status: "fresh" | "stale" | "unavailable" | "not_configured"; intervals: BusyInterval[] | null; totalBusyMinutes: number | null; days: { date: string; busyMinutes: number }[]; fetchedAt: string | null; error: CalendarFailure | null };
export type CalendarWorkspace = { configured: boolean; connection: Connection | null; availability: Availability | null };
export const weekSchema = z.string().refine(v => calendarDate(v) && mondayOf(v) === v, "Choose a valid Monday-start week.");
export const selectionSchema = z.strictObject({ expectedVersion: z.number().int().positive(), calendarIds: z.array(z.string().min(1).max(1024)).max(selectionLimit, "Choose at most 50 calendars.").refine(v => new Set(v).size === v.length, "Choose each calendar once.") });
export function validate<T>(schema: z.ZodType<T>, input: unknown): T {
  const parsed = schema.safeParse(input);
  if (!parsed.success) throw new ApplicationError("VALIDATION", parsed.error.issues.map(v => v.message).join(" "));
  return parsed.data;
}
export function canReadBusy(role: string) { return ["freeBusyReader", "reader", "writer", "writerWithoutPrivateAccess", "owner"].includes(role); }
export function selectionMissing(connection: Connection) { return connection.selectedCalendarIds.filter(id => !connection.calendars.some(c => c.id === id && canReadBusy(c.accessRole))); }
export function weekRange(week: string, zone: string): WeekRange {
  validate(weekSchema, week); validate(timezoneSchema, zone);
  const monday = Temporal.PlainDate.from(week);
  // toZonedDateTime(timeZone) means the first valid instant of a local date,
  // including zones whose midnight changes. Never add 24 elapsed hours.
  const boundary = (offset: number) => monday.add({ days: offset }).toZonedDateTime(zone).toInstant().toString();
  return { weekStartDate: week, timezone: zone, start: boundary(0), end: boundary(7), days: Array.from({ length: 7 }, (_, i) => ({ date: monday.add({ days: i }).toString(), start: boundary(i), end: boundary(i + 1) })) };
}
export function normalizeInterval(value: BusyInterval): BusyInterval {
  const start = Temporal.Instant.from(value.start), end = Temporal.Instant.from(value.end);
  if (Temporal.Instant.compare(start, end) >= 0) throw new Error("Invalid busy interval.");
  return { start: start.toString(), end: end.toString() };
}
export function mergeBusyIntervals(input: BusyInterval[], range: BusyInterval): BusyInterval[] {
  const bounds = normalizeInterval(range); const lo = Temporal.Instant.from(bounds.start).epochNanoseconds, hi = Temporal.Instant.from(bounds.end).epochNanoseconds;
  const intervals = input.map(normalizeInterval).map(v => ({ start: Temporal.Instant.from(v.start).epochNanoseconds, end: Temporal.Instant.from(v.end).epochNanoseconds }))
    .map(v => ({ start: v.start < lo ? lo : v.start, end: v.end > hi ? hi : v.end })).filter(v => v.start < v.end)
    .sort((a, b) => a.start < b.start ? -1 : a.start > b.start ? 1 : a.end < b.end ? -1 : a.end > b.end ? 1 : 0);
  const merged: typeof intervals = [];
  for (const value of intervals) { const previous = merged.at(-1); if (previous && value.start <= previous.end) { if (value.end > previous.end) previous.end = value.end; } else merged.push({ ...value }); }
  // Half-open intervals; adjacency merges because their union has no gap.
  return merged.map(v => ({ start: Temporal.Instant.fromEpochNanoseconds(v.start).toString(), end: Temporal.Instant.fromEpochNanoseconds(v.end).toString() }));
}
export function busyTotals(intervals: BusyInterval[], range: WeekRange) {
  const ns = (v: string) => Temporal.Instant.from(v).epochNanoseconds;
  const days = range.days.map(day => ({ date: day.date, busyMinutes: Number(intervals.reduce((sum, v) => { const start = ns(v.start) > ns(day.start) ? ns(v.start) : ns(day.start); const end = ns(v.end) < ns(day.end) ? ns(v.end) : ns(day.end); return sum + (end > start ? end - start : 0n); }, 0n)) / 60_000_000_000 }));
  return { days, totalBusyMinutes: days.reduce((sum, day) => sum + day.busyMinutes, 0) };
}
