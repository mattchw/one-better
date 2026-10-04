import "server-only";
import { connectDatabase } from "../db/connect";
import { readConfiguration } from "./config";
import { createAuthentication } from "./auth-factory";
import { readGoogleAuthConfiguration } from "./google-auth-config";

function createRuntime() {
  const config = readConfiguration(process.env);
  const database = connectDatabase(config.DATABASE_URL);
  return { ...database, auth: createAuthentication(database.db, { secret: config.BETTER_AUTH_SECRET, baseURL: config.BETTER_AUTH_URL, google: readGoogleAuthConfiguration(process.env) }) };
}
const shared = globalThis as typeof globalThis & { executionRuntime?: ReturnType<typeof createRuntime> };
export function runtime() { return shared.executionRuntime ??= createRuntime(); }
