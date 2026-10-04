import { describe, expect, it } from "vitest";
import { busyTotals, canReadBusy, mergeBusyIntervals, normalizeInterval, selectionSchema, weekRange } from "../../src/modules/calendar/domain";
import { credentialCipher } from "../../src/modules/calendar/encryption";
import { readCalendarConfiguration } from "../../src/server/calendar-config";
import { fixtureEnvironment } from "../calendar-fixture-server";
const interval = (start: string, end: string) => ({ start, end });
const range = weekRange("2026-09-28", "Europe/London");
describe("Calendar timing, distinct from focus capacity", () => {
  it("sorts, clips, merges overlapping, nested, duplicate and adjacent intervals without double-counting", () => {
    const input = [interval("2026-09-28T12:00Z", "2026-09-28T13:00Z"), interval("2026-09-28T10:30Z", "2026-09-28T11:00Z"), interval("2026-09-28T10:00Z", "2026-09-28T12:00Z"), interval("2026-09-28T11:00Z", "2026-09-28T12:00Z"), interval("2026-09-28T10:00Z", "2026-09-28T12:00Z")];
    const copy = structuredClone(input); const result = mergeBusyIntervals(input, range); expect(result).toEqual([interval("2026-09-28T10:00:00Z", "2026-09-28T13:00:00Z")]); expect(busyTotals(result, range).totalBusyMinutes).toBe(180); expect(input).toEqual(copy);
  });
  it("clips week edges and discards entirely outside ranges", () => {
    const result = mergeBusyIntervals([interval("2026-09-27T20:00Z", "2026-09-28T01:00Z"), interval("2026-10-04T22:00Z", "2026-10-05T03:00Z"), interval("2026-10-05T04:00Z", "2026-10-05T05:00Z")], range);
    expect(result).toEqual([interval(range.start, "2026-09-28T01:00:00Z"), interval("2026-10-04T22:00:00Z", range.end)]); expect(busyTotals(result, range).totalBusyMinutes).toBe(180);
  });
  it("splits a crossing-midnight union at exact local-day boundaries", () => {
    const totals = busyTotals(mergeBusyIntervals([interval("2026-09-28T22:30Z", "2026-09-29T01:00Z")], range), range);
    expect(totals.days.slice(0, 2).map(d => d.busyMinutes)).toEqual([30, 120]); expect(totals.totalBusyMinutes).toBe(150);
  });
  it.each([["2026-03-23", 167, 23], ["2026-10-19", 169, 25]])("%s uses actual DST week and Sunday lengths", (week, hours, sundayHours) => {
    const r = weekRange(String(week), "Europe/London"); const totals = busyTotals(mergeBusyIntervals([r], r), r);
    expect(totals.totalBusyMinutes).toBe(Number(hours) * 60); expect(totals.days[6].busyMinutes).toBe(Number(sundayHours) * 60); expect(totals.days.slice(0, 6).every(d => d.busyMinutes === 1440)).toBe(true);
  });
  it("counts elapsed repeated-hour timing once and preserves second precision", () => {
    const r = weekRange("2026-10-19", "Europe/London"); const result = mergeBusyIntervals([interval("2026-10-25T01:00:00+01:00", "2026-10-25T01:00:30Z")], r);
    expect(busyTotals(result, r).days[6].busyMinutes).toBe(60.5);
  });
  it("non-European zones and skipped midnight use the first valid local date instant", () => {
    const r = weekRange("2026-09-28", "America/Los_Angeles"); expect(r.start).toBe("2026-09-28T07:00:00Z"); expect(r.end).toBe("2026-10-05T07:00:00Z");
  });
  it.each([interval("2026-09-28T10:00", "2026-09-28T11:00Z"), interval("2026-09-28T11:00Z", "2026-09-28T10:00Z"), interval("bad", "bad"), interval("2026-09-28T10:00Z", "2026-09-28T10:00Z")])("rejects invalid, ambiguous or zero intervals %o", value => { expect(() => normalizeInterval(value)).toThrow(); });
  it.each(["2026-09-29", "2026-02-30", "1999-12-27", "not-a-date"])("rejects invalid Monday identity %s", week => { expect(() => weekRange(week, "Europe/London")).toThrow(); });
  it("rejects invalid timezone and accepts an empty complete union as zero occupied minutes", () => { expect(() => weekRange("2026-09-28", "Unknown/Zone")).toThrow(); expect(busyTotals([], range)).toEqual({ days: range.days.map(d => ({ date: d.date, busyMinutes: 0 })), totalBusyMinutes: 0 }); });
  it("explicit selection allows none or 50, rejects duplicates, extras and excessive selection", () => {
    expect(selectionSchema.safeParse({ expectedVersion: 1, calendarIds: [] }).success).toBe(true); const ids = Array.from({ length: 50 }, (_, i) => `calendar-${i}`); expect(selectionSchema.safeParse({ expectedVersion: 1, calendarIds: ids }).success).toBe(true);
    for (const command of [{ expectedVersion: 1, calendarIds: [...ids, "51"] }, { expectedVersion: 1, calendarIds: ["a", "a"] }, { expectedVersion: 1, calendarIds: ["a"], ownerId: "foreign" }]) expect(selectionSchema.safeParse(command).success).toBe(false);
  });
  it("freeBusyReader through writerWithoutPrivateAccess/owner can read timing; unknown roles cannot", () => { for (const role of ["freeBusyReader", "reader", "writer", "writerWithoutPrivateAccess", "owner"]) expect(canReadBusy(role)).toBe(true); expect(canReadBusy("none")).toBe(false); expect(canReadBusy("newRole")).toBe(false); });
});
describe("Authenticated encryption and exact configuration", () => {
  it("uses random IVs and authenticates owner, connection, purpose and ciphertext", () => {
    const cipher = credentialCipher({ v1: Buffer.alloc(32, 1).toString("base64") }, "v1"); const context = "owner:connection:credentials"; const first = cipher.encrypt("fixture-only-secret", context), second = cipher.encrypt("fixture-only-secret", context);
    expect(first).not.toBe(second); expect(first).not.toContain("fixture-only-secret"); expect(cipher.decrypt(first, context)).toBe("fixture-only-secret"); expect(() => cipher.decrypt(first, "different-owner")).toThrow(); const parts = first.split("."); parts[4] = Buffer.from("tampered").toString("base64url"); expect(() => cipher.decrypt(parts.join("."), context)).toThrow();
  });
  it("key IDs allow gradual rotation while refusing unavailable keys and invalid key lengths", () => { const keys = { old: Buffer.alloc(32, 1).toString("base64"), next: Buffer.alloc(32, 2).toString("base64") }; const old = credentialCipher(keys, "old").encrypt("fixture-secret", "context"); expect(credentialCipher(keys, "next").decrypt(old, "context")).toBe("fixture-secret"); expect(() => credentialCipher({ bad: "abc" }, "bad")).toThrow(); expect(() => credentialCipher({ next: keys.next }, "next").decrypt(old, "context")).toThrow(); });
  it("Calendar remains optional and callback must exactly match the app origin and fixed path", () => { expect(readCalendarConfiguration({}, "http://127.0.0.1:3100")).toBeNull(); const env = { ...fixtureEnvironment("http://127.0.0.1:4000", "http://127.0.0.1:3101"), DATABASE_URL: "postgres://local@127.0.0.1/execution_test_abc" }; expect(readCalendarConfiguration(env, "http://127.0.0.1:3101")?.google.testOrigin).toBe("http://127.0.0.1:4000"); expect(() => readCalendarConfiguration({ ...env, GOOGLE_CALENDAR_REDIRECT_URI: "https://untrusted.test/callback" }, "http://127.0.0.1:3101")).toThrow(); });
  it.each(["postgres://local@127.0.0.1/execution", "postgres://local@remote.test/execution_test", "postgres://local@127.0.0.1/execution_test_other?x=y"])("fake provider refuses a non-test deployment %s", url => {
    // The final case has a valid test database name; separately assert remote fixture URLs.
    const env = { ...fixtureEnvironment("http://remote.test:4000", "http://127.0.0.1:3101"), DATABASE_URL: url }; expect(() => readCalendarConfiguration(env, "http://127.0.0.1:3101")).toThrow();
  });
});
