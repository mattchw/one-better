import { migrate } from "drizzle-orm/node-postgres/migrator";
import { connectDatabase } from "../src/db/connect";
const url = process.env.DATABASE_URL;
if (!url) throw new Error("Set DATABASE_URL before applying migrations.");
const { db, pool } = connectDatabase(url);
try { await migrate(db, { migrationsFolder: "src/db/migrations" }); console.log("Migrations applied."); }
finally { await pool.end(); }
