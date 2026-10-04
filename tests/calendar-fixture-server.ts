import { createServer } from "node:http";
import { createHash, randomUUID } from "node:crypto";
import { Temporal } from "@js-temporal/polyfill";
import { calendarScopes } from "../src/modules/calendar/domain";
export const fixtureKey = Buffer.alloc(32, 7).toString("base64");
export function fixtureEnvironment(origin: string, appOrigin: string) {
  return { GOOGLE_CALENDAR_CLIENT_ID: "calendar-test-client", GOOGLE_CALENDAR_CLIENT_SECRET: "calendar-test-secret", GOOGLE_CALENDAR_REDIRECT_URI: `${appOrigin}/api/calendar/callback`, CALENDAR_ENCRYPTION_KEYS: JSON.stringify({ fixture: fixtureKey }), CALENDAR_ENCRYPTION_KEY_ID: "fixture", CALENDAR_TEST_ORIGIN: origin };
}
type Controls = { failure?: boolean; partial?: boolean; revoked?: boolean; missingPersonal?: boolean; pageTwoFailure?: boolean; limitedScopes?: boolean; omitRefresh?: boolean; accountId?: string; delayMs?: number; revokeFailure?: boolean; expiresIn?: number; emptyBusy?: boolean };
export async function startCalendarFixture(appOrigin: string, port = 0) {
  let controls: Controls = {}; const codes = new Map<string, { challenge: string; redirect: string; accountId: string }>();
  const accessTokens = new Map<string, { accountId: string; scopes: string[] }>(); const refreshTokens = new Map<string, string>();
  const calls: { path: string; calendarIds?: string[] }[] = [];
  const server = createServer(async (req, res) => {
    const base = "http://127.0.0.1"; const url = new URL(req.url!, base); const chunks: Buffer[] = []; for await (const chunk of req) chunks.push(Buffer.from(chunk)); const text = Buffer.concat(chunks).toString();
    const json = (value: unknown, status = 200) => { res.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store" }); res.end(JSON.stringify(value)); };
    const redirect = (value: string) => { res.writeHead(303, { Location: value, "Referrer-Policy": "no-referrer" }); res.end(); };
    if (url.pathname === "/control") { if (req.method === "POST") { controls = JSON.parse(text || "{}"); calls.length = 0; } return json({ calls }); }
    calls.push({ path: url.pathname });
    if (url.pathname === "/authorize") {
      if (url.searchParams.get("redirect_uri") !== `${appOrigin}/api/calendar/callback` || url.searchParams.get("client_id") !== "calendar-test-client" || url.searchParams.get("code_challenge_method") !== "S256") return json({ error: "invalid_request" }, 400);
      // Simulated provider consent, entirely outside the application. It still
      // exercises the real OAuth client, code exchange, PKCE and app session.
      const approve = new URL("/approve", `http://127.0.0.1:${(server.address() as { port: number }).port}`); approve.search = url.search;
      res.writeHead(200, { "Content-Type": "text/html", "Cache-Control": "no-store" });
      const href = approve.toString().replaceAll("&", "&amp;").replaceAll('"', "&quot;"); res.end(`<html><body><h1>Simulated Google Calendar consent</h1><p>This local test provider has no real Google account access.</p><a href="${href}">Approve test Calendar access</a></body></html>`); return;
    }
    if (url.pathname === "/approve") {
      const callback = new URL(url.searchParams.get("redirect_uri")!); if (callback.origin !== appOrigin || callback.pathname !== "/api/calendar/callback") return json({}, 400);
      const code = `fixture-code-${randomUUID()}`; codes.set(code, { challenge: url.searchParams.get("code_challenge")!, redirect: callback.toString(), accountId: controls.accountId ?? "different-google-account" }); callback.searchParams.set("state", url.searchParams.get("state")!); callback.searchParams.set("code", code); return redirect(callback.toString());
    }
    if (url.pathname === "/token") {
      const form = new URLSearchParams(text); let accountId: string | undefined;
      if (form.get("client_id") !== "calendar-test-client" || form.get("client_secret") !== "calendar-test-secret") return json({ error: "invalid_client" }, 400);
      if (form.get("grant_type") === "authorization_code") {
        const entry = codes.get(form.get("code")!); codes.delete(form.get("code")!);
        if (!entry || entry.redirect !== form.get("redirect_uri") || createHash("sha256").update(form.get("code_verifier") ?? "").digest("base64url") !== entry.challenge) return json({ error: "invalid_grant" }, 400);
        accountId = entry.accountId;
      } else { accountId = refreshTokens.get(form.get("refresh_token")!); if (controls.revoked || !accountId) return json({ error: "invalid_grant" }, 400); }
      const access = `fixture-access-${randomUUID()}`; const refresh = `fixture-refresh-${randomUUID()}`;
      accessTokens.set(access, { accountId, scopes: controls.limitedScopes ? [calendarScopes[0]] : [...calendarScopes] }); refreshTokens.set(refresh, accountId);
      return json({ access_token: access, refresh_token: controls.omitRefresh ? undefined : refresh, expires_in: controls.expiresIn ?? 3600, token_type: "Bearer", scope: calendarScopes.join(" ") });
    }
    if (url.pathname === "/tokeninfo") { const token = accessTokens.get(req.headers.authorization?.replace(/^Bearer /, "") ?? ""); if (!token) return json({ error: "invalid_token" }, 401); return json({ aud: "calendar-test-client", sub: token.accountId, expires_in: 3600, scope: token.scopes.join(" ") }); }
    if (url.pathname === "/revoke") { if (url.searchParams.has("token")) return json({ error: "token_must_not_be_in_url" }, 400); if (controls.revokeFailure) return json({ error: "temporarily_unavailable" }, 503); refreshTokens.delete(new URLSearchParams(text).get("token") ?? ""); return json({}); }
    const access = accessTokens.get(req.headers.authorization?.replace(/^Bearer /, "") ?? ""); if (!access || controls.revoked) return json({ error: "invalid_token" }, 401);
    if (controls.delayMs) await new Promise(resolve => setTimeout(resolve, controls.delayMs));
    if (controls.failure) return json({ error: "temporarily_unavailable" }, 503);
    if (url.pathname === "/calendar/v3/users/me/calendarList") {
      if (url.searchParams.has("pageToken")) {
        if (controls.pageTwoFailure) return json({}, 503);
        return json({ items: controls.missingPersonal ? [] : [{ id: "personal-calendar", summary: "Personal", accessRole: "freeBusyReader", timeZone: "Europe/London", description: "Discard unused Calendar metadata" }] });
      }
      return json({ nextPageToken: "fixture-page-two", items: [{ id: "work-calendar", summary: "Work", primary: true, accessRole: "owner", timeZone: "Europe/London" }, { id: "unreadable-calendar", summary: "Unavailable role", accessRole: "none" }, { id: "holidays-calendar", summary: "Team Holidays", accessRole: "reader" }] });
    }
    if (url.pathname === "/calendar/v3/freeBusy") {
      const query = JSON.parse(text) as { timeMin: string; timeMax: string; items: { id: string }[] }; calls.at(-1)!.calendarIds = query.items.map(v => v.id);
      const monday = Temporal.Instant.from(query.timeMin).toZonedDateTimeISO("Europe/London").toPlainDate();
      const instant = (day: number, hour: number, minute = 0) => monday.add({ days: day }).toZonedDateTime({ timeZone: "Europe/London", plainTime: Temporal.PlainTime.from({ hour, minute }) }).toInstant().toString();
      const busy = (day: number, startHour: number, endHour: number, endMinute = 0) => ({ start: instant(day, startHour), end: instant(day, endHour, endMinute) });
      const calendars = Object.fromEntries(query.items.map(({ id }) => [id, controls.partial && id === "personal-calendar" || controls.missingPersonal && id === "personal-calendar" ? { errors: [{ reason: "notFound", domain: "calendar" }] } : { busy: controls.emptyBusy ? [] : id === "work-calendar" ? [busy(0, 9, 12), busy(1, 9, 14, 30), busy(2, 10, 12), busy(3, 9, 13)] : id === "personal-calendar" ? [busy(0, 10, 11), busy(4, 12, 13)] : [] }]));
      return json({ timeMin: query.timeMin, timeMax: query.timeMax, calendars });
    }
    return json({ error: "unsupported_fixture_endpoint" }, 404);
  });
  await new Promise<void>(resolve => server.listen(port, "127.0.0.1", resolve));
  return { origin: `http://127.0.0.1:${(server.address() as { port: number }).port}`, close: () => new Promise<void>((resolve, reject) => { server.close(error => error ? reject(error) : resolve()); server.closeIdleConnections(); }), controls: (value: Controls) => { controls = value; calls.length = 0; }, calls };
}
