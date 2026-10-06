"use client";
import { useRef } from 'react';
import type { WeeklyPlan } from '@/modules/planning/domain';
import type { PlacementReview } from '@/modules/scheduling/domain';
import { deriveFocusAvailability } from '@/modules/availability/domain';
import { suggestWeek, type WeekSuggestion } from '@/modules/planning/quick-schedule';
import { FirstWeekTask, type FirstWeekTaskCommand } from './first-week-task';
import { request, errorInfo, RequestFailure } from './mutation-client';
import type { QuickPlanningContext } from './quick-week-planner';
type Step = { url: string; body: object };
export function FirstWeekPlanner({ initial, onClose, onLock }: { initial: QuickPlanningContext; onClose: () => void; onLock: (locked: boolean) => void }) {
  const plan = useRef<WeeklyPlan | null>(null), suggestion = useRef<WeekSuggestion | null>(null), next = useRef(0), pending = useRef<Step | null>(null), attempt = useRef<string | null>(null);
  const week = initial.workspace.weekStartDate, draft = initial.workspace.view?.plan;
  const canSuggestTimes = initial.context?.availability.status === 'available';
  const send = <T,>(step: Step) => request<T>(step.url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(step.body) });
  const href = (manual: boolean) => `/calendar?week=${week}&taskAdded=${plan.current!.commitments[0].id}${manual ? `&placeFirst=${plan.current!.commitments[0].id}` : ''}`;
  async function add(command: FirstWeekTaskCommand) {
    if (attempt.current !== command.mutationId) { attempt.current = command.mutationId; plan.current = null; suggestion.current = null; next.current = 0; pending.current = null; }
    try {
      if (!plan.current) {
        if (!pending.current) {
          const latest = await request<QuickPlanningContext>(`/api/weekly-plans/quick-context?week=${week}`);
          if ((latest.workspace.view?.plan.id ?? null) !== (draft?.id ?? null) || (latest.workspace.view?.plan.version ?? null) !== (draft?.version ?? null))
            throw new Error('Your setup changed. Reload the calendar before adding this task.');
          const availability = latest.context?.calendar.availability ? deriveFocusAvailability(latest.context.schedule, latest.context.calendar.availability, latest.now) : null;
          suggestion.current = suggestWeek({ week, timezone: latest.workspace.timezone, now: latest.now, availability,
            occupied: latest.occupied, choices: [{ actionId: command.mutationId, budgetMinutes: command.budgetMinutes }] });
          pending.current = { url: '/api/weekly-plans/first-task', body: { ...command, weekStartDate: week, ...(draft ? { planId: draft.id, expectedVersion: draft.version } : {}) } };
        }
        plan.current = (await send<{ plan: WeeklyPlan }>(pending.current)).plan; pending.current = null;
      }
      const value = plan.current, blocks = suggestion.current?.blocks ?? [];
      while (next.current < blocks.length) {
        const block = blocks[next.current];
        if (!pending.current) {
          const placement = { commitmentId: value.commitments[0].id, date: block.date, startTime: block.startTime, endTime: block.endTime };
          const checked = await send<PlacementReview>({ url: `/api/weekly-plans/${value.id}/time-blocks/preview`, body: placement });
          if (checked.planVersion !== value.version || checked.outsideHours || checked.busyConflict !== false || checked.calendarStatus !== 'fresh' || checked.adjustments.length || checked.resultingMinutes > checked.budgetMinutes || Date.parse(checked.interval.start) !== Date.parse(block.start) || Date.parse(checked.interval.end) !== Date.parse(block.end)) return href(next.current === 0);
          pending.current = { url: `/api/weekly-plans/${value.id}/time-blocks`, body: { ...placement, mutationId: crypto.randomUUID(), expectedPlanVersion: checked.planVersion, reviewKey: checked.reviewKey, acknowledgeOutsideHours: false, acknowledgeBusy: false } };
        }
        await send(pending.current); pending.current = null; next.current++;
      }
      return href(!blocks.length);
    } catch (e) {
      const info = errorInfo(e);
      if (plan.current && info.code !== 'UNCERTAIN' && info.code !== 'DATABASE_UNAVAILABLE') return href(next.current === 0);
      // A failed context read has no mutation to retry. Preserve the root command
      // identity anyway; after a confirmed failure the task remains editable.
      if (e instanceof Error && !('info' in e)) { throw new RequestFailure({ code: 'CONFLICT', message: e.message }); }
      throw e;
    }
  }
  return <FirstWeekTask onAdd={add} onClose={onClose} onLock={onLock} canSuggestTimes={canSuggestTimes} sparePercent={initial.sparePercent}/>;
}
