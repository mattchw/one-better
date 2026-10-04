// Isolated manual UI fixture. Uses the real domain APIs and a loopback Calendar provider.
import {randomBytes,randomUUID} from 'node:crypto';
import {spawn,type ChildProcess} from 'node:child_process';
import {once} from 'node:events';
import {createInterface} from 'node:readline/promises';
import {setTimeout as delay} from 'node:timers/promises';
import {Pool} from 'pg';
import {migrate} from 'drizzle-orm/node-postgres/migrator';
import {connectDatabase} from '../src/db/connect';
import {requireTestDatabaseURL} from './test-database';
import {provisionLocalUser} from './local-user';
import {currentWeek} from '../src/modules/planning/domain';
import {startCalendarFixture,fixtureEnvironment} from '../tests/calendar-fixture-server';
const {url}=requireTestDatabaseURL(),target=new URL(url),adminURL=new URL(url),name=`execution_test_${randomBytes(6).toString('hex')}`,origin='http://127.0.0.1:3104';target.pathname=`/${name}`;adminURL.pathname='/postgres';
const admin=new Pool({connectionString:adminURL.toString()}),database=connectDatabase(target.toString()),provider=await startCalendarFixture(origin);let child:ChildProcess|undefined,created=false,cookie='';const input=createInterface({input:process.stdin,output:process.stdout});
async function api(path:string,data?:object,method=data?'POST':'GET'){const response=await fetch(`${origin}${path}`,{method,headers:{Cookie:cookie,Origin:origin,'Content-Type':'application/json'},body:data?JSON.stringify(data):undefined});if(!response.ok)throw new Error(`${path}: ${response.status} ${await response.text()}`);return response.json();}
try{
 await admin.query(`CREATE DATABASE "${name}"`);created=true;await migrate(database.db,{migrationsFolder:'src/db/migrations'});await provisionLocalUser(database.db,{email:'goals-r2@example.test',password:'Disposable-R2-Walkthrough!',name:'Goals walkthrough',timezone:'Europe/London'});
 child=spawn(process.execPath,['node_modules/next/dist/bin/next','start','--hostname','127.0.0.1','--port','3104'],{env:{...process.env,NODE_ENV:'production',DATABASE_URL:target.toString(),BETTER_AUTH_URL:origin,EXECUTION_TEST_CLOCK_FILE:'',...fixtureEnvironment(provider.origin,origin)},stdio:'ignore'});
 for(let i=0;i<120;i++){if(child.exitCode!==null)throw new Error('Manual app exited');try{if((await fetch(`${origin}/api/health`)).ok)break;}catch{}await delay(250);}
 const login=await fetch(`${origin}/api/auth/sign-in/email`,{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify({email:'goals-r2@example.test',password:'Disposable-R2-Walkthrough!'})});if(!login.ok)throw new Error('Fixture login failed');cookie=login.headers.getSetCookie().map(v=>v.split(';')[0]).join('; ');
 const week=currentWeek(new Date().toISOString(),'Europe/London');
 const g=(await api('/api/goals',{mutationId:randomUUID(),title:'Make space for meaningful progress',outcome:'A useful release, and time for life outside work'})).goal;
 const ms=(await api(`/api/goals/${g.id}/milestones`,{mutationId:randomUUID(),title:'Ship a calmer planning experience',successCondition:'The weekly loop works for a real person'})).milestone;
 const titles=['Build the first useful prototype','Review the research and write a clear decision about the next version of the product experience','Prepare launch notes','Read and take notes','Explore a quieter direction'];const actions=[];
 for(let i=0;i<titles.length;i++)actions.push((await api(`/api/goals/${g.id}/actions`,{mutationId:randomUUID(),title:titles[i],estimateMinutes:180,doneWhen:'A concrete, reviewable result',milestoneId:i<2?ms.id:null})).action);
 const candidates=(await api('/api/weekly-plans/candidates')).candidates;
 const plan=(await api('/api/weekly-plans',{mutationId:randomUUID(),weekStartDate:week,provisionalCapacityMinutes:1500,reserveMinutes:300})).plan;
 await api(`/api/weekly-plans/${plan.id}`,{mutationId:randomUUID(),expectedVersion:1,provisionalCapacityMinutes:1500,reserveMinutes:300,commitments:actions.slice(0,1).map(a=>({actionId:a.id,budgetMinutes:180,source:candidates.find((c:{actionId:string})=>c.actionId===a.id).source}))},'PATCH');
 const proof=(await api(`/api/goals/${g.id}/milestones`,{mutationId:randomUUID(),title:'Weekly planning loop is usable',successCondition:'I can choose work, protect reserve and preserve the baseline'})).milestone;
 await api(`/api/milestones/${proof.id}/complete`,{mutationId:randomUUID(),expectedVersion:proof.version,evidence:'The baseline and amendment workflow is usable end to end'});
 const life=(await api('/api/goals',{mutationId:randomUUID(),title:'Build a regular reading practice',outcome:'Read thoughtfully and turn useful ideas into everyday changes'})).goal;
 await api(`/api/goals/${life.id}/milestones`,{mutationId:randomUUID(),title:'Finish one book and test an idea',successCondition:'One practical change from the book is part of my routine'});
 await api(`/api/goals/${life.id}/actions`,{mutationId:randomUUID(),title:'Read a chapter and capture one useful idea',doneWhen:'One idea is written down in my own words',estimateMinutes:30});
 await api('/api/focusable-hours',{mutationId:randomUUID(),scheduleId:null,expectedVersion:0,windows:Array.from({length:5},(_,i)=>({weekday:i+1,startMinute:540,endMinute:1020}))},'PUT');
 console.log(JSON.stringify({origin,week,goalId:g.id,email:'goals-r2@example.test',password:'Disposable-R2-Walkthrough!',commands:['stop']}));
 while((await input.question('Walkthrough command: ')).trim()!=='stop')console.log('Ready; stop ends the isolated fixture.');
}finally{input.close();if(child&&child.exitCode===null){const done=once(child,'exit');child.kill('SIGTERM');await done;}await provider.close();await database.pool.end();if(created)await admin.query(`DROP DATABASE "${name}" WITH (FORCE)`);await admin.end();}
