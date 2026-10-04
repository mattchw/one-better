import { createHash, randomBytes, randomUUID } from "node:crypto";
import { z } from "zod";
import { isDeepStrictEqual } from "node:util";
import type { Actor } from "../../domain/actor";
import { ApplicationError } from "../../domain/errors";
import { currentWeek } from "../planning/domain";
import { busyTotals, calendarScopes, freshnessMinutes, mergeBusyIntervals, selectionMissing, selectionSchema, validate, weekRange, weekSchema, type Availability, type CalendarFailure, type CalendarWorkspace, type Connection } from "./domain";
import { ProviderFailure, type CalendarAvailabilityProvider, type Credentials } from "./provider";
import type { credentialCipher } from "./encryption";
import type { CalendarRepository, CalendarStore, StoredCache, StoredConnection } from "./repository";
const credentialSchema = z.strictObject({ accessToken: z.string().min(1).max(16384), refreshToken: z.string().min(1).max(16384).nullable(), expiresAt: z.number().finite().positive(), scopes: z.array(z.string().max(1024)).max(100), accountId: z.string().min(1).max(1024).nullable() });
const hash = (value: string) => createHash("sha256").update(value).digest("hex");
const selectionKey = (ids: string[]) => hash(JSON.stringify([...ids].sort()));
const tokenContext = (c: StoredConnection) => `google:${c.ownerId}:${c.id}`;
const flowContext = (owner: string, stateHash: string) => `oauth:${owner}:${stateHash}`;
export function connectionDTO(value: StoredConnection): Connection {
  return { id: value.id, state: value.state, version: value.version, calendars: structuredClone(value.calendars), selectedCalendarIds: [...value.selectedCalendarIds], listFetchedAt: value.listFetchedAt?.toISOString() ?? null, listError: value.listError };
}
function owned(value: StoredConnection | null, actor: Actor, id?: string): StoredConnection {
  if (!value || value.ownerId !== actor.userId || id && value.id !== id) throw new ApplicationError("NOT_FOUND", "This Calendar connection is unavailable.");
  return value;
}
function connected(value: StoredConnection) { if (value.state !== "connected") throw new ApplicationError("CONFLICT", "Reconnect Google Calendar in Integrations.", { kind: "CALENDAR_CONNECTION" }); }
function checkGrant(value: Credentials) {
  const result = credentialSchema.safeParse(value);
  if (!result.success || !calendarScopes.every(scope => result.data.scopes.includes(scope))) throw new ProviderFailure("reauthorization_required");
  return result.data;
}
function failure(error: unknown): CalendarFailure { return error instanceof ProviderFailure ? error.kind : "unavailable"; }
export function cachedAvailability(value: StoredConnection | null, cached: StoredCache | null, week: string, timezone: string, forcedError: CalendarFailure | null = null, now = new Date()): Availability {
    const range = weekRange(week, timezone);
    const base: Availability = { weekStartDate: week, timezone, status: "unavailable", intervals: null, days: [], totalBusyMinutes: null, fetchedAt: null, error: forcedError };
    if (!value || value.state === "disconnected" || !value.selectedCalendarIds.length) return { ...base, status: "not_configured" };
    const error = forcedError ?? (value.state === "reauthorization_required" ? "reauthorization_required" : selectionMissing(connectionDTO(value)).length ? "selection_review" : null) ?? cached?.lastError ?? null;
    if (!cached || cached.selectionKey !== selectionKey(value.selectedCalendarIds)) return { ...base, error };
    return { ...base, intervals: structuredClone(cached.intervals), ...busyTotals(cached.intervals, range), fetchedAt: cached.fetchedAt.toISOString(), status: error || now.getTime() - cached.fetchedAt.getTime() >= freshnessMinutes * 60_000 ? "stale" : "fresh", error };
  }
