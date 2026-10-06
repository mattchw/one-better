import { Temporal } from '@js-temporal/polyfill';
import { intersectIntervals, subtractIntervals, type FocusAvailability } from '../availability/domain';
import { weekRange } from '../calendar/domain';
import { elapsedMinutes, resolvePlacement, type TimeBlock } from '../scheduling/domain';
export type SuggestedBlock = { actionId: string; date: string; startTime: string; endTime: string; start: string; end: string; minutes: number };
export type WeekSuggestion = { blocks: SuggestedBlock[]; unplacedMinutes: number; available: boolean };
export function remainingOpenMinutes(input: { week: string; timezone: string; now: number; availability: FocusAvailability | null; occupied: Pick<TimeBlock, 'start' | 'end' | 'state'>[] }): number | null {
  const availability = input.availability;
  if (!availability || availability.status !== 'available' || !availability.open || availability.weekStartDate !== input.week) return null;
  const free = subtractIntervals(intersectIntervals(availability.open, [weekRange(input.week, input.timezone)]), input.occupied.filter(b => b.state === 'planned'));
  return Math.floor(free.reduce((n, w) => n + Math.max(0, Date.parse(w.end) - Math.max(Date.parse(w.start), input.now)) / 60000, 0));
}
// Deterministic, read-only proposals. Existing scheduling commands independently
// validate every accepted placement against current hours, busy time and blocks.
export function suggestWeek(input: {
  week: string; timezone: string; now: number; availability: FocusAvailability | null;
  occupied: Pick<TimeBlock, 'start' | 'end' | 'state'>[];
  choices: { actionId: string; budgetMinutes: number }[];
}): WeekSuggestion {
  const total = input.choices.reduce((n, c) => n + c.budgetMinutes, 0), availability = input.availability;
  if (!availability || availability.status !== 'available' || !availability.open || availability.weekStartDate !== input.week)
    return { blocks: [], unplacedMinutes: total, available: false };
  let free = subtractIntervals(intersectIntervals(availability.open, [weekRange(input.week, input.timezone)]), input.occupied.filter(b => b.state === 'planned'));
  const blocks: SuggestedBlock[] = [], dayLoad = new Map<string, number>();
  const remaining = input.choices.map(c => ({ ...c }));
  // Round robin across priorities and the least used days; do not fill spare time.
  for (let round = 0; round < 60 && remaining.some(c => c.budgetMinutes >= 15); round++) {
    let progressed = false;
    for (const choice of remaining) {
      if (choice.budgetMinutes < 15 || blocks.length >= 60) continue;
      const options: SuggestedBlock[] = [];
      for (const window of free) {
        let at = Temporal.Instant.fromEpochMilliseconds(Math.max(Date.parse(window.start), input.now + 1)).toZonedDateTimeISO(input.timezone).with({ second: 0, millisecond: 0, microsecond: 0, nanosecond: 0 });
        at = at.add({ minutes: (15 - at.minute % 15) % 15 });
        if (at.epochMilliseconds <= input.now || at.epochMilliseconds < Date.parse(window.start)) at = at.add({ minutes: 15 });
        while (at.epochMilliseconds < Date.parse(window.end)) {
          const minutes = Math.min(90, Math.floor(choice.budgetMinutes / 15) * 15, Math.floor((Date.parse(window.end) - at.epochMilliseconds) / 900000) * 15);
          if (minutes < 15) break;
          const end = at.add({ minutes });
          if (at.toPlainDate().equals(end.toPlainDate())) {
            const date = at.toPlainDate().toString(), startTime = at.toPlainTime().toString({ smallestUnit: 'minute' }), endTime = end.toPlainTime().toString({ smallestUnit: 'minute' });
            try {
              const resolved = resolvePlacement({ weekStartDate: input.week, timezone: input.timezone }, { date, startTime, endTime });
              if (!resolved.adjustments.length && Date.parse(resolved.interval.start) === at.epochMilliseconds && Date.parse(resolved.interval.end) === end.epochMilliseconds)
                options.push({ actionId: choice.actionId, date, startTime, endTime, ...resolved.interval, minutes: elapsedMinutes(resolved.interval) });
            } catch { /* Ambiguous/shifted local boundaries require the manual editor. */ }
            if (options.some(o => o.start === at.toInstant().toString())) break;
          }
          at = at.add({ minutes: 15 });
        }
      }
      options.sort((a, b) => (dayLoad.get(a.date) ?? 0) - (dayLoad.get(b.date) ?? 0) || a.start.localeCompare(b.start));
      const next = options[0]; if (!next) continue;
      blocks.push(next); choice.budgetMinutes -= next.minutes;
      dayLoad.set(next.date, (dayLoad.get(next.date) ?? 0) + next.minutes);
      free = subtractIntervals(free, [next]); progressed = true;
    }
    if (!progressed) break;
  }
  return { blocks, unplacedMinutes: total - blocks.reduce((n, b) => n + b.minutes, 0), available: true };
}
