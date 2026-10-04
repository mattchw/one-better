// Disposable R3 visual quality gate. Existing services seed intent; UI records actuals.
import { randomBytes, randomUUID } from "node:crypto";
import { spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { createInterface } from "node:readline/promises";
import { setTimeout as delay } from "node:timers/promises";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import assert from "node:assert/strict";
import { Pool } from "pg";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { connectDatabase } from "../src/db/connect";
import { requireTestDatabaseURL } from "./test-database";
import { provisionLocalUser } from "./local-user";
import { goalService } from "../src/modules/goals/service";
import { goalRepository } from "../src/modules/goals/repository";
import { milestoneService } from "../src/modules/milestones/service";
import { milestoneRepository } from "../src/modules/milestones/repository";
import { actionService } from "../src/modules/actions/service";
import { actionRepository } from "../src/modules/actions/repository";
import { planService } from "../src/modules/planning/service";
import { planRepository } from "../src/modules/planning/repository";
import { schedulingService } from "../src/modules/scheduling/service";
import { schedulingRepository } from "../src/modules/scheduling/repository";
import { amendmentService } from "../src/modules/amendments/service";
import { amendmentRepository } from "../src/modules/amendments/repository";
const {url}=requireTestDatabaseURL(),target=new URL(url),adminURL=new URL(url),name=`execution_test_${randomBytes(6).toString("hex")}`,origin="http://127.0.0.1:3104";
target.pathname=`/${name}`;adminURL.pathname="/postgres";
const admin=new Pool({connectionString:adminURL.toString()}),database=connectDatabase(target.toString()),directory=await mkdtemp(join(tmpdir(),"focus-r3-")),clockFile=join(directory,"now"),input=createInterface({input:process.stdin,output:process.stdout});
let created=false,child:ChildProcess|undefined;
async function start(){child=spawn(process.execPath,["node_modules/next/dist/bin/next","start","--hostname","127.0.0.1","--port","3104"],{env:{...process.env,NODE_ENV:"production",DATABASE_URL:target.toString(),BETTER_AUTH_URL:origin,EXECUTION_TEST_CLOCK_FILE:clockFile},stdio:"ignore"});for(let i=0;i<120;i++){if(child.exitCode!==null)throw new Error("Manual process exited");try{if((await fetch(`${origin}/api/health`)).ok)return;}catch{}await delay(250);}throw new Error("Manual app not ready");}
async function stop(){if(child&&child.exitCode===null){const done=once(child,"exit");child.kill("SIGTERM");await done;}child=undefined;}
try{
 await admin.query(`CREATE DATABASE "${name}"`);created=true;await migrate(database.db,{migrationsFolder:"src/db/migrations"});
 const account=await provisionLocalUser(database.db,{email:"focus-r3@example.test",password:"Disposable-Focus-R3!",name:"Morgan Lee",timezone:"Europe/London"}),actor={userId:account.id},seedClock=()=>"2026-09-27T12:00:00.000Z";
 const goals=goalService(goalRepository(database.db)),milestones=milestoneService(milestoneRepository(database.db)),actions=actionService(actionRepository(database.db)),plans=planService(planRepository(database.db),seedClock),schedule=schedulingService(schedulingRepository(database.db,()=>new Date(seedClock())),seedClock);
 const goal=await goals.createGoal(actor,{mutationId:randomUUID(),title:"Build a thoughtful weekly rhythm that makes room for meaningful work, learning and the people who matter",outcome:"The plan helps me do the work I care about."});
 const milestone=await milestones.createMilestone(actor,goal.id,{mutationId:randomUUID(),title:"A trustworthy planning-to-execution loop that preserves deliberate commitments through interruptions and changing priorities",successCondition:"Use Focus for real work."});
 const action=await actions.createAction(actor,goal.id,{mutationId:randomUUID(),title:"Refine the weekly review flow so it clearly separates recorded attention from completed work and helps choose the next deliberate step",doneWhen:"The review is readable on a phone and preserves the original plan.",estimateMinutes:360,milestoneId:milestone.id});
 const removed=await actions.createAction(actor,goal.id,{mutationId:randomUUID(),title:"Explore a different onboarding approach",estimateMinutes:60,milestoneId:milestone.id});
 const candidates=await plans.candidates(actor);let plan=await plans.create(actor,{mutationId:randomUUID(),weekStartDate:"2026-09-28",provisionalCapacityMinutes:900,reserveMinutes:180});
 plan=await plans.save(actor,plan.id,{mutationId:randomUUID(),expectedVersion:1,provisionalCapacityMinutes:900,reserveMinutes:180,commitments:[{actionId:action.id,budgetMinutes:360,source:candidates.find(c=>c.actionId===action.id)!.source},{actionId:removed.id,budgetMinutes:60,source:candidates.find(c=>c.actionId===removed.id)!.source}]});
 plan=await plans.commit(actor,plan.id,{mutationId:randomUUID(),expectedVersion:2});
 async function create(date:string,startTime:string,endTime:string,actionId=action.id){const commitmentId=plan.commitments.find(c=>c.actionId===actionId)!.id,input={commitmentId,date,startTime,endTime},review=await schedule.preview(actor,plan.id,input);return schedule.create(actor,plan.id,{...input,mutationId:randomUUID(),expectedPlanVersion:review.planVersion,reviewKey:review.reviewKey,acknowledgeOutsideHours:true,acknowledgeBusy:false});}
 const earlier=await create("2026-10-03","08:00","09:00"),next=await create("2026-10-03","10:00","12:00"),late=await create("2026-10-03","14:00","15:00"),last=await create("2026-10-03","16:00","17:00"),dropped=await create("2026-10-03","13:00","13:30",removed.id),single=await create("2026-10-04","10:00","12:00");
 const amends=amendmentService(amendmentRepository(database.db),()=>"2026-10-03T08:00:00.000Z"),history=await amends.history(actor,plan.id);
 await amends.confirm(actor,plan.id,{mutationId:randomUUID(),expectedVersion:history.baseline.version,provisionalCapacityMinutes:900,reserveMinutes:180,reason:"Keep the prior scheduled block as review-required context",commitments:[{actionId:action.id,budgetMinutes:360}]});
 const snapshot=async()=>{const result:Record<string,unknown>={};for(const table of ["goal","milestone","action","weekly_plan","weekly_commitment","weekly_plan_amendment","amendment_commitment","time_block"])result[table]=(await database.pool.query(`SELECT row_to_json(t) FROM ${table} t WHERE owner_id=$1 ORDER BY row_to_json(t)::text`,[actor.userId])).rows;return result;},before=await snapshot();
 await writeFile(clockFile,"2026-10-03T08:45:00.000Z");await start();
 console.log(JSON.stringify({origin,email:"focus-r3@example.test",password:"Disposable-Focus-R3!",earlier:earlier.id,next:next.id,late:late.id,last:last.id,dropped:dropped.id,single:single.id,commands:["clock <ISO UTC>","restart","stop"]}));
 while(true){const command=(await input.question("R3 command: ")).trim();if(command==="stop")break;if(command==="restart"){await stop();await start();console.log("Production process restarted; session untouched.");}else if(command.startsWith("clock ")){const value=command.slice(6);assert.ok(Number.isFinite(Date.parse(value)));await writeFile(clockFile,value);console.log(`Authoritative test clock: ${value}`);}else console.log("Use clock <ISO UTC>, restart or stop.");}
 assert.deepEqual(await snapshot(),before);
 const sessions=(await database.pool.query("SELECT * FROM focus_session WHERE owner_id=$1 ORDER BY started_at",[actor.userId])).rows;
 assert.ok(sessions.length>=3);assert.ok(sessions.every(s=>s.ended_at&&s.ended_at>s.started_at));assert.deepEqual(new Set(sessions.map(s=>s.outcome)),new Set(["completed","partial","abandoned"]));assert.ok(sessions.some(s=>s.end_note?.includes("Scratch handoff")));
 console.log(JSON.stringify({sessions:sessions.map(s=>({outcome:s.outcome,elapsedMilliseconds:s.ended_at-s.started_at,note:s.end_note}))}));console.log("PASS: UI outcomes and scratch handoff recorded; sources, complete baseline/amendment history and TimeBlocks byte-unchanged.");
}finally{input.close();await stop();await database.pool.end();if(created)await admin.query(`DROP DATABASE "${name}" WITH (FORCE)`);await admin.end();await rm(directory,{recursive:true,force:true});}