export function calendarService(repository: CalendarRepository, provider: CalendarAvailabilityProvider | null, cipher: ReturnType<typeof credentialCipher> | null, clock: () => Date = () => new Date()) {
  function configuration() { if (!provider || !cipher) throw new ApplicationError("CONFLICT", "Google Calendar is not configured on this local app. See the setup instructions.", { kind: "CALENDAR_SETUP" }); return { provider, cipher }; }
  function decode(value: StoredConnection) { const { cipher } = configuration(); try { return checkGrant(JSON.parse(cipher.decrypt(value.encryptedCredentials!, tokenContext(value)))); } catch { throw new ProviderFailure("reauthorization_required"); } }
  async function withAccess<T>(store: CalendarStore, context: { connection: StoredConnection }, work: (token: string) => Promise<T>): Promise<T> {
    const { provider, cipher } = configuration(); let credentials = decode(context.connection); let refreshed = false;
    const refresh = async () => {
      if (!credentials.refreshToken) throw new ProviderFailure("reauthorization_required");
      const next = checkGrant(await provider.refresh(credentials.refreshToken));
      // Refresh belongs to the same grant. Reject an unexpected subject switch.
      if (next.accountId && credentials.accountId && next.accountId !== credentials.accountId) throw new ProviderFailure("reauthorization_required");
      credentials = { ...next, refreshToken: next.refreshToken ?? credentials.refreshToken, accountId: next.accountId ?? credentials.accountId };
      context.connection = { ...context.connection, encryptedCredentials: cipher.encrypt(JSON.stringify(credentials), tokenContext(context.connection)), accessExpiresAt: new Date(credentials.expiresAt), grantedScopes: credentials.scopes, updatedAt: clock() };
      await store.saveConnection(context.connection); refreshed = true;
    };
    if (credentials.expiresAt <= clock().getTime() + 60_000) await refresh();
    try { return await work(credentials.accessToken); } catch (error) { if (!(error instanceof ProviderFailure) || error.kind !== "reauthorization_required" || refreshed) throw error; await refresh(); return work(credentials.accessToken); }
  }
  async function markFailure(store: CalendarStore, value: StoredConnection, kind: CalendarFailure): Promise<StoredConnection> {
    if (kind !== "reauthorization_required") return value;
    const next: StoredConnection = { ...value, state: "reauthorization_required", version: value.version + 1, listError: kind, updatedAt: clock() };
    await store.saveConnection(next); return next;
  }

  return {
    async workspace(actor: Actor, week?: string, id?: string): Promise<CalendarWorkspace> {
      if (id) validate(z.uuid(), id); if (week) validate(weekSchema, week);
      return repository.read(actor.userId, async store => {
        const raw = await store.connection(); const value = id ? owned(raw, actor, id) : raw ? owned(raw, actor) : null;
        const timezone = await store.timezone(); const chosenWeek = week ?? currentWeek(clock().toISOString(), timezone);
        const cached = value ? await store.cache(value.id, chosenWeek, timezone) : null;
        return { configured: !!provider && !!cipher, connection: value ? connectionDTO(value) : null, availability: cachedAvailability(value, cached, chosenWeek, timezone, null, clock()) };
      });
    },
    async start(actor: Actor): Promise<{ url: string }> {
      const { provider, cipher } = configuration();
      return repository.locked(actor.userId, async store => {
        const state = randomBytes(32).toString("base64url"); const stateHash = hash(state); const result = await provider.authorization(state);
        await store.saveFlow({ ownerId: actor.userId, stateHash, encryptedVerifier: cipher.encrypt(result.verifier, flowContext(actor.userId, stateHash)), expiresAt: new Date(clock().getTime() + 10 * 60_000), result: null });
        return { url: result.url };
      });
    },
    async callback(actor: Actor, input: { state: string | null; code: string | null; denied: boolean }): Promise<"success" | "cancelled" | "failed"> {
      const { provider, cipher } = configuration();
      if (!input.state || input.state.length > 256) return "failed";
      return repository.locked(actor.userId, async store => {
        const flow = await store.flow(); if (!flow || flow.ownerId !== actor.userId || flow.stateHash !== hash(input.state!) || flow.expiresAt <= clock()) return "failed";
        if (flow.result) return flow.result === "processing" ? "failed" : flow.result;
        const verifier = cipher.decrypt(flow.encryptedVerifier!, flowContext(actor.userId, flow.stateHash));
        const consumed = { ...flow, encryptedVerifier: null, result: "processing" as const };
        await store.saveFlow(consumed); // Claim before exchange: retry/crash cannot exchange a code twice.
        if (input.denied || !input.code || input.code.length > 16384) { const result = input.denied ? "cancelled" as const : "failed" as const; await store.saveFlow({ ...consumed, result }); return result; }
        try {
          const grant = checkGrant(await provider.exchange(input.code, verifier)); const previous = await store.connection();
          const sameAccount = !!grant.accountId && grant.accountId === previous?.providerAccountId;
          // A missing refresh token can reuse an old one only for a verified
          // identical subject; never pair credentials from different accounts.
          if (!grant.refreshToken && sameAccount && previous?.state === "connected" && previous.encryptedCredentials) grant.refreshToken = decode(previous).refreshToken;
          if (!grant.refreshToken) throw new ProviderFailure("reauthorization_required");
          const now = clock(); const value: StoredConnection = { id: previous?.id ?? randomUUID(), ownerId: actor.userId, state: "connected", version: (previous?.version ?? 0) + 1, providerAccountId: grant.accountId, encryptedCredentials: null, accessExpiresAt: new Date(grant.expiresAt), grantedScopes: grant.scopes, calendars: sameAccount ? previous!.calendars : [], selectedCalendarIds: sameAccount ? previous!.selectedCalendarIds : [], listFetchedAt: null, listError: null, createdAt: previous?.createdAt ?? now, updatedAt: now };
          value.encryptedCredentials = cipher.encrypt(JSON.stringify(grant), tokenContext(value)); await store.complete(value, { ...consumed, result: "success" }); return "success";
        } catch (error) {
          if (error instanceof ApplicationError) throw error; // Do not claim success/failure after uncertain DB acknowledgement.
          await store.saveFlow({ ...consumed, result: "failed" }); return "failed";
        }
      });
    },
    async refreshCalendars(actor: Actor, id: string): Promise<Connection> {
      validate(z.uuid(), id);
      return repository.locked(actor.userId, async store => {
        const context = { connection: owned(await store.connection(), actor, id) }; connected(context.connection);
        try {
          const calendars = await withAccess(store, context, token => configuration().provider.listCalendars(token));
          const next: StoredConnection = { ...context.connection, calendars, listFetchedAt: clock(), listError: null, version: context.connection.version + (isDeepStrictEqual(calendars, context.connection.calendars) ? 0 : 1), updatedAt: clock() };
          if (selectionMissing(connectionDTO(next)).length) next.listError = "selection_review";
          await store.saveConnection(next); return connectionDTO(next);
        } catch (error) {
          if (error instanceof ApplicationError) throw error;
          const kind = failure(error); const next = await markFailure(store, context.connection, kind);
          await store.saveConnection({ ...next, listError: kind }); return connectionDTO({ ...next, listError: kind });
        }
      });
    },
    async select(actor: Actor, id: string, input: unknown): Promise<Connection> {
      validate(z.uuid(), id); const command = validate(selectionSchema, input); const ids = [...command.calendarIds].sort();
      return repository.locked(actor.userId, async store => {
        const value = owned(await store.connection(), actor, id); connected(value);
        if (value.version !== command.expectedVersion) {
          // Lost-ack retry is a safe no-op when the exact desired selection is already current.
          if (JSON.stringify(ids) === JSON.stringify([...value.selectedCalendarIds].sort())) return connectionDTO(value);
          throw new ApplicationError("CONFLICT", "Calendar selection changed elsewhere. Review the latest saved selection.", { kind: "CALENDAR_VERSION", current: connectionDTO(value) });
        }
        if (!value.listFetchedAt || value.listError && value.listError !== "selection_review") throw new ApplicationError("CONFLICT", "Refresh the calendar list before saving your selection.");
        if (ids.some(id => !value.calendars.some(c => c.id === id))) throw new ApplicationError("VALIDATION", "Choose only calendars in the current list. Remove unavailable selections.");
        if (JSON.stringify(ids) === JSON.stringify([...value.selectedCalendarIds].sort())) return connectionDTO(value);
        const next = { ...value, selectedCalendarIds: ids, listError: null, version: value.version + 1, updatedAt: clock() }; await store.saveConnection(next, true); return connectionDTO(next);
      });
    },
    async refreshAvailability(actor: Actor, id: string, input: unknown): Promise<Availability> {
      validate(z.uuid(), id); const { weekStartDate } = validate(z.strictObject({ weekStartDate: weekSchema }), input);
      return repository.locked(actor.userId, async store => {
        const context = { connection: owned(await store.connection(), actor, id) }; const timezone = await store.timezone(); const range = weekRange(weekStartDate, timezone);
        let cached = await store.cache(id, weekStartDate, timezone);
        if (context.connection.state !== "connected" || !context.connection.selectedCalendarIds.length || selectionMissing(connectionDTO(context.connection)).length) return cachedAvailability(context.connection, cached, weekStartDate, timezone, null, clock());
        try {
          const intervals = mergeBusyIntervals(await withAccess(store, context, token => configuration().provider.queryBusyIntervals(token, context.connection.selectedCalendarIds, range)), range);
          cached = { ownerId: actor.userId, connectionId: id, weekStartDate, timezone, selectionKey: selectionKey(context.connection.selectedCalendarIds), intervals, fetchedAt: clock(), lastError: null }; await store.saveCache(cached);
          return cachedAvailability(context.connection, cached, weekStartDate, timezone, null, clock());
        } catch (error) {
          if (error instanceof ApplicationError) throw error;
          const kind = failure(error); context.connection = await markFailure(store, context.connection, kind);
          if (cached && cached.selectionKey === selectionKey(context.connection.selectedCalendarIds)) await store.saveCache({ ...cached, lastError: kind });
          return cachedAvailability(context.connection, cached, weekStartDate, timezone, kind, clock());
        }
      });
    },
    async disconnect(actor: Actor, id: string): Promise<{ connection: Connection; revocationConfirmed: boolean }> {
      validate(z.uuid(), id);
      return repository.locked(actor.userId, async store => {
        const value = owned(await store.connection(), actor, id); let token: string | null = null;
        try { if (value.encryptedCredentials) { const credentials = decode(value); token = credentials.refreshToken ?? credentials.accessToken; } } catch { /* Local secret removal still succeeds if key is unavailable. */ }
        const next: StoredConnection = { ...value, state: "disconnected", encryptedCredentials: null, providerAccountId: null, accessExpiresAt: null, grantedScopes: [], calendars: [], selectedCalendarIds: [], listFetchedAt: null, listError: null, version: value.state === "disconnected" ? value.version : value.version + 1, updatedAt: value.state === "disconnected" ? value.updatedAt : clock() };
        // Erase locally first. A provider timeout or process interruption must
        // not retain secrets/config/cache or let a pending callback resurrect it.
        await store.disconnect(next);
        let revocationConfirmed = false;
        if (token && provider) { try { await provider.revoke(token); revocationConfirmed = true; } catch { revocationConfirmed = false; } }
        return { connection: connectionDTO(next), revocationConfirmed };
      });
    },
  };
}
