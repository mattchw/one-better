// Isolated Settings design walkthrough. Saves only fixture preferences. Uses the real domain APIs and a loopback Calendar provider.
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
 await admin.query(`CREATE DATABASE "${name}"`);created=true;await migrate(database.db,{migrationsFolder:'src/db/migrations'});await provisionLocalUser(database.db,{email:'settings-design@example.test',password:'Disposable-Settings-Walkthrough!',name:'Morgan Lee',timezone:'Europe/London'});
 child=spawn(process.execPath,['node_modules/next/dist/bin/next','start','--hostname','127.0.0.1','--port','3104'],{env:{...process.env,NODE_ENV:'production',DATABASE_URL:target.toString(),BETTER_AUTH_URL:origin,EXECUTION_TEST_CLOCK_FILE:'',...fixtureEnvironment(provider.origin,origin)},stdio:'ignore'});
 for(let i=0;i<120;i++){if(child.exitCode!==null)throw new Error('Manual app exited');try{if((await fetch(`${origin}/api/health`)).ok)break;}catch{}await delay(250);}
 const login=await fetch(`${origin}/api/auth/sign-in/email`,{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify({email:'settings-design@example.test',password:'Disposable-Settings-Walkthrough!'})});if(!login.ok)throw new Error('Fixture login failed');cookie=login.headers.getSetCookie().map(v=>v.split(';')[0]).join('; ');
 const week=currentWeek(new Date().toISOString(),'Europe/London');
 const plan=(await api('/api/weekly-plans',{mutationId:randomUUID(),weekStartDate:week,provisionalCapacityMinutes:1500,reserveMinutes:300})).plan;
 await api('/api/focusable-hours',{mutationId:randomUUID(),scheduleId:null,expectedVersion:0,windows:Array.from({length:5},(_,i)=>({weekday:i+1,startMinute:540,endMinute:i===4?900:1020}))},'PUT');
 const before=(await api(`/api/weekly-plans?week=${week}`)).view;
 console.log(JSON.stringify({origin,week,planId:plan.id,email:'settings-design@example.test',password:'Disposable-Settings-Walkthrough!',commands:['stop']}));
 while((await input.question('Walkthrough command: ')).trim()!=='stop')console.log('Ready; stop ends the isolated fixture.');
 const after=(await api(`/api/weekly-plans?week=${week}`)).view; if(JSON.stringify(after)!==JSON.stringify(before))throw new Error('Settings walkthrough changed weekly plan facts'); console.log('Weekly plan unchanged.');
}finally{input.close();if(child&&child.exitCode===null){const done=once(child,'exit');child.kill('SIGTERM');await done;}await provider.close();await database.pool.end();if(created)await admin.query(`DROP DATABASE "${name}" WITH (FORCE)`);await admin.end();}
