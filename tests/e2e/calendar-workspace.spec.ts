import {fixtureSignIn} from "./sign-in-helper";
import {test,expect,type Page,type BrowserContext,type Locator} from "@playwright/test";
import {randomUUID} from "node:crypto";
import {mkdir,writeFile} from "node:fs/promises";
import {executionFixture} from "../focus-database";
import {currentWeek} from "../../src/modules/planning/domain";
import {inArray} from "drizzle-orm";
import {connectDatabase} from "../../src/db/connect";
import {weeklyReviewDecision,weeklyReview,dailyReflection,focusSession,timeBlock,commitmentIdentity,weeklyPlan,weeklyCommitment,weeklyPlanAmendment,amendmentCommitment,action,goal,milestone,mutationReceipt,user,focusableHours,calendarAvailabilityCache,calendarOAuthFlow,calendarConnection} from "../../src/db/schema";
import {createAuthentication} from "../../src/server/auth-factory";
import {requireTestDatabaseURL} from "../../scripts/test-database";
import type {WeeklyPlan} from "../../src/modules/planning/domain";
import type {SchedulingView,TimeBlock,PlacementReview} from "../../src/modules/scheduling/domain";
const origin="http://127.0.0.1:3101",week="2028-01-03";let database:ReturnType<typeof connectDatabase>,owners:string[];const cookies:Record<string,Parameters<BrowserContext["addCookies"]>[0]>={};
async function clean(){for(const table of [weeklyReviewDecision,weeklyReview,dailyReflection,focusSession,timeBlock,commitmentIdentity,mutationReceipt,amendmentCommitment,weeklyPlanAmendment,weeklyCommitment,weeklyPlan,action,milestone,goal,focusableHours,calendarAvailabilityCache,calendarOAuthFlow,calendarConnection])await database.db.delete(table).where(inArray(table.ownerId,owners));await database.pool.query("UPDATE app_user SET timezone='Europe/London' WHERE id=ANY($1)",[owners]);}
test.beforeAll(async()=>{test.setTimeout(90000);const target=requireTestDatabaseURL();if(target.name==="execution_test")throw new Error("Requires isolated browser DB");database=connectDatabase(target.url);owners=(await database.db.select({id:user.id}).from(user)).map(v=>v.id);const auth=createAuthentication(database.db,{secret:process.env.BETTER_AUTH_SECRET!,baseURL:origin});for(const suffix of ["A","B"]){const response=await fixtureSignIn(()=>auth.handler(new Request(`${origin}/api/auth/sign-in/email`,{method:"POST",headers:{Origin:origin,"Content-Type":"application/json"},body:JSON.stringify({email:process.env[`TEST_USER_${suffix}_EMAIL`],password:process.env[`TEST_USER_${suffix}_PASSWORD`]})})));expect(response.status).toBe(200);cookies[suffix]=response.headers.getSetCookie().map(v=>{const pair=v.split(";")[0],i=pair.indexOf("=");return {name:pair.slice(0,i),value:pair.slice(i+1),url:origin,httpOnly:true,sameSite:"Lax" as const};});}});
test.beforeEach(async({page})=>{await clean();await fetch(`${process.env.CALENDAR_TEST_ORIGIN}/control`,{method:"POST",body:"{}"});await page.context().addCookies(cookies.A);});test.afterAll(async()=>{await clean();await database.pool.end();});
async function mutate(page:Page,path:string,data:object,method="POST"){const r=await page.request.fetch(path,{method,headers:{Origin:origin},data});expect(r.status(),await r.text()).toBe(200);return r.json();}
async function fixture(page:Page,commit=true,title="Build weekly planning UI",planWeek=week,withHours=true){const g=(await mutate(page,"/api/goals",{mutationId:randomUUID(),title:"Make meaningful progress",outcome:"A calmer week with protected time"})).goal;const act=(await mutate(page,`/api/goals/${g.id}/actions`,{mutationId:randomUUID(),title,estimateMinutes:240,doneWhen:"The planning loop is usable"})).action;const candidate=(await (await page.request.get("/api/weekly-plans/candidates")).json()).candidates.find((c:{actionId:string})=>c.actionId===act.id);let plan:WeeklyPlan=(await mutate(page,"/api/weekly-plans",{mutationId:randomUUID(),weekStartDate:planWeek,provisionalCapacityMinutes:720,reserveMinutes:180})).plan;plan=(await mutate(page,`/api/weekly-plans/${plan.id}`,{mutationId:randomUUID(),expectedVersion:1,provisionalCapacityMinutes:720,reserveMinutes:180,commitments:[{actionId:act.id,budgetMinutes:180,source:candidate.source}]},"PATCH")).plan;if(commit)plan=(await mutate(page,`/api/weekly-plans/${plan.id}/commit`,{mutationId:randomUUID(),expectedVersion:2})).plan;if(withHours)await mutate(page,"/api/focusable-hours",{mutationId:randomUUID(),scheduleId:null,expectedVersion:0,windows:Array.from({length:5},(_,i)=>({weekday:i+1,startMinute:540,endMinute:1020}))},"PUT");return {g,act,plan,url:`/api/weekly-plans/${plan.id}/time-blocks`};}
const read=async(page:Page,url:string):Promise<SchedulingView>=>(await page.request.get(url)).json();
test('dark theme keeps the calendar grid, blocks and hover details readable',async({page})=>{
 await page.addInitScript(()=>localStorage.setItem('one-better-theme','dark'));
 const f=await fixture(page),{block}=await apiCreate(page,f);
 const before=await read(page,f.url);
 await page.goto(`/calendar?week=${week}`);
 await expect(page.locator('html')).toHaveAttribute('data-theme','dark');
 const card=page.locator(`[data-calendar-block="${block.id}"]`);
 await expect(card).toBeVisible();
 const background=await card.evaluate(el=>getComputedStyle(el).backgroundColor);
 expect(Math.max(...background.match(/\d+/g)!.slice(0,3).map(Number))).toBeLessThan(90);
 await card.hover();
 await expect(page.getByRole('tooltip')).toContainText('Build weekly planning UI');
 await page.screenshot({path:'.cache/theme-calendar-dark.png',fullPage:true});
 await card.click();
 await expect(blockRegion(page)).toContainText('The planning loop is usable');
 expect(await read(page,f.url)).toEqual(before);
});
async function apiCreate(page:Page,f:Awaited<ReturnType<typeof fixture>>,date="2028-01-04",startTime="10:00",endTime="11:30"){const input={commitmentId:(await read(page,f.url)).commitments[0].id,date,startTime,endTime},r:PlacementReview=await mutate(page,`${f.url}/preview`,input);const command={...input,mutationId:randomUUID(),expectedPlanVersion:r.planVersion,reviewKey:r.reviewKey,acknowledgeOutsideHours:r.outsideHours,acknowledgeBusy:!!r.busyConflict};return {block:(await mutate(page,f.url,command)).block as TimeBlock,command};}
async function choose(page:Page,date='2028-01-04',start='10:00',end='11:30') {await page.getByLabel('Day',{exact:true}).fill(date);await page.getByLabel('Start time',{exact:true}).fill(start);await page.getByLabel('End time',{exact:true}).fill(end);await page.getByRole('button',{name:'Review placement',exact:true}).click();}
async function connect(page:Page){await page.goto('/integrations');await page.getByRole('button',{name:'Connect Google Calendar',exact:true}).click();await page.getByRole('link',{name:'Approve test Calendar access'}).click();await page.getByRole('checkbox',{name:/^Work/}).check();await page.getByRole('button',{name:'Save calendar selection'}).click();await expect(page.getByText('Calendar selection saved. Weekly planning stays unchanged.')).toBeVisible();return (await (await page.request.get('/api/calendar')).json()).connection.id as string;}
const blockRegion=(page:Page)=>page.getByRole('region',{name:'Selected time block',exact:true});
// Compare against visible local slot boundaries, independent of the renderer's DOM positioning strategy.
async function assertPlacement(page:Page,card:Locator,start:string,end:string){
 const slot=(time:string)=>page.locator(`[data-slot-time="${time}:00"]`).first();
 await expect(card).toBeVisible();await expect(slot(start)).toBeAttached();
 const box=await card.boundingBox(),lo=await slot(start).boundingBox(),hi=await slot(end).boundingBox();
 expect(box).not.toBeNull();expect(lo).not.toBeNull();expect(hi).not.toBeNull();
 expect(Math.abs(box!.y-lo!.y)).toBeLessThan(4);
 expect(Math.abs(box!.height-(hi!.y-lo!.y))).toBeLessThan(4);
}

