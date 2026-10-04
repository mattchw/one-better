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
import {currentWeek,addDays} from '../src/modules/planning/domain';
import {startCalendarFixture,fixtureEnvironment} from '../tests/calendar-fixture-server';
const {url}=requireTestDatabaseURL(),target=new URL(url),adminURL=new URL(url),name=`execution_test_${randomBytes(6).toString('hex')}`,origin='http://127.0.0.1:3104';target.pathname=`/${name}`;adminURL.pathname='/postgres';
const admin=new Pool({connectionString:adminURL.toString()}),database=connectDatabase(target.toString()),provider=await startCalendarFixture(origin);let child:ChildProcess|undefined,created=false,cookie='',connectionId='';const input=createInterface({input:process.stdin,output:process.stdout});
async function api(path:string,data?:object,method=data?'POST':'GET'){const response=await fetch(`${origin}${path}`,{method,headers:{Cookie:cookie,Origin:origin,'Content-Type':'application/json'},body:data?JSON.stringify(data):undefined});if(!response.ok)throw new Error(`${path}: ${response.status} ${await response.text()}`);return response.json();}
try{
 await admin.query(`CREATE DATABASE "${name}"`);created=true;await migrate(database.db,{migrationsFolder:'src/db/migrations'});await provisionLocalUser(database.db,{email:'calendar-r1@example.test',password:'Disposable-R1-Walkthrough!',name:'Calendar walkthrough',timezone:'Europe/London'});
 child=spawn(process.execPath,['node_modules/next/dist/bin/next','start','--hostname','127.0.0.1','--port','3104'],{env:{...process.env,NODE_ENV:'production',DATABASE_URL:target.toString(),BETTER_AUTH_URL:origin,EXECUTION_TEST_CLOCK_FILE:'',...fixtureEnvironment(provider.origin,origin)},stdio:'ignore'});
 for(let i=0;i<120;i++){if(child.exitCode!==null)throw new Error('Manual app exited');try{if((await fetch(`${origin}/api/health`)).ok)break;}catch{}await delay(250);}
 const login=await fetch(`${origin}/api/auth/sign-in/email`,{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify({email:'calendar-r1@example.test',password:'Disposable-R1-Walkthrough!'})});if(!login.ok)throw new Error('Fixture login failed');cookie=login.headers.getSetCookie().map(v=>v.split(';')[0]).join('; ');
 const week=addDays(currentWeek(new Date().toISOString(),'Europe/London'),7);
 const g=(await api('/api/goals',{mutationId:randomUUID(),title:'Make space for meaningful progress',outcome:'A useful release, and time for life outside work'})).goal;
 const ms=(await api(`/api/goals/${g.id}/milestones`,{mutationId:randomUUID(),title:'Ship a calmer planning experience',successCondition:'The weekly loop works for a real person'})).milestone;
 const titles=['Build the first useful prototype','Review the research and write a clear decision about the next version of the product experience','Prepare launch notes','Read and take notes','Explore a quieter direction'];const actions=[];
 for(let i=0;i<titles.length;i++)actions.push((await api(`/api/goals/${g.id}/actions`,{mutationId:randomUUID(),title:titles[i],estimateMinutes:180,doneWhen:'A concrete, reviewable result',milestoneId:i<2?ms.id:null})).action);
 const candidates=(await api('/api/weekly-plans/candidates')).candidates;
 let plan=(await api('/api/weekly-plans',{mutationId:randomUUID(),weekStartDate:week,provisionalCapacityMinutes:1500,reserveMinutes:300})).plan;
 plan=(await api(`/api/weekly-plans/${plan.id}`,{mutationId:randomUUID(),expectedVersion:1,provisionalCapacityMinutes:1500,reserveMinutes:300,commitments:actions.map(a=>({actionId:a.id,budgetMinutes:180,source:candidates.find((c:{actionId:string})=>c.actionId===a.id).source}))},'PATCH')).plan;
 plan=(await api(`/api/weekly-plans/${plan.id}/commit`,{mutationId:randomUUID(),expectedVersion:2})).plan;
 await api('/api/focusable-hours',{mutationId:randomUUID(),scheduleId:null,expectedVersion:0,windows:Array.from({length:5},(_,i)=>({weekday:i+1,startMinute:540,endMinute:1020}))},'PUT');
 const placements=[[0,0,'09:00','10:30'],[0,2,'14:00','15:30'],[1,1,'10:00','12:00'],[1,3,'14:00','15:00'],[2,0,'14:00','15:00'],[2,4,'11:00','12:30'],[3,1,'16:00','17:00'],[3,4,'15:00','16:00'],[4,2,'07:00','08:00'],[4,3,'16:00','17:00']] as const;
 for(const [index,day,startTime,endTime] of placements){const placement={commitmentId:plan.commitments[index].id,date:addDays(week,day),startTime,endTime},review=await api(`/api/weekly-plans/${plan.id}/time-blocks/preview`,placement);await api(`/api/weekly-plans/${plan.id}/time-blocks`,{...placement,mutationId:randomUUID(),expectedPlanVersion:review.planVersion,reviewKey:review.reviewKey,acknowledgeOutsideHours:review.outsideHours,acknowledgeBusy:!!review.busyConflict});}
 await api(`/api/weekly-plans/${plan.id}/amendments`,{mutationId:randomUUID(),expectedVersion:3,provisionalCapacityMinutes:1440,reserveMinutes:300,reason:'Protect reserve and deliberately remove exploration',commitments:actions.slice(0,4).map(a=>({actionId:a.id,budgetMinutes:180}))});
 console.log(JSON.stringify({origin,week,email:'calendar-r1@example.test',password:'Disposable-R1-Walkthrough!',blocks:10,commands:['busy','stale','unavailable','disconnect','stop']}));
 while(true){const command=(await input.question('Walkthrough command: ')).trim();if(command==='stop')break;
  if(command==='busy'&&!connectionId){const flow=await api('/api/calendar/connect',{}),authorize=await fetch(flow.url),html=await authorize.text(),href=html.match(/href="([^"]+)"/)![1].replaceAll('&amp;','&');const approved=await fetch(href,{redirect:'manual'});await fetch(approved.headers.get('location')!,{headers:{Cookie:cookie},redirect:'manual'});let connection=(await api('/api/calendar')).connection;connection=(await api(`/api/calendar/${connection.id}/calendars`,{})).connection;connection=(await api(`/api/calendar/${connection.id}`,{expectedVersion:connection.version,calendarIds:['work-calendar']},'PATCH')).connection;connectionId=connection.id;await api(`/api/calendar/${connectionId}/availability`,{weekStartDate:week});}
  if(command==='stale')await database.pool.query("UPDATE calendar_availability_cache SET last_error='unavailable' WHERE connection_id=$1",[connectionId]);
  if(command==='unavailable')await database.pool.query('DELETE FROM calendar_availability_cache WHERE connection_id=$1',[connectionId]);
  if(command==='disconnect')await api(`/api/calendar/${connectionId}/disconnect`,{});
  console.log(`Ready: ${command}; reload the workspace.`);
 }
}finally{input.close();if(child&&child.exitCode===null){const done=once(child,'exit');child.kill('SIGTERM');await done;}await provider.close();await database.pool.end();if(created)await admin.query(`DROP DATABASE "${name}" WITH (FORCE)`);await admin.end();}
