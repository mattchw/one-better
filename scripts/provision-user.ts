import { connectDatabase } from "../src/db/connect";
import { readConfiguration } from "../src/server/config";
import { assertLocalProvisioning, provisionLocalUser } from "./local-user";
const config = readConfiguration(process.env);
assertLocalProvisioning(config.DATABASE_URL, config.BETTER_AUTH_URL);
const { db, pool } = connectDatabase(config.DATABASE_URL);
try {
  const result = await provisionLocalUser(db, { email: process.env.LOCAL_USER_EMAIL, name: process.env.LOCAL_USER_NAME, password: process.env.LOCAL_USER_PASSWORD, timezone: process.env.LOCAL_USER_TIMEZONE ?? "Europe/London" });
  console.log(result.created ? "Local account provisioned. Sign in using the credentials in .env.local." : "Local account already exists; identity and credentials were preserved.");
} finally { await pool.end(); }