test('calendar is home; legacy Goals bookmarks, Settings and week controls remain usable',async({page})=>{await page.goto('/');await expect(page).toHaveURL(/\/calendar$/);await expect(page.getByRole('region',{name:'Week calendar',exact:true})).toBeVisible();await expect(page.getByRole('heading',{name:'What’s one thing to move forward this week?',exact:true})).toBeVisible();await expect(page.getByText('Connect Calendar to see busy time alongside your plan.')).toBeVisible();await page.goto('/?view=archived');await expect(page).toHaveURL(/\/goals\?view=archived$/);await page.getByRole('navigation',{name:'Main navigation'}).getByRole('link',{name:'Calendar',exact:true}).click();await page.locator('.settings-menu summary').click();await page.getByRole('link',{name:'Availability',exact:true}).click();await expect(page).toHaveURL(/\/availability$/);await page.goto(`/calendar?week=${week}`);await page.getByRole('link',{name:'Next week',exact:true}).click();await expect(page).toHaveURL(/week=2028-01-10$/);await page.getByRole('link',{name:'Previous week',exact:true}).click();await expect(page).toHaveURL(/week=2028-01-03$/);await page.getByRole('link',{name:'Current week',exact:true}).click();await expect(page.getByRole('region',{name:'Week calendar',exact:true})).toBeVisible();});
test('frozen work, effective capacity, Focusable Hours, local coordinates and keyboard selection',async({page})=>{const f=await fixture(page),{block}=await apiCreate(page,f);await mutate(page,`/api/weekly-plans/${f.plan.id}/amendments`,{mutationId:randomUUID(),expectedVersion:3,provisionalCapacityMinutes:660,reserveMinutes:120,reason:'Keep capacity realistic',commitments:[{actionId:f.act.id,budgetMinutes:150}]});await page.goto(`/calendar?week=${week}`);const rail=page.getByRole('region',{name:'Work for this week'});await expect(rail).toContainText(f.g.title);await expect(rail.getByRole('button',{name:`Schedule ${f.act.title}`,exact:true})).toHaveText('+ Schedule 1h');const facts=page.getByRole('region',{name:'Week summary'});await expect(facts).toContainText('1h still to place');await expect(facts).not.toContainText('capacity');await expect(page.getByRole('img',{name:/Focusable Hours Tuesday/})).toBeVisible();const card=page.locator(`[data-calendar-block="${block.id}"]`);await assertPlacement(page,card,'10:00','11:30');await expect(card).toBeInViewport();await card.focus();await page.keyboard.press('Enter');await expect(blockRegion(page)).toContainText('The planning loop is usable');await expect(blockRegion(page)).toContainText('Block duration1h 30m');await expect(blockRegion(page)).toContainText('Recorded focus0m');await expect(blockRegion(page).getByRole('link',{name:/Start focus/})).toHaveCount(0);});
test('create, reschedule and cancel reuse guarded commands and retain the immutable baseline',async({page})=>{const f=await fixture(page);const before=(await (await page.request.get(`/api/weekly-plans/${f.plan.id}/amendments`)).json()).baseline;await page.goto(`/calendar?week=${week}`);await page.getByRole('region',{name:'Work for this week'}).getByRole('button',{name:/Schedule/}).click();await expect(page.getByLabel('Day',{exact:true})).toBeFocused();await choose(page);await page.getByRole('dialog').getByRole('button',{name:'Schedule block',exact:true}).click();await expect(page.getByRole('dialog')).toHaveCount(0);await expect(page.locator('[data-calendar-block]')).toHaveCount(1);await expect(blockRegion(page)).toContainText('1h 30m');await blockRegion(page).getByRole('button',{name:'Reschedule',exact:true}).click();await choose(page,'2028-01-04','13:00','14:00');await page.getByRole('button',{name:'Save new times',exact:true}).click();await expect(page.getByRole('dialog')).toHaveCount(0);await assertPlacement(page,page.locator('[data-calendar-block]'),'13:00','14:00');await blockRegion(page).getByRole('button',{name:'Cancel block',exact:true}).click();await page.getByRole('dialog').getByRole('button',{name:'Cancel block',exact:true}).click();await expect(page.locator('[data-calendar-block]')).toHaveCount(0);await expect(page.locator('.calendar-cancelled-history summary')).toContainText('1');await page.reload();expect((await read(page,f.url)).blocks[0]).toMatchObject({state:'cancelled',version:3});expect((await (await page.request.get(`/api/weekly-plans/${f.plan.id}/amendments`)).json()).baseline).toEqual(before);});
test('Google busy is distinct context; stale and unavailable never hide local blocks',async({page})=>{const f=await fixture(page),{block}=await apiCreate(page,f),id=await connect(page);await mutate(page,`/api/calendar/${id}/availability`,{weekStartDate:week});await page.goto(`/calendar?week=${week}`);await expect(page.getByRole('img',{name:/Google busy/}).first()).toBeVisible();await page.locator(`[data-calendar-block="${block.id}"]`).click();await expect(blockRegion(page)).toContainText('Overlaps known Google busy time.');await database.pool.query("UPDATE calendar_availability_cache SET last_error='incomplete' WHERE connection_id=$1",[id]);await page.reload();await expect(page.getByText('Stale · last fetched timing',{exact:true})).toBeVisible();await expect(page.locator('.busy-interval').first()).toHaveClass(/is-stale/);await database.pool.query('DELETE FROM calendar_availability_cache WHERE connection_id=$1',[id]);await page.reload();await expect(page.getByText('Google timing unavailable',{exact:true})).toBeVisible();await expect(page.locator('[data-calendar-block]')).toHaveCount(1);await expect(page.locator('.busy-interval')).toHaveCount(0);await page.route(`**/api/calendar/${id}/availability`,async route=>{await route.fetch();await mutate(page,`/api/calendar/${id}/disconnect`,{});await route.fulfill({status:409,contentType:'application/json',body:JSON.stringify({error:{code:'CONFLICT',message:'Calendar changed while refreshing'}})});});await page.getByRole('button',{name:'Refresh Calendar context',exact:true}).click();await expect(page.getByText('Connect Calendar to see busy time alongside your plan.')).toBeVisible();await expect(page.locator('.busy-interval')).toHaveCount(0);await expect(page.locator('[data-calendar-block]')).toHaveCount(1);});
test('removed lineage retains review-required details, outside-hours warning and guarded actions',async({page})=>{const f=await fixture(page),{block}=await apiCreate(page,f,'2028-01-04','07:00','08:00');await mutate(page,`/api/weekly-plans/${f.plan.id}/amendments`,{mutationId:randomUUID(),expectedVersion:3,provisionalCapacityMinutes:720,reserveMinutes:180,reason:'Deliberately remove work',commitments:[]});await page.goto(`/calendar?week=${week}`);await expect(page.locator('[data-calendar-commitment]')).toHaveCount(0);await page.locator(`[data-calendar-block="${block.id}"]`).click();await expect(blockRegion(page)).toContainText('Review required');await expect(blockRegion(page)).toContainText('Outside current Focusable Hours.');await expect(blockRegion(page).getByRole('button',{name:'Reschedule'})).toHaveCount(0);await expect(blockRegion(page).getByRole('link',{name:/Start focus/})).toHaveCount(0);await expect(blockRegion(page).getByRole('button',{name:'Cancel block'})).toBeVisible();});
test('responsive day calendar, long work title and keyboard editor without horizontal overflow',async({page})=>{const longTitle='A deliberately long action title that keeps its meaning when the calendar is narrow and work is complex',f=await fixture(page,true,longTitle);await apiCreate(page,f);await mutate(page,`/api/actions/${f.act.id}`,{mutationId:randomUUID(),expectedVersion:1,title:'Changed live Action title',estimateMinutes:240,doneWhen:'Changed live condition'},'PATCH');for(const width of [1440,1024,390]){await page.setViewportSize({width,height:900});await page.goto(`/calendar?week=${week}`);if(width===390){await expect(page.locator('.work-disclosure')).not.toHaveAttribute('open','');await page.getByRole('group',{name:'Choose calendar day'}).getByRole('button',{name:/Tue/}).click();}await expect(page.locator('[data-calendar-block]')).toBeVisible();expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await page.locator('[data-calendar-block]').focus();await page.keyboard.press('Enter');await expect(blockRegion(page)).toBeVisible();await expect(blockRegion(page).getByRole('heading',{name:longTitle,exact:true})).toBeVisible();if(width===390)await expect(blockRegion(page).getByRole('heading')).toBeFocused();}await blockRegion(page).getByRole('button',{name:'Reschedule'}).click();await page.keyboard.press('Escape');await expect(blockRegion(page).getByRole('button',{name:'Reschedule'})).toBeFocused();});

test('selected eligible block links to Focus without starting execution until the user acts',async({page})=>{const owner=(await database.db.select().from(user)).find(v=>v.email===process.env.TEST_USER_A_EMAIL)!;const realNow=new Date().toISOString(),f=await executionFixture(database.db,{userId:owner.id},currentWeek(realNow,"Europe/London"),()=>"2026-09-25T12:00:00.000Z");await writeFile(process.env.EXECUTION_TEST_CLOCK_FILE!,realNow);try{await page.goto(`/calendar?week=${f.plan.weekStartDate}`);await page.locator(`[data-calendar-block="${f.block.id}"]`).click();await blockRegion(page).getByRole('link',{name:/Start focus/}).click();await expect(page).toHaveURL(new RegExp(`/focus\\?block=${f.block.id}$`));expect((await (await page.request.get('/api/focus')).json()).active).toBeNull();await page.locator(`[data-focus-block="${f.block.id}"]`).getByRole('button',{name:'Start focus',exact:true}).click();await expect(page.locator('[data-active-session]')).toBeVisible();expect((await (await page.request.get('/api/focus')).json()).active.session.timeBlockId).toBe(f.block.id);}finally{await writeFile(process.env.EXECUTION_TEST_CLOCK_FILE!,new Date().toISOString());}});

test('quick focus is visible without selection, recovers the active session and never starts on navigation',async({page})=>{
 const owner=(await database.db.select().from(user)).find(v=>v.email===process.env.TEST_USER_A_EMAIL)!;
 const realNow=new Date().toISOString(),planWeek=currentWeek(realNow,'Europe/London'),f=await executionFixture(database.db,{userId:owner.id},planWeek,()=>`${planWeek}T00:00:00.000Z`);
 await writeFile(process.env.EXECUTION_TEST_CLOCK_FILE!,realNow);
 try {
  await page.goto(`/calendar?week=${planWeek}`);
  const widget=page.getByRole('region',{name:'Quick focus',exact:true});await expect(widget).toBeVisible();
  expect((await (await page.request.get('/api/focus')).json()).active).toBeNull();
  const before=await read(page,`/api/weekly-plans/${f.plan.id}/time-blocks`);
  const session=await mutate(page,`/api/time-blocks/${f.block.id}/focus-sessions`,{mutationId:randomUUID(),expectedBlockVersion:f.block.version,acknowledgeRemoved:false});
  await page.getByRole('button',{name:'Refresh workspace',exact:true}).click();
  await expect(widget).toContainText('In focus');await expect(widget).toContainText(f.action.title);
  await expect(widget.getByRole('link',{name:'Continue focus →',exact:true})).toHaveAttribute('href',`/focus?block=${f.block.id}`);
  await expect(widget.getByRole('link',{name:/Start focus/})).toHaveCount(0);
  await page.reload();await expect(widget).toContainText('In focus');
  await widget.getByRole('button',{name:'View block details →',exact:true}).click();
  await expect(blockRegion(page).getByRole('link',{name:'Continue current focus →',exact:true})).toBeVisible();
  await expect(blockRegion(page).getByRole('link',{name:/Start focus/})).toHaveCount(0);
  await blockRegion(page).getByRole('button',{name:'Close block details',exact:true}).click();await expect(widget).toContainText('In focus');
  expect((await (await page.request.get('/api/focus')).json()).active.session.id).toBe(session.session.id);
  expect((await read(page,`/api/weekly-plans/${f.plan.id}/time-blocks`)).blocks.map(({start,end})=>({start,end}))).toEqual(before.blocks.map(({start,end})=>({start,end})));
  await widget.getByRole('link',{name:'Continue focus →',exact:true}).click();await expect(page.locator('[data-active-session]')).toBeVisible();
  await page.setViewportSize({width:390,height:844});await page.goto(`/calendar?week=${planWeek}`);await expect(widget).toBeVisible();expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 } finally {await writeFile(process.env.EXECUTION_TEST_CLOCK_FILE!,new Date().toISOString());}
});


