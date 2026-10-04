import { expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { parseCommand } from "../../src/modules/goals/domain";
import { archiveMilestone, completeMilestone, editMilestone, milestoneFieldsSchema, completeMilestoneSchema, createMilestoneSchema, updateMilestoneSchema, archiveMilestoneSchema, ownedMilestone, type Milestone } from "../../src/modules/milestones/domain";
const initial: Milestone = { id: randomUUID(), goalId: randomUUID(), title: "Continuous 5 km run", successCondition: "Finish without walking at the intended effort.", state: "active", version: 1, createdAt: "2026-10-02T10:00:00.000Z", updatedAt: "2026-10-02T10:00:00.000Z", completedAt: null, archivedAt: null, evidence: null };
const now = "2026-10-02T11:00:00.000Z";
it("requires outcome checkpoint fields, trims and retains multiline success conditions", () => {
  expect(parseCommand(milestoneFieldsSchema, { title: " Run ", successCondition: " Finish\nwithout walking. " })).toEqual({ title: "Run", successCondition: "Finish\nwithout walking." });
  for (const value of ["", " \t\n ", null, 3, "\0", "\ud800"]) for (const field of ["title", "successCondition"]) expect(milestoneFieldsSchema.safeParse({ title: "Run", successCondition: "Finish", [field]: value }).success).toBe(false);
  expect(() => parseCommand(milestoneFieldsSchema, { title: "", successCondition: "" })).toThrow();
});
it("enforces Unicode limits and denies ownership, move, state and date fields", () => {
  expect(milestoneFieldsSchema.safeParse({ title: "😀".repeat(160), successCondition: "😀".repeat(2000) }).success).toBe(true);
  for (const fields of [{ title: "😀".repeat(161) }, { successCondition: "😀".repeat(2001) }, { goalId: randomUUID() }, { ownerId: randomUUID() }, { state: "completed" }, { targetDate: now }]) expect(createMilestoneSchema.safeParse({ title: "Run", successCondition: "Finish", mutationId: randomUUID(), ...fields }).success).toBe(false);
  for (const schema of [updateMilestoneSchema, archiveMilestoneSchema, completeMilestoneSchema]) for (const expectedVersion of [0, 1.5, "1", 2147483647]) expect(schema.safeParse({ mutationId: randomUUID(), expectedVersion, title: "Run", successCondition: "Finish" }).success).toBe(false);
});
it("normalizes optional evidence and rejects invalid or excessive notes", () => {
  for (const evidence of [undefined, null, " \t "]) expect(parseCommand(completeMilestoneSchema, { mutationId: randomUUID(), expectedVersion: 1, evidence }).evidence).toBeNull();
  expect(completeMilestone(initial, 1, " Ran 5 km in 28:42. ", now).evidence).toBe("Ran 5 km in 28:42.");
  for (const evidence of [3, "\0", "\ud800", "😀".repeat(2001)]) expect(completeMilestoneSchema.safeParse({ mutationId: randomUUID(), expectedVersion: 1, evidence }).success).toBe(false);
});
it("edits only checkpoint fields while retaining parent, identity and creation", () => {
  const edited = editMilestone(initial, 1, { title: "5 km demonstrated", successCondition: "A continuous run." }, now);
  expect(edited).toMatchObject({ id: initial.id, goalId: initial.goalId, createdAt: initial.createdAt, version: 2, state: "active", updatedAt: now });
  expect(initial.version).toBe(1);
});
it("completion preserves definition and timestamps and archive retains identity", () => {
  expect(completeMilestone(initial, 1, "Proof", now)).toEqual({ ...initial, state: "completed", version: 2, updatedAt: now, completedAt: now, evidence: "Proof" });
  expect(archiveMilestone(initial, 1, now)).toEqual({ ...initial, state: "archived", version: 2, updatedAt: now, archivedAt: now });
});
it("both terminal states forbid editing, completion and archival with typed owned snapshots", () => {
  for (const value of [completeMilestone(initial, 1, null, now), archiveMilestone(initial, 1, now)]) for (const operation of [() => editMilestone(value, 2, { title: "Changed", successCondition: "Changed" }, now), () => completeMilestone(value, 2, null, now), () => archiveMilestone(value, 2, now)]) {
    try { operation(); throw new Error("Expected rejection"); } catch (error) { expect(error).toMatchObject({ code: "CONFLICT", details: { kind: "TERMINAL", current: value } }); }
  }
});
it("stale mutations conflict before terminal checks and never change input", () => {
  const completed = completeMilestone(initial, 1, null, now);
  try { archiveMilestone(completed, 1, now); throw new Error("Expected rejection"); } catch (error) { expect(error).toMatchObject({ code: "CONFLICT", details: { kind: "VERSION", current: completed } }); }
  expect(initial.version).toBe(1);
});
it("foreign and missing checkpoints are indistinguishable and ownership stays server-side", () => {
  for (const value of [null, { ...initial, ownerId: "foreign" }]) expect(() => ownedMilestone(value, "owner")).toThrow("This milestone is unavailable.");
  expect(ownedMilestone({ ...initial, ownerId: "owner" }, "owner")).toEqual(initial);
});
