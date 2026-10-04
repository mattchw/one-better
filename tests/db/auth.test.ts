import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { connectDatabase } from "../../src/db/connect";
import { account, session } from "../../src/db/schema";
import { createAuthentication } from "../../src/server/auth-factory";
import { actorFromSession } from "../../src/domain/actor";
import { accountRepository } from "../../src/modules/account/repository";
import { readAccountContext } from "../../src/modules/account/service";
import { provisionLocalUser } from "../../scripts/local-user";
import { requireTestDatabaseURL } from "../../scripts/test-database";

const { url } = requireTestDatabaseURL();
const { db, pool } = connectDatabase(url);
const baseURL = process.env.BETTER_AUTH_URL!;
const auth = createAuthentication(db, { secret: process.env.BETTER_AUTH_SECRET!, baseURL });
const credentials = (suffix: string) => ({ email: process.env[`TEST_USER_${suffix}_EMAIL`]!, password: process.env[`TEST_USER_${suffix}_PASSWORD`]! });
const cookie = (response: Response) => response.headers.getSetCookie().map((v) => v.split(";")[0]).join("; ");
async function signIn(suffix: string) {
  return auth.handler(new Request(`${baseURL}/api/auth/sign-in/email`, { method: "POST", headers: { "Content-Type": "application/json", Origin: baseURL }, body: JSON.stringify(credentials(suffix)) }));
}
beforeAll(async () => {
  await migrate(db, { migrationsFolder: "src/db/migrations" });
  for (const suffix of ["A", "B"]) await provisionLocalUser(db, { ...credentials(suffix), name: `Engineer ${suffix}`, timezone: "Europe/London" });
});
afterAll(async () => { await pool.end(); });

describe("real PostgreSQL authentication", () => {
  it("creates the complete schema from migrations and is repeatable", async () => {
    await migrate(db, { migrationsFolder: "src/db/migrations" });
    const tables = await pool.query("SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename");
    expect(tables.rows.map((r) => r.tablename)).toEqual(["action", "ai_recommendation_run", "amendment_commitment", "app_user", "auth_account", "auth_session", "auth_verification", "calendar_availability_cache", "calendar_oauth_flow", "chatgpt_connection", "chatgpt_oauth_flow", "commitment_identity", "daily_reflection", "focus_cycle", "focus_cycle_goal", "focus_session", "focusable_hours", "goal", "google_calendar_connection", "milestone", "mutation_receipt", "time_block", "weekly_commitment", "weekly_plan", "weekly_plan_amendment", "weekly_review", "weekly_review_decision"]);
    const types = await pool.query("SELECT data_type FROM information_schema.columns WHERE table_name='auth_session' AND column_name='expires_at'");
    expect(types.rows[0].data_type).toBe("timestamp with time zone");
  });
  it("rejects anonymous, invalid, and untrusted-origin sessions", async () => {
    expect(await auth.api.getSession({ headers: new Headers() })).toBeNull();
    expect(await auth.api.getSession({ headers: new Headers({ cookie: "better-auth.session_token=forged" }) })).toBeNull();
    const denied = await auth.handler(new Request(`${baseURL}/api/auth/sign-in/email`, { method: "POST", headers: { "Content-Type": "application/json", Origin: "https://evil.example.test" }, body: JSON.stringify(credentials("A")) }));
    expect(denied.status).toBe(403);
  });
  it("keeps email/password registration disabled", async () => {
    const response = await auth.handler(new Request(`${baseURL}/api/auth/sign-up/email`, { method: "POST", headers: { "Content-Type": "application/json", Origin: baseURL }, body: JSON.stringify({ ...credentials("A"), name: "Forbidden" }) }));
    expect(response.ok).toBe(false);
  });
  it("uses hashes rather than plaintext credentials", async () => {
    const accounts = await db.select().from(account);
    expect(accounts).toHaveLength(2);
    for (const a of accounts) { expect(a.password).not.toBe(credentials("A").password); expect(a.password).not.toBe(credentials("B").password); expect(a.accessToken).toBeNull(); expect(a.refreshToken).toBeNull(); }
  });
  it("resolves distinct authenticated owners and ignores arbitrary ownership input", async () => {
    const a = await signIn("A"); const b = await signIn("B");
    expect(a.status).toBe(200); expect(b.status).toBe(200);
    expect(a.headers.getSetCookie().join(" ")).toContain("HttpOnly");
    const sa = await auth.api.getSession({ headers: new Headers({ cookie: cookie(a) }) });
    const sb = await auth.api.getSession({ headers: new Headers({ cookie: cookie(b) }) });
    const actorA = actorFromSession(sa); const actorB = actorFromSession(sb);
    expect(actorA.userId).not.toBe(actorB.userId);
    const current = await readAccountContext(actorA, accountRepository(db));
    expect(current.email).toBe(credentials("A").email); expect(current.id).not.toBe(actorB.userId);
    const repeated = await provisionLocalUser(db, { ...credentials("A"), name: "Engineer A", timezone: "Europe/London" });
    expect(repeated).toEqual({ created: false, id: actorA.userId });
  });
  it("rejects wrong passwords without creating a session", async () => {
    const response = await auth.handler(new Request(`${baseURL}/api/auth/sign-in/email`, { method: "POST", headers: { "Content-Type": "application/json", Origin: baseURL }, body: JSON.stringify({ email: credentials("A").email, password: "incorrect-password" }) }));
    expect(response.status).toBe(401);
  });
  it("persists sessions in Postgres across auth-instance replacement and respects revocation", async () => {
    const response = await signIn("A"); const headers = new Headers({ cookie: cookie(response) });
    const first = await auth.api.getSession({ headers }); expect(first).not.toBeNull();
    const restarted = createAuthentication(db, { secret: process.env.BETTER_AUTH_SECRET!, baseURL });
    const second = await restarted.api.getSession({ headers }); expect(second?.user.id).toBe(first?.user.id);
    await db.delete(session).where(eq(session.id, second!.session.id));
    expect(await restarted.api.getSession({ headers })).toBeNull();
  });
  it("rejects expired sessions even with an otherwise valid cookie", async () => {
    const response = await signIn("B"); const headers = new Headers({ cookie: cookie(response) });
    const valid = await auth.api.getSession({ headers }); expect(valid).not.toBeNull();
    await db.update(session).set({ expiresAt: new Date(0) }).where(eq(session.id, valid!.session.id));
    expect(await auth.api.getSession({ headers })).toBeNull();
  });
  it("throttles repeated sign-in attempts", async () => {
    const statuses: number[] = [];
    for (let attempt = 0; attempt < 11; attempt++) {
      const response = await auth.handler(new Request(`${baseURL}/api/auth/sign-in/email`, { method: "POST", headers: { "Content-Type": "application/json", Origin: baseURL }, body: JSON.stringify({ email: credentials("A").email, password: "incorrect-password" }) }));
      statuses.push(response.status);
    }
    expect(statuses).toContain(429); expect(statuses.at(-1)).toBe(429);
  });
});
