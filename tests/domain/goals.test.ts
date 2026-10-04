import { describe, expect, it } from "vitest";
import { archiveGoalSchema, createGoalSchema, editGoal, goalFieldsSchema, ownedGoal, parseCommand, softArchiveGoal, type Goal } from "../../src/modules/goals/domain";
import { randomUUID } from "node:crypto";
const original: Goal = { id: randomUUID(), title: "Improve fitness", outcome: "I can comfortably run 10 km.", version: 1, createdAt: "2026-10-02T10:00:00.000Z", updatedAt: "2026-10-02T10:00:00.000Z", archivedAt: null };
const now = "2026-10-02T11:00:00.000Z";
describe("Goal validation and lifecycle", () => {
  it("requires title and outcome, trims whitespace, preserves outcome newlines", () => {
    expect(parseCommand(goalFieldsSchema, { title: "  Fitness  ", outcome: " \nSuccess\nmeans endurance. \n" })).toEqual({ title: "Fitness", outcome: "Success\nmeans endurance." });
    for (const title of ["", " \n\t ", null, 42]) expect(() => parseCommand(goalFieldsSchema, { title, outcome: "Success" })).toThrow();
    for (const outcome of ["", " \u2003 ", null, 42]) expect(() => parseCommand(goalFieldsSchema, { title: "Goal", outcome })).toThrow();
  });
  it("counts Unicode code points consistently at meaningful boundaries", () => {
    expect(goalFieldsSchema.safeParse({ title: "😀".repeat(160), outcome: "😀".repeat(2000) }).success).toBe(true);
    expect(goalFieldsSchema.safeParse({ title: "😀".repeat(161), outcome: "ok" }).success).toBe(false);
    expect(goalFieldsSchema.safeParse({ title: "ok", outcome: "😀".repeat(2001) }).success).toBe(false);
    expect(goalFieldsSchema.safeParse({ title: "a", outcome: "b" }).success).toBe(true);
  });
  it("rejects null characters, extra fields, malformed command IDs and versions", () => {
    expect(goalFieldsSchema.safeParse({ title: "a\0", outcome: "ok" }).success).toBe(false);
    expect(goalFieldsSchema.safeParse({ title: "\ud800", outcome: "ok" }).success).toBe(false);
    expect(createGoalSchema.safeParse({ mutationId: randomUUID(), title: "a", outcome: "b", ownerId: randomUUID() }).success).toBe(false);
    expect(createGoalSchema.safeParse({ mutationId: "bad", title: "a", outcome: "b" }).success).toBe(false);
    for (const expectedVersion of [0, -1, 1.5, "1", 2147483647]) expect(archiveGoalSchema.safeParse({ mutationId: randomUUID(), expectedVersion }).success).toBe(false);
  });
  it("returns typed field validation errors without changing the input", () => {
    try { parseCommand(goalFieldsSchema, { title: " ", outcome: " " }); throw new Error("Expected failure"); }
    catch (error) { expect(error).toMatchObject({ code: "VALIDATION", details: { fields: { title: "Title is required.", outcome: "Outcome is required." } } }); }
  });
  it("edits only matching active versions while retaining identity and creation", () => {
    const next = editGoal(original, 1, { title: "Run comfortably", outcome: "Complete 10 km" }, now);
    expect(next).toMatchObject({ id: original.id, createdAt: original.createdAt, title: "Run comfortably", version: 2, updatedAt: now });
    expect(original.version).toBe(1);
    expect(() => editGoal(next, 1, { title: "Stale", outcome: "Stale" }, now)).toThrow();
  });
  it("soft archives with a single version transition and retains every outcome field", () => {
    const archived = softArchiveGoal(original, 1, now);
    expect(archived).toEqual({ ...original, version: 2, updatedAt: now, archivedAt: now });
    for (const version of [1, 2]) {
      expect(() => editGoal(archived, version, { title: "new", outcome: "new" }, now)).toThrow();
      expect(() => softArchiveGoal(archived, version, now)).toThrow();
    }
  });
  it("typed version conflicts carry only the already-owned current record", () => {
    try { softArchiveGoal(original, 2, now); throw new Error("Expected conflict"); }
    catch (error) { expect(error).toMatchObject({ code: "CONFLICT", details: { kind: "VERSION", current: original } }); }
  });
  it("defends against an unscoped repository result and strips server ownership", () => {
    expect(() => ownedGoal({ ...original, ownerId: "other" }, "actor")).toThrow("This goal is unavailable.");
    expect(() => ownedGoal(null, "actor")).toThrow("This goal is unavailable.");
    expect(ownedGoal({ ...original, ownerId: "actor" }, "actor")).toEqual(original);
  });
});
