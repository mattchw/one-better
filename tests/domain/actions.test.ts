import { expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { actionFieldsSchema, createActionSchema, updateActionSchema, transitionActionSchema, actionMutability, ownedAction, editAction, completeAction, archiveAction, type Action } from "../../src/modules/actions/domain";
import type { Goal } from "../../src/modules/goals/domain";
import type { Milestone } from "../../src/modules/milestones/domain";
const now = "2026-10-02T12:00:00.000Z";
const parent: Goal = { id: randomUUID(), title: "Fitness", outcome: "Run comfortably", version: 1, createdAt: now, updatedAt: now, archivedAt: null };
const m: Milestone = { id: randomUUID(), goalId: parent.id, title: "Continuous run", successCondition: "Finish without walking", state: "active", version: 1, createdAt: now, updatedAt: now, completedAt: null, archivedAt: null, evidence: null };
const initial: Action = { id: randomUUID(), goalId: parent.id, milestoneId: null, title: "Run 5 km", doneWhen: null, estimateMinutes: 45, state: "open", version: 1, createdAt: now, updatedAt: now, completedAt: null, archivedAt: null };
const fields = { title: "Run 6 km", doneWhen: "Finish continuously", estimateMinutes: 60, milestoneId: null };
it("quick capture normalizes optional fields and Unicode text", () => {
  expect(actionFieldsSchema.parse({ title: " Run " })).toEqual({ title: "Run", doneWhen: null, estimateMinutes: null, milestoneId: null });
  expect(actionFieldsSchema.parse({ title: "😀".repeat(160), doneWhen: " 😀\nFinish " }).doneWhen).toBe("😀\nFinish");
  expect(actionFieldsSchema.parse({ title: "Run", doneWhen: " \t " }).doneWhen).toBeNull();
});
it("rejects malformed titles, done conditions and estimates with field paths", () => {
  for (const title of ["", " \n", 4, null, "\0", "\ud800", "😀".repeat(161)]) expect(actionFieldsSchema.safeParse({ title }).success).toBe(false);
  for (const doneWhen of [4, "\0", "\ud800", "😀".repeat(2001)]) expect(actionFieldsSchema.safeParse({ title: "Run", doneWhen }).success).toBe(false);
  for (const estimateMinutes of [0, -1, 1.5, "45", 10081, Infinity, NaN]) expect(actionFieldsSchema.safeParse({ title: "Run", estimateMinutes }).success).toBe(false);
  for (const estimateMinutes of [null, 1, 10080]) expect(actionFieldsSchema.safeParse({ title: "Run", estimateMinutes }).success).toBe(true);
});
it("commands forbid Goal moves, ownership/state/date/progress fields and invalid versions", () => {
  for (const extra of [{ goalId: parent.id }, { ownerId: "attacker" }, { state: "completed" }, { actualMinutes: 10 }, { dueDate: now }, { evidence: "Not required" }]) expect(createActionSchema.safeParse({ title: "Run", mutationId: randomUUID(), ...extra }).success).toBe(false);
  for (const expectedVersion of [undefined, 0, "1", 1.5, 2147483647]) for (const schema of [updateActionSchema, transitionActionSchema]) expect(schema.safeParse({ mutationId: randomUUID(), expectedVersion, ...(schema === updateActionSchema ? fields : {}) }).success).toBe(false);
});
it("edit retains immutable Goal/identity and changes only the four work fields", () => {
  expect(editAction(initial, 1, fields, parent, null, null, now)).toEqual({ ...initial, ...fields, version: 2 });
  expect(initial.version).toBe(1);
});
it("supports active same-Goal assignment, detachment and direct reassignment", () => {
  const linked = editAction(initial, 1, { ...fields, milestoneId: m.id }, parent, null, m, now);
  const detached = editAction(linked, 2, fields, parent, m, null, now); expect(detached.milestoneId).toBeNull();
  const other = { ...m, id: randomUUID() }; expect(editAction(linked, 2, { ...fields, milestoneId: other.id }, parent, m, other, now).milestoneId).toBe(other.id);
});
it("cross-Goal and terminal destination milestones cannot be assigned", () => {
  for (const dest of [{ ...m, goalId: randomUUID() }, { ...m, state: "completed" as const }, { ...m, state: "archived" as const }]) expect(() => editAction(initial, 1, { ...fields, milestoneId: dest.id }, parent, null, dest, now)).toThrow("Choose an active milestone from this goal.");
});
it("completion and archival preserve effort estimates, definition and parent state", () => {
  expect(completeAction(initial, 1, parent, null, now)).toEqual({ ...initial, state: "completed", version: 2, completedAt: now });
  expect(archiveAction(initial, 1, parent, null, now)).toEqual({ ...initial, state: "archived", version: 2, archivedAt: now });
  expect(parent.version).toBe(1); expect(m.state).toBe("active");
});
it("central effective mutability forbids changing any terminal Action or parent", () => {
  for (const value of [completeAction(initial, 1, parent, null, now), archiveAction(initial, 1, parent, null, now)]) {
    expect(actionMutability(value, parent, null)).toMatchObject({ editable: false, kind: "TERMINAL" });
    for (const change of [() => editAction(value, 2, fields, parent, null, null, now), () => completeAction(value, 2, parent, null, now), () => archiveAction(value, 2, parent, null, now)]) expect(change).toThrow();
  }
  expect(actionMutability(initial, { ...parent, archivedAt: now }, null).kind).toBe("GOAL_ARCHIVED");
  for (const state of ["completed", "archived"] as const) { const linked = { ...initial, milestoneId: m.id }; const terminal = { ...m, state };
    expect(actionMutability(linked, parent, terminal).kind).toBe("MILESTONE_TERMINAL"); expect(() => editAction(linked, 1, fields, parent, terminal, null, now)).toThrow("read-only history");
  }
});
it("stale versions return owned snapshots before terminal status and safe ownership strips identity", () => {
  const completed = completeAction(initial, 1, parent, null, now);
  try { archiveAction(completed, 1, parent, null, now); throw new Error("Expected conflict"); } catch (error) { expect(error).toMatchObject({ code: "CONFLICT", details: { kind: "VERSION", current: completed } }); }
  for (const row of [null, { ...initial, ownerId: "foreign" }]) expect(() => ownedAction(row, "owner")).toThrow("This action is unavailable.");
  expect(ownedAction({ ...initial, ownerId: "owner" }, "owner")).toEqual(initial);
  expect(() => actionMutability({ ...initial, milestoneId: m.id }, parent, null)).toThrow("unavailable");
});