test('Week and Day controls preserve selection; weekend scheduling remains visible',async({page})=>{
 const f=await fixture(page),{block}=await apiCreate(page,f);await page.goto(`/calendar?week=${week}`);
 await expect(page.locator('[data-calendar-date]')).toHaveCount(5);
 await page.getByRole('button',{name:'Show weekends',exact:true}).click();await expect(page.locator('[data-calendar-date]')).toHaveCount(7);
 await page.getByRole('button',{name:'Hide weekends',exact:true}).click();await expect(page.locator('[data-calendar-date]')).toHaveCount(5);
 await page.getByRole('group',{name:'Calendar view'}).getByRole('button',{name:'Day',exact:true}).click();
 await page.getByRole('group',{name:'Choose calendar day'}).getByRole('button',{name:/Tue/}).click();
 const card=page.locator(`[data-calendar-block="${block.id}"]`);await expect(card).toBeInViewport();await card.press('Space');
 await expect(card).toHaveAttribute('aria-pressed','true');await expect(blockRegion(page)).toContainText(f.act.title);
 await page.getByRole('button',{name:'Close block details',exact:true}).click();await expect(card).toHaveAttribute('aria-pressed','false');
 await page.getByRole('group',{name:'Calendar view'}).getByRole('button',{name:'Week',exact:true}).click();
 await page.getByRole('button',{name:'+ Time block',exact:true}).click();await choose(page,'2028-01-08','10:00','11:00');
 await expect(page.getByRole('checkbox',{name:/outside Focusable Hours/i})).toHaveCount(0);await expect(page.locator('.outside-hours-tag')).toHaveText('Outside Focusable Hours');await page.getByRole('button',{name:'Schedule block',exact:true}).click();
 await expect(page.getByRole('dialog')).toHaveCount(0);await expect(page.locator('[data-calendar-date]')).toHaveCount(7);await expect(page.locator('[data-calendar-block]')).toHaveCount(2);
 await page.reload();await expect(page.locator('[data-calendar-date]')).toHaveCount(7);await expect(page.locator('[data-calendar-block]')).toHaveCount(2);
});

test('work chooser and empty-slot prefill require review before saving and retain the baseline',async({page})=>{
 const f=await fixture(page);await apiCreate(page,f);
 const second=(await mutate(page,`/api/goals/${f.g.id}/actions`,{mutationId:randomUUID(),title:'Prepare the release notes',estimateMinutes:60,doneWhen:'A readable draft'})).action;
 const source=(await (await page.request.get('/api/weekly-plans/candidates')).json()).candidates.find((c:{actionId:string})=>c.actionId===second.id).source;
 await mutate(page,`/api/weekly-plans/${f.plan.id}/amendments`,{mutationId:randomUUID(),expectedVersion:3,provisionalCapacityMinutes:720,reserveMinutes:180,reason:'Add a deliberate release commitment',commitments:[{actionId:f.act.id,budgetMinutes:180},{actionId:second.id,budgetMinutes:60,source}]});
 const before=(await (await page.request.get(`/api/weekly-plans/${f.plan.id}/amendments`)).json()).baseline;
 await page.goto(`/calendar?week=${week}`);await page.getByRole('button',{name:'+ Time block',exact:true}).click();
 await expect(page.getByRole('dialog',{name:'Make room for…'})).toBeVisible();await page.keyboard.press('Escape');await expect(page.getByRole('button',{name:'+ Time block',exact:true})).toBeFocused();
 const lane=await page.locator('[data-calendar-date="2028-01-05"]').boundingBox(),slot=await page.locator('[data-slot-time="10:00:00"]').first().boundingBox();
 await page.mouse.click(lane!.x+lane!.width/2,slot!.y+5);
 await expect(page.getByRole('dialog',{name:'Schedule time block'})).toBeVisible();await page.getByLabel('Work to schedule',{exact:true}).selectOption({label:`Prepare the release notes · ${f.g.title}`});
 await expect(page.getByLabel('Day',{exact:true})).toHaveValue('2028-01-05');await expect(page.getByLabel('Start time',{exact:true})).toHaveValue('10:00');await expect(page.getByLabel('End time',{exact:true})).toHaveValue('11:00');
 await expect(page.getByRole('button',{name:'Schedule block',exact:true})).toHaveCount(0);expect((await read(page,f.url)).blocks).toHaveLength(1);
 await page.getByRole('button',{name:'Review placement',exact:true}).click();expect((await read(page,f.url)).blocks).toHaveLength(1);
 await page.getByLabel('Work to schedule',{exact:true}).selectOption({label:`${f.act.title} · ${f.g.title}`});await expect(page.getByRole('button',{name:'Schedule block',exact:true})).toHaveCount(0);await expect(page.getByLabel('Start time',{exact:true})).toHaveValue('10:00');await page.getByLabel('Work to schedule',{exact:true}).selectOption({label:`Prepare the release notes · ${f.g.title}`});await page.getByRole('button',{name:'Review placement',exact:true}).click();
 await page.getByRole('button',{name:'Schedule block',exact:true}).click();await expect(page.getByRole('dialog')).toHaveCount(0);
 await expect(page.locator('[data-calendar-block]')).toHaveCount(2);expect((await read(page,f.url)).blocks.find(b=>b.snapshot.action.id===second.id)).toMatchObject({start:'2028-01-05T10:00:00.000Z',end:'2028-01-05T11:00:00.000Z'});
 expect((await (await page.request.get(`/api/weekly-plans/${f.plan.id}/amendments`)).json()).baseline).toEqual(before);
});

test('calendar uses the plan timezone when browser and current availability zones differ',async({page,browser})=>{
 const f=await fixture(page),{block}=await apiCreate(page,f);
 await database.pool.query("UPDATE app_user SET timezone='America/New_York' WHERE email=$1",[process.env.TEST_USER_A_EMAIL]);
 const context=await browser.newContext({timezoneId:'Asia/Tokyo',viewport:{width:1440,height:960}});await context.addCookies(cookies.A);
 try{const foreignPage=await context.newPage();await foreignPage.goto(`${origin}/calendar?week=${week}`);
 await expect(foreignPage.getByText('Schedule uses Europe/London; current availability uses America/New_York.',{exact:true})).toBeVisible();
 const card=foreignPage.locator(`[data-calendar-block="${block.id}"]`);await assertPlacement(foreignPage,card,'10:00','11:30');await expect(card).toBeInViewport();
 await card.click();await expect(blockRegion(foreignPage)).toContainText('10:00 GMT+0 – 11:30 GMT+0');await expect(blockRegion(foreignPage)).toContainText('Outside current Focusable Hours.');
 }finally{await context.close();}
});


test('clock-change weeks keep authoritative offsets and elapsed duration in block details',async({page})=>{
 for(const c of [{week:'2028-03-20',date:'2028-03-26',start:'01:15',end:'03:00',duration:'45m',label:'02:15 GMT+1 – 03:00 GMT+1'},{week:'2028-10-23',date:'2028-10-29',start:'01:30',end:'02:30',duration:'2h',label:'01:30 GMT+1 – 02:30 GMT+0'}]){
  await clean();const f=await fixture(page,true,'Protect time through a clock change',c.week),{block}=await apiCreate(page,f,c.date,c.start,c.end);
  await page.goto(`/calendar?week=${c.week}`);await expect(page.getByText('Clock change',{exact:true})).toBeVisible();
  await page.locator(`[data-calendar-block="${block.id}"]`).click();await expect(blockRegion(page)).toContainText(c.label);await expect(blockRegion(page)).toContainText(`Block duration${c.duration}`);
  expect((await read(page,f.url)).blocks[0].start).toBe(block.start);expect((await read(page,f.url)).blocks[0].end).toBe(block.end);
 }
});

