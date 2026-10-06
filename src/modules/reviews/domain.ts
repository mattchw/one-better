import { Temporal } from "@js-temporal/polyfill";
import { z } from "zod";
import { ApplicationError } from "../../domain/errors";
import { boundedText } from "../goals/domain";
import { calendarDate } from "../planning/domain";
import { localDate, type FocusSession } from "../focus/domain";
import type { TimeBlock } from "../scheduling/domain";

export const daySchema = z.string().refine(calendarDate, "Choose a valid local date (YYYY-MM-DD).");
const version = z.number().int().min(1).max(2147483646);
// Empty drafts are valid; finishing requires a saved, non-empty note.
const draftNote = z.preprocess(v => typeof v === "string" && !v.trim() ? "" : v, z.union([z.literal(""), boundedText("Reflection", 4000)]));
export const saveReflectionSchema = z.strictObject({ mutationId: z.uuid(), localDate: daySchema, reflectionId: z.uuid().nullable(), expectedVersion: z.number().int().min(0).max(2147483646), note: draftNote }).refine(v => (v.reflectionId === null) === (v.expectedVersion === 0), "Reflection identity and version must agree.");
export const finalizeReflectionSchema = z.strictObject({ mutationId: z.uuid(), expectedVersion: version });
export type DailyReflection = { id: string; localDate: string; status: "draft" | "finalized"; note: string; version: number; createdAt: string; updatedAt: string; finalizedAt: string | null };
export type OwnedReflection = DailyReflection & { ownerId: string };
export type ExecutionBlock = { block: TimeBlock; planTimezone: string };

export function localDayRange(date: string, timezone: string) {
  const day = Temporal.PlainDate.from(daySchema.parse(date));
  return { start: day.toZonedDateTime(timezone).toInstant().toString(), end: day.add({ days: 1 }).toZonedDateTime(timezone).toInstant().toString() };
}
// Half-open intersection, with precision retained until final display rounding.
export function intervalMilliseconds(start: string, end: string, range: { start: string; end: string }) {
  const a = Temporal.Instant.from(start).epochNanoseconds, b = Temporal.Instant.from(end).epochNanoseconds;
  const lo = Temporal.Instant.from(range.start).epochNanoseconds, hi = Temporal.Instant.from(range.end).epochNanoseconds;
  const clippedStart = a > lo ? a : lo, clippedEnd = b < hi ? b : hi;
  return clippedEnd > clippedStart ? Number(clippedEnd - clippedStart) / 1_000_000 : 0;
}
export function durationWithinLocalDay(start: string, end: string, date: string, timezone: string) {
  return intervalMilliseconds(start, end, localDayRange(date, timezone));
}
export function activeChangesDay(active: Pick<FocusSession, "startedAt" | "endedAt"> | null, date: string, timezone: string, now: string) {
  // Even a just-started zero-duration session will change today's facts.
  return !!active && !active.endedAt && date === localDate(now, timezone) && Temporal.Instant.compare(active.startedAt, localDayRange(date, timezone).end) < 0;
}
export function deriveDay(date: string, timezone: string, now: string, blocks: ExecutionBlock[], sessions: FocusSession[]) {
  const range = localDayRange(date, timezone), today = localDate(now, timezone);
  const active = sessions.find(s => !s.endedAt) ?? null;
  const live = activeChangesDay(active, date, timezone, now);
  const entries = blocks.map(context => {
    const blockSessions = sessions.filter(s => s.timeBlockId === context.block.id);
    const contributions = blockSessions.map(session => ({ session, recordedMilliseconds: intervalMilliseconds(session.startedAt, session.endedAt ?? now, range) })).filter(v => v.recordedMilliseconds > 0 || live && v.session.id === active?.id);
    const scheduledMilliseconds = intervalMilliseconds(context.block.start, context.block.end, range);
    return { ...context, scheduledMilliseconds, recordedMilliseconds: contributions.reduce((n, s) => n + s.recordedMilliseconds, 0), sessionCount: blockSessions.length, sessions: contributions };
  }).sort((a, b) => Temporal.Instant.compare(a.block.start, b.block.start) || a.block.id.localeCompare(b.block.id));
  const scheduled = entries.filter(b => b.scheduledMilliseconds > 0);
  const otherWork = entries.filter(b => b.scheduledMilliseconds === 0 && b.sessions.length > 0);
  const contributions = entries.flatMap(b => b.sessions);
  return { localDate: date, today, timezone, serverNow: now, range, scheduled, otherWork,
    scheduledMilliseconds: scheduled.filter(b => b.block.state === "planned").reduce((n, b) => n + b.scheduledMilliseconds, 0),
    recordedMilliseconds: contributions.reduce((n, s) => n + s.recordedMilliseconds, 0),
    outcomes: { completed: contributions.filter(v => v.session.outcome === "completed").length, partial: contributions.filter(v => v.session.outcome === "partial").length, abandoned: contributions.filter(v => v.session.outcome === "abandoned").length, active: contributions.filter(v => !v.session.endedAt).length },
    commitmentCount: new Set(entries.filter(b => b.scheduledMilliseconds > 0 || b.sessions.length).map(b => b.block.commitmentId)).size,
    live, canReflect: date <= today, activeSessionId: live ? active!.id : null };
}
export type DailyExecution = ReturnType<typeof deriveDay> & { habit?:import("./habit").HabitProgress; reflection: DailyReflection | null };
export function ownedReflection(value: OwnedReflection | null, ownerId: string): DailyReflection {
  if (!value || value.ownerId !== ownerId) throw new ApplicationError("NOT_FOUND", "This daily reflection is unavailable.");
  const { ownerId: _owner, ...dto } = value; void _owner; return dto;
}
export function requireReflectionDate(date: string, timezone: string, now: string) {
  if (date > localDate(now, timezone)) throw new ApplicationError("CONFLICT", "Reflect on today or a past day. Future reflections cannot be saved.", { kind: "FUTURE_REFLECTION" });
}
export function requireDraft(reflection: DailyReflection, expectedVersion: number) {
  if (reflection.version !== expectedVersion) throw new ApplicationError("CONFLICT", "This reflection changed elsewhere. Review the latest saved note before saving your draft.", { kind: "REFLECTION_VERSION", current: reflection });
  if (reflection.status !== "draft") throw new ApplicationError("CONFLICT", "This finalized reflection is read-only. Its saved text is preserved.", { kind: "REFLECTION_FINALIZED", current: reflection });
}
export function requireClock(reflection: DailyReflection, now: string) {
  if (Temporal.Instant.compare(now, reflection.updatedAt) < 0) throw new ApplicationError("CONFLICT", "The server clock moved before the last save. Retry when it has recovered.", { kind: "CLOCK_ORDER" });
}
