import "server-only";
import { readFileSync } from "node:fs";
// A process-owned test clock, never a request parameter or production-account override.
export function executionClock() {
  const file=process.env.EXECUTION_TEST_CLOCK_FILE;
  if(!file)return new Date().toISOString();
  const database=new URL(process.env.DATABASE_URL??""),origin=new URL(process.env.BETTER_AUTH_URL??"");
  if(!["127.0.0.1","localhost","[::1]"].includes(database.hostname)||!/^\/execution_test_[a-z0-9]+$/.test(database.pathname)||!["127.0.0.1","localhost","[::1]"].includes(origin.hostname))throw new Error("Test clock requires an isolated loopback test database and origin.");
  return new Date(readFileSync(file,"utf8").trim()).toISOString();
}
