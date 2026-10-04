import { Pool } from "pg";
export function requireTestDatabaseURL() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("Set the test DATABASE_URL.");
  const parsed = new URL(url);
  const name = parsed.pathname.slice(1);
  if (!["localhost", "127.0.0.1", "[::1]"].includes(parsed.hostname) || !/^execution_test(?:_[a-z0-9]+)?$/.test(name)) {
    throw new Error("Test commands require a loopback database named execution_test or execution_test_<suffix>.");
  }
  return { url, name };
}
export async function ensureTestDatabase(url: string, name: string) {
  const adminURL = new URL(url); adminURL.pathname = "/postgres";
  const admin = new Pool({ connectionString: adminURL.toString() });
  try {
    const result = await admin.query("SELECT 1 FROM pg_database WHERE datname = $1", [name]);
    if (!result.rowCount) await admin.query(`CREATE DATABASE "${name}"`);
  } finally { await admin.end(); }
}

// Pools may resolve end() before PostgreSQL observes the socket close. Avoid
// FORCE killing an ending client and raising a late unhandled pool error.
export async function dropIsolatedTestDatabase(admin:Pool,name:string){
 if(!/^execution_test_[a-z0-9]+$/.test(name))throw new Error('Expected an isolated test database.');
 for(let attempt=0;attempt<10;attempt++)try{await admin.query(`DROP DATABASE "${name}"`);return;}catch(error){
  if((error as {code?:string}).code!=='55006'||attempt===9)throw error;
  await new Promise(resolve=>setTimeout(resolve,100));
 }
}
