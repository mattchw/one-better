import { describe, expect, it } from "vitest";
import { actorFromSession } from "../../src/domain/actor";
import { timezoneSchema } from "../../src/domain/timezone";
import { readConfiguration } from "../../src/server/config";
import { assertLocalProvisioning } from "../../scripts/local-user";

describe("authenticated ownership foundation", () => {
  it("rejects absent or malformed session identities", () => {
    expect(() => actorFromSession(null)).toThrow("Sign in");
    expect(() => actorFromSession({ user: { id: "browser-selected-owner" } })).toThrow("Sign in");
  });
  it("produces an immutable narrow actor", () => {
    const actor = actorFromSession({ user: { id: "00000000-0000-4000-8000-000000000001" } });
    expect(actor).toEqual({ userId: "00000000-0000-4000-8000-000000000001" });
    expect(Object.isFrozen(actor)).toBe(true);
  });
  it("uses standard timezone validation", () => {
    expect(timezoneSchema.safeParse("Europe/London").success).toBe(true);
    expect(timezoneSchema.safeParse("America/New_York").success).toBe(true);
    expect(timezoneSchema.safeParse("Mars/Olympus").success).toBe(false);
  });
  it("requires safe configuration without leaking supplied secrets", () => {
    expect(() => readConfiguration({ DATABASE_URL: "private-secret" })).toThrow("Configure DATABASE_URL");
    expect(() => readConfiguration({ DATABASE_URL: "postgresql://localhost/execution", BETTER_AUTH_SECRET: "x".repeat(32), BETTER_AUTH_URL: "http://public.example.test" })).toThrow();
  });
  it("never provisions development accounts in production or against a remote database", () => {
    expect(() => assertLocalProvisioning("postgresql://localhost/execution", "http://localhost:3100", "production")).toThrow("production");
    expect(() => assertLocalProvisioning("postgresql://remote.example.test/execution", "http://localhost:3100", "development")).toThrow("loopback");
    expect(() => assertLocalProvisioning("postgresql://localhost/execution", "http://remote.example.test", "development")).toThrow("loopback");
  });
});
