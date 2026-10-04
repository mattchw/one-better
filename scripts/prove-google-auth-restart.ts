import assert from 'node:assert/strict';
import {randomBytes,randomUUID} from 'node:crypto';
import {spawn,type ChildProcess} from 'node:child_process';
import {once} from 'node:events';
import {setTimeout as delay} from 'node:timers/promises';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {Pool} from 'pg';
import {migrate} from 'drizzle-orm/node-postgres/migrator';
import {eq} from 'drizzle-orm';
import {connectDatabase} from '../src/db/connect';
import {account,goal} from '../src/db/schema';
import {requireTestDatabaseURL,dropIsolatedTestDatabase} from './test-database';
import {provisionLocalUser} from './local-user';
import {startGoogleAuthFixture} from '../tests/google-auth-fixture';

const origin='http://127.0.0.1:3102',name=`execution_test_${randomBytes(6).toString('hex')}`;
const target=new URL(requireTestDatabaseURL().url),adminURL=new URL(target);
target.pathname=`/${name}`;adminURL.pathname='/postgres';
const admin=new Pool({connectionString:adminURL.toString()}),database=connectDatabase(target.toString()),fixture=await startGoogleAuthFixture(origin);
let child:ChildProcess|undefined,created=false;
const cookies=new Map<string,string>();
const cookie=()=>Array.from(cookies,([key,value])=>`${key}=${value}`).join('; ');
function capture(response:Response){for(const row of response.headers.getSetCookie()){const pair=row.split(';')[0],index=pair.indexOf('=');if(/Max-Age=0/i.test(row))cookies.delete(pair.slice(0,index));else cookies.set(pair.slice(0,index),pair.slice(index+1));}}
async function start(){
 child=spawn(process.execPath,['node_modules/next/dist/bin/next','start','--hostname','127.0.0.1','--port','3102'],{env:{...process.env,NODE_ENV:'production',BETTER_AUTH_URL:origin,DATABASE_URL:target.toString(),...fixture.environment,NODE_OPTIONS:`${process.env.NODE_OPTIONS??''} --import=${pathToFileURL(resolve('tests/google-auth-test-transport.mjs'))}`,AI_PROVIDER:'',OPENAI_API_KEY:'',OPENAI_MODEL:'',ANTHROPIC_API_KEY:'',ANTHROPIC_MODEL:'',AI_TEST_BASE_URL:'',GOOGLE_CALENDAR_CLIENT_ID:'',GOOGLE_CALENDAR_CLIENT_SECRET:'',GOOGLE_CALENDAR_REDIRECT_URI:'',CALENDAR_ENCRYPTION_KEYS:'',CALENDAR_ENCRYPTION_KEY_ID:'',CALENDAR_TEST_ORIGIN:'',CHATGPT_ENCRYPTION_KEYS:'',CHATGPT_ENCRYPTION_KEY_ID:'',CHATGPT_TEST_ORIGIN:'',CHATGPT_TEST_MODE:''},stdio:'ignore'});
 for(let i=0;i<120;i++){if(child.exitCode!==null)throw new Error('Production process exited');try{if((await fetch(`${origin}/api/health`)).ok)return;}catch{}await delay(250);}throw new Error('Production process not ready');
}
async function stop(){if(child&&child.exitCode===null){const ended=once(child,'exit');child.kill('SIGTERM');await ended;}child=undefined;}
async function request(path:string,body?:object){const response=await fetch(`${origin}${path}`,{method:body?'POST':'GET',headers:{Origin:origin,Cookie:cookie(),'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined,redirect:'manual'});capture(response);return response;}
async function login(){
 const beginning=await request('/api/auth/sign-in/social',{provider:'google',callbackURL:'/calendar',errorCallbackURL:'/sign-in'});assert.equal(beginning.status,200);
 const callback=await fixture.authorize((await beginning.json()).url),result=await fetch(callback,{headers:{Cookie:cookie()},redirect:'manual'});capture(result);assert.equal(new URL(result.headers.get('Location')!,origin).toString(),`${origin}/calendar`);
}
try{
 await admin.query(`CREATE DATABASE "${name}"`);created=true;await migrate(database.db,{migrationsFolder:'src/db/migrations'});
 const owner=await provisionLocalUser(database.db,{email:process.env.TEST_USER_A_EMAIL,password:process.env.TEST_USER_A_PASSWORD,name:'Google restart proof',timezone:'Europe/London'});
 const id=randomUUID();await database.db.insert(goal).values({id,ownerId:owner.id,title:'Preserve my workspace through Google sign-in',outcome:'Same identity and work after restart'});
 await fixture.control({identity:{email:process.env.TEST_USER_A_EMAIL,subject:'restart-google',verified:true}});await start();await login();
 const before=(await (await request('/api/account')).json()).user;assert.equal(before.id,owner.id);
 const linked=(await database.db.select({id:account.id,userId:account.userId}).from(account).where(eq(account.providerId,'google')))[0];assert.equal(linked.userId,owner.id);
 await stop();await start();assert.deepEqual((await (await request('/api/account')).json()).user,before,'Persisted session must survive a real process restart');
 assert.equal((await request(`/api/goals/${id}`)).status,200);
 assert.deepEqual((await database.db.select({id:account.id,userId:account.userId}).from(account).where(eq(account.providerId,'google')))[0],linked);
 await request('/api/auth/sign-out',{});cookies.clear();await login();assert.deepEqual((await (await request('/api/account')).json()).user,before);
 const calendar=await (await request('/api/calendar')).json();assert.equal(calendar.connection,null);
 const stats=await fixture.stats();assert.deepEqual(stats.lastAuthorization.scopes,['email','openid','profile']);assert.equal(stats.exchanges,2);
 assert.equal((await request('/api/auth/get-access-token',{providerId:'google'})).status,404);
 await request('/api/auth/sign-out',{});cookies.clear();await fixture.control({identity:{email:`google-new-${randomUUID()}@example.test`,subject:'restart-new-google',verified:true}});await login();
 const registered=(await (await request('/api/account')).json()).user;assert.notEqual(registered.id,owner.id);assert.equal(registered.timezone,'Europe/London');assert.equal((await request(`/api/goals/${id}`)).status,404);
 const savedResponse=await request('/api/goals',{mutationId:randomUUID(),title:'New Google account survives restart',outcome:'Keep my own workspace after signup'});assert.equal(savedResponse.status,200);const saved=(await savedResponse.json()).goal;
 await stop();await start();assert.deepEqual((await (await request('/api/account')).json()).user,registered);assert.equal((await request(`/api/goals/${saved.id}`)).status,200);
 await request('/api/auth/sign-out',{});cookies.clear();await login();assert.deepEqual((await (await request('/api/account')).json()).user,registered);assert.equal((await request(`/api/goals/${saved.id}`)).status,200);
 assert.equal((await (await request('/api/calendar')).json()).connection,null);
 console.log('PASS: production stop/start preserves existing Google login and newly registered Google account, user IDs, saved Goals and sessions; fresh Google-only logins reuse each workspace; different accounts remain isolated; Calendar stays separate; only identity scopes are requested; OAuth tokens remain server-side. All Google traffic is synthetic.');
}finally{await stop();await fixture.close();await database.pool.end();if(created)await dropIsolatedTestDatabase(admin,name);await admin.end();}
