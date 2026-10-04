// Actual process restart proof in a disposable database; no real provider requests.
import {randomBytes,randomUUID} from "node:crypto";
import {spawn,type ChildProcess} from "node:child_process";
import {once} from "node:events";
import {setTimeout as delay} from "node:timers/promises";
import assert from "node:assert/strict";
import {Pool} from "pg";
import {migrate} from "drizzle-orm/node-postgres/migrator";
import {connectDatabase} from "../src/db/connect";
import {requireTestDatabaseURL,dropIsolatedTestDatabase} from "./test-database";
import {provisionLocalUser} from "./local-user";
import type {WeeklyPlan} from "../src/modules/planning/domain";
import type {PlanningSource} from "../src/modules/planning/domain";
import type {TimeBlock,PlacementReview,SchedulingView} from "../src/modules/scheduling/domain";
const origin="http://127.0.0.1:3102",{url}=requireTestDatabaseURL(),target=new URL(url),adminURL=new URL(url),name=`execution_test_${randomBytes(6).toString("hex")}`;
target.pathname=`/${name}`;adminURL.pathname="/postgres";const admin=new Pool({connectionString:adminURL.toString()}),database=connectDatabase(target.toString());let created=false,child:ChildProcess|undefined;
async function start(databaseURL=target.toString(),health=200){child=spawn(process.execPath,["node_modules/next/dist/bin/next","start","--hostname","127.0.0.1","--port","3102"],{env:{...process.env,NODE_ENV:"production",BETTER_AUTH_URL:origin,DATABASE_URL:databaseURL},stdio:"ignore"});for(let i=0;i<120;i++){if(child.exitCode!==null)throw new Error("Production process exited");try{if((await fetch(`${origin}/api/health`)).status===health)return;}catch{}await delay(250);}throw new Error("Production process did not become ready");}
async function stop(){if(child&&child.exitCode===null){const ended=once(child,"exit");child.kill("SIGTERM");await ended;}child=undefined;}
try{
 await admin.query(`CREATE DATABASE "${name}"`);created=true;await migrate(database.db,{migrationsFolder:"src/db/migrations"});const actor=await provisionLocalUser(database.db,{email:process.env.TEST_USER_A_EMAIL,password:process.env.TEST_USER_A_PASSWORD,name:"Restart proof",timezone:"Europe/London"});await start();
 const signin=await fetch(`${origin}/api/auth/sign-in/email`,{method:"POST",headers:{Origin:origin,"Content-Type":"application/json"},body:JSON.stringify({email:process.env.TEST_USER_A_EMAIL,password:process.env.TEST_USER_A_PASSWORD})});assert.equal(signin.status,200);const cookie=signin.headers.getSetCookie().map(v=>v.split(";")[0]).join("; ");
 async function read<T>(path:string):Promise<T>{const r=await fetch(`${origin}${path}`,{headers:{cookie}});assert.equal(r.status,200);return r.json() as Promise<T>;}
 async function mutate<T>(path:string,data:object,method="POST"):Promise<T>{const r=await fetch(`${origin}${path}`,{method,headers:{cookie,Origin:origin,"Content-Type":"application/json"},body:JSON.stringify(data)});assert.equal(r.status,200);return r.json() as Promise<T>;}
 const goal=(await mutate<{goal:{id:string}}>("/api/goals",{mutationId:randomUUID(),title:"Prove local schedule persistence",outcome:"Unchanged history through real restarts"})).goal;
 const action=(await mutate<{action:{id:string}}>(`/api/goals/${goal.id}/actions`,{mutationId:randomUUID(),title:"Protect useful work",estimateMinutes:240})).action;
 const candidates=await read<{candidates:PlanningSource[]}>("/api/weekly-plans/candidates"),source=candidates.candidates.find(c=>c.actionId===action.id)!;
 let plan=(await mutate<{plan:WeeklyPlan}>("/api/weekly-plans",{mutationId:randomUUID(),weekStartDate:"2030-01-07",provisionalCapacityMinutes:720,reserveMinutes:180})).plan;
 plan=(await mutate<{plan:WeeklyPlan}>(`/api/weekly-plans/${plan.id}`,{mutationId:randomUUID(),expectedVersion:1,provisionalCapacityMinutes:720,reserveMinutes:180,commitments:[{actionId:action.id,budgetMinutes:180,source:source.source}]},"PATCH")).plan;
 plan=(await mutate<{plan:WeeklyPlan}>(`/api/weekly-plans/${plan.id}/commit`,{mutationId:randomUUID(),expectedVersion:2})).plan;
 await mutate("/api/focusable-hours",{mutationId:randomUUID(),scheduleId:null,expectedVersion:0,windows:[{weekday:2,startMinute:540,endMinute:1020}]},"PUT");
 const snapshot=async()=>{const result:Record<string,unknown>={};for(const table of ["goal","action","weekly_plan","weekly_commitment","weekly_plan_amendment","amendment_commitment","focusable_hours"])result[table]=(await database.pool.query(`SELECT row_to_json(t) FROM ${table} t WHERE owner_id=$1 ORDER BY row_to_json(t)::text`,[actor.id])).rows;return result;},before=await snapshot(),url=`/api/weekly-plans/${plan.id}/time-blocks`;
 const placement={commitmentId:plan.commitments[0].id,date:"2030-01-08",startTime:"10:00",endTime:"11:30"},review=await mutate<PlacementReview>(`${url}/preview`,placement),createCommand={...placement,mutationId:randomUUID(),expectedPlanVersion:review.planVersion,reviewKey:review.reviewKey,acknowledgeOutsideHours:false,acknowledgeBusy:false};
 const first=(await mutate<{block:TimeBlock}>(url,createCommand)).block;
 const newTimes={...placement,startTime:"12:00",endTime:"13:30",blockId:first.id,expectedVersion:1},editReview=await mutate<PlacementReview>(`${url}/preview`,newTimes),{blockId:_id,...editPlacement}=newTimes;void _id;
 const editCommand={...editPlacement,mutationId:randomUUID(),expectedPlanVersion:editReview.planVersion,reviewKey:editReview.reviewKey,acknowledgeOutsideHours:false,acknowledgeBusy:false},edited=(await mutate<{block:TimeBlock}>(`/api/time-blocks/${first.id}`,editCommand,"PATCH")).block;
 const cancelCommand={mutationId:randomUUID(),expectedVersion:2},cancelled=(await mutate<{block:TimeBlock}>(`/api/time-blocks/${first.id}/cancel`,cancelCommand)).block;
 for(let cycle=0;cycle<2;cycle++){await stop();await start();assert.deepEqual((await mutate<{block:TimeBlock}>(url,createCommand)).block,first);assert.deepEqual((await mutate<{block:TimeBlock}>(`/api/time-blocks/${first.id}`,editCommand,"PATCH")).block,edited);assert.deepEqual((await mutate<{block:TimeBlock}>(`/api/time-blocks/${first.id}/cancel`,cancelCommand)).block,cancelled);assert.deepEqual((await read<{block:TimeBlock}>(`/api/time-blocks/${first.id}`)).block,cancelled);assert.equal((await read<SchedulingView>(url)).commitments[0].scheduledMinutes,0);assert.deepEqual(await snapshot(),before);}
 assert.equal((await database.pool.query("SELECT 1 FROM time_block WHERE owner_id=$1",[actor.id])).rowCount,1);assert.equal((await database.pool.query("SELECT 1 FROM mutation_receipt WHERE owner_id=$1 AND result ? 'commitmentId'",[actor.id])).rowCount,3);
 await stop();const unavailable=new URL(target);unavailable.pathname=`/execution_test_unavailable${Date.now()}`;await start(unavailable.toString(),503);
 for(const [path,method,data] of [[url,"GET",undefined],[url,"POST",createCommand],[`${url}/preview`,"POST",placement],[`/api/time-blocks/${first.id}`,"GET",undefined],[`/api/time-blocks/${first.id}`,"PATCH",editCommand],[`/api/time-blocks/${first.id}/cancel`,"POST",cancelCommand]] as const)assert.equal((await fetch(`${origin}${path}`,{method,headers:{cookie,Origin:origin,"Content-Type":"application/json"},body:data?JSON.stringify(data):undefined})).status,503);
 console.log("PASS: local create/edit/cancel original receipts and terminal history survive two actual production process restarts; one persisted block and three receipts; current truth stays cancelled; source/baseline/amendments/settings byte unchanged; every scheduling HTTP surface fails safely with unavailable PostgreSQL.");
}finally{await stop();await database.pool.end();if(created)await dropIsolatedTestDatabase(admin,name);await admin.end();}
