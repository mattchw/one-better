import { migrate } from "drizzle-orm/node-postgres/migrator";
import { connectDatabase } from "../src/db/connect";
import { assertLocalProvisioning, provisionLocalUser } from "./local-user";
import { ensureTestDatabase, requireTestDatabaseURL } from "./test-database";
const { url, name } = requireTestDatabaseURL();
assertLocalProvisioning(url, process.env.BETTER_AUTH_URL ?? "");
await ensureTestDatabase(url, name);
const { db, pool } = connectDatabase(url);
try {
  await migrate(db, { migrationsFolder: "src/db/migrations" });
  for (const suffix of ["A", "B"]) await provisionLocalUser(db, { email: process.env[`TEST_USER_${suffix}_EMAIL`], password: process.env[`TEST_USER_${suffix}_PASSWORD`], name: `Test Engineer ${suffix}`, timezone: "Europe/London" });
  console.log("Dedicated browser-test database migrated; two test accounts ready.");
} finally { await pool.end(); }
