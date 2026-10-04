import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import type { Actor } from "../../domain/actor";
import { ApplicationError } from "../../domain/errors";
import { validate } from "../calendar/domain";
import type { FocusSession } from "../focus/domain";
import { activeChangesDay, daySchema, finalizeReflectionSchema, ownedReflection, requireClock, requireDraft, requireReflectionDate, saveReflectionSchema, type DailyExecution, type DailyReflection, type OwnedReflection } from "./domain";

export interface ReflectionTransaction {
  timezone: string;
  byDate(date: string): Promise<DailyReflection | null>;
  get(id: string): Promise<OwnedReflection | null>;
  active(): Promise<FocusSession | null>;
  insert(value: DailyReflection): Promise<DailyReflection>;
  update(value: DailyReflection, expectedVersion: number): Promise<DailyReflection>;
}
export interface ReviewRepository {
  day(actor: Actor, now: string, date?: string): Promise<DailyExecution>;
  get(actor: Actor, id: string): Promise<OwnedReflection | null>;
  execute(actor: Actor, mutationId: string, hash: string, apply: (tx: ReflectionTransaction) => Promise<DailyReflection>): Promise<DailyReflection>;
}
const hash = (v: unknown) => createHash("sha256").update(JSON.stringify(v)).digest("hex");
export function reviewService(repository: ReviewRepository, clock = () => new Date().toISOString(), newId: () => string = randomUUID) {
  return {
    async day(actor: Actor, date?: string) { if (date !== undefined) validate(daySchema, date); return repository.day(actor, clock(), date); },
    async get(actor: Actor, id: string) { validate(z.uuid(), id); return ownedReflection(await repository.get(actor, id), actor.userId); },
    async save(actor: Actor, input: unknown) {
      const { mutationId, ...value } = validate(saveReflectionSchema, input);
      return repository.execute(actor, mutationId, hash({ kind: "daily-reflection.save", ...value }), async tx => {
        // Check supplied identity's ownership before reading another date's draft.
        const current = value.reflectionId ? ownedReflection(await tx.get(value.reflectionId), actor.userId) : await tx.byDate(value.localDate);
        const now = clock(); requireReflectionDate(value.localDate, tx.timezone, now);
        if (current) {
          if (current.localDate !== value.localDate) throw new ApplicationError("CONFLICT", "A reflection's local date cannot change.", { kind: "REFLECTION_DATE" });
          requireDraft(current, value.expectedVersion); requireClock(current, now);
          return tx.update({ ...current, note: value.note, updatedAt: now, version: current.version + 1 }, value.expectedVersion);
        }
        return tx.insert({ id: newId(), localDate: value.localDate, status: "draft", note: value.note, version: 1, createdAt: now, updatedAt: now, finalizedAt: null });
      });
    },
    async finalize(actor: Actor, id: string, input: unknown) {
      validate(z.uuid(), id); const { mutationId, ...value } = validate(finalizeReflectionSchema, input);
      return repository.execute(actor, mutationId, hash({ kind: "daily-reflection.finalize", id, ...value }), async tx => {
        const current = ownedReflection(await tx.get(id), actor.userId), now = clock();
        requireDraft(current, value.expectedVersion); requireReflectionDate(current.localDate, tx.timezone, now); requireClock(current, now);
        if (!current.note.trim()) throw new ApplicationError("VALIDATION", "Write and save a reflection before finishing.", { fields: { note: "A reflection is required." } });
        if (activeChangesDay(await tx.active(), current.localDate, tx.timezone, now)) throw new ApplicationError("CONFLICT", "You still have an active focus session. End it before finishing today's reflection.", { kind: "ACTIVE_EXECUTION" });
        return tx.update({ ...current, status: "finalized", finalizedAt: now, updatedAt: now, version: current.version + 1 }, value.expectedVersion);
      });
    },
  };
}
