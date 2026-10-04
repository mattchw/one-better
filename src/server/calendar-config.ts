import { z } from "zod";
import { ApplicationError } from "../domain/errors";
import { credentialCipher } from "../modules/calendar/encryption";
import type { GoogleConfiguration } from "../providers/google/calendar";
export function readCalendarConfiguration(env: Record<string, string | undefined>, appURL: string): { google: GoogleConfiguration; cipher: ReturnType<typeof credentialCipher> } | null {
  if (!env.GOOGLE_CALENDAR_CLIENT_ID || !env.GOOGLE_CALENDAR_CLIENT_SECRET || !env.CALENDAR_ENCRYPTION_KEYS || !env.CALENDAR_ENCRYPTION_KEY_ID) return null;
  try {
    const origin = new URL(appURL).origin;
    const redirectUri = `${origin}/api/calendar/callback`;
    if (env.GOOGLE_CALENDAR_REDIRECT_URI !== redirectUri) throw new Error();
    let testOrigin: string | undefined;
    if (env.CALENDAR_TEST_ORIGIN) {
      const test = new URL(env.CALENDAR_TEST_ORIGIN), database = new URL(env.DATABASE_URL!), app = new URL(origin);
      // Test endpoints are server configuration, never browser input. Refuse
      // them outside isolated loopback test databases, including production.
      if (test.protocol !== "http:" || test.hostname !== "127.0.0.1" || test.pathname !== "/" || test.search || test.hash || test.username || test.password || !["localhost", "127.0.0.1", "[::1]"].includes(database.hostname) || !/^\/execution_test(?:_[a-z0-9]+)?$/.test(database.pathname) || app.hostname !== "127.0.0.1" || env.GOOGLE_CALENDAR_CLIENT_ID !== "calendar-test-client" || env.GOOGLE_CALENDAR_CLIENT_SECRET !== "calendar-test-secret") throw new Error();
      testOrigin = test.origin;
    }
    const keys = z.record(z.string(), z.string()).parse(JSON.parse(env.CALENDAR_ENCRYPTION_KEYS));
    return { google: { clientId: env.GOOGLE_CALENDAR_CLIENT_ID, clientSecret: env.GOOGLE_CALENDAR_CLIENT_SECRET, redirectUri, testOrigin }, cipher: credentialCipher(keys, env.CALENDAR_ENCRYPTION_KEY_ID) };
  } catch { throw new ApplicationError("CONFLICT", "Google Calendar configuration needs attention. Check the server setup instructions.", { kind: "CALENDAR_SETUP" }); }
}
