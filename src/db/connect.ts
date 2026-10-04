import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema";

export function connectDatabase(url: string) {
  const pool = new Pool({ connectionString: url, max: 5, connectionTimeoutMillis: 3000 });
  const db = drizzle(pool, { schema });
  return { db, pool };
}
export type Database = ReturnType<typeof connectDatabase>["db"];
