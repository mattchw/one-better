import { Temporal } from "@js-temporal/polyfill";
import type { BusyInterval } from "@/modules/calendar/domain";

export type PlacementPrefill = { date: string; startTime: string; endTime: string };
const time = (minutes: number) => `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;

// A UI suggestion only. The server's placement review remains authoritative.
export function hoverPlacement(date: string, minute: number, zone: string, now: number, occupied: BusyInterval[]): PlacementPrefill | null {
  const startMinute = Math.floor(minute / 30) * 30;
  if (startMinute < 0 || startMinute >= 1440) return null;
  try {
    const start = Temporal.PlainDateTime.from(`${date}T${time(startMinute)}`).toZonedDateTime(zone, { disambiguation: "reject" });
    let end = Temporal.PlainDateTime.from(`${date}T${time(Math.min(startMinute + 60, 1439))}`).toZonedDateTime(zone, { disambiguation: "reject" });
    if (start.epochMilliseconds <= now) return null;
    for (const interval of occupied) {
      const lo = Date.parse(interval.start), hi = Date.parse(interval.end);
      if (lo <= start.epochMilliseconds && hi > start.epochMilliseconds) return null;
      if (lo > start.epochMilliseconds && lo < end.epochMilliseconds) end = Temporal.Instant.fromEpochMilliseconds(lo).toZonedDateTimeISO(zone);
    }
    const endMinute = end.hour * 60 + end.minute;
    if (endMinute <= startMinute || !end.toPlainDate().equals(start.toPlainDate())) return null;
    return { date, startTime: time(startMinute), endTime: time(endMinute) };
  } catch { return null; } // Ambiguous/nonexistent wall times need deliberate manual placement.
}

// Day view can use the account zone while the committed plan keeps its original zone.
export function placementInPlan(placement: PlacementPrefill, displayZone: string, planZone: string, week: string): PlacementPrefill | null {
  try {
    const convert = (wallTime: string) => Temporal.PlainDateTime.from(`${placement.date}T${wallTime}`).toZonedDateTime(displayZone, { disambiguation: "reject" }).withTimeZone(planZone);
    const start = convert(placement.startTime), end = convert(placement.endTime), date = start.toPlainDate().toString();
    if (!end.toPlainDate().equals(start.toPlainDate()) || date < week || date > Temporal.PlainDate.from(week).add({ days: 6 }).toString()) return null;
    // Ambiguous plan wall times cannot carry an offset in the existing editor.
    start.toPlainDateTime().toZonedDateTime(planZone, { disambiguation: "reject" });
    end.toPlainDateTime().toZonedDateTime(planZone, { disambiguation: "reject" });
    const startTime = start.toPlainTime().toString({ smallestUnit: "minute" }), endTime = end.toPlainTime().toString({ smallestUnit: "minute" });
    return endTime > startTime ? { date, startTime, endTime } : null;
  } catch { return null; }
}
