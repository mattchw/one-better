import { randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import { Pool } from "pg";
import { requireTestDatabaseURL } from "./test-database";
const { url } = requireTestDatabaseURL();
const isolated = new URL(url); const name = `execution_test_${randomBytes(6).toString("hex")}`;
isolated.pathname = `/${name}`;
const adminURL = new URL(url); adminURL.pathname = "/postgres";
const admin = new Pool({ connectionString: adminURL.toString() });
let created = false;
try {
  await admin.query(`CREATE DATABASE "${name}"`);
  created = true;
  const exit = await new Promise<number>((resolve, reject) => {
    const child = spawn(process.execPath, ["node_modules/vitest/vitest.mjs", "run", "--config", "vitest.db.config.ts", ...process.argv.slice(2)], { stdio: "inherit", env: { ...process.env, DATABASE_URL: isolated.toString() } });
    child.once("error", reject); child.once("exit", (code) => resolve(code ?? 1));
  });
  process.exitCode = exit;
} finally {
  if (created) await admin.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
  await admin.end();
}