test('R6A shared date zoom, correct navigation units and Today at every zoom',async({page})=>{
 await page.goto('/calendar?view=month&date=2028-01-12');await expect(page.getByRole('heading',{name:'January 2028',exact:true})).toBeVisible();await expect(page.locator('.month-cell')).toHaveCount(42);await expect(page.locator('[data-month-block]')).toHaveCount(0);
 for(const target of ['Week','Day','Month']){await page.getByRole('group',{name:'Calendar view'}).getByRole('button',{name:target,exact:true}).click();await expect(page).toHaveURL(new RegExp(`view=${target.toLowerCase()}&date=2028-01-12$`));}
 await page.getByRole('button',{name:'Next month',exact:true}).click();await expect(page).toHaveURL(/date=2028-02-12$/);await page.getByRole('button',{name:'Previous month',exact:true}).click();
 await page.getByRole('button',{name:'Select Thursday 13 January',exact:true}).click();await expect(page.getByRole('region',{name:'Selected day'})).toContainText('Thursday 13 January');await page.getByRole('button',{name:'View day →',exact:true}).click();await expect(page.getByRole('region',{name:'Day calendar',exact:true})).toBeVisible();await page.getByRole('button',{name:'Next day',exact:true}).click();await expect(page).toHaveURL(/date=2028-01-14$/);await page.getByRole('button',{name:'Previous day',exact:true}).click();
 await page.getByRole('group',{name:'Calendar view'}).getByRole('button',{name:'Week',exact:true}).click();await expect(page.getByRole('heading',{name:'10 Jan – 16 Jan',exact:true})).toBeVisible();await page.getByRole('button',{name:'Next week',exact:true}).click();await expect(page).toHaveURL(/date=2028-01-20$/);await page.getByRole('button',{name:'Previous week',exact:true}).click();
 for(const zoom of ['Month','Week','Day']){await page.getByRole('group',{name:'Calendar view'}).getByRole('button',{name:zoom,exact:true}).click();await page.getByRole('button',{name:'Today',exact:true}).click();const today=new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/London',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());await expect(page).toHaveURL(new RegExp(`view=${zoom.toLowerCase()}&date=${today}$`));}
});
test('R6A Month cross-plan details, overflow, guarded creation and owner isolation',async({page})=>{
 await page.setViewportSize({width:1440,height:1000});
 const f=await fixture(page),second=await fixture(page,true,'Work from a different weekly plan','2028-01-10',false);const x=(await apiCreate(page,f)).block,y=(await apiCreate(page,second,'2028-01-11')).block;
 for(const [start,end] of [['12:00','13:00'],['13:00','14:00'],['14:00','15:00'],['15:00','16:00']])await apiCreate(page,f,'2028-01-04',start,end);
 await page.goto('/calendar?view=month&date=2028-01-04');await expect(page.locator('[data-month-block]')).toHaveCount(3);await expect(page.getByRole('button',{name:'+3 more',exact:true})).toBeVisible();await page.locator(`[data-month-block="${y.id}"]`).focus();await page.keyboard.press('Enter');await expect(blockRegion(page)).toContainText('Originating week 2028-01-10');await expect(blockRegion(page)).toContainText('Work from a different weekly plan');await expect(blockRegion(page)).toContainText('Recorded focus0m');await blockRegion(page).getByRole('button',{name:'Reschedule',exact:true}).click();await choose(page,'2028-01-11','13:00','14:00');await page.getByRole('button',{name:'Save new times',exact:true}).click();await expect(page.getByRole('dialog')).toHaveCount(0);expect((await read(page,second.url)).blocks[0].start).toBe('2028-01-11T13:00:00.000Z');
 await page.getByRole('button',{name:'Close block details'}).click();await page.getByRole('button',{name:'+ Time block',exact:true}).click();await choose(page,'2028-01-05','10:00','11:00');await page.getByRole('button',{name:'Schedule block',exact:true}).click();await expect(page.locator('[data-month-block]')).toHaveCount(4);expect((await read(page,f.url)).blocks).toHaveLength(6);expect((await read(page,second.url)).blocks).toHaveLength(1);
 const day=page.getByRole('region',{name:'Tuesday 4 January',exact:true});await day.getByRole('button',{name:'+3 more',exact:true}).click();await expect(page.locator('[data-calendar-block]')).toHaveCount(5);await assertPlacement(page,page.locator(`[data-calendar-block="${x.id}"]`),'10:00','11:30');
 await page.context().clearCookies();await page.context().addCookies(cookies.B);await page.goto('/calendar?view=month&date=2028-01-04');await expect(page.locator('[data-month-block]')).toHaveCount(0);expect((await (await page.request.get('/api/calendar/projection?view=month&date=2028-01-04')).json()).blocks).toEqual([]);expect((await page.request.get(second.url)).status()).toBe(404);
});
test('R6A Day layers, stale context and no Google connection retain exact local blocks',async({page})=>{
 const f=await fixture(page),{block}=await apiCreate(page,f),id=await connect(page);await mutate(page,`/api/calendar/${id}/availability`,{weekStartDate:week});await page.goto('/calendar?view=day&date=2028-01-04');await assertPlacement(page,page.locator(`[data-calendar-block="${block.id}"]`),'10:00','11:30');await expect(page.getByRole('img',{name:/Focusable Hours Tuesday/})).toBeVisible();await expect(page.getByRole('img',{name:/Google busy Tuesday/})).toBeVisible();await expect(page.getByRole('region',{name:'Day context'})).toContainText('1h 30m scheduled');await expect(page.locator('.calendar-now')).toHaveCount(0);
 await database.pool.query("UPDATE calendar_availability_cache SET last_error='incomplete' WHERE connection_id=$1",[id]);await page.reload();await expect(page.locator('.busy-interval').first()).toHaveClass(/is-stale/);await expect(page.locator('[data-calendar-block]')).toHaveCount(1);await page.goto('/calendar?view=month&date=2028-01-04');await expect(page.locator('.busy-interval')).toHaveCount(0);await expect(page.getByText(/open focus time/)).toHaveCount(0);await mutate(page,`/api/calendar/${id}/disconnect`,{});await page.goto('/calendar?view=day&date=2028-01-04');await expect(page.locator('.busy-interval')).toHaveCount(0);await expect(page.locator('[data-calendar-block]')).toHaveCount(1);
});
test('R6A Day Start Focus uses existing mode; current-time indicator follows local Today',async({page})=>{
 const owner=(await database.db.select().from(user)).find(v=>v.email===process.env.TEST_USER_A_EMAIL)!;const realNow=new Date().toISOString(),local=new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/London',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date()),f=await executionFixture(database.db,{userId:owner.id},currentWeek(realNow,'Europe/London'),()=>`${currentWeek(realNow,'Europe/London')}T00:00:00Z`);
 await writeFile(process.env.EXECUTION_TEST_CLOCK_FILE!,realNow);await page.goto(`/calendar?view=day&date=${local}`);await expect(page.locator('.calendar-now')).toHaveCount(1);await page.goto(`/calendar?view=day&date=${f.block.start.slice(0,10)}`);const card=page.locator(`[data-calendar-block="${f.block.id}"]`);await expect(card.getByRole('link',{name:'▶ Start focus',exact:true})).toBeInViewport();await card.getByRole('link',{name:'▶ Start focus',exact:true}).click();await expect(page).toHaveURL(`${origin}/focus?block=${f.block.id}`);expect((await (await page.request.get('/api/focus')).json()).active).toBeNull();await page.locator(`[data-focus-block="${f.block.id}"]`).getByRole('button',{name:'Start focus',exact:true}).click();await expect(page.locator('[data-active-session]')).toBeVisible();
});
test('R6A manual QA capture: desktop/mobile Month Week Day, long titles and dense days',async({page})=>{
 const f=await fixture(page,true,'A deliberately long Action: prepare the launch and finish the important documentation'),second=await fixture(page,true,'A separate week: protect the follow-up','2028-01-10',false);await apiCreate(page,f);await apiCreate(page,second,'2028-01-11');for(const [start,end] of [['12:00','13:00'],['13:00','14:00'],['14:00','15:00']])await apiCreate(page,f,'2028-01-04',start,end);
 await page.setViewportSize({width:1440,height:1000});for(const view of ['month','week','day']){await page.goto(`/calendar?view=${view}&date=2028-01-04`);await expect(page.locator(view==='month'?'[data-month-block]':'[data-calendar-block]').first()).toBeVisible();expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);if(view==='month'){await expect(page.locator('.month-cell').last()).toBeInViewport();await expect(page.getByRole('button',{name:'+2 more',exact:true})).toBeInViewport();}await page.screenshot({path:`docs/r6a-evidence/desktop-${view}.png`});}
 await page.setViewportSize({width:1280,height:720});await page.goto('/calendar?view=month&date=2028-01-04');await expect(page.getByRole('button',{name:'+3 more',exact:true})).toBeInViewport();await expect(page.locator('.month-cell').last()).toBeInViewport();
 await page.setViewportSize({width:390,height:844});await page.goto('/calendar?view=month&date=2028-01-04');await expect(page.getByRole('button',{name:'+3 more',exact:true})).toBeVisible();await page.screenshot({path:'docs/r6a-evidence/mobile-month.png'});await page.getByRole('button',{name:'View day →',exact:true}).click();await expect(page.locator('[data-calendar-block]')).toHaveCount(4);expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await page.screenshot({path:'docs/r6a-evidence/mobile-day.png'});
 await page.goto('/calendar?view=day&date=2026-10-25');await expect(page.getByText('Clock change',{exact:true})).toBeVisible();await page.goto('/calendar?view=month&date=2026-03-29');await expect(page.locator('.month-cell')).toHaveCount(42);await expect(page.locator('[data-month-block]')).toHaveCount(0);await page.screenshot({path:'docs/r6a-evidence/empty-month.png'});
});

test('R6A Month and Day use user-local dates after a timezone change while legacy Week stays pinned',async({page,browser})=>{
 const f=await fixture(page),morning=(await apiCreate(page,f)).block,midnight=(await apiCreate(page,f,'2028-01-04','00:30','01:30')).block;
 await database.pool.query("UPDATE app_user SET timezone='America/New_York' WHERE email=$1",[process.env.TEST_USER_A_EMAIL]);
 const context=await browser.newContext({timezoneId:'Asia/Tokyo',viewport:{width:1440,height:1000}});await context.addCookies(cookies.A);
 try{const foreign=await context.newPage();await foreign.goto(`${origin}/calendar?view=month&date=2028-01-03`);await expect(foreign.getByRole('region',{name:'Monday 3 January',exact:true}).locator(`[data-month-block="${midnight.id}"]`)).toHaveCount(1);await expect(foreign.getByText('Local schedule · America/New_York',{exact:true})).toBeVisible();
 await foreign.getByRole('button',{name:'View day →',exact:true}).click();await expect(foreign.locator(`[data-calendar-block="${midnight.id}"]`)).toBeVisible();await assertPlacement(foreign,foreign.locator(`[data-calendar-block="${midnight.id}"]`),'19:30','20:30');await foreign.locator(`[data-calendar-block="${midnight.id}"]`).click();await expect(blockRegion(foreign)).toContainText('19:30 GMT-5 – 20:30 GMT-5');await expect(blockRegion(foreign)).toContainText('Times entered in Europe/London');
 await foreign.goto(`${origin}/calendar?view=day&date=2028-01-04`);await assertPlacement(foreign,foreign.locator(`[data-calendar-block="${morning.id}"]`),'05:00','06:30');
 }finally{await context.close();}
});


