import { Temporal } from "@js-temporal/polyfill";
import { z } from "zod";
import { ApplicationError } from "../../domain/errors";
import { weekRange } from "../calendar/domain";
import { boundedText } from "../goals/domain";
import { currentWeek, type WeeklyPlan } from "../planning/domain";
import type { EffectivePlan } from "../amendments/domain";
import type { TimeBlock } from "../scheduling/domain";
export const outcomes = ["completed", "partial", "abandoned"] as const;
export type FocusSession = { id: string; timeBlockId: string; startedAt: string; endedAt: string | null; outcome: typeof outcomes[number] | null; endNote: string | null; version: number; createdAt: string; updatedAt: string };
export type OwnedSession = FocusSession & { ownerId: string };
export type FocusContext = { block: TimeBlock; plan: WeeklyPlan; effective: EffectivePlan; userTimezone: string; blocks: TimeBlock[]; sessions: FocusSession[] };
export const startSessionSchema = z.strictObject({ mutationId: z.uuid(), expectedBlockVersion: z.number().int().min(1).max(2147483646), acknowledgeRemoved: z.boolean() });
const note = z.preprocess(v => v === undefined || v === null || typeof v === "string" && !v.trim() ? null : v, boundedText("End note", 1000).nullable());
export const endSessionSchema = z.strictObject({ mutationId: z.uuid(), expectedVersion: z.number().int().min(1).max(2147483646), outcome: z.enum(outcomes), endNote: note });
export function ownedSession(value: OwnedSession | null, owner: string): FocusSession {
  if (!value || value.ownerId !== owner) throw new ApplicationError("NOT_FOUND", "This focus session is unavailable.");
  const { ownerId: _owner, ...dto } = value; void _owner; return dto;
}
export const localDate = (instant: string, timezone: string) => Temporal.Instant.from(instant).toZonedDateTimeISO(timezone).toPlainDate().toString();
// Ended totals include every outcome. Active elapsed appears only in labelled 'so far' projections.
export function sessionMilliseconds(session: Pick<FocusSession,"startedAt"|"endedAt">, now?: string) {
  const end = session.endedAt ?? now;
  if (!end) return 0;
  return Math.max(0, Number(Temporal.Instant.from(end).epochNanoseconds - Temporal.Instant.from(session.startedAt).epochNanoseconds) / 1_000_000);
}
export function requireStart(context: FocusContext, expectedBlockVersion: number, acknowledgeRemoved: boolean, now: string) {
  if (context.block.state !== "planned" || context.plan.state !== "committed" || context.plan.weekStartDate !== currentWeek(now, context.userTimezone)) throw new ApplicationError("CONFLICT", "Focus can start only from a planned block in your current local planning week.", { kind: "FOCUS_INELIGIBLE" });
  const range=weekRange(context.plan.weekStartDate,context.plan.timezone);
  if(context.block.planId!==context.plan.id || Temporal.Instant.compare(context.block.start,context.block.end)>=0 || Temporal.Instant.compare(context.block.start,range.start)<0 || Temporal.Instant.compare(context.block.end,range.end)>0 || localDate(context.block.start,context.plan.timezone)!==localDate(context.block.end,context.plan.timezone)) throw new ApplicationError("CONFLICT", "This block has invalid schedule context and cannot start.", {kind:"FOCUS_INELIGIBLE"});
  if (context.block.version !== expectedBlockVersion) throw new ApplicationError("CONFLICT", "This scheduled block changed. Inspect the latest schedule before starting.", { kind: "BLOCK_VERSION" });
  if (!context.effective.commitments.some(c => c.id === context.block.commitmentId) && !acknowledgeRemoved) throw new ApplicationError("CONFLICT", "This scheduled block belongs to work that is no longer in your current weekly plan. Acknowledge this before starting.", { kind: "REMOVED_COMMITMENT" });
}
export function finishSession(session: FocusSession, input: z.infer<typeof endSessionSchema>, now: string): FocusSession {
  if (session.version !== input.expectedVersion || session.endedAt) throw new ApplicationError("CONFLICT", "This session has already changed or ended. Its recorded history is preserved.", { kind: "SESSION_VERSION", current: session });
  if (Temporal.Instant.compare(now,session.startedAt) <= 0) throw new ApplicationError("CONFLICT", "The server clock has not advanced past the session start. Wait a moment and retry ending.", { kind: "CLOCK_ORDER" });
  return {...session,endedAt:now,outcome:input.outcome,endNote:input.endNote,version:session.version+1,updatedAt:now};
}
export function focusDetail(context: FocusContext, now: string) {
  const {block,plan,effective,sessions}=context, commitment=effective.commitments.find(c=>c.id===block.commitmentId);
  const associated=context.blocks.filter(b=>b.commitmentId===block.commitmentId),ids=new Set(associated.map(b=>b.id));
  const own=sessions.filter(s=>s.timeBlockId===block.id),total=sessions.filter(s=>ids.has(s.timeBlockId));
  return {block,timezone:plan.timezone,weekStartDate:plan.weekStartDate,reviewRequired:!commitment,canStart:block.state==="planned"&&plan.state==="committed"&&plan.weekStartDate===currentWeek(now,context.userTimezone),budgetMinutes:commitment?.budgetMinutes??null,scheduledMinutes:associated.filter(b=>b.state==="planned").reduce((n,b)=>n+Number(Temporal.Instant.from(b.end).epochNanoseconds-Temporal.Instant.from(b.start).epochNanoseconds)/60_000_000_000,0),recordedMilliseconds:own.reduce((n,s)=>n+sessionMilliseconds(s),0),commitmentRecordedMilliseconds:total.reduce((n,s)=>n+sessionMilliseconds(s),0),sessions:own};
}
export type FocusDetail = ReturnType<typeof focusDetail>;
export type FocusWorkspace = { serverNow: string; timezone: string; today: string; active: { session: FocusSession; detail: FocusDetail } | null; todayBlocks: FocusDetail[]; selected: FocusDetail | null };
