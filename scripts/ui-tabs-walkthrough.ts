// Disposable simulated working day for manual product inspection. No normal data/provider calls.
import {randomBytes,randomUUID} from "node:crypto";
import {spawn,type ChildProcess} from "node:child_process";
import {once} from "node:events";
import {createInterface} from "node:readline/promises";
import {setTimeout as delay} from "node:timers/promises";
import {mkdtemp,writeFile,rm} from "node:fs/promises";
import {join} from "node:path";
import {tmpdir} from "node:os";
import assert from "node:assert/strict";
import {milestoneService} from "../src/modules/milestones/service";
import {milestoneRepository} from "../src/modules/milestones/repository";
import {Pool} from "pg";
import {migrate} from "drizzle-orm/node-postgres/migrator";
import {connectDatabase} from "../src/db/connect";
import {requireTestDatabaseURL} from "./test-database";
import {provisionLocalUser} from "./local-user";
import {executionFixture} from "../tests/focus-database";
import {focusService} from "../src/modules/focus/service";
import {focusRepository} from "../src/modules/focus/repository";
import {reviewService} from "../src/modules/reviews/service";
import {reviewRepository} from "../src/modules/reviews/repository";
const {url}=requireTestDatabaseURL(),target=new URL(url),adminURL=new URL(url),name=`execution_test_${randomBytes(6).toString("hex")}`,origin="http://127.0.0.1:3104";target.pathname=`/${name}`;adminURL.pathname="/postgres";
const admin=new Pool({connectionString:adminURL.toString()}),database=connectDatabase(target.toString()),directory=await mkdtemp(join(tmpdir(),"design-walkthrough-")),clockFile=join(directory,"now");let created=false,child:ChildProcess|undefined;const input=createInterface({input:process.stdin,output:process.stdout});
async function start(){child=spawn(process.execPath,["node_modules/next/dist/bin/next","start","--hostname","127.0.0.1","--port","3104"],{env:{...process.env,NODE_ENV:"production",DATABASE_URL:target.toString(),BETTER_AUTH_URL:origin,EXECUTION_TEST_CLOCK_FILE:clockFile},stdio:"ignore"});for(let i=0;i<120;i++){if(child.exitCode!==null)throw new Error("Manual app exited");try{if((await fetch(`${origin}/api/health`)).ok)return;}catch{}await delay(250);}throw new Error("Manual app not ready");}
async function stop(){if(child&&child.exitCode===null){const done=once(child,"exit");child.kill("SIGTERM");await done;}child=undefined;}
try{
 await admin.query(`CREATE DATABASE "${name}"`);created=true;await migrate(database.db,{migrationsFolder:"src/db/migrations"});const account=await provisionLocalUser(database.db,{email:"design@example.test",password:"Disposable-Design-Walkthrough!",name:"Morgan Lee",timezone:"Europe/London"}),actor={userId:account.id},f=await executionFixture(database.db,actor),partial=await f.create("2026-10-06","14:00","15:00"),empty=await f.create("2026-10-06","16:00","17:00"),cancelled=await f.create("2026-10-06","18:00","19:00");await f.schedule.cancel(actor,cancelled.id,{mutationId:randomUUID(),expectedVersion:1});
 let instant="2026-10-06T09:00:00.000Z";const focus=focusService(focusRepository(database.db),()=>instant);
 for(const [block,from,to,outcome,note] of [[f.block,"2026-10-06T09:00Z","2026-10-06T10:20Z","completed","Core implementation finished."],[partial,"2026-10-06T13:00Z","2026-10-06T13:35Z","partial","An incident interrupted browser tests."],[partial,"2026-10-06T13:40Z","2026-10-06T13:45Z","abandoned","Brief restart; left the remaining tests for tomorrow."]] as const){instant=from;const s=await focus.start(actor,block.id,{mutationId:randomUUID(),expectedBlockVersion:1,acknowledgeRemoved:false});instant=to;await focus.end(actor,s.id,{mutationId:randomUUID(),expectedVersion:1,outcome,endNote:note});}
 const checkpoints=milestoneService(milestoneRepository(database.db));
 const done=await checkpoints.createMilestone(actor,f.goal.id,{mutationId:randomUUID(),title:"The weekly loop is usable",successCondition:"Plan, focus and review work together"});
 await checkpoints.completeMilestone(actor,done.id,{mutationId:randomUUID(),expectedVersion:done.version,evidence:"A real week reviewed end to end"});
 await f.actions.createAction(actor,f.goal.id,{mutationId:randomUUID(),title:"Prepare a calmer release",doneWhen:"A useful release note is ready",estimateMinutes:60});
 const reading=await f.goals.createGoal(actor,{mutationId:randomUUID(),title:"Read thoughtfully, every week",outcome:"Turn useful ideas from books into small everyday changes"});
 const readingM=await checkpoints.createMilestone(actor,reading.id,{mutationId:randomUUID(),title:"Finish a book and try one idea",successCondition:"One practical idea becomes a habit"});
 await f.actions.createAction(actor,reading.id,{mutationId:randomUUID(),title:"Read a chapter and capture one useful idea",doneWhen:"An idea is written in my own words",estimateMinutes:30,milestoneId:readingM.id});
 const prior=await executionFixture(database.db,actor,"2026-09-28",()=>"2026-09-25T12:00:00.000Z");
 await prior.goals.updateGoal(actor,prior.goal.id,{mutationId:randomUUID(),expectedVersion:1,title:"Protect time for deep work",outcome:"Keep room for focused work alongside everyday commitments"});
 instant="2026-09-29T09:00:00.000Z";const priorSession=await focus.start(actor,prior.block.id,{mutationId:randomUUID(),expectedBlockVersion:1,acknowledgeRemoved:false});instant="2026-09-29T09:45:00.000Z";await focus.end(actor,priorSession.id,{mutationId:randomUUID(),expectedVersion:1,outcome:"partial",endNote:"The first useful slice is ready."});
 await writeFile(clockFile,"2026-10-06T18:00:00.000Z");const snapshot=async()=>{const result:Record<string,unknown>={};for(const table of ["goal","milestone","action","weekly_plan","weekly_commitment","weekly_plan_amendment","amendment_commitment","commitment_identity","time_block"])result[table]=(await database.pool.query(`SELECT row_to_json(t) FROM ${table} t WHERE owner_id=$1 ORDER BY row_to_json(t)::text`,[actor.userId])).rows;return result;},before=await snapshot();await start();console.log(JSON.stringify({origin,date:"2026-10-06",email:"design@example.test",scheduledMinutes:240,recordedMinutes:120,goalId:f.goal.id,unrecordedBlock:empty.id,password:"Disposable-Design-Walkthrough!",commands:["advance","restart","stop"]}));
 while(true){const command=(await input.question("Walkthrough command: ")).trim();if(command==="stop")break;if(command==="advance")await writeFile(clockFile,"2026-10-06T18:14:00.000Z");else if(command==="restart"){await stop();await start();}else console.log("Use advance, restart or stop.");}
 const d=await reviewService(reviewRepository(database.db),()=>"2026-10-06T18:00:00.000Z").day(actor);assert.equal(d.scheduledMilliseconds,240*60000);assert.ok(d.recordedMilliseconds>=120*60000);assert.equal(d.reflection?.status,"finalized");assert.ok(d.reflection.note.length>0);assert.deepEqual(await snapshot(),before);console.log(`PASS: simulated 4h scheduled / ${Math.floor(d.recordedMilliseconds/60000)}m recorded, session history and unrecorded/cancelled blocks, manually saved/reloaded/finalized reflection; every source/planning/block byte unchanged.`);
}finally{input.close();await stop();await database.pool.end();if(created)await admin.query(`DROP DATABASE "${name}" WITH (FORCE)`);await admin.end();await rm(directory,{recursive:true,force:true});}