test('short blocks expose full hover and keyboard details; empty space previews one click creation',async({page})=>{
 const title='Prepare a clear release plan with the team',f=await fixture(page,true,title),{block}=await apiCreate(page,f,'2028-01-04','10:00','10:30');
 await page.setViewportSize({width:1440,height:960});await page.goto(`/calendar?week=${week}`);
 const card=page.locator(`[data-calendar-block="${block.id}"]`),tooltip=page.getByRole('tooltip');
 await card.hover();await expect(tooltip).toContainText(title);await expect(tooltip).toContainText(f.g.title);await expect(tooltip).toContainText('10:00 GMT');await expect(tooltip).toContainText('10:30 GMT');await expect(tooltip).toContainText('The planning loop is usable');
 await expect(card).toHaveAttribute('aria-describedby',await tooltip.getAttribute('id')??'');await expect(page.locator('[data-placement-preview]')).toHaveCount(0);
 await mkdir('docs/screenshots/calendar-hover',{recursive:true});await page.screenshot({path:'docs/screenshots/calendar-hover/block-details.png',caret:'initial'});
 await page.mouse.move(10,10);await expect(tooltip).toHaveCount(0);await card.focus();await expect(tooltip).toBeVisible();await page.keyboard.press('Escape');await expect(tooltip).toHaveCount(0);
 const lane=await page.locator('[data-calendar-date="2028-01-05"]').boundingBox(),slot=await page.locator('[data-slot-time="10:00:00"]').first().boundingBox();
 await page.mouse.move(lane!.x+lane!.width/2,slot!.y+8);const ghost=page.locator('[data-placement-preview]');await expect(ghost).toContainText('10:00–11:00');await expect(ghost).toContainText('+ Time block');
 const box=await ghost.boundingBox(),end=await page.locator('[data-slot-time="11:00:00"]').first().boundingBox();expect(Math.abs(box!.height-(end!.y-slot!.y))).toBeLessThan(4);
 await page.screenshot({path:'docs/screenshots/calendar-hover/empty-slot.png',caret:'initial'});
 await page.mouse.click(lane!.x+lane!.width/2,slot!.y+8);await expect(page.getByRole('dialog',{name:'Schedule time block'})).toBeVisible();await expect(ghost).toHaveCount(0);
 await expect(page.getByLabel('Day',{exact:true})).toHaveValue('2028-01-05');await expect(page.getByLabel('Start time',{exact:true})).toHaveValue('10:00');await expect(page.getByLabel('End time',{exact:true})).toHaveValue('11:00');expect((await read(page,f.url)).blocks).toHaveLength(1);
 await page.keyboard.press('Escape');await expect(page.getByRole('button',{name:'+ Time block',exact:true})).toBeFocused();
 await page.getByRole('link',{name:'Next week',exact:true}).click();await expect(page.locator('[data-calendar-date="2028-01-10"]')).toBeAttached();const nextLane=await page.locator('[data-calendar-date="2028-01-10"]').boundingBox(),nextSlot=await page.locator('[data-slot-time="10:00:00"]').first().boundingBox();await page.mouse.move(nextLane!.x+nextLane!.width/2,nextSlot!.y+8);await expect(ghost).toHaveCount(0);
});


test('Day hover creates the clicked instant when the account and committed plan zones differ',async({page})=>{
 const f=await fixture(page);await apiCreate(page,f);
 await database.pool.query("UPDATE app_user SET timezone='America/New_York' WHERE email=$1",[process.env.TEST_USER_A_EMAIL]);
 await page.goto('/calendar?view=day&date=2028-01-04');await expect(page.getByRole('region',{name:'Day calendar',exact:true})).toContainText('America/New_York');
 const lane=await page.locator('[data-calendar-date="2028-01-04"]').boundingBox(),slot=await page.locator('[data-slot-time="10:00:00"]').first().boundingBox();
 await page.mouse.move(lane!.x+lane!.width/2,slot!.y+8);await expect(page.locator('[data-placement-preview]')).toContainText('10:00–11:00');await page.mouse.click(lane!.x+lane!.width/2,slot!.y+8);
 await expect(page.getByRole('dialog',{name:'Schedule time block'})).toContainText('Europe/London');await expect(page.getByLabel('Start time',{exact:true})).toHaveValue('15:00');await expect(page.getByLabel('End time',{exact:true})).toHaveValue('16:00');
 await page.getByRole('button',{name:'Review placement',exact:true}).click();await page.getByRole('button',{name:'Schedule block',exact:true}).click();await expect(page.getByRole('dialog')).toHaveCount(0);
 expect((await read(page,f.url)).blocks.find(b=>b.start==='2028-01-04T15:00:00.000Z')?.end).toBe('2028-01-04T16:00:00.000Z');
});

const quickPanel=(page:Page)=>page.locator('.quick-week-planner');

 test('quick weekly API requires identity/origin and never exposes another account context',async({page})=>{
  const f=await fixture(page,false);const candidates=(await (await page.request.get('/api/weekly-plans/candidates')).json()).candidates;
  const command={mutationId:randomUUID(),weekStartDate:week,planId:f.plan.id,expectedVersion:f.plan.version,provisionalCapacityMinutes:720,reserveMinutes:180,commitments:[{actionId:f.act.id,source:candidates[0].source,budgetMinutes:180}]};
  expect((await page.request.post('/api/weekly-plans/quick-commit',{headers:{Origin:'https://other.example'},data:command})).status()).toBe(403);
  await page.context().clearCookies();expect((await page.request.get(`/api/weekly-plans/quick-context?week=${week}`)).status()).toBe(401);
  expect((await page.request.post('/api/weekly-plans/quick-commit',{headers:{Origin:origin},data:command})).status()).toBe(401);
  await page.context().addCookies(cookies.B);const scoped=(await (await page.request.get(`/api/weekly-plans/quick-context?week=${week}`)).json());
  expect(scoped.workspace.view).toBeNull();expect(scoped.candidates).toEqual([]);expect(scoped.occupied).toEqual([]);
  expect((await page.request.post('/api/weekly-plans/quick-commit',{headers:{Origin:origin},data:command})).status()).toBe(404);
 });
const firstTask=(page:Page)=>page.locator('.first-week-task');
async function firstTaskHours(page:Page){await mutate(page,'/api/focusable-hours',{mutationId:randomUUID(),scheduleId:null,expectedVersion:0,windows:Array.from({length:5},(_,i)=>({weekday:i+1,startMinute:540,endMinute:1020}))},'PUT');}
test('no-goals task fits an undersized saved draft without opening the full planner',async({page})=>{
 const draft=(await mutate(page,'/api/weekly-plans',{mutationId:randomUUID(),weekStartDate:week,provisionalCapacityMinutes:60,reserveMinutes:30})).plan;
 await firstTaskHours(page);const id=await connect(page);await mutate(page,`/api/calendar/${id}/availability`,{weekStartDate:week});await page.goto(`/calendar?week=${week}`);
 const card=firstTask(page);await card.getByRole('textbox',{name:'Task'}).fill('Make progress on the longer task');await card.getByRole('radio',{name:'3h',exact:true}).check();await card.getByRole('button',{name:'Add to my week'}).click();
 await expect(card).toHaveCount(0);await expect(page.locator('.canvas-notice')).toContainText('3h scheduled · 0m still to place');
 const plan=(await (await page.request.get(`/api/weekly-plans?week=${week}`)).json()).view.plan as WeeklyPlan;
 expect(plan).toMatchObject({id:draft.id,state:'committed',provisionalCapacityMinutes:240,reserveMinutes:60,commitments:[{budgetMinutes:180}]});
 await page.reload();expect((await (await page.request.get(`/api/weekly-plans?week=${week}`)).json()).view.plan).toEqual(plan);
});
test('no-goals card accepts one task, places selected time and survives an interrupted creation response',async({page})=>{
 const pageErrors:string[]=[];page.on('pageerror',error=>pageErrors.push(error.message));await firstTaskHours(page);const id=await connect(page);await mutate(page,`/api/calendar/${id}/availability`,{weekStartDate:week});await page.setViewportSize({width:1440,height:900});await page.goto(`/calendar?week=${week}`);const card=firstTask(page);
 await expect(card.getByRole('heading',{name:'What’s one thing to move forward this week?'})).toBeVisible();await expect(card.getByRole('button',{name:'Add to my week'})).toBeDisabled();await expect(card.getByRole('radio',{name:'1h',exact:true})).toBeChecked();
 await card.getByRole('textbox',{name:'Task',exact:true}).fill('Draft the project proposal');await card.getByRole('radio',{name:'2h',exact:true}).check();await expect(page.locator('[data-calendar-date]')).toHaveCount(5);await mkdir('.cache',{recursive:true});await page.screenshot({path:'.cache/first-week-task-desktop.png'});
 let attempts=0;const bodies:string[]=[];await page.route('**/api/weekly-plans/first-task',async route=>{bodies.push(route.request().postData()!);attempts++;if(attempts===1){await route.fetch();await route.abort('failed');}else await route.continue();});
 await card.getByRole('button',{name:'Add to my week'}).click();await expect(card.getByRole('button',{name:'Retry same command'})).toBeVisible();await expect(card.getByRole('textbox',{name:'Task'})).toBeDisabled();await card.getByRole('button',{name:'Retry same command'}).click();await expect(card).toHaveCount(0);expect(bodies).toHaveLength(2);expect(bodies[0]).toBe(bodies[1]);
 const plan=(await (await page.request.get(`/api/weekly-plans?week=${week}`)).json()).view.plan as WeeklyPlan;const view=await read(page,`/api/weekly-plans/${plan.id}/time-blocks`);
 expect(view.blocks).toHaveLength(2);expect(view.blocks.reduce((n,b)=>n+(Date.parse(b.end)-Date.parse(b.start))/60000,0)).toBe(120);await expect(page.locator('.canvas-notice')).toContainText('2h scheduled · 0m still to place');
 for(const table of ['goal','action','weekly_plan'])expect((await database.pool.query(`SELECT count(*)::int AS n FROM ${table} WHERE owner_id=$1`,[owners[0]])).rows[0].n).toBe(table==='goal'?0:1);
 await page.reload();expect((await read(page,`/api/weekly-plans/${plan.id}/time-blocks`)).blocks).toEqual(view.blocks);await page.goto('/goals');await expect(page.locator('.goal-card')).toHaveCount(0);expect(pageErrors).toEqual([]);
});
test('no-goals card without fresh timing opens the guarded picker and remains usable on mobile/dark',async({page})=>{
 await page.addInitScript(()=>localStorage.setItem('one-better-theme','dark'));await page.setViewportSize({width:390,height:844});await page.goto(`/calendar?week=${week}`);const card=firstTask(page);
 await card.getByRole('textbox',{name:'Task'}).fill('Write the first draft');await card.getByRole('radio',{name:'30m',exact:true}).check();await expect(card).toContainText('choose its times');expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await page.screenshot({path:'.cache/first-week-task-mobile-dark.png'});
 await card.getByRole('textbox',{name:'Task'}).press('Enter');await expect(page.getByRole('dialog')).toBeVisible();await expect(page.locator('.canvas-notice')).toContainText('0m scheduled · 30m still to place');
 const plan=(await (await page.request.get(`/api/weekly-plans?week=${week}`)).json()).view.plan as WeeklyPlan;expect(plan.commitments[0].budgetMinutes).toBe(30);expect((await read(page,`/api/weekly-plans/${plan.id}/time-blocks`)).blocks).toEqual([]);
 await page.getByRole('dialog').getByRole('button',{name:'Keep schedule',exact:true}).click();
});
test('first-task card links to Goals and rejects overlong or empty task text',async({page})=>{
 await page.goto('/calendar?week='+week);const card=firstTask(page);await expect(card.getByRole('button',{name:'Add to my week'})).toBeDisabled();await card.getByRole('textbox',{name:'Task'}).fill('a'.repeat(161));await expect(card.getByRole('button',{name:'Add to my week'})).toBeDisabled();await card.getByRole('link',{name:'Set up goals instead →'}).click();await expect(page).toHaveURL(/\/goals$/);expect((await (await page.request.get('/api/weekly-plans?week='+week)).json()).view).toBeNull();
});

