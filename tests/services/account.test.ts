import { describe, expect, it, vi } from "vitest";
import { readAccountContext } from "../../src/modules/account/service";
describe("account context service", () => {
  it("scopes repository reads to the authenticated actor", async () => {
    const findOwnedUser = vi.fn().mockResolvedValue({ id: "A", name: "Engineer", email: "a@example.test", timezone: "Europe/London" });
    const result = await readAccountContext({ userId: "A" }, { findOwnedUser });
    expect(findOwnedUser).toHaveBeenCalledWith("A"); expect(result.id).toBe("A");
  });
  it("does not expose a missing or mismatched account", async () => {
    await expect(readAccountContext({ userId: "A" }, { findOwnedUser: async () => null })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(readAccountContext({ userId: "A" }, { findOwnedUser: async () => ({ id: "B", name: "Other", email: "b@example.test", timezone: "UTC" }) })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});
