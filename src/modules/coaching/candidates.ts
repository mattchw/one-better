import { createHash } from 'node:crypto';
import { Temporal } from '@js-temporal/polyfill';
import { expandFocusableWindows, intersectIntervals, subtractIntervals } from '../availability/domain';
import { mergeBusyIntervals, weekRange } from '../calendar/domain';
import { elapsedMinutes, resolvePlacement } from '../scheduling/domain';
import type { ContextSources } from './context';
import type { ScheduleCandidate } from './domain';

// Conservative alternatives, not a proposed whole-week schedule. Calendar coverage
// must be fresh; stale/unknown coverage still permits ordinary manual scheduling.
export function scheduleCandidates(input: ContextSources, requestTime: string): ScheduleCandidate[] {
  const { scheduling: view, effective, hours, availability, sources, scope } = input;
  if (scope.contextType !== 'calendar' || !view?.canSchedule || !effective || input.workspace.view?.plan.state !== 'committed' || !hours?.windows.length || availability?.status !== 'available' || !availability.open || availability.weekStartDate !== scope.week || view.weekStartDate !== scope.week) return [];
  const now = Temporal.Instant.from(requestTime), range = weekRange(scope.week, view.timezone);
  if (Temporal.Instant.compare(now, range.end) >= 0) return [];
  const local = expandFocusableWindows(hours.windows, scope.week, view.userTimezone).intervals;
  const open = intersectIntervals(intersectIntervals(local, availability.open), [range]);
  const blocked = mergeBusyIntervals(view.blocks.filter(b => b.state === 'planned').map(b => ({ start:b.start, end:b.end })), range);
  const free = subtractIntervals(open, blocked);
  const candidates: ScheduleCandidate[] = [];
  const commitments = view.commitments.filter(c => effective.commitments.some(e => e.id === c.id) && sources.some(s => s.actionId === c.actionId && s.eligible) && c.budgetMinutes - c.scheduledMinutes >= 30).sort((a,b) => (b.budgetMinutes-b.scheduledMinutes)-(a.budgetMinutes-a.scheduledMinutes) || a.id.localeCompare(b.id)).slice(0,3);
  for (const c of commitments) {
    const remaining = c.budgetMinutes-c.scheduledMinutes, duration = Math.min(60, Math.floor(remaining/15)*15);
    let count = 0;
    for (const window of free) {
      // Fixed quarter-hour grid keeps identical facts stable between requests;
      // exact request time still excludes the current minute and started slots.
      let at = Temporal.Instant.from(window.start).toZonedDateTimeISO(view.timezone).with({ second:0, millisecond:0, microsecond:0, nanosecond:0 });
      at = at.add({ minutes:(15-at.minute%15)%15 });
      if (Temporal.Instant.compare(at.toInstant(), window.start) < 0) at = at.add({ minutes:15 });
      while (Temporal.Instant.compare(at.toInstant(), window.end) < 0) {
        const end = at.add({ minutes:duration });
        if (Temporal.Instant.compare(at.toInstant(), now) > 0 && Temporal.Instant.compare(end.toInstant(),window.end) <= 0 && at.toPlainDate().equals(end.toPlainDate())) {
          const date=at.toPlainDate().toString(), startTime=at.toPlainTime().toString({smallestUnit:'minute'}), endTime=end.toPlainTime().toString({smallestUnit:'minute'});
          try {
            const resolved=resolvePlacement({weekStartDate:scope.week,timezone:view.timezone},{date,startTime,endTime});
            // Do not offer ambiguous or shifted wall-clock boundaries. The manual
            // editor retains the existing explicit DST disclosure/approval path.
            if (!resolved.adjustments.length && Temporal.Instant.compare(resolved.interval.start,at.toInstant())===0 && Temporal.Instant.compare(resolved.interval.end,end.toInstant())===0 && elapsedMinutes(resolved.interval)<=remaining) {
              const id=`schedule_candidate_${createHash('sha256').update(`${view.planId}:${c.id}:${date}:${startTime}:${endTime}`).digest('hex').slice(0,16)}`;
              candidates.push({id,commitmentId:c.id,localDate:date,startLocalTime:startTime,endLocalTime:endTime,...resolved.interval,durationMinutes:elapsedMinutes(resolved.interval),remainingUnscheduledMinutes:remaining,focusableHours:'inside',calendarStatus:'available'});
              count++;
            }
          } catch { /* Unsupported local boundary is not a candidate. */ }
        }
        if (count===2) break;
        // Iterate elapsed minutes so a DST fold cannot trap the loop.
        at=at.add({minutes:15});
      }
      if (count===2) break;
    }
  }
  return candidates;
}
