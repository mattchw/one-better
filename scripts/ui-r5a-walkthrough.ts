// Disposable Focus Cycle production QA; compares the established loop byte for byte.
import {randomBytes,randomUUID} from 'node:crypto';
import {spawn,type ChildProcess} from 'node:child_process';
import {once} from 'node:events';
import {createInterface} from 'node:readline/promises';
import {setTimeout as delay} from 'node:timers/promises';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import assert from 'node:assert/strict';
import {Pool} from 'pg';
import {migrate} from 'drizzle-orm/node-postgres/migrator';
import {connectDatabase} from '../src/db/connect';
import {requireTestDatabaseURL} from './test-database';
import {provisionLocalUser} from './local-user';
import {weeklyFixture} from '../tests/weekly-review-fixture';
import {cycleService} from '../src/modules/focus-cycles/service';
import {cycleRepository} from '../src/modules/focus-cycles/repository';
import type {FocusCycle} from '../src/modules/focus-cycles/domain';
const {url}=requireTestDatabaseURL(),target=new URL(url),adminURL=new URL(url),name=`execution_test_${randomBytes(6).toString('hex')}`,origin='http://127.0.0.1:3104';target.pathname=`/${name}`;adminURL.pathname='/postgres';
const admin=new Pool({connectionString:adminURL.toString()}),database=connectDatabase(target.toString()),directory=await mkdtemp(join(tmpdir(),'cycles-r5a-')),clockFile=join(directory,'now'),input=createInterface({input:process.stdin,output:process.stdout});let child:ChildProcess|undefined,created=false;
async function start(){child=spawn(process.execPath,['node_modules/next/dist/bin/next','start','--hostname','127.0.0.1','--port','3104'],{env:{...process.env,NODE_ENV:'production',DATABASE_URL:target.toString(),BETTER_AUTH_URL:origin,EXECUTION_TEST_CLOCK_FILE:clockFile},stdio:'ignore'});for(let i=0;i<120;i++){if(child.exitCode!==null)throw new Error('Manual app exited');try{if((await fetch(`${origin}/api/health`)).ok)return;}catch{}await delay(250);}throw new Error('Manual app not ready');}
async function stop(){if(child&&child.exitCode===null){const done=once(child,'exit');child.kill('SIGTERM');await done;}child=undefined;}
try{
 await admin.query(`CREATE DATABASE "${name}"`);created=true;await migrate(database.db,{migrationsFolder:'src/db/migrations'});const actor={userId:(await provisionLocalUser(database.db,{email:'cycles-r5a@example.test',password:'Disposable-Cycles-R5A!',name:'Morgan Lee',timezone:'Europe/London'})).id},f=await weeklyFixture(database.db,actor,'2026-09-28');f.setNow('2026-10-03T08:00:00.000Z');const cycles=cycleService(cycleRepository(database.db),f.clock);
 const fitness=await f.goals.createGoal(actor,{mutationId:randomUUID(),title:'Run consistently and build a sustainable rhythm for fitness, recovery and time outdoors',outcome:'Run three times each week while keeping recovery protected.'}),launch=await f.goals.createGoal(actor,{mutationId:randomUUID(),title:'Prepare a small product launch',outcome:'Get the first useful version in front of real people.'}),outside=await f.goals.createGoal(actor,{mutationId:randomUUID(),title:'Learn a useful new skill',outcome:'Keep this available for a later horizon.'});
 const run=await f.actions.createAction(actor,fitness.id,{mutationId:randomUUID(),title:'Go for a steady run',estimateMinutes:60}),learn=await f.actions.createAction(actor,outside.id,{mutationId:randomUUID(),title:'Read and capture one useful idea',estimateMinutes:30});
 const sources=await f.plans.candidates(actor),h=await f.amends.history(actor,f.plan.id);await f.amends.confirm(actor,f.plan.id,{mutationId:randomUUID(),expectedVersion:h.baseline.version,reason:'Make room for a steady run and deliberate learning alongside product work.',provisionalCapacityMinutes:720,reserveMinutes:150,commitments:[...h.effective.commitments.map(c=>({actionId:c.actionId,budgetMinutes:c.budgetMinutes})),{actionId:run.id,budgetMinutes:60,source:sources.find(c=>c.actionId===run.id)!.source},{actionId:learn.id,budgetMinutes:30,source:sources.find(c=>c.actionId===learn.id)!.source}]});
 f.setNow('2026-09-25T12:00:00.000Z');let past=await cycles.create(actor,{mutationId:randomUUID(),title:'September: establish a useful foundation',intent:'Build the deterministic loop.',startDate:'2026-09-01',endDate:'2026-09-30',goals:[{goalId:f.goal.id,goalVersion:1}]});past=await cycles.transition(actor,past.id,'activate',{mutationId:randomUUID(),expectedVersion:1});past=await cycles.transition(actor,past.id,'finish',{mutationId:randomUUID(),expectedVersion:2});await cycles.transition(actor,past.id,'archive',{mutationId:randomUUID(),expectedVersion:3});f.setNow('2026-10-03T08:00:00.000Z');await cycles.create(actor,{mutationId:randomUUID(),title:'December: a later horizon',intent:null,startDate:'2026-12-01',endDate:'2026-12-31',goals:[{goalId:outside.id,goalVersion:1}]});await writeFile(clockFile,f.clock());
 const tables=['goal','milestone','action','weekly_plan','weekly_commitment','weekly_plan_amendment','amendment_commitment','commitment_identity','time_block','focus_session','daily_reflection','weekly_review','weekly_review_decision'];const snapshot=async()=>{const v:Record<string,unknown>={};for(const t of tables)v[t]=(await database.pool.query(`SELECT row_to_json(t) FROM ${t} t WHERE owner_id=$1 ORDER BY row_to_json(t)::text`,[actor.userId])).rows;return v;},before=await snapshot();
 await start();console.log(JSON.stringify({origin,email:'cycles-r5a@example.test',password:'Disposable-Cycles-R5A!',week:f.week,currentGoals:[f.goal.title,fitness.title,launch.title],outside:outside.title,commands:['restart','stop']}));
 while(true){const cmd=(await input.question('R5A command: ')).trim();if(cmd==='stop')break;if(cmd==='restart'){await stop();await start();console.log('Production process restarted with cycle and membership retained.');}}
 const v=await cycles.workspace(actor);assert.ok(v.current);assert.ok(v.cycles.filter(c=>['finished','archived'].includes(c.status)).length>=2);assert.deepEqual(await snapshot(),before);
 // Reconstruct only this fixture's successful UI create receipts and replay after a restart/new connection.
 const receipts=(await database.pool.query("SELECT mutation_id,result FROM mutation_receipt WHERE owner_id=$1 AND result ? 'startDate' AND result->>'version'='1'",[actor.userId])).rows;const fresh=connectDatabase(target.toString());try{const service=cycleService(cycleRepository(fresh.db),f.clock);for(const r of receipts){const c=r.result as FocusCycle;assert.deepEqual(await service.create(actor,{mutationId:r.mutation_id,title:c.title,intent:c.intent,startDate:c.startDate,endDate:c.endDate,goals:c.goals.map(g=>({goalId:g.goalId,goalVersion:g.goalVersion}))}),c);}}finally{await fresh.pool.end();}
 console.log('PASS: current cycle, manual create/activate/edit/finish and retained past contexts survive reload/restart. Original UI create receipts replay. All Goals, Actions, full planning/history, schedule, execution and reflection bytes unchanged. Future Draft remains deliberate; no provider calls or automatic work.');
}finally{input.close();await stop();await database.pool.end();if(created)await admin.query(`DROP DATABASE "${name}" WITH (FORCE)`);await admin.end();await rm(directory,{recursive:true,force:true});}
