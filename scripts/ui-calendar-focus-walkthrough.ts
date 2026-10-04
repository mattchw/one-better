// Disposable real-time manual quality gate; no normal user data or provider calls.
import {randomBytes} from "node:crypto";
import {spawn,type ChildProcess} from "node:child_process";
import {once} from "node:events";
import {createInterface} from "node:readline/promises";
import {setTimeout as delay} from "node:timers/promises";
import assert from "node:assert/strict";
import {Pool} from "pg";
import {migrate} from "drizzle-orm/node-postgres/migrator";
import {Temporal} from "@js-temporal/polyfill";
import {connectDatabase} from "../src/db/connect";
import {requireTestDatabaseURL} from "./test-database";
import {provisionLocalUser} from "./local-user";
import {executionFixture} from "../tests/focus-database";
import {currentWeek,addDays} from "../src/modules/planning/domain";
const {url}=requireTestDatabaseURL(),target=new URL(url),adminURL=new URL(url),name=`execution_test_${randomBytes(6).toString("hex")}`,origin="http://127.0.0.1:3104";target.pathname=`/${name}`;adminURL.pathname="/postgres";
const admin=new Pool({connectionString:adminURL.toString()}),database=connectDatabase(target.toString());let created=false,child:ChildProcess|undefined;const input=createInterface({input:process.stdin,output:process.stdout});
async function start(){child=spawn(process.execPath,["node_modules/next/dist/bin/next","start","--hostname","127.0.0.1","--port","3104"],{env:{...process.env,NODE_ENV:"production",DATABASE_URL:target.toString(),BETTER_AUTH_URL:origin,EXECUTION_TEST_CLOCK_FILE:undefined},stdio:"ignore"});for(let i=0;i<120;i++){try{if((await fetch(`${origin}/api/health`)).ok)return;}catch{}await delay(250);}throw new Error("Manual app not ready");}
async function stop(){if(child&&child.exitCode===null){const done=once(child,"exit");child.kill("SIGTERM");await done;}child=undefined;}
try{
 await admin.query(`CREATE DATABASE "${name}"`);created=true;await migrate(database.db,{migrationsFolder:"src/db/migrations"});const account=await provisionLocalUser(database.db,{email:"calendar-focus@example.test",password:"Disposable-Calendar-Focus!",name:"Morgan Lee",timezone:"Europe/London"}),actor={userId:account.id},now=new Date().toISOString(),week=currentWeek(now,"Europe/London"),fixtureClock=()=>`${addDays(week,-1)}T12:00:00.000Z`,f=await executionFixture(database.db,actor,week,fixtureClock),local=Temporal.Instant.from(now).toZonedDateTimeISO("Europe/London"),today=local.toPlainDate().toString(),minute=local.hour*60+local.minute;

 const time=(m:number)=>`${Math.floor(m/60).toString().padStart(2,"0")}:${(m%60).toString().padStart(2,"0")}`;
 const early=minute<1434?await f.create(today,time(minute+5),time(Math.min(minute+125,1439))):await f.create(addDays(today,1),"00:05","02:05"),late=minute>=60?await f.create(today,time(minute-60),time(minute-30)):f.block;
 const snapshot=async()=>{const result:Record<string,unknown>={};for(const table of ["goal","milestone","action","weekly_commitment","time_block"])result[table]=(await database.pool.query(`SELECT row_to_json(t) FROM ${table} t WHERE owner_id=$1 ORDER BY row_to_json(t)::text`,[actor.userId])).rows;result.weekly_plan=(await database.pool.query("SELECT to_jsonb(t) AS row FROM weekly_plan t WHERE owner_id=$1",[actor.userId])).rows;return result;},before=await snapshot();await start();
 console.log(JSON.stringify({origin,week,today,earlyBlock:early.id,lateBlock:late.id,email:"calendar-focus@example.test",password:"Disposable-Calendar-Focus!",commands:["restart","stop"]}));
 while(true){const command=(await input.question("Walkthrough command: ")).trim();if(command==="stop")break;if(command==="restart"){await stop();await start();console.log("Actual production process restarted; session persistence untouched.");}else console.log("Use restart or stop.");}

 assert.deepEqual(await snapshot(),before);const sessions=(await database.pool.query("SELECT * FROM focus_session WHERE owner_id=$1 ORDER BY started_at",[actor.userId])).rows;assert.ok(sessions.length>=1);assert.ok(sessions.every(s=>s.ended_at&&s.ended_at>s.started_at));console.log(JSON.stringify({sessions:sessions.map(s=>({startedAt:s.started_at,endedAt:s.ended_at,outcome:s.outcome,elapsedMilliseconds:s.ended_at-s.started_at}))}));console.log("PASS: original planned intervals, frozen sources and baseline unchanged through real focus work.");
}finally{input.close();await stop();await database.pool.end();if(created)await admin.query(`DROP DATABASE "${name}" WITH (FORCE)`);await admin.end();}
