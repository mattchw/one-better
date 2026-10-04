import {test,expect,type Page} from '@playwright/test';
import {randomUUID} from 'node:crypto';
import {mkdir} from 'node:fs/promises';
import {and,eq,inArray} from 'drizzle-orm';
import {connectDatabase} from '../../src/db/connect';
import {account,user,goal} from '../../src/db/schema';
import {requireTestDatabaseURL} from '../../scripts/test-database';
import {createAuthentication} from '../../src/server/auth-factory';
import {fixtureSignIn} from './sign-in-helper';
const origin='http://127.0.0.1:3101';
const signupEmail=`google-signup-${randomUUID()}@example.test`,unverifiedEmail=`google-unverified-${randomUUID()}@example.test`;
let database:ReturnType<typeof connectDatabase>,owners:string[],credentialRows:(typeof account.$inferSelect)[],goalId:string;
const cookies:Record<string,Parameters<ReturnType<Page['context']>['addCookies']>[0]>={};
async function control(identity:object={},mode='normal'){await fetch(`${process.env.GOOGLE_AUTH_TEST_ORIGIN}/control`,{method:'POST',body:JSON.stringify({identity,mode})});}
async function google(page:Page,cancel=false){
 for(let attempt=0;attempt<2;attempt++){
  const response=page.waitForResponse(r=>r.url().endsWith('/api/auth/sign-in/social'));await page.getByRole('button',{name:'Continue with Google',exact:true}).click();const r=await response;
  if(r.status()!==429){expect(r.status()).toBe(200);break;}
  const seconds=Number(r.headers()['x-retry-after']??r.headers()['retry-after']??60);test.setTimeout(test.info().timeout+(seconds+1)*1000);await page.waitForTimeout((seconds+1)*1000);
 }
 await page.getByRole('link',{name:cancel?'Cancel Google sign-in':'Continue with test Google identity',exact:true}).click();
}
test.beforeAll(async()=>{
 test.setTimeout(90_000);const target=requireTestDatabaseURL();if(target.name==='execution_test')throw new Error('Requires isolated browser DB');database=connectDatabase(target.url);owners=(await database.db.select().from(user)).map(row=>row.id);
 credentialRows=await database.db.select().from(account).where(eq(account.providerId,'credential'));
 const auth=createAuthentication(database.db,{baseURL:origin,secret:process.env.BETTER_AUTH_SECRET!});
 for(const suffix of ['A','B']){const response=await fixtureSignIn(()=>auth.handler(new Request(`${origin}/api/auth/sign-in/email`,{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify({email:process.env[`TEST_USER_${suffix}_EMAIL`],password:process.env[`TEST_USER_${suffix}_PASSWORD`]})})));cookies[suffix]=response.headers.getSetCookie().map(row=>{const pair=row.split(';')[0],index=pair.indexOf('=');return {name:pair.slice(0,index),value:pair.slice(index+1),url:origin,httpOnly:true,sameSite:'Lax' as const};});}
 const a=(await database.db.select().from(user)).find(row=>row.email===process.env.TEST_USER_A_EMAIL)!;
 goalId=randomUUID();await database.db.insert(goal).values({id:goalId,ownerId:a.id,title:'Keep my existing workspace after Google login',outcome:'The same identity owns my work'});
});
test.beforeEach(async({page})=>{
 await database.db.delete(account).where(and(inArray(account.userId,owners),eq(account.providerId,'google')));
 for(const row of credentialRows)await database.db.update(account).set({password:row.password}).where(eq(account.id,row.id));
 await database.db.update(user).set({emailVerified:false}).where(inArray(user.id,owners));
 await control({email:process.env.TEST_USER_A_EMAIL,subject:'google-A',verified:true});
 await page.route('https://accounts.google.com/o/oauth2/v2/auth**',async route=>{const url=new URL('/authorize',process.env.GOOGLE_AUTH_TEST_ORIGIN);url.search=new URL(route.request().url()).search;await route.fulfill({response:await page.request.get(url.toString())});});
});
test.afterEach(async()=>{await database.db.delete(user).where(inArray(user.email,[signupEmail,unverifiedEmail]));});
test.afterAll(async()=>{await database.db.delete(account).where(and(inArray(account.userId,owners),eq(account.providerId,'google')));for(const row of credentialRows)await database.db.update(account).set({password:row.password}).where(eq(account.id,row.id));await database.db.delete(goal).where(eq(goal.id,goalId));await database.db.delete(user).where(inArray(user.email,[signupEmail,unverifiedEmail]));await database.pool.end();});

