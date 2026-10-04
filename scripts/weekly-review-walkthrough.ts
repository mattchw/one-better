// Disposable simulated finished week for manual product inspection. No normal data/provider calls.
import {randomBytes} from "node:crypto";
import {spawn,type ChildProcess} from "node:child_process";
import {once} from "node:events";
import {createInterface} from "node:readline/promises";
import {setTimeout as delay} from "node:timers/promises";
import {mkdtemp,writeFile,rm} from "node:fs/promises";
import {join} from "node:path";
import {tmpdir} from "node:os";
import assert from "node:assert/strict";
import {Pool} from "pg";
import {migrate} from "drizzle-orm/node-postgres/migrator";
import {connectDatabase} from "../src/db/connect";
import {requireTestDatabaseURL} from "./test-database";
import {provisionLocalUser} from "./local-user";
import {weeklyFixture} from "../tests/weekly-review-fixture";
const {url}=requireTestDatabaseURL(),target=new URL(url),adminURL=new URL(url),name=`execution_test_${randomBytes(6).toString("hex")}`,origin="http://127.0.0.1:3104";target.pathname=`/${name}`;adminURL.pathname="/postgres";
const admin=new Pool({connectionString:adminURL.toString()}),database=connectDatabase(target.toString()),directory=await mkdtemp(join(tmpdir(),"weekly-review-walkthrough-")),clockFile=join(directory,"now");let created=false,child:ChildProcess|undefined;const input=createInterface({input:process.stdin,output:process.stdout});
async function start(){child=spawn(process.execPath,["node_modules/next/dist/bin/next","start","--hostname","127.0.0.1","--port","3104"],{env:{...process.env,NODE_ENV:"production",DATABASE_URL:target.toString(),BETTER_AUTH_URL:origin,EXECUTION_TEST_CLOCK_FILE:clockFile},stdio:"ignore"});for(let i=0;i<120;i++){if(child.exitCode!==null)throw new Error("Manual app exited");try{if((await fetch(`${origin}/api/health`)).ok)return;}catch{}await delay(250);}throw new Error("Manual app not ready");}
async function stop(){if(child&&child.exitCode===null){const done=once(child,"exit");child.kill("SIGTERM");await done;}child=undefined;}
try{
 await admin.query(`CREATE DATABASE "${name}"`);created=true;await migrate(database.db,{migrationsFolder:"src/db/migrations"});const account=await provisionLocalUser(database.db,{email:"review7a@example.test",password:"Disposable-7A-Walkthrough!",name:"Weekly review walkthrough",timezone:"Europe/London"}),actor={userId:account.id},f=await weeklyFixture(database.db,actor);await writeFile(clockFile,f.clock());
 const snapshot=async()=>{const result:Record<string,unknown>={};for(const table of ["goal","milestone","time_block","focus_session","daily_reflection"])result[table]=(await database.pool.query(`SELECT row_to_json(t) FROM ${table} t WHERE owner_id=$1 ORDER BY row_to_json(t)::text`,[actor.userId])).rows;for(const table of ["weekly_plan","weekly_commitment","weekly_plan_amendment","commitment_identity"])result[table]=(await database.pool.query(`SELECT row_to_json(t) FROM ${table} t WHERE ${table==="weekly_plan"?"id":"plan_id"}=$1 ORDER BY row_to_json(t)::text`,[f.plan.id])).rows;result.amendment_commitment=(await database.pool.query("SELECT row_to_json(t) FROM amendment_commitment t WHERE amendment_id IN (SELECT id FROM weekly_plan_amendment WHERE plan_id=$1) ORDER BY row_to_json(t)::text",[f.plan.id])).rows;return result;},before=await snapshot();const actionBefore=(await database.pool.query("SELECT row_to_json(t) FROM action t WHERE id=ANY($1) ORDER BY id",[[f.sources[0].id,f.sources[1].id,f.sources[3].id]])).rows;
 await start();console.log(JSON.stringify({origin,week:f.week,email:"review7a@example.test",originalBudgetMinutes:360,finalBudgetMinutes:315,scheduledMinutes:240,recordedMinutes:106,logicalIds:f.decisions.map(d=>({id:d.commitmentId,kind:d.kind})),commands:["stop"]}));
 while((await input.question("Walkthrough command: ")).trim()!=="stop")console.log("Use stop after saving, reloading, finishing and explicitly adding Carry in next week's Draft.");
 const v=(await f.reviews.workspace(actor,f.week)).facts!,r=v.review!;assert.equal(r.status,"finalized");assert.ok(r.note.trim());assert.equal(v.commitments.length,4);assert.equal(v.amendments.length,2);assert.equal(v.scheduledMilliseconds,240*60000);assert.equal(v.recordedMilliseconds,106*60000);assert.deepEqual(await snapshot(),before);assert.deepEqual((await database.pool.query("SELECT row_to_json(t) FROM action t WHERE id=ANY($1) ORDER BY id",[[f.sources[0].id,f.sources[1].id,f.sources[3].id]])).rows,actionBefore);assert.equal((await f.actions.getAction(actor,f.sources[2].id)).action.state,"archived");const next=(await f.plans.workspace(actor,"2026-10-12")).view!.plan;assert.equal(next.state,"draft");assert.equal(next.commitments.length,1);assert.equal(next.commitments[0].actionId,f.sources[0].id);assert.notEqual(next.commitments[0].id,f.decisions.find(d=>d.kind==="carry")!.commitmentId);assert.equal(next.commitments[0].budgetMinutes,75);assert.equal(r.decisions.find(d=>d.kind==="carry")!.proposedBudgetMinutes,90);
 console.log("PASS: manual simulated finished week, original/final/two reasons/4h scheduled/1h46 recorded/three daily reflections, fresh 90m Carry + Defer + confirmed Drop, durable Draft reload, immutable final, explicit edited 75m next-week commitment/new identity; old planning/execution/daily and non-Drop source bytes unchanged.");
}finally{input.close();await stop();await database.pool.end();if(created)await admin.query(`DROP DATABASE "${name}" WITH (FORCE)`);await admin.end();await rm(directory,{recursive:true,force:true});}
