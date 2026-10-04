import { describe, it, expect } from "vitest";
import { hoverPlacement, placementInPlan } from "../../src/components/calendar-hover-placement";

describe("empty calendar placement suggestions", () => {
  const now = Date.parse("2026-10-04T12:00Z");
  it("snaps to half hours and respects the displayed timezone", () => {
    expect(hoverPlacement("2026-10-05", 607, "Europe/London", now, [])).toEqual({ date: "2026-10-05", startTime: "10:00", endTime: "11:00" });
    expect(hoverPlacement("2026-10-04", 750, "Europe/London", now, [])).toBeNull();
  });
  it("shortens the suggestion before existing work and never suggests inside a block", () => {
    const occupied = [{ start: "2026-10-05T09:30Z", end: "2026-10-05T10:00Z" }];
    expect(hoverPlacement("2026-10-05", 600, "Europe/London", now, occupied)?.endTime).toBe("10:30");
    expect(hoverPlacement("2026-10-05", 630, "Europe/London", now, occupied)).toBeNull();
    expect(hoverPlacement("2026-10-05", 660, "Europe/London", now, occupied)?.endTime).toBe("12:00");
  });
  it("keeps the suggestion within one local day", () => {
    expect(hoverPlacement("2026-10-05", 1410, "Europe/London", now, [])?.endTime).toBe("23:59");
  });
  it("leaves repeated and nonexistent wall times to explicit placement review", () => {
    expect(hoverPlacement("2026-10-25", 90, "Europe/London", now, [])).toBeNull();
    expect(hoverPlacement("2027-03-28", 90, "Europe/London", now, [])).toBeNull();
  });
});


describe("hover placement in a pinned plan timezone", () => {
  it("preserves the clicked instant instead of reinterpreting the displayed wall time", () => {
    expect(placementInPlan({ date: "2028-01-04", startTime: "10:00", endTime: "11:00" }, "America/New_York", "Europe/London", "2028-01-03")).toEqual({ date: "2028-01-04", startTime: "15:00", endTime: "16:00" });
  });
  it("does not suggest intervals crossing the plan's midnight or week boundary", () => {
    expect(placementInPlan({ date: "2028-01-04", startTime: "18:30", endTime: "19:30" }, "America/New_York", "Europe/London", "2028-01-03")).toBeNull();
    expect(placementInPlan({ date: "2028-01-09", startTime: "21:00", endTime: "22:00" }, "America/New_York", "Europe/London", "2028-01-03")).toBeNull();
  });
});
