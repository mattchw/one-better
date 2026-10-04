import { beforeAll, beforeEach, afterAll, describe, it, expect } from 'vitest';
import { randomUUID } from 'node:crypto';
import { and, eq, inArray } from 'drizzle-orm';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { connectDatabase } from '../../src/db/connect';
import { account, user, goal } from '../../src/db/schema';
import { createAuthentication } from '../../src/server/auth-factory';
import { readSignInMethods } from '../../src/server/sign-in-methods';
import { provisionLocalUser } from '../../scripts/local-user';
import { requireTestDatabaseURL } from '../../scripts/test-database';
import { startGoogleAuthFixture } from '../google-auth-fixture';
import { installGoogleAuthTestTransport } from '../google-auth-test-transport.mjs';
const target=requireTestDatabaseURL(),database=connectDatabase(target.url),baseURL=process.env.BETTER_AUTH_URL!,secret=process.env.BETTER_AUTH_SECRET!;
let fixture:Awaited<ReturnType<typeof startGoogleAuthFixture>>,restore:()=>void,auth:ReturnType<typeof createAuthentication>;
const emailA=`google-a-${randomUUID()}@example.test`,emailB=`google-b-${randomUUID()}@example.test`,password='Disposable-Google-Test-Password!';
const signupEmail=`google-new-${randomUUID()}@example.test`,tokenEmail=`google-token-${randomUUID()}@example.test`,unverifiedEmail=`google-unverified-${randomUUID()}@example.test`;
const signupEmails=[signupEmail,tokenEmail,unverifiedEmail];
let idA:string,idB:string,credentials:(typeof account.$inferSelect)[],cookieA:string,cookieB:string,goalId:string;
function capture(response:Response,cookies=new Map<string,string>()) {for(const row of response.headers.getSetCookie()){const pair=row.split(';')[0],index=pair.indexOf('=');if(/Max-Age=0/i.test(row))cookies.delete(pair.slice(0,index));else cookies.set(pair.slice(0,index),pair.slice(index+1));}return cookies;}
const cookieHeader=(cookies:Map<string,string>)=>Array.from(cookies,([name,value])=>`${name}=${value}`).join('; ');
async function post(path:string,body:object,cookie='') {
 const send=()=>auth.handler(new Request(`${baseURL}/api/auth/${path}`,{method:'POST',headers:{Origin:baseURL,'Content-Type':'application/json',Cookie:cookie},body:JSON.stringify(body)}));
 let response=await send();if(response.status===429){const seconds=Number(response.headers.get('X-Retry-After')??response.headers.get('Retry-After')??60);await new Promise(resolve=>setTimeout(resolve,(seconds+1)*1000));response=await send();}return response;
}
async function oauth(email=emailA,subject='google-A',cookie='',link=false,cancel=false) {
 await fixture.control({identity:{email,subject,verified:true}});
 const beginning=await post(link?'link-social':'sign-in/social',{provider:'google',callbackURL:link?'/settings/account?google=linked':'/calendar',errorCallbackURL:'/sign-in'},cookie);expect(beginning.status).toBe(200);
 const cookies=capture(beginning,new Map(cookie.split('; ').filter(Boolean).map(pair=>{const i=pair.indexOf('=');return [pair.slice(0,i),pair.slice(i+1)];}))),url=(await beginning.json()).url;
 const result=await auth.handler(new Request(await fixture.authorize(url,cancel),{headers:{Cookie:cookieHeader(cookies)}}));capture(result,cookies);
 return {result,cookie:cookieHeader(cookies),url};
}
beforeAll(async()=>{
 await migrate(database.db,{migrationsFolder:'src/db/migrations'});
 idA=(await provisionLocalUser(database.db,{email:emailA,name:'Private Google A',password,timezone:'Europe/London'})).id;
 idB=(await provisionLocalUser(database.db,{email:emailB,name:'Private Google B',password,timezone:'Europe/London'})).id;
 credentials=await database.db.select().from(account).where(inArray(account.userId,[idA,idB]));
 fixture=await startGoogleAuthFixture(baseURL);restore=installGoogleAuthTestTransport({...process.env,...fixture.environment});
 auth=createAuthentication(database.db,{baseURL,secret,google:{clientId:'google-auth-fixture',clientSecret:'google-auth-fixture-secret'}});
 const login=async(email:string)=>{const response=await post('sign-in/email',{email,password});expect(response.status).toBe(200);return cookieHeader(capture(response));};
 cookieA=await login(emailA);cookieB=await login(emailB);
 goalId=randomUUID();await database.db.insert(goal).values({id:goalId,ownerId:idA,title:'Retain my existing Google-login workspace',outcome:'The same account owns the saved work'});
},90_000);
beforeEach(async()=>{
 await database.db.delete(user).where(inArray(user.email,signupEmails));
 await database.db.delete(account).where(and(inArray(account.userId,[idA,idB]),eq(account.providerId,'google')));
 for(const credential of credentials)await database.db.insert(account).values(credential).onConflictDoUpdate({target:account.id,set:{password:credential.password}});
 await database.db.update(user).set({emailVerified:false}).where(inArray(user.id,[idA,idB]));
 await fixture.control({identity:{email:emailA,subject:'google-A',verified:true},mode:'normal'});
});
afterAll(async()=>{restore?.();await fixture?.close();await database.db.delete(goal).where(eq(goal.id,goalId));await database.db.delete(user).where(inArray(user.email,signupEmails));await database.db.delete(user).where(inArray(user.id,[idA,idB]));await database.pool.end();});
describe('built-in Google authentication with real PostgreSQL and fake provider transport',()=>{
 it('links verified Google to a provisioned row, retaining ID, profile, timezone and owned work',async()=>{
  const before=await database.db.select().from(user).where(eq(user.id,idA)),result=await oauth();expect(result.result.headers.get('Location')).toBe('/calendar');
  const current=await auth.api.getSession({headers:new Headers({Cookie:result.cookie})});expect(current?.user.id).toBe(idA);expect(current?.user.name).toBe(before[0].name);expect(current?.user.timezone).toBe('Europe/London');
  expect((await database.db.select().from(goal).where(eq(goal.ownerId,current!.user.id)))[0].id).toBe(goalId);
  const linked=await database.db.select().from(account).where(and(eq(account.userId,idA),eq(account.providerId,'google')));expect(linked).toHaveLength(1);expect(linked[0].accessToken).not.toBe('google-access-fixture-secret');
  expect(await readSignInMethods(database.db,idA,emailA)).toEqual({passwordAvailable:true,google:{id:linked[0].id,email:emailA}});
 },90_000);
 it('Google-only login and persisted sessions survive replacement of the auth/server instance',async()=>{
  const first=await oauth(),restart=createAuthentication(database.db,{baseURL,secret,google:{clientId:'google-auth-fixture',clientSecret:'google-auth-fixture-secret'}});
  expect((await restart.api.getSession({headers:new Headers({Cookie:first.cookie})}))?.user.id).toBe(idA);auth=restart;
  const again=await oauth();expect((await auth.api.getSession({headers:new Headers({Cookie:again.cookie})}))?.user.id).toBe(idA);
 },90_000);
 it('a new verified Google email creates one independent account and subsequent logins reuse it',async()=>{
  const before=(await database.db.select().from(user)).length,result=await oauth(signupEmail,'google-new');
  expect(result.result.headers.get('Location')).toBe('/calendar');expect((await database.db.select().from(user)).length).toBe(before+1);
  const current=await auth.api.getSession({headers:new Headers({Cookie:result.cookie})});expect(current?.user.email).toBe(signupEmail);expect(current?.user.emailVerified).toBe(true);expect(current?.user.timezone).toBe('Europe/London');expect([idA,idB]).not.toContain(current?.user.id);
  expect(await readSignInMethods(database.db,current!.user.id,signupEmail)).toEqual({passwordAvailable:false,google:expect.objectContaining({email:signupEmail})});
  expect((await post('unlink-account',{accountId:(await readSignInMethods(database.db,current!.user.id,signupEmail)).google!.id},result.cookie)).status).toBe(403);
  const again=await oauth(signupEmail,'google-new');expect((await auth.api.getSession({headers:new Headers({Cookie:again.cookie})}))?.user.id).toBe(current!.user.id);expect((await database.db.select().from(user)).length).toBe(before+1);
  expect((await database.db.select().from(goal).where(eq(goal.ownerId,idA)))[0].id).toBe(goalId);
 },90_000);
 it('ID-token signup requires a valid Google signature and verified email',async()=>{
  const forged=await post('sign-in/social',{provider:'google',requestSignUp:true,idToken:{token:'forged-google-identity'}});expect(forged.ok).toBe(false);
  const unverified=await fixture.token({email:unverifiedEmail,subject:'unverified-token',verified:false});const denied=await post('sign-in/social',{provider:'google',requestSignUp:true,idToken:{token:unverified}});expect(denied.ok).toBe(false);expect(await database.db.select().from(user).where(eq(user.email,unverifiedEmail))).toEqual([]);
  const idToken=await fixture.token({email:tokenEmail,subject:'verified-token',verified:true});const response=await post('sign-in/social',{provider:'google',requestSignUp:true,idToken:{token:idToken}});expect(response.status).toBe(200);expect((await database.db.select().from(user).where(eq(user.email,tokenEmail)))[0].emailVerified).toBe(true);
 },90_000);
 it('unverified Google email cannot link or sign in',async()=>{
  await fixture.control({identity:{verified:false}});const start=await post('sign-in/social',{provider:'google',callbackURL:'/calendar',errorCallbackURL:'/sign-in'}),cookies=capture(start);
  // Better Auth rejects the unverified identity before automatic linking.
  const result=await auth.handler(new Request(await fixture.authorize((await start.json()).url),{headers:{Cookie:cookieHeader(cookies)}}));expect(result.headers.get('Location')).toBe(`${baseURL}/sign-in?error=account_not_linked`);
  expect(await database.db.select().from(account).where(and(eq(account.userId,idA),eq(account.providerId,'google')))).toEqual([]);
  await fixture.control({identity:{email:unverifiedEmail,subject:'unverified-new',verified:false}});const newStart=await post('sign-in/social',{provider:'google',callbackURL:'/calendar',errorCallbackURL:'/sign-in'}),newCookies=capture(newStart);
  const newResult=await auth.handler(new Request(await fixture.authorize((await newStart.json()).url),{headers:{Cookie:cookieHeader(newCookies)}}));expect(newResult.headers.get('Location')).toBe(`${baseURL}/sign-in?error=email_not_verified`);expect(await database.db.select().from(user).where(eq(user.email,unverifiedEmail))).toEqual([]);
 },90_000);
 it('mismatched email cannot take over an authenticated account',async()=>{
  const result=await oauth(emailB,'google-B',cookieA,true);expect(result.result.headers.get('Location')).toBe(`${baseURL}/sign-in?error=email_does_not_match`);expect((await auth.api.getSession({headers:new Headers({Cookie:cookieA})}))?.user.id).toBe(idA);
  expect(await database.db.select().from(account).where(eq(account.providerId,'google'))).toEqual([]);
 },90_000);
 it('one provider subject cannot belong to two users, even if its asserted email changes',async()=>{
  await oauth();const result=await oauth(emailB,'google-A',cookieB,true);expect(result.result.headers.get('Location')).toBe(`${baseURL}/sign-in?error=account_already_linked_to_different_user`);
  expect((await database.db.select().from(account).where(eq(account.providerId,'google'))).map(a=>a.userId)).toEqual([idA]);
 },90_000);
 it('a returning provider subject with a mismatched fresh email is rejected',async()=>{
  await oauth();const result=await oauth(emailB,'google-A');expect(result.result.headers.get('Location')).toBe(`${baseURL}/sign-in?error=email_does_not_match`);expect(await auth.api.getSession({headers:new Headers({Cookie:result.cookie})})).toBeNull();
 },90_000);
 it('authenticated explicit linking and unlinking use Better Auth and retain password login',async()=>{
  await oauth(emailA,'google-A',cookieA,true);const methods=await readSignInMethods(database.db,idA,emailA);expect(methods.google).not.toBeNull();
  expect((await post('unlink-account',{accountId:methods.google!.id},cookieA)).status).toBe(200);
  expect((await readSignInMethods(database.db,idA,emailA)).google).toBeNull();const passwordLogin=await post('sign-in/email',{email:emailA,password});expect(passwordLogin.status).toBe(200);
 },90_000);
 it('foreign and anonymous users cannot manage another account’s auth methods',async()=>{
  await oauth();const methods=await readSignInMethods(database.db,idA,emailA);
  expect((await post('unlink-account',{accountId:methods.google!.id},cookieB)).status).toBe(403);expect((await post('unlink-account',{accountId:methods.google!.id})).status).toBe(401);
  const list=await auth.handler(new Request(`${baseURL}/api/auth/list-accounts?userId=${idA}`,{headers:{Cookie:cookieB}}));expect((await list.json()).every((a:{userId:string})=>a.userId===idB)).toBe(true);
 },90_000);
 it('unlink refuses the only usable method, including a credential record without a password',async()=>{
  await oauth();const google=(await readSignInMethods(database.db,idA,emailA)).google!;
  await database.db.update(account).set({password:null}).where(and(eq(account.userId,idA),eq(account.providerId,'credential')));
  expect((await post('unlink-account',{accountId:google.id},cookieA)).status).toBe(403);expect((await readSignInMethods(database.db,idA,emailA)).google).not.toBeNull();
  expect((await post('unlink-account',{accountId:credentials[0].id},cookieA)).status).toBe(403);
 },90_000);
 it('identity scopes, online access and no incremental permissions; refuses Calendar scope injection',async()=>{
  await oauth();const stats=await fixture.stats();expect(stats.lastAuthorization.scopes).toEqual(['email','openid','profile']);expect(stats.lastAuthorization.redirectURI).toBe(`${baseURL}/api/auth/callback/google`);expect(stats.lastAuthorization.includeGrantedScopes).not.toBe('true');expect(stats.lastAuthorization.accessType).toBe('online');
  expect((await post('sign-in/social',{provider:'google',scopes:['https://www.googleapis.com/auth/calendar.readonly']})).status).toBe(403);
  expect((await post('link-social',{provider:'google',additionalParams:{include_granted_scopes:'true'}},cookieA)).status).toBe(403);
  expect((await database.pool.query('SELECT count(*)::int AS n FROM google_calendar_connection WHERE owner_id=$1',[idA])).rows[0].n).toBe(0);
 },90_000);
 it('OAuth access/refresh/ID tokens are absent from browser account responses and token APIs are disabled',async()=>{
  const result=await oauth();const list=await auth.handler(new Request(`${baseURL}/api/auth/list-accounts`,{headers:{Cookie:result.cookie}})),text=await list.text();expect(text).not.toMatch(/accessToken|refreshToken|idToken|google-access-fixture-secret|google-refresh-fixture-secret|password/);
  const google=(await readSignInMethods(database.db,idA,emailA)).google!;for(const path of ['get-access-token','refresh-token'])expect((await post(path,{accountId:google.id},result.cookie)).status).toBe(404);
 },90_000);
 it('cancelled consent and malformed callback return safe sign-in errors without provider descriptions',async()=>{
  const cancelled=await oauth(emailA,'google-A','',false,true);expect(cancelled.result.headers.get('Location')).toBe(`${baseURL}/sign-in?error=access_denied`);expect(cancelled.result.headers.get('Location')).not.toContain('PRIVATE_PROVIDER_INTERNAL');
  const bad=await auth.handler(new Request(`${baseURL}/api/auth/callback/google?code=forged&state=wrong`));expect(bad.headers.get('Location')).toMatch(new RegExp(`${baseURL}/sign-in\\?error=`));
  expect(await auth.api.getSession({headers:new Headers({Cookie:cancelled.cookie})})).toBeNull();
 },90_000);
 it('rejects wrong origins and safely reports missing provider configuration while password remains usable',async()=>{
  const denied=await auth.handler(new Request(`${baseURL}/api/auth/sign-in/social`,{method:'POST',headers:{Origin:'https://evil.test','Content-Type':'application/json'},body:JSON.stringify({provider:'google'})}));expect(denied.status).toBe(403);
  const missing=createAuthentication(database.db,{secret,baseURL});const response=await missing.handler(new Request(`${baseURL}/api/auth/sign-in/social`,{method:'POST',headers:{Origin:baseURL,'Content-Type':'application/json'},body:JSON.stringify({provider:'google'})}));expect(response.status).toBe(503);expect(await response.text()).not.toContain('clientSecret');expect((await missing.api.getSession({headers:new Headers({Cookie:cookieA})}))?.user.id).toBe(idA);
 },90_000);
});
