import { expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { addDays, calendarDate, capacitySummary, commitPlanSchema, createPlanSchema, currentWeek, mondayOf, ownedPlan, planningSource, planningView, requireDraft, savePlanSchema, sourceIssues, sourceGuardSchema, weekSchema } from "../../src/modules/planning/domain";
import { action, checkpoint, now, parent, plan, source } from "../planning-fixtures";
const create = { mutationId: randomUUID(), weekStartDate: plan.weekStartDate, provisionalCapacityMinutes: 720, reserveMinutes: 180 };
const save = { mutationId: randomUUID(), expectedVersion: 2, provisionalCapacityMinutes: 720, reserveMinutes: 180, commitments: [{ actionId: action.id, source: source.source, budgetMinutes: 180 }] };
it.each([
  ["2026-03-29T23:30:00Z", "Europe/London", "2026-03-30"],
  ["2026-03-29T00:30:00Z", "Europe/London", "2026-03-23"],
  ["2026-10-25T00:30:00Z", "Europe/London", "2026-10-19"],
  ["2026-10-25T01:30:00Z", "Europe/London", "2026-10-19"],
  ["2026-10-04T23:30:00Z", "Asia/Tokyo", "2026-10-05"],
  ["2026-10-05T00:30:00Z", "America/Los_Angeles", "2026-09-28"],
])("local Monday identity at %s in %s", (instant, zone, expected) => { expect(currentWeek(instant, zone)).toBe(expected); });
it("calendar arithmetic crosses DST, month/year and leap boundaries without 168-hour assumptions", () => {
  expect(addDays("2026-03-23", 7)).toBe("2026-03-30"); expect(addDays("2026-10-19", 7)).toBe("2026-10-26"); expect(mondayOf("2027-01-01")).toBe("2026-12-28"); expect(addDays("2028-02-28", 1)).toBe("2028-02-29");
  for (const value of ["2026-02-30", "2026-9-28", "2026-10-02", "1999-12-27"]) expect(weekSchema.safeParse(value).success).toBe(false); expect(calendarDate("2026-10-02")).toBe(true);
});
it("capacity arithmetic preserves reserve and presents unused capacity as a normal positive result", () => {
  expect(capacitySummary({ ...plan, commitments: [{ ...plan.commitments[0], budgetMinutes: 390 }] })).toEqual({ usableMinutes: 540, totalMinutes: 390, remainingMinutes: 150 });
  expect(capacitySummary({ ...plan, commitments: [] }).remainingMinutes).toBe(540); expect(capacitySummary({ ...plan, commitments: [{ ...plan.commitments[0], budgetMinutes: 600 }] }).remainingMinutes).toBe(-60);
});
it("bounded whole-minute capacity and reserve rules reject coercion and invalid combinations", () => {
  for (const fields of [{ provisionalCapacityMinutes: 0 }, { provisionalCapacityMinutes: 10081 }, { provisionalCapacityMinutes: "720" }, { provisionalCapacityMinutes: 1.5 }, { reserveMinutes: -1 }, { reserveMinutes: 720 }, { reserveMinutes: 721 }, { reserveMinutes: 0.5 }]) expect(createPlanSchema.safeParse({ ...create, ...fields }).success).toBe(false);
  expect(createPlanSchema.parse({ ...create, provisionalCapacityMinutes: 1, reserveMinutes: 0 }).reserveMinutes).toBe(0);
});
it("budget is independent of Action estimate and duplicates and excessive selections are invalid", () => {
  expect(savePlanSchema.parse(save).commitments[0].budgetMinutes).toBe(180); expect(action.estimateMinutes).toBe(120);
  for (const budgetMinutes of [0, -1, 1.5, "60", 10081]) expect(savePlanSchema.safeParse({ ...save, commitments: [{ ...save.commitments[0], budgetMinutes }] }).success).toBe(false);
  expect(savePlanSchema.safeParse({ ...save, commitments: [...save.commitments, ...save.commitments] }).success).toBe(false);
  expect(savePlanSchema.safeParse({ ...save, commitments: Array.from({ length: 51 }, () => ({ ...save.commitments[0], actionId: randomUUID() })) }).success).toBe(false);
  expect(savePlanSchema.parse({ ...save, commitments: [] }).commitments).toEqual([]);
});
it("commands forbid browser ownership, timezone, lifecycle, snapshots and later-phase fields", () => {
  for (const extra of [{ ownerId: "other" }, { timezone: "Asia/Tokyo" }, { state: "committed" }, { scheduledMinutes: 60 }, { revision: 2 }]) expect(createPlanSchema.safeParse({ ...create, ...extra }).success).toBe(false);
  expect(savePlanSchema.safeParse({ ...save, commitments: [{ ...save.commitments[0], snapshot: {} }] }).success).toBe(false); expect(commitPlanSchema.safeParse({ mutationId: randomUUID(), expectedVersion: 0 }).success).toBe(false);
});
it("eligibility reuses Action mutability for Goal-level and active milestone Actions", () => {
  expect(planningSource({ ...action, milestoneId: null }, parent, null).eligible).toBe(true); expect(source.eligible).toBe(true);
  expect(planningSource({ ...action, state: "completed" }, parent, checkpoint).eligible).toBe(false); expect(planningSource({ ...action, state: "archived" }, parent, checkpoint).eligible).toBe(false);
  expect(planningSource(action, { ...parent, archivedAt: now }, checkpoint).eligible).toBe(false);
  for (const state of ["completed", "archived"] as const) expect(planningSource(action, parent, { ...checkpoint, state }).eligible).toBe(false);
  expect(() => planningSource(action, parent, { ...checkpoint, goalId: randomUUID() })).toThrow();
});
it("changed source versions and active milestone moves require review, without rewriting guards", () => {
  const moved = { ...source, source: { ...source.source, milestoneId: randomUUID(), milestoneVersion: 1, actionVersion: 2 } };
  expect(sourceIssues(plan.commitments, [moved])[0].kind).toBe("CHANGED"); expect(sourceIssues(plan.commitments, [{ ...source, source: { ...source.source, goalVersion: 2 } }])[0].kind).toBe("CHANGED"); expect(plan.commitments[0].source).toEqual(source.source);
  expect(sourceIssues(plan.commitments, [])[0].kind).toBe("UNAVAILABLE"); expect(sourceIssues(plan.commitments, [{ ...source, eligible: false, reason: "Archived" }])[0].kind).toBe("INELIGIBLE");
});
it("Draft version and terminal lifecycle are distinct typed conflicts; committed view ignores live sources", () => {
  expect(() => requireDraft(plan, 1)).toThrow(expect.objectContaining({ details: expect.objectContaining({ kind: "VERSION" }) }));
  expect(() => requireDraft({ ...plan, state: "committed" }, 2)).toThrow(expect.objectContaining({ details: expect.objectContaining({ kind: "COMMITTED" }) }));
  const frozen = { ...plan, state: "committed" as const, committedAt: now, commitments: [{ ...plan.commitments[0], snapshot: source.context }] };
  const view = planningView(frozen, [{ ...source, eligible: false }]); expect(view.sources).toEqual([]); expect(view.issues).toEqual([]); expect(view.canCommit).toBe(false); expect(view.plan.commitments[0].snapshot).toEqual(source.context);
});
it("foreign and missing Plans are indistinguishable and DTOs omit owner identity", () => {
  for (const value of [null, { ...plan, ownerId: "other" }]) expect(() => ownedPlan(value, "owner")).toThrow(expect.objectContaining({ code: "NOT_FOUND", message: "This weekly plan is unavailable." })); expect(ownedPlan(plan, "owner")).not.toHaveProperty("ownerId");
});

it("General sources have no Goal or milestone and reject incomplete linkage guards", () => {
  const general = planningSource({ ...action, goalId:null, milestoneId:null },null,null);
  expect(general.eligible).toBe(true);
  expect(general.context.goal).toBeNull();
  expect(sourceGuardSchema.parse(general.source)).toMatchObject({goalId:null,goalVersion:null,milestoneId:null,milestoneVersion:null});
  for (const extra of [{goalId:parent.id},{goalVersion:1},{milestoneId:checkpoint.id,milestoneVersion:1}]) {
    expect(sourceGuardSchema.safeParse({...general.source,...extra}).success).toBe(false);
  }
  expect(()=>planningSource({...action,goalId:null,milestoneId:null},parent,null)).toThrow();
});