test('no-goals placement retries the exact block command without duplicating the task or schedule',async({page})=>{
 await firstTaskHours(page);const id=await connect(page);await mutate(page,`/api/calendar/${id}/availability`,{weekStartDate:week});await page.goto(`/calendar?week=${week}`);const card=firstTask(page);await card.getByRole('textbox',{name:'Task'}).fill('Finish the small proposal');
 const bodies:string[]=[];await page.route('**/api/weekly-plans/*/time-blocks',async route=>{if(route.request().method()!=='POST')return route.continue();bodies.push(route.request().postData()!);if(bodies.length===1){await route.fetch();await route.abort('failed');}else await route.continue();});
 await card.getByRole('button',{name:'Add to my week'}).click();await expect(card.getByRole('button',{name:'Retry same command'})).toBeVisible();await card.getByRole('button',{name:'Retry same command'}).click();await expect(card).toHaveCount(0);expect(bodies).toHaveLength(2);expect(bodies[0]).toBe(bodies[1]);
 const plan=(await (await page.request.get(`/api/weekly-plans?week=${week}`)).json()).view.plan as WeeklyPlan;const view=await read(page,`/api/weekly-plans/${plan.id}/time-blocks`);expect(view.blocks).toHaveLength(1);expect((Date.parse(view.blocks[0].end)-Date.parse(view.blocks[0].start))/60000).toBe(60);expect(plan.commitments).toHaveLength(1);
});

test('Calendar task controls save budgets immediately, Drop restores blocks with Undo, and Add task is ready to schedule',async({page})=>{
 const f=await fixture(page),{block}=await apiCreate(page,f);await page.goto(`/calendar?week=${week}`);
 const item=page.locator(`[data-calendar-commitment="${f.plan.commitments[0].id}"]`);
 await item.getByRole('button',{name:`Increase ${f.act.title} by 30 minutes`,exact:true}).click();await expect(item.getByRole('group',{name:`Time for ${f.act.title}`})).toContainText('3h 30m');
 await item.getByRole('button',{name:`Reduce ${f.act.title} by 30 minutes`,exact:true}).click();await expect(item.getByRole('group',{name:`Time for ${f.act.title}`})).toContainText('3h');
 expect((await (await page.request.get(`/api/weekly-plans/${f.plan.id}`)).json()).plan.commitments[0].budgetMinutes).toBe(180);
 await item.getByRole('button',{name:`Options for ${f.act.title}`,exact:true}).click();await item.getByRole('menuitem',{name:'Delete',exact:true}).click();await expect(item).toHaveCount(0);await expect(page.locator(`[data-calendar-block="${block.id}"]`)).toHaveCount(0);
 const toast=page.locator('.calendar-task-toast');await expect(toast).toContainText('Task dropped.');await toast.getByRole('button',{name:'Undo',exact:true}).click();await expect(item).toBeVisible();await expect(page.locator(`[data-calendar-block="${block.id}"]`)).toBeVisible();
 await page.getByRole('button',{name:'+ Add a task',exact:true}).click();const form=page.locator('.add-weekly-task-form');await form.getByLabel('Task name',{exact:true}).fill('A short writing task');await form.getByRole('radio',{name:'30m',exact:true}).check();await form.getByRole('button',{name:'Add task',exact:true}).click();await expect(form).toHaveCount(0);
 const added=page.locator('.calendar-commitment').filter({hasText:'A short writing task'});await expect(added).toBeVisible();await expect(added).toContainText('30m');await expect(added.getByRole('button',{name:'Schedule A short writing task',exact:true})).toBeVisible();
 await mkdir('.cache',{recursive:true});await page.screenshot({path:'.cache/calendar-direct-task-controls.png'});
 await page.reload();await expect(page.locator('.calendar-commitment').filter({hasText:'A short writing task'})).toBeVisible();await expect(page.locator(`[data-calendar-block="${block.id}"]`)).toBeVisible();
});
test('Drop Undo expires after six seconds; task changes replay safely after a lost response',async({page})=>{
 const f=await fixture(page),{block}=await apiCreate(page,f);await page.goto(`/calendar?week=${week}`);const item=page.locator(`[data-calendar-commitment="${f.plan.commitments[0].id}"]`);
 let attempts=0;const bodies:string[]=[];await page.route('**/api/weekly-plans/*/tasks',async route=>{bodies.push(route.request().postData()!);if(++attempts===1){await route.fetch();await route.abort('failed');}else await route.continue();});
 await item.getByRole('button',{name:`Increase ${f.act.title} by 30 minutes`,exact:true}).click();await page.getByRole('button',{name:'Retry same task change',exact:true}).click();await expect(item.getByRole('group',{name:`Time for ${f.act.title}`})).toContainText('3h 30m');expect(bodies[0]).toBe(bodies[1]);
 await item.getByRole('button',{name:`Options for ${f.act.title}`,exact:true}).click();await item.getByRole('menuitem',{name:'Delete',exact:true}).click();const undo=page.locator('.calendar-task-toast').getByRole('button',{name:'Undo',exact:true});await expect(undo).toBeVisible();await expect(undo).toHaveCount(0,{timeout:7500});await page.reload();await expect(item).toHaveCount(0);await expect(page.locator(`[data-calendar-block="${block.id}"]`)).toHaveCount(0);
});
test('Spare time choices persist in Hours and change the planning card without mutating a saved week',async({page})=>{
 const f=await fixture(page,false);await page.goto('/availability');const spare=page.getByRole('group',{name:'Spare time',exact:true});await expect(spare.getByRole('radio',{name:'Some (25%)',exact:true})).toBeChecked();
 await spare.getByRole('radio',{name:'Lots (40%)',exact:true}).check();await page.getByRole('button',{name:'Save Focusable Hours',exact:true}).click();await expect(page.getByRole('button',{name:'Save Focusable Hours',exact:true})).toBeDisabled();await page.reload();await expect(spare.getByRole('radio',{name:'Lots (40%)',exact:true})).toBeChecked();
 expect((await (await page.request.get(`/api/weekly-plans/${f.plan.id}`)).json()).plan).toEqual(f.plan);
 const id=await connect(page);await mutate(page,`/api/calendar/${id}/availability`,{weekStartDate:'2028-01-10'});await page.goto('/calendar?week=2028-01-10');await expect(firstTask(page)).toContainText('keeping ~40% spare');
 await page.goto('/availability');await spare.getByRole('radio',{name:'None',exact:true}).check();await page.getByRole('button',{name:'Save Focusable Hours',exact:true}).click();await expect(page.getByRole('button',{name:'Save Focusable Hours',exact:true})).toBeDisabled();
 await page.goto(`/calendar?week=2028-01-10`);await expect(firstTask(page)).toContainText('keeping ~0% spare');
});

