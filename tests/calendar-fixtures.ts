import { vi } from "vitest";
import { calendarScopes } from "../src/modules/calendar/domain";
import { credentialCipher } from "../src/modules/calendar/encryption";
import type { CalendarRepository, CalendarStore, StoredCache, StoredConnection, StoredFlow } from "../src/modules/calendar/repository";
import type { CalendarAvailabilityProvider, Credentials } from "../src/modules/calendar/provider";
export const calendarClock = new Date("2026-10-02T12:00:00Z");
export const calendarGrant = (): Credentials => ({ accessToken: "fixture-unit-access", refreshToken: "fixture-unit-refresh", expiresAt: calendarClock.getTime() + 3600000, scopes: [...calendarScopes], accountId: "google-identity-different-from-app-user" });
export const calendarCipher = () => credentialCipher({ test: Buffer.alloc(32, 1).toString("base64") }, "test");
export function fakeCalendar() {
  return {
    authorization: vi.fn(async (state: string) => ({ url: `https://provider.example.test/authorize?state=${state}`, verifier: "fixture-unit-verifier" })),
    exchange: vi.fn(async () => calendarGrant()), refresh: vi.fn(async () => ({ ...calendarGrant(), refreshToken: null })), revoke: vi.fn(async () => {}),
    listCalendars: vi.fn(async () => [{ id: "work", summary: "Work", primary: true, timezone: "Europe/London", accessRole: "owner" }, { id: "personal", summary: "Personal", primary: false, timezone: null, accessRole: "freeBusyReader" }]),
    queryBusyIntervals: vi.fn(async (...args: Parameters<CalendarAvailabilityProvider["queryBusyIntervals"]>) => { void args; return [{ start: "2026-09-28T09:00:00Z", end: "2026-09-28T12:00:00Z" }, { start: "2026-09-28T10:00:00Z", end: "2026-09-28T11:00:00Z" }]; }),
  } satisfies CalendarAvailabilityProvider;
}
export function memoryCalendarRepository() {
  const connections = new Map<string, StoredConnection>(), flows = new Map<string, StoredFlow>(), caches = new Map<string, StoredCache>();
  const store = (owner: string): CalendarStore => ({
    connection: async () => structuredClone(connections.get(owner) ?? null), timezone: async () => "Europe/London", flow: async () => structuredClone(flows.get(owner) ?? null),
    saveFlow: async value => { flows.set(owner, structuredClone(value)); }, saveConnection: async (value, clearCache) => { connections.set(owner, structuredClone(value)); if (clearCache) for (const [key, c] of caches) if (c.ownerId === owner) caches.delete(key); },
    complete: async (value, flow) => { await store(owner).saveConnection(value, true); await store(owner).saveFlow(flow); },
    disconnect: async value => { await store(owner).saveConnection(value, true); flows.delete(owner); },
    cache: async (id, week, timezone) => structuredClone(caches.get(`${owner}:${id}:${week}:${timezone}`) ?? null),
    saveCache: async value => { caches.set(`${owner}:${value.connectionId}:${value.weekStartDate}:${value.timezone}`, structuredClone(value)); },
  });
  const repository: CalendarRepository = { read: async (owner, work) => work(store(owner)), locked: async (owner, work) => work(store(owner)) };
  return { repository, connections, flows, caches, store };
}
