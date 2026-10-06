import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import type { Actor } from "../../domain/actor";
import { ApplicationError } from "../../domain/errors";
import { validate, weekSchema, type CalendarWorkspace } from "../calendar/domain";
import { deriveFocusAvailability, saveHoursSchema, type FocusableHoursSchedule, type HoursSettings } from "./domain";
export interface HoursRepository {
  read(actor: Actor, id?: string): Promise<HoursSettings>;
  execute(actor: Actor, mutationId: string, hash: string, apply: (current: FocusableHoursSchedule | null) => FocusableHoursSchedule): Promise<FocusableHoursSchedule>;
}
export function hoursService(repository: HoursRepository, clock = () => new Date().toISOString(), newId: () => string = randomUUID) {
  return {
    async settings(actor: Actor, id?: string) { if (id) validate(z.uuid(), id); return repository.read(actor, id); },
    async save(actor: Actor, input: unknown) {
      const { mutationId, ...command } = validate(saveHoursSchema, input);
      const hash = createHash("sha256").update(JSON.stringify({ kind: "focusable-hours.save", ...command })).digest("hex");
      return repository.execute(actor, mutationId, hash, current => {
        if (command.scheduleId && current?.id !== command.scheduleId) throw new ApplicationError("NOT_FOUND", "These Focusable Hours are unavailable.");
        if ((current?.version ?? 0) !== command.expectedVersion) throw new ApplicationError("CONFLICT", "Focusable Hours changed elsewhere. Review the latest saved hours.", { kind: "HOURS_VERSION", current });
        const now = clock(); return { id: current?.id ?? newId(), version: (current?.version ?? 0)+1, windows: command.windows, sparePercent: command.sparePercent ?? current?.sparePercent ?? 25, createdAt: current?.createdAt ?? now, updatedAt: now };
      });
    },
  };
}
export function focusAvailabilityService(hours: ReturnType<typeof hoursService>, calendar: { workspace(actor: Actor, week?: string): Promise<CalendarWorkspace> }, clock = () => Date.now()) {
  return { async read(actor: Actor, week: string, scheduleId?: string) {
    validate(weekSchema, week);
    const settings = await hours.settings(actor, scheduleId);
    const context = await calendar.workspace(actor, week);
    if (!context.availability) throw new ApplicationError("DATABASE_UNAVAILABLE", "Calendar context could not be loaded.");
    return { schedule: settings.schedule, calendar: context, availability: deriveFocusAvailability(settings.schedule, context.availability, clock()) };
  } };
}
export type FocusWorkspace = Awaited<ReturnType<ReturnType<typeof focusAvailabilityService>["read"]>>;