test('living week preselects unfinished work, plans once without capacity or confirmation, and keeps optional history quiet',async({page})=>{
 const f=await fixture(page,true,'Finish the essay','2027-12-27',false);
 const before=await page.request.get('/api/weekly-plans?week=2028-01-03');expect((await before.json()).view).toBeNull();
 await page.goto('/planning?week=2028-01-03');await expect(page).toHaveURL(/calendar\?week=2028-01-03/);
 const card=page.getByRole('region',{name:'What matters this week?'});
 await expect(card).toContainText('Unfinished from last week, already picked');await expect(card.getByRole('checkbox')).toBeChecked();
 await expect(card.getByRole('spinbutton')).toHaveCount(0);await expect(card).not.toContainText('Focus time to commit');
 const payloads:object[]=[];await page.route('**/api/weekly-plans/quick-commit',async route=>{payloads.push(route.request().postDataJSON());const response=await route.fetch();await route.fulfill(payloads.length===1?{status:200,contentType:'application/json',body:'lost'}:{response});});
 await card.getByRole('button',{name:'Plan my week',exact:true}).click();await card.getByRole('button',{name:'Retry same command'}).click();
 await expect(page.locator('[data-calendar-commitment]')).toHaveCount(1);expect(payloads[1]).toEqual(payloads[0]);expect(payloads[0]).not.toHaveProperty('provisionalCapacityMinutes');
 const summary=page.getByRole('region',{name:'Week summary',exact:true});await expect(summary).toContainText('3h still to place');await expect(summary).not.toContainText('capacity');
 await page.getByRole('button',{name:'Reduce Finish the essay by 30 minutes'}).click();await expect(page.getByRole('group',{name:'Time for Finish the essay'})).toContainText('2h 30m');
 await page.getByRole('button',{name:'Undo',exact:true}).click();await expect(page.getByRole('group',{name:'Time for Finish the essay'})).toContainText('3h');
 await expect(page.locator('.week-activity')).not.toHaveAttribute('open','');await page.locator('.week-activity summary').click();await expect(page.locator('.week-activity')).toContainText('Changed Finish the essay to 2h 30m');
 expect(await page.locator('.calendar-workspace').innerText()).not.toMatch(/Amendment|Uncommitted|Committed total/);
 await page.reload();await expect(page.locator('.week-activity')).not.toHaveAttribute('open','');expect((await read(page,f.url)).commitments[0].budgetMinutes).toBe(180);
 await expect(page.getByRole('grid',{name:'January 2028',exact:true})).toBeVisible();await page.screenshot({path:'.cache/living-week-calendar.png',fullPage:false});
});
test('living week with no unfinished tasks asks for one task even when Goals already exist; add supports Undo',async({page})=>{
 await mutate(page,'/api/goals',{mutationId:randomUUID(),title:'A bigger goal',outcome:'Progress over time'});
 await page.goto(`/calendar?week=${week}`);await expect(page.getByRole('heading',{name:'What’s one thing to move forward this week?'})).toBeVisible();await expect(page.getByRole('spinbutton')).toHaveCount(0);
 await page.getByRole('textbox',{name:'Task',exact:true}).fill('Read one chapter');await page.getByRole('radio',{name:'30m',exact:true}).check();await page.getByRole('button',{name:'Add to my week'}).click();
 const dialog=page.getByRole('dialog');await expect(dialog).toBeVisible();await page.keyboard.press('Escape');await expect(page.locator('[data-calendar-commitment]')).toHaveCount(1);
 await page.getByRole('button',{name:'+ Add a task'}).click();await page.getByLabel('Task name',{exact:true}).fill('Another small step');await page.getByRole('button',{name:'Add task',exact:true}).click();await expect(page.locator('[data-calendar-commitment]')).toHaveCount(2);
 await page.getByRole('button',{name:'Undo',exact:true}).click();await expect(page.locator('[data-calendar-commitment]')).toHaveCount(1);
 await page.reload();await expect(page.locator('[data-calendar-commitment]')).toHaveCount(1);
});
test('Calendar Add a task selects an empty Goal, persists its Action and keeps safe Undo',async({page})=>{
 const f=await fixture(page),workout=(await mutate(page,'/api/goals',{mutationId:randomUUID(),title:'Workout',outcome:'Gain muscle'})).goal;
 await page.goto(`/calendar?week=${week}`);await page.getByRole('button',{name:'+ Add a task',exact:true}).click();
 const form=page.locator('.add-weekly-task-form');await form.getByLabel('Linked goal',{exact:true}).selectOption(workout.id);
 await form.getByLabel('Task name',{exact:true}).fill('Strength training');await form.getByRole('radio',{name:'30m',exact:true}).check();await form.getByRole('button',{name:'Add task',exact:true}).click();await expect(form).toHaveCount(0);
 await expect(page.getByRole('region',{name:'Work for this week'})).toContainText('Workout');await expect(page.locator('[data-calendar-commitment]')).toHaveCount(2);
 const view=await read(page,f.url),chosen=view.commitments.find(c=>c.snapshot.action.title==='Strength training')!;expect(chosen.snapshot.goal?.id).toBe(workout.id);
 await page.getByRole('button',{name:'Undo',exact:true}).click();await expect(page.locator('[data-calendar-commitment]')).toHaveCount(1);
 const actions=(await (await page.request.get(`/api/goals/${workout.id}/actions`)).json()).actions;expect(actions).toHaveLength(1);expect(actions[0].action.title).toBe('Strength training');
 await page.reload();await expect(page.locator('[data-calendar-commitment]')).toHaveCount(1);
});
test('Calendar single-task starter offers Workout even when it has no Actions',async({page})=>{
 const workout=(await mutate(page,'/api/goals',{mutationId:randomUUID(),title:'Workout',outcome:'Gain muscle'})).goal;
 await page.goto(`/calendar?week=${week}`);const card=firstTask(page);await card.getByLabel('Linked goal',{exact:true}).selectOption(workout.id);
 await card.getByRole('textbox',{name:'Task',exact:true}).fill('Strength training');await card.getByRole('radio',{name:'30m',exact:true}).check();await card.getByRole('button',{name:'Add to my week',exact:true}).click();
 await expect(page.getByRole('dialog')).toBeVisible();await page.keyboard.press('Escape');await expect(page.getByRole('region',{name:'Work for this week'})).toContainText('Workout');
 await page.reload();await expect(page.getByRole('region',{name:'Work for this week'})).toContainText('Strength training');
 const goals=(await (await page.request.get('/api/goals')).json()).goals;expect(goals.map((g:{title:string})=>g.title)).toEqual(['Workout']);
});
test('living Review shows the agreed focus-or-reflection streak without draft text or future credit',async({page})=>{
 const savedClock=new Date().toISOString();await writeFile(process.env.EXECUTION_TEST_CLOCK_FILE!,'2028-01-03T05:00:00Z');
 try {
  await page.clock.install({time:new Date('2028-01-03T08:00:00Z')});
  const f=await fixture(page),{block}=await apiCreate(page,f,'2028-01-03','06:00','07:00');await writeFile(process.env.EXECUTION_TEST_CLOCK_FILE!,'2028-01-03T08:00:00Z');const owner=(await database.db.select().from(user)).find(v=>v.email===process.env.TEST_USER_A_EMAIL)!;
  await database.db.insert(focusSession).values({id:randomUUID(),ownerId:owner.id,timeBlockId:block.id,startedAt:new Date('2028-01-03T06:00Z'),endedAt:new Date('2028-01-03T06:30Z'),outcome:'partial',endNote:'PRIVATE focus note',version:2,createdAt:new Date('2028-01-03T06:00Z'),updatedAt:new Date('2028-01-03T06:30Z')});
  await writeFile(process.env.EXECUTION_TEST_CLOCK_FILE!,'2028-01-02T20:00:00Z');
  const r=await mutate(page,'/api/daily-reflections',{mutationId:randomUUID(),localDate:'2028-01-02',reflectionId:null,expectedVersion:0,note:'PRIVATE finalized reflection'},'PUT');
  await mutate(page,`/api/daily-reflections/${r.reflection.id}/finalize`,{mutationId:randomUUID(),expectedVersion:r.reflection.version});
  await mutate(page,'/api/daily-reflections',{mutationId:randomUUID(),localDate:'2028-01-01',reflectionId:null,expectedVersion:0,note:'PRIVATE unfinished draft'},'PUT');
  await writeFile(process.env.EXECUTION_TEST_CLOCK_FILE!,'2028-01-03T08:00:00Z');
  await page.goto('/review');await expect(page.getByRole('heading',{name:'Week of 3 Jan 2028'})).toBeVisible();
  const streak=page.getByRole('region',{name:'1% better streak'});await expect(streak).toContainText('2 days in a row');await expect(streak).toContainText('You showed up today');await expect(streak).not.toContainText('PRIVATE');
  await page.screenshot({path:'.cache/living-week-review.png',fullPage:false});
  await page.getByRole('link',{name:'Daily',exact:true}).click();await expect(page.getByRole('region',{name:'1% better streak'})).toContainText('2 days in a row');
  await page.setViewportSize({width:390,height:844});await page.reload();expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 } finally {await writeFile(process.env.EXECUTION_TEST_CLOCK_FILE!,savedClock);}
});

