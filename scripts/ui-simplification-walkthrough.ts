// UI manual QA: isolated local database and localhost cookies, synthetic work, no provider calls.
import {randomBytes} from 'node:crypto';
import {spawn,type ChildProcess} from 'node:child_process';
import {once} from 'node:events';
import {createInterface} from 'node:readline/promises';
import {setTimeout as delay} from 'node:timers/promises';
import {Pool} from 'pg';
import {migrate} from 'drizzle-orm/node-postgres/migrator';
import {Temporal} from '@js-temporal/polyfill';
import {connectDatabase} from '../src/db/connect';
import {requireTestDatabaseURL,dropIsolatedTestDatabase} from './test-database';
import {provisionLocalUser} from './local-user';
import {executionFixture} from '../tests/focus-database';
import {currentWeek,addDays} from '../src/modules/planning/domain';
import {hoursService} from '../src/modules/availability/service';
import {hoursRepository} from '../src/modules/availability/repository';
import {focusService} from '../src/modules/focus/service';
import {focusRepository} from '../src/modules/focus/repository';
import {randomUUID} from 'node:crypto';
const {url}=requireTestDatabaseURL(),target=new URL(url),adminURL=new URL(url),name=`execution_test_${randomBytes(6).toString('hex')}`,origin='http://localhost:3104';target.pathname=`/${name}`;adminURL.pathname='/postgres';
const admin=new Pool({connectionString:adminURL.toString()}),database=connectDatabase(target.toString()),input=createInterface({input:process.stdin,output:process.stdout});let created=false,child:ChildProcess|undefined;
try{
 await admin.query(`CREATE DATABASE "${name}"`);created=true;await migrate(database.db,{migrationsFolder:'src/db/migrations'});
 const account=await provisionLocalUser(database.db,{email:'uiqa@example.test',password:'Disposable-UI-QA-Only!',name:'Morgan Lee',timezone:'Europe/London'}),actor={userId:account.id},now=new Date().toISOString(),week=currentWeek(now,'Europe/London'),today=Temporal.Instant.from(now).toZonedDateTimeISO('Europe/London').toPlainDate().toString(),clock=()=>`${addDays(week,-14)}T00:00:00Z`;
 const f=await executionFixture(database.db,actor,week,clock),next=await executionFixture(database.db,actor,addDays(week,7),clock),prior=await executionFixture(database.db,actor,addDays(week,-7),clock);
 for(const [start,end] of [['09:00','10:00'],['10:00','11:00'],['13:00','14:00'],['14:00','15:00']])await f.create(today,start,end);
 await hoursService(hoursRepository(database.db),clock).save(actor,{mutationId:randomUUID(),scheduleId:null,expectedVersion:0,windows:Array.from({length:7},(_,i)=>({weekday:i+1,startMinute:540,endMinute:1020}))});
 const instant=(time:string)=>Temporal.PlainDate.from(today).toZonedDateTime({timeZone:'Europe/London',plainTime:time}).toInstant().toString();
 const started=await focusService(focusRepository(database.db),()=>instant('09:00')).start(actor,f.block.id,{mutationId:randomUUID(),expectedBlockVersion:1,acknowledgeRemoved:false});
 await focusService(focusRepository(database.db),()=>instant('09:35')).end(actor,started.id,{mutationId:randomUUID(),expectedVersion:1,outcome:'partial',endNote:'Private session note must stay outside the calendar projection.'});
 child=spawn(process.execPath,['node_modules/next/dist/bin/next','start','--hostname','127.0.0.1','--port','3104'],{env:{...process.env,NODE_ENV:'production',DATABASE_URL:target.toString(),BETTER_AUTH_URL:origin,EXECUTION_TEST_CLOCK_FILE:undefined,GOOGLE_CALENDAR_CLIENT_ID:'',GOOGLE_CALENDAR_CLIENT_SECRET:'',OPENAI_API_KEY:'',ANTHROPIC_API_KEY:''},stdio:'ignore'});
 for(let i=0;i<120;i++){try{if((await fetch(`${origin}/api/health`)).ok)break;}catch{}await delay(250);if(i===119)throw new Error('Manual app not ready');}
 console.log(JSON.stringify({origin,date:today,week,nextWeek:next.plan.weekStartDate,priorWeek:prior.plan.weekStartDate,email:'uiqa@example.test',password:'Disposable-UI-QA-Only!',providerCalls:0}));
 while((await input.question('Type stop to remove this isolated QA database: ')).trim()!=='stop'){}
}finally{
 input.close();if(child&&child.exitCode===null){const done=once(child,'exit');child.kill('SIGTERM');await done;}await database.pool.end();if(created)await dropIsolatedTestDatabase(admin,name);await admin.end();
}
