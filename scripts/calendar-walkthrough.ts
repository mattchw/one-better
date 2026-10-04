// Manual UI quality gate against an isolated simulated provider, with real auth.
// Run: npx tsx --env-file=.env.test scripts/calendar-walkthrough.ts
import { randomBytes, randomUUID } from "node:crypto";
import { spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { createInterface } from "node:readline";
import { setTimeout as delay } from "node:timers/promises";
import assert from "node:assert/strict";
import { Pool } from "pg";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { connectDatabase } from "../src/db/connect";
import { assertLocalProvisioning, provisionLocalUser } from "./local-user";
import { requireTestDatabaseURL } from "./test-database";
import { startCalendarFixture, fixtureEnvironment } from "../tests/calendar-fixture-server";
import { goalService } from "../src/modules/goals/service";
import { goalRepository } from "../src/modules/goals/repository";
import { actionService } from "../src/modules/actions/service";
import { actionRepository } from "../src/modules/actions/repository";
import { planService } from "../src/modules/planning/service";
import { planRepository } from "../src/modules/planning/repository";
import { currentWeek } from "../src/modules/planning/domain";
const { url } = requireTestDatabaseURL(); const origin = "http://127.0.0.1:3104";
assertLocalProvisioning(url, origin);
const databaseURL = new URL(url), adminURL = new URL(url); const name = `execution_test_${randomBytes(6).toString("hex")}`;
databaseURL.pathname = `/${name}`; adminURL.pathname = "/postgres";
const admin = new Pool({ connectionString: adminURL.toString() });
const database = connectDatabase(databaseURL.toString()); const fixture = await startCalendarFixture(origin);
let created = false, child: ChildProcess | undefined;
try {
  await admin.query(`CREATE DATABASE "${name}"`); created = true;
  await migrate(database.db, { migrationsFolder: "src/db/migrations" });
  const actor = { userId: (await provisionLocalUser(database.db, { email: "calendar-walkthrough@example.test", password: "SimulatedCalendarOnly-2026!", name: "Calendar walkthrough", timezone: "Europe/London" })).id };
  const goals = goalService(goalRepository(database.db)), actions = actionService(actionRepository(database.db)), plans = planService(planRepository(database.db));
  const goal = await goals.createGoal(actor, { mutationId: randomUUID(), title: "Make the weekly planning loop useful", outcome: "Choose deliberate work and protect room for ordinary life." });
  const budgets = [180, 120, 90]; const ids: string[] = [];
  for (const title of ["Build the next usable slice", "Review the planning experience", "Write the acceptance contract"]) ids.push((await actions.createAction(actor, goal.id, { mutationId: randomUUID(), title })).id);
  const week = currentWeek(new Date().toISOString(), "Europe/London"); const draft = await plans.create(actor, { mutationId: randomUUID(), weekStartDate: week, provisionalCapacityMinutes: 660, reserveMinutes: 120 });
  const candidates = await plans.candidates(actor);
  const saved = await plans.save(actor, draft.id, { mutationId: randomUUID(), expectedVersion: draft.version, provisionalCapacityMinutes: 660, reserveMinutes: 120, commitments: ids.map((id, i) => ({ actionId: id, source: candidates.find(c => c.actionId === id)!.source, budgetMinutes: budgets[i] })) });
  await plans.commit(actor, saved.id, { mutationId: randomUUID(), expectedVersion: saved.version });
  const snapshot = async () => { const rows: Record<string, unknown> = {}; for (const table of ["goal", "milestone", "action", "weekly_plan", "weekly_commitment", "weekly_plan_amendment", "amendment_commitment", "mutation_receipt"]) rows[table] = (await database.pool.query(`SELECT row_to_json(t) AS data FROM ${table} t WHERE owner_id=$1 ${table === "mutation_receipt" ? "AND NOT (result ? 'windows')" : ""} ORDER BY row_to_json(t)::text`, [actor.userId])).rows; return rows; };
  const before = await snapshot();
  child = spawn(process.execPath, ["node_modules/next/dist/bin/next", "start", "--hostname", "127.0.0.1", "--port", "3104"], { env: { ...process.env, NODE_ENV: "production", BETTER_AUTH_URL: origin, DATABASE_URL: databaseURL.toString(), ...fixtureEnvironment(fixture.origin, origin) }, stdio: "ignore" });
  let ready = false;
  for (let i = 0; i < 120; i++) { if (child.exitCode !== null) throw new Error("Walkthrough server exited."); try { if ((await fetch(`${origin}/api/health`)).status === 200) { ready = true; break; } } catch { /* Await this owned process. */ } await delay(250); }
  assert.ok(ready, "Walkthrough server readiness");
  console.log(`SIMULATED walkthrough ready: ${origin}/sign-in. Dedicated synthetic account: calendar-walkthrough@example.test / SimulatedCalendarOnly-2026! (not a real credential). Plan: 11h capacity, 2h reserve, 6h30 committed. Type JSON fixture controls, e.g. {"failure":true}, {} to reset, or stop to clean up.`);
  const lines = createInterface({ input: process.stdin });
  for await (const line of lines) { if (line.trim() === "stop") { lines.close(); break; } try { fixture.controls(JSON.parse(line)); console.log("Simulated provider controls updated."); } catch { console.log("Expected fixture-control JSON or stop."); } }
  assert.deepEqual(await snapshot(), before, "Manual Calendar walkthrough must not alter any source, plan, baseline, amendment or receipt row.");
  console.log("PASS: manual Calendar walkthrough left every planning/source/history/receipt row unchanged.");
} finally {
  if (child && child.exitCode === null) { const exited = once(child, "exit"); child.kill("SIGTERM"); await exited; }
  await fixture.close(); await database.pool.end();
  if (created) await admin.query(`DROP DATABASE "${name}" WITH (FORCE)`);
  await admin.end();
}