test('one-click week planning checks fresh timing and retries the exact placement without duplicate blocks',async({page})=>{
 const f=await fixture(page,false),id=await connect(page);await mutate(page,`/api/calendar/${id}/availability`,{weekStartDate:week});await page.goto(`/calendar?week=${week}`);
 const payloads:object[]=[];await page.route('**/api/weekly-plans/*/time-blocks',async route=>{if(route.request().method()!=='POST')return route.continue();payloads.push(route.request().postDataJSON());const response=await route.fetch();await route.fulfill(payloads.length===1?{status:200,contentType:'application/json',body:'interrupted'}:{response});});
 const card=quickPanel(page);await card.getByRole('button',{name:'Plan my week',exact:true}).click();await card.getByRole('button',{name:'Retry same command',exact:true}).click();await expect(card).toHaveCount(0);expect(payloads[1]).toEqual(payloads[0]);const saved=await read(page,f.url);expect(saved.blocks).toHaveLength(2);expect(saved.commitments[0].scheduledMinutes).toBe(180);await page.reload();expect((await read(page,f.url)).blocks.map(b=>b.id)).toEqual(saved.blocks.map(b=>b.id));
});
test('changed Calendar timing preserves the saved list and stops placement; changed task sources cannot be silently accepted',async({page})=>{
 const f=await fixture(page,false),id=await connect(page);await mutate(page,`/api/calendar/${id}/availability`,{weekStartDate:week});await page.goto(`/calendar?week=${week}`);
 await page.route('**/api/weekly-plans/*/time-blocks/preview',async route=>{const hours=(await (await page.request.get('/api/focusable-hours')).json()).schedule;await mutate(page,'/api/focusable-hours',{mutationId:randomUUID(),scheduleId:hours.id,expectedVersion:hours.version,windows:[{weekday:5,startMinute:960,endMinute:1020}]},'PUT');await route.continue();});
 const card=quickPanel(page);await card.getByRole('button',{name:'Plan my week',exact:true}).click();await expect(card.getByRole('alert')).toContainText('Availability changed');expect((await read(page,f.url)).blocks).toEqual([]);await card.getByRole('link',{name:'Back to my week →'}).click();await expect(page.locator('[data-calendar-commitment]')).toHaveCount(1);
 await page.goto('/calendar?week=2028-01-10');await mutate(page,`/api/actions/${f.act.id}`,{mutationId:randomUUID(),expectedVersion:f.act.version,title:'Changed source',estimateMinutes:240},'PATCH');await quickPanel(page).getByRole('button',{name:'Plan my week',exact:true}).click();await expect(quickPanel(page).getByRole('alert')).toContainText('task or Goal changed');expect((await (await page.request.get('/api/weekly-plans?week=2028-01-10')).json()).view).toBeNull();
});
test('saved drafts retain more than three choices without requiring a capacity form on mobile and dark theme',async({page})=>{
 const f=await fixture(page,false);for(const title of ['Second task','Third task','Fourth task'])await mutate(page,`/api/goals/${f.g.id}/actions`,{mutationId:randomUUID(),title,estimateMinutes:60});const candidates=(await (await page.request.get('/api/weekly-plans/candidates')).json()).candidates;
 await mutate(page,`/api/weekly-plans/${f.plan.id}`,{mutationId:randomUUID(),expectedVersion:f.plan.version,provisionalCapacityMinutes:720,reserveMinutes:180,commitments:candidates.map((c:{actionId:string;source:unknown})=>({actionId:c.actionId,source:c.source,budgetMinutes:60}))},'PATCH');await page.addInitScript(()=>localStorage.setItem('one-better-theme','dark'));await page.setViewportSize({width:390,height:844});await page.goto(`/calendar?week=${week}`);const card=quickPanel(page);await expect(card.locator('input:checked')).toHaveCount(4);await expect(card.getByRole('spinbutton')).toHaveCount(0);expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await card.getByRole('button',{name:'Plan my week',exact:true}).click();await expect(card).toHaveCount(0);expect((await read(page,f.url)).commitments).toHaveLength(4);
});

test('General is a nullable task group alongside real Goals, with reference layout and reload persistence',async({page})=>{
 const f=await fixture(page),workout=(await mutate(page,'/api/goals',{mutationId:randomUUID(),title:'Workout',outcome:'Gain muscle'})).goal;
 await mutate(page,`/api/weekly-plans/${f.plan.id}/tasks`,{kind:'add',mutationId:randomUUID(),expectedVersion:3,title:'Strength training',budgetMinutes:60,goal:{id:workout.id,version:1}});
 await mutate(page,`/api/weekly-plans/${f.plan.id}/tasks`,{kind:'add',mutationId:randomUUID(),expectedVersion:4,title:'Read ten pages',budgetMinutes:30});
 const placement={commitmentId:f.plan.commitments[0].id,date:'2028-01-04',startTime:'10:00',endTime:'13:00'},preview:PlacementReview=await mutate(page,`${f.url}/preview`,placement);
 await mutate(page,f.url,{...placement,mutationId:randomUUID(),expectedPlanVersion:preview.planVersion,reviewKey:preview.reviewKey,acknowledgeOutsideHours:false,acknowledgeBusy:false});
 await page.goto(`/calendar?week=${week}`);const rail=page.getByRole('region',{name:'Work for this week'});
 const general=rail.locator('.work-goal-group').filter({has:page.locator('.general-work-heading')});
 await expect(general.locator('.work-goal')).toHaveText('General');await expect(general.getByRole('link')).toHaveCount(0);await expect(general).toContainText('Read ten pages');
 const linked=rail.locator('.work-goal-group').filter({has:page.getByRole('link',{name:'Workout',exact:true})});await expect(linked).toContainText('Strength training');await expect(linked).not.toContainText('Read ten pages');
 await expect(rail).not.toContainText('Weekly priorities');await expect(rail).toContainText('3 things · 2 still need time');
 const formButton=page.getByRole('button',{name:'+ Add a task',exact:true});await formButton.click();await expect(page.getByLabel('Linked goal',{exact:true})).toHaveValue('');await expect(page.getByLabel('Linked goal',{exact:true}).locator('option').first()).toHaveText('General');await page.getByRole('button',{name:'Cancel',exact:true}).click();
 const view=await read(page,f.url),task=view.commitments.find(c=>c.snapshot.action.title==='Read ten pages')!;expect(task.snapshot.goal).toBeNull();expect(task.source).toMatchObject({goalId:null,goalVersion:null});
 expect((await (await page.request.get('/api/goals')).json()).goals.map((g:{title:string})=>g.title)).not.toContain('Weekly priorities');
 const generalCard=general.locator('[data-calendar-commitment]');await generalCard.getByRole('button',{name:/Increase/}).click();await expect(generalCard).toContainText('1h');await page.getByRole('button',{name:'Undo',exact:true}).click();await expect(generalCard).toContainText('30m');
 await page.reload();await expect(general).toContainText('Read ten pages');await expect(general).toContainText('30m');
 await page.setViewportSize({width:1440,height:960});await expect(page.locator('.calendar-engine')).toBeVisible();
 for(const heading of await rail.locator('.work-goal').all()){const text=await heading.boundingBox(),dot=await heading.locator('.goal-dot').boundingBox();expect(Math.abs(text!.x-dot!.x)).toBeLessThan(1);}
 await expect(rail.getByRole('button',{name:`Schedule ${f.act.title}`,exact:true})).toHaveCount(0);await expect(rail).toContainText('✓ Scheduled');await page.screenshot({path:'.cache/general-goal-groups.png'});
 await page.addInitScript(()=>localStorage.setItem('one-better-theme','dark'));await page.reload();await expect(page.locator('html')).toHaveAttribute('data-theme','dark');await page.screenshot({path:'.cache/general-goal-groups-dark.png'});
 await page.setViewportSize({width:390,height:844});await page.reload();await rail.locator('.work-disclosure > summary').click();await expect(generalCard).toBeVisible();expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});

test('reference task menu edits inline, drags between Goals and General, and Undo preserves schedule and history',async({page})=>{
 const f=await fixture(page),{block}=await apiCreate(page,f);
 const workout=(await mutate(page,'/api/goals',{mutationId:randomUUID(),title:'Workout',outcome:'Move every day'})).goal;
 await page.goto(`/calendar?week=${week}`);const item=page.locator(`[data-calendar-commitment="${f.plan.commitments[0].id}"]`);
 await item.getByRole('button',{name:`Options for ${f.act.title}`}).click();await item.getByRole('menuitem',{name:'Edit',exact:true}).click();await item.getByRole('textbox',{name:'Task name',exact:true}).fill('A clearer task');await page.keyboard.press('Enter');await expect(item.getByRole('heading',{name:'A clearer task',exact:true})).toBeVisible();
 await expect(page.locator(`[data-calendar-block="${block.id}"]`)).toContainText('A clearer task');
 await page.locator('.calendar-task-toast').getByRole('button',{name:'Undo',exact:true}).click();await expect(item.getByRole('heading',{name:f.act.title,exact:true})).toBeVisible();
 await item.getByRole('button',{name:`Options for ${f.act.title}`}).click();await item.getByRole('menuitem',{name:'Edit',exact:true}).click();await item.getByRole('textbox',{name:'Task name',exact:true}).fill('Cancelled rename');await page.keyboard.press('Escape');await expect(item.getByRole('heading',{name:f.act.title,exact:true})).toBeVisible();
 // Native pointer drag exposes empty Goal targets before the drop.
 const box=await item.boundingBox();await page.mouse.move(box!.x+25,box!.y+18);await page.mouse.down();await page.mouse.move(box!.x+80,box!.y+30,{steps:8});
 const target=page.locator(`[data-goal-drop="${workout.id}"]`);await expect(target).toContainText('Drop a task here');const dest=await target.boundingBox();await page.mouse.move(dest!.x+dest!.width/2,dest!.y+dest!.height/2,{steps:10});await page.mouse.up();
 await expect(target.locator('[data-calendar-commitment]')).toHaveCount(1);await expect(page.locator('.calendar-task-toast')).toContainText('Task moved.');
 expect((await (await page.request.get(`/api/actions/${f.act.id}`)).json()).action.goalId).toBe(workout.id);
 expect((await read(page,f.url)).blocks[0]).toMatchObject({start:block.start,end:block.end,snapshot:{goal:{id:workout.id}}});
 await page.reload();await expect(target.locator('[data-calendar-commitment]')).toHaveCount(1);
 // Accessible alternative also works on a narrow screen.
 await page.setViewportSize({width:390,height:844});await page.locator('.work-disclosure > summary').click();await item.getByRole('button',{name:`Options for ${f.act.title}`}).click();await item.getByRole('menuitem',{name:'Move to…',exact:true}).click();await page.getByRole('button',{name:'Move to General',exact:true}).click();
 await expect(page.locator('[data-goal-drop="general"] [data-calendar-commitment]')).toHaveCount(1);expect((await (await page.request.get(`/api/actions/${f.act.id}`)).json()).action.goalId).toBeNull();expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 await page.locator('.calendar-task-toast').getByRole('button',{name:'Undo',exact:true}).click();await expect(target.locator('[data-calendar-commitment]')).toHaveCount(1);
 await page.setViewportSize({width:1440,height:960});await page.screenshot({path:'.cache/calendar-task-organization-light.png'});await page.getByRole('button',{name:'Switch to dark mode',exact:true}).click();await page.screenshot({path:'.cache/calendar-task-organization-dark.png'});
 const baseline=(await (await page.request.get(`/api/weekly-plans/${f.plan.id}`)).json()).plan;expect(baseline.commitments[0].snapshot.goal.id).toBe(f.g.id);expect(baseline.commitments[0].snapshot.action.title).toBe(f.act.title);
});
