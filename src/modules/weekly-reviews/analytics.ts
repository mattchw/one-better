import { goalGroupKey, goalTitle } from '../planning/general';
import { addDays, type PlanningSnapshot } from "../planning/domain";
import { localDate, type FocusSession } from "../focus/domain";
import { intervalMilliseconds, localDayRange } from "../reviews/domain";
import type { TimeBlock } from "../scheduling/domain";

type Budget = { budgetMinutes: number; snapshot: PlanningSnapshot };
export function deriveReviewAnalytics(input: {
  startDate: string; days: number; timezone: string; now: string;
  blocks: TimeBlock[]; sessions: FocusSession[];
  plan: { originalMinutes: number; commitments: Budget[]; reserveMinutes: number } | null;
  reflections: { localDate: string; status: "draft" | "finalized" }[];
}) {
  const { startDate, days, timezone, now, plan } = input;
  const today = localDate(now, timezone);
  const range = { start: localDayRange(startDate, timezone).start, end: localDayRange(addDays(startDate, days), timezone).start };
  const blocks = [...new Map(input.blocks.map(b => [b.id, b])).values()];
  const owned = new Set(blocks.map(b => b.id));
  // Clip live and ended contributions to the observed instant. Future days have no actuals.
  const sessions = [...new Map(input.sessions.map(s => [s.id, s])).values()].filter(s => owned.has(s.timeBlockId));
  const end = (s: FocusSession) => Date.parse(s.endedAt ?? now) > Date.parse(now) ? now : s.endedAt ?? now;
  const contributions = sessions.filter(s => intervalMilliseconds(s.startedAt, end(s), range) > 0);
  const daily = Array.from({ length: days }, (_, i) => {
    const date = addDays(startDate, i), day = localDayRange(date, timezone);
    return { date, future: date > today,
      scheduledMilliseconds: blocks.filter(b => b.state === "planned").reduce((n,b) => n + intervalMilliseconds(b.start,b.end,day),0),
      recordedMilliseconds: contributions.reduce((n,s) => n + intervalMilliseconds(s.startedAt,end(s),day),0),
      reflection: input.reflections.find(r => r.localDate === date)?.status ?? "missing" as const };
  });
  const goals = new Map<string, { id: string; title: string; budgetMinutes: number | null; scheduledMilliseconds: number; recordedMilliseconds: number }>();
  function goal(snapshot: PlanningSnapshot) {
    let value = goals.get(goalGroupKey(snapshot.goal));
    if (!value) { value = { id:goalGroupKey(snapshot.goal),title:goalTitle(snapshot.goal),budgetMinutes:plan ? 0 : null,scheduledMilliseconds:0,recordedMilliseconds:0 }; goals.set(value.id,value); }
    return value;
  }
  for (const c of plan?.commitments ?? []) goal(c.snapshot).budgetMinutes! += c.budgetMinutes;
  for (const b of blocks) {
    const scheduled = b.state === "planned" ? intervalMilliseconds(b.start,b.end,range) : 0;
    const recorded = contributions.filter(s => s.timeBlockId === b.id).reduce((n,s) => n + intervalMilliseconds(s.startedAt,end(s),range),0);
    if (scheduled || recorded) { const g = goal(b.snapshot); g.scheduledMilliseconds += scheduled; g.recordedMilliseconds += recorded; }
  }
  const outcomes = { completed:0,partial:0,abandoned:0,active:0 };
  for (const s of contributions) outcomes[s.endedAt ? s.outcome! : "active"]++;
  return { startDate,timezone,observedAt:now,today,daily,goals:[...goals.values()].sort((a,b) => b.recordedMilliseconds-a.recordedMilliseconds || a.title.localeCompare(b.title)),
    originalMinutes:plan?.originalMinutes ?? null,budgetMinutes:plan ? plan.commitments.reduce((n,c) => n+c.budgetMinutes,0) : null,
    reserveMinutes:plan?.reserveMinutes ?? null,
    scheduledMilliseconds:daily.reduce((n,d) => n+d.scheduledMilliseconds,0),recordedMilliseconds:daily.reduce((n,d) => n+d.recordedMilliseconds,0),
    sessionCount:contributions.length,outcomes,
    endedBlocksWithoutSessions:blocks.filter(b => b.state === "planned" && Date.parse(b.end) <= Date.parse(now) && intervalMilliseconds(b.start,b.end,range)>0 && !sessions.some(s => s.timeBlockId===b.id)).length,
    cancelledBlocks:blocks.filter(b => b.state === "cancelled" && intervalMilliseconds(b.start,b.end,range)>0).length };
}
export type ReviewAnalytics = ReturnType<typeof deriveReviewAnalytics>;