test('Google signs into the same saved workspace and works again after sign-out',async({page})=>{
 await page.context().addCookies(cookies.A);const before=(await (await page.request.get('/api/account')).json()).user;await page.context().clearCookies();await page.goto('/sign-in');
 await expect(page.getByRole('button',{name:'Continue with Google',exact:true})).toBeEnabled();await mkdir('docs/screenshots/google-sign-in',{recursive:true});await page.screenshot({path:'docs/screenshots/google-sign-in/sign-in-fixture.png',caret:'initial'});
 await google(page);await expect(page).toHaveURL(/\/calendar$/);expect((await (await page.request.get('/api/account')).json()).user).toEqual(before);
 await page.goto('/goals');await expect(page.locator(`[data-goal-id="${goalId}"]`).getByRole('heading',{name:'Keep my existing workspace after Google login',exact:true})).toBeVisible();
 for(const url of ['/focus','/review']){await page.goto(url);await expect(page).not.toHaveURL(/sign-in/);}
 await page.goto('/settings/account');const methods=page.getByRole('region',{name:'Sign-in methods',exact:true});await expect(methods).toContainText(`Connected as ${before.email}`);await expect(methods).toContainText('Available');await page.screenshot({path:'docs/screenshots/google-sign-in/settings-fixture.png',caret:'initial'});
 await page.locator('.settings-account-action').getByRole('button',{name:'Sign out',exact:true}).click();await expect(page).toHaveURL(/sign-in/);await google(page);await expect(page).toHaveURL(/calendar$/);expect((await (await page.request.get('/api/account')).json()).user.id).toBe(before.id);
 const state=(await (await page.request.get('/api/calendar')).json());expect(state.connection).toBeNull();
});
test('new verified Google account signs up once, stays independent and signs back in',async({page})=>{
 const before=(await database.db.select().from(user)).length;await control({email:signupEmail,subject:'google-new'});await page.goto('/sign-in');await expect(page.getByText('Sign in or create your account with Google.',{exact:true})).toBeVisible();await google(page);await expect(page).toHaveURL(/calendar$/);
 const current=(await (await page.request.get('/api/account')).json()).user;expect(current.email).toBe(signupEmail);expect(current.timezone).toBe('Europe/London');expect(owners).not.toContain(current.id);expect((await database.db.select().from(user)).length).toBe(before+1);
 expect((await page.request.get(`/api/goals/${goalId}`)).status()).toBe(404);expect((await (await page.request.get('/api/calendar')).json()).connection).toBeNull();
 await page.goto('/settings/account');const methods=page.getByRole('region',{name:'Sign-in methods',exact:true});await expect(methods).toContainText(`Connected as ${signupEmail}`);await expect(methods).toContainText('Password');await expect(methods).toContainText('Not available');await expect(methods).toContainText('Your only sign-in method');await expect(methods.getByRole('button',{name:'Unlink Google',exact:true})).toHaveCount(0);
 await page.locator('.settings-account-action').getByRole('button',{name:'Sign out',exact:true}).click();await expect(page).toHaveURL(/sign-in/);await google(page);await expect(page).toHaveURL(/calendar$/);expect((await (await page.request.get('/api/account')).json()).user.id).toBe(current.id);expect((await database.db.select().from(user)).length).toBe(before+1);
});
test('an unverified new Google identity cannot register',async({page})=>{
 const before=(await database.db.select().from(user)).length;await control({email:unverifiedEmail,subject:'unverified-new',verified:false});await page.goto('/sign-in');await google(page);await expect(page).toHaveURL(/sign-in\?error=email_not_verified$/);await expect(page.getByRole('alert')).toContainText('could not verify');expect((await database.db.select().from(user)).length).toBe(before);expect((await page.request.get('/api/account')).status()).toBe(401);
});
test('Settings links and unlinks Google using the existing account; foreign management is refused',async({page})=>{
 await page.context().addCookies(cookies.A);await page.goto('/settings/account');await page.getByRole('button',{name:'Link Google',exact:true}).click();await page.getByRole('link',{name:'Continue with test Google identity',exact:true}).click();await expect(page).toHaveURL(/settings\/account\?google=linked$/);await expect(page.getByRole('status')).toContainText('Google sign-in linked.');
 const linked=(await database.db.select().from(account).where(eq(account.providerId,'google')))[0];await page.context().clearCookies();await page.context().addCookies(cookies.B);
 expect((await page.request.post('/api/auth/unlink-account',{headers:{Origin:origin},data:{accountId:linked.id}})).status()).toBe(403);
 await page.goto('/settings/account');await expect(page.getByRole('region',{name:'Sign-in methods'})).toContainText('Not linked');
 await page.context().clearCookies();await page.context().addCookies(cookies.A);await page.goto('/settings/account');await page.getByRole('button',{name:'Unlink Google',exact:true}).click();await expect(page.getByRole('button',{name:'Link Google',exact:true})).toBeVisible();expect((await (await page.request.get('/api/account')).json()).user.id).toBe(linked.userId);
});
test('wrong-email Google linking cannot take over the signed-in account',async({page})=>{
 await page.context().addCookies(cookies.A);const before=(await (await page.request.get('/api/account')).json()).user;await control({email:process.env.TEST_USER_B_EMAIL,subject:'google-B'});await page.goto('/settings/account');await page.getByRole('button',{name:'Link Google',exact:true}).click();await page.getByRole('link',{name:'Continue with test Google identity',exact:true}).click();await expect(page.getByRole('alert')).toContainText('does not match');expect((await (await page.request.get('/api/account')).json()).user.id).toBe(before.id);
 expect(await database.db.select().from(account).where(eq(account.providerId,'google'))).toEqual([]);
});
test('consent cancellation and provider failure return readable errors without raw internals',async({page})=>{
 await page.goto('/sign-in');await google(page,true);await expect(page).toHaveURL(/sign-in\?error=access_denied$/);await expect(page.getByRole('alert')).toContainText('cancelled');expect(page.url()).not.toContain('PRIVATE_PROVIDER_INTERNAL');
 await control({},'failure');await google(page);await expect(page).toHaveURL(/sign-in\?error=oauth_callback_failed$/);await expect(page.getByRole('alert')).toContainText('could not be completed');await expect(page.getByRole('button',{name:'Sign in',exact:true})).toBeEnabled();expect(await page.locator('body').innerText()).not.toContain('PRIVATE_PROVIDER_INTERNAL');
});
test('Google authentication and Calendar scopes, linking and disconnect remain independent',async({page})=>{
 await page.goto('/sign-in');await google(page);await expect(page).toHaveURL(/calendar$/);const owner=(await (await page.request.get('/api/account')).json()).user.id;
 const before=(await (await page.request.get('/api/calendar')).json());expect(before.connection).toBeNull();
 const stats=await (await fetch(`${process.env.GOOGLE_AUTH_TEST_ORIGIN}/control`)).json();expect(stats.lastAuthorization.scopes).toEqual(['email','openid','profile']);
 await page.goto('/integrations');await page.getByRole('button',{name:'Connect Google Calendar',exact:true}).click();await page.getByRole('link',{name:'Approve test Calendar access',exact:true}).click();const connected=(await (await page.request.get('/api/calendar')).json()).connection;
 const disconnected=await page.request.post(`/api/calendar/${connected.id}/disconnect`,{headers:{Origin:origin},data:{}});expect(disconnected.status()).toBe(200);expect((await (await page.request.get('/api/account')).json()).user.id).toBe(owner);expect((await database.db.select().from(account).where(and(eq(account.userId,owner),eq(account.providerId,'google'))))).toHaveLength(1);
 await page.context().clearCookies();await page.goto('/sign-in');await google(page);await expect(page).toHaveURL(/calendar$/);expect((await (await page.request.get('/api/account')).json()).user.id).toBe(owner);
});
test('the only usable Google sign-in cannot be unlinked and tokens never reach the browser',async({page})=>{
 await page.goto('/sign-in');await google(page);await expect(page).toHaveURL(/calendar$/);const current=(await (await page.request.get('/api/account')).json()).user;
 const googleRow=(await database.db.select().from(account).where(and(eq(account.userId,current.id),eq(account.providerId,'google'))))[0];await database.db.update(account).set({password:null}).where(and(eq(account.userId,current.id),eq(account.providerId,'credential')));
 await page.goto('/settings/account');await expect(page.getByText('Your only sign-in method',{exact:true})).toBeVisible();await expect(page.getByRole('button',{name:'Unlink Google',exact:true})).toHaveCount(0);
 expect((await page.request.post('/api/auth/unlink-account',{headers:{Origin:origin},data:{accountId:googleRow.id}})).status()).toBe(403);
 for(const path of ['get-access-token','refresh-token'])expect((await page.request.post(`/api/auth/${path}`,{headers:{Origin:origin},data:{accountId:googleRow.id}})).status()).toBe(404);
 expect(await (await page.request.get('/api/auth/list-accounts')).text()).not.toMatch(/accessToken|refreshToken|idToken|password|google-access-fixture-secret/);
 await page.setViewportSize({width:390,height:844});await page.reload();expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});
