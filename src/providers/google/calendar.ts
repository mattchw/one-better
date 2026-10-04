import { OAuth2Client, CodeChallengeMethod } from "google-auth-library";
import { z } from "zod";
import { calendarScopes, canReadBusy, normalizeInterval, selectionLimit, type BusyInterval, type Calendar } from "../../modules/calendar/domain";
import { ProviderFailure, type CalendarAvailabilityProvider, type Credentials } from "../../modules/calendar/provider";

export type GoogleConfiguration = { clientId: string; clientSecret: string; redirectUri: string; testOrigin?: string };
const listPage = z.object({ items: z.array(z.object({ id: z.string().min(1).max(1024), summary: z.string().max(10000).optional(), primary: z.boolean().optional(), timeZone: z.string().max(100).optional(), accessRole: z.string(), deleted: z.boolean().optional() })).default([]), nextPageToken: z.string().min(1).max(4096).optional() });
export function mapCalendars(value: unknown): { calendars: Calendar[]; nextPageToken?: string } {
  const parsed = listPage.safeParse(value); if (!parsed.success) throw new ProviderFailure("unavailable");
  return { calendars: parsed.data.items.filter(c => !c.deleted && canReadBusy(c.accessRole)).map(c => ({ id: c.id, summary: c.summary || c.id, primary: c.primary ?? false, timezone: c.timeZone ?? null, accessRole: c.accessRole })), nextPageToken: parsed.data.nextPageToken };
}
export function mapFreeBusy(value: unknown, ids: string[], range: BusyInterval): BusyInterval[] {
  const parsed = z.object({ timeMin: z.string(), timeMax: z.string(), calendars: z.record(z.string(), z.object({ busy: z.array(z.object({ start: z.string(), end: z.string() })).optional(), errors: z.array(z.unknown()).optional() })) }).safeParse(value);
  if (!parsed.success) throw new ProviderFailure("incomplete");
  try {
    const responseRange = normalizeInterval({ start: parsed.data.timeMin, end: parsed.data.timeMax }); const expectedRange = normalizeInterval(range);
    if (responseRange.start !== expectedRange.start || responseRange.end !== expectedRange.end) throw new Error();
    return ids.flatMap(id => { const calendar = parsed.data.calendars[id]; if (!calendar || calendar.errors?.length || !calendar.busy) throw new Error(); return calendar.busy.map(normalizeInterval); });
  } catch { throw new ProviderFailure("incomplete"); }
}
function safeFailure(error: unknown): ProviderFailure {
  // Inspect only classification fields. Never propagate/log library errors,
  // request URLs, headers, bodies, tokens or raw responses.
  const parsed = z.object({ response: z.object({ status: z.number().optional(), data: z.object({ error: z.union([z.string(), z.object({ status: z.string().optional() })]).optional() }).optional() }).optional() }).safeParse(error);
  const response = parsed.success ? parsed.data.response : undefined;
  return new ProviderFailure(response?.status === 401 || response?.data?.error === "invalid_grant" ? "reauthorization_required" : "unavailable");
}
export function googleCalendarProvider(config: GoogleConfiguration): CalendarAvailabilityProvider {
  const client = () => {
    const origin = config.testOrigin;
    const oauth = new OAuth2Client({ clientId: config.clientId, clientSecret: config.clientSecret, redirectUri: config.redirectUri, transporterOptions: { timeout: 10000 }, endpoints: origin ? { oauth2AuthBaseUrl: `${origin}/authorize`, oauth2TokenUrl: `${origin}/token`, tokenInfoUrl: `${origin}/tokeninfo`, oauth2RevokeUrl: `${origin}/revoke` } : undefined });
    // Enforce one bounded HTTP attempt even for OAuth library internal calls.
    const send = oauth.transporter.request.bind(oauth.transporter);
    oauth.transporter.request = options => send({ ...options, timeout: 10000, retry: false, signal: AbortSignal.timeout(10000) });
    return oauth;
  };
  async function safely<T>(work: () => Promise<T>): Promise<T> { try { return await work(); } catch (error) { if (error instanceof ProviderFailure) throw error; throw safeFailure(error); } }
  async function grant(oauth: OAuth2Client, tokens: { access_token?: string | null; refresh_token?: string | null; expiry_date?: number | null }): Promise<Credentials> {
    if (!tokens.access_token) throw new ProviderFailure("reauthorization_required");
    const info = await oauth.getTokenInfo(tokens.access_token);
    if (info.aud !== config.clientId || !calendarScopes.every(scope => info.scopes.includes(scope))) throw new ProviderFailure("reauthorization_required");
    return { accessToken: tokens.access_token, refreshToken: tokens.refresh_token ?? null, expiresAt: tokens.expiry_date ?? info.expiry_date, scopes: info.scopes, accountId: info.sub ?? info.user_id ?? null };
  }
  async function read<T>(token: string, path: string, options: { method?: "POST"; data?: object } = {}) { const oauth = client(); oauth.setCredentials({ access_token: token }); const result = await oauth.request<T>({ url: `${config.testOrigin ?? "https://www.googleapis.com"}/calendar/v3/${path}`, ...options }); return result.data; }
  return {
    async authorization(state) { const oauth = client(); const pkce = await oauth.generateCodeVerifierAsync(); return { verifier: pkce.codeVerifier, url: oauth.generateAuthUrl({ state, scope: [...calendarScopes], access_type: "offline", prompt: "consent select_account", include_granted_scopes: false, code_challenge: pkce.codeChallenge, code_challenge_method: CodeChallengeMethod.S256 }) }; },
    exchange: (code, verifier) => safely(async () => { const oauth = client(); const { tokens } = await oauth.getToken({ code, codeVerifier: verifier }); return grant(oauth, tokens); }),
    refresh: token => safely(async () => { const oauth = client(); oauth.setCredentials({ refresh_token: token }); const { credentials } = await oauth.refreshAccessToken(); return grant(oauth, credentials); }),
    revoke: token => safely(async () => {
      // The library's revokeToken helper puts the token in its request URL.
      // Use its bounded transport with Google's supported POST form instead.
      const oauth = client(); await oauth.transporter.request({ method: "POST", url: oauth.endpoints.oauth2RevokeUrl, data: new URLSearchParams({ token }), headers: { "Content-Type": "application/x-www-form-urlencoded" } });
    }),
    listCalendars: token => safely(async () => {
      const result = new Map<string, Calendar>(); const seen = new Set<string>(); let next: string | undefined;
      for (let pages = 0; ; pages++) {
        if (pages >= 100) throw new ProviderFailure("unavailable");
        const params = new URLSearchParams({ maxResults: "250", minAccessRole: "freeBusyReader", showHidden: "true", fields: "items(id,summary,primary,timeZone,accessRole,deleted),nextPageToken" }); if (next) params.set("pageToken", next);
        const mapped = mapCalendars(await read<unknown>(token, `users/me/calendarList?${params}`)); for (const c of mapped.calendars) result.set(c.id, c);
        next = mapped.nextPageToken; if (!next) return [...result.values()]; if (seen.has(next)) throw new ProviderFailure("unavailable"); seen.add(next);
      }
    }),
    queryBusyIntervals: (token, ids, range) => safely(async () => {
      if (!ids.length || ids.length > selectionLimit || new Set(ids).size !== ids.length) throw new ProviderFailure("incomplete");
      const data = await read<unknown>(token, "freeBusy", { method: "POST", data: { timeMin: range.start, timeMax: range.end, timeZone: "UTC", calendarExpansionMax: selectionLimit, items: ids.map(id => ({ id })) } }); return mapFreeBusy(data, ids, range);
    }),
  };
}
