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

test('calendar is home; legacy Goals bookmarks, Settings and week controls remain usable',async({page})=>{await page.goto('/');await expect(page).toHaveURL(/\/calendar$/);await expect(page.getByRole('region',{name:'Week calendar',exact:true})).toBeVisible();await expect(page.getByText('Plan this week before scheduling focus time.')).toBeVisible();await expect(page.getByText('Connect Calendar to see busy time alongside your plan.')).toBeVisible();await page.goto('/?view=archived');await expect(page).toHaveURL(/\/goals\?view=archived$/);await page.getByRole('navigation',{name:'Main navigation'}).getByRole('link',{name:'Calendar',exact:true}).click();await page.locator('.settings-menu summary').click();await page.getByRole('link',{name:'Availability',exact:true}).click();await expect(page).toHaveURL(/\/availability$/);await page.goto(`/calendar?week=${week}`);await page.getByRole('link',{name:'Next week',exact:true}).click();await expect(page).toHaveURL(/week=2028-01-10$/);await page.getByRole('link',{name:'Previous week',exact:true}).click();await expect(page).toHaveURL(/week=2028-01-03$/);await page.getByRole('link',{name:'Current week',exact:true}).click();await expect(page.getByRole('region',{name:'Week calendar',exact:true})).toBeVisible();});
test('frozen work, effective capacity, Focusable Hours, local coordinates and keyboard selection',async({page})=>{const f=await fixture(page),{block}=await apiCreate(page,f);await mutate(page,`/api/weekly-plans/${f.plan.id}/amendments`,{mutationId:randomUUID(),expectedVersion:3,provisionalCapacityMinutes:660,reserveMinutes:120,reason:'Keep capacity realistic',commitments:[{actionId:f.act.id,budgetMinutes:150}]});await page.goto(`/calendar?week=${week}`);const rail=page.getByRole('region',{name:'Work for this week'});await expect(rail).toContainText(f.g.title);await expect(rail).toContainText('1h still unscheduled');const facts=page.getByRole('region',{name:'Week facts'});await expect(facts).toContainText('Weekly capacity11h');await expect(facts).toContainText('Protected reserve2h');await expect(facts).toContainText('Committed budget2h 30m');await expect(page.getByRole('img',{name:/Focusable Hours Tuesday/})).toBeVisible();const card=page.locator(`[data-calendar-block="${block.id}"]`);await assertPlacement(page,card,'10:00','11:30');await expect(card).toBeInViewport();await card.focus();await page.keyboard.press('Enter');await expect(blockRegion(page)).toContainText('The planning loop is usable');await expect(blockRegion(page)).toContainText('Commitment budget2h 30m');await expect(blockRegion(page)).toContainText('Scheduled for this work1h 30m');await expect(blockRegion(page).getByRole('link',{name:/Start focus/})).toHaveCount(0);});
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
 await page.getByRole('checkbox',{name:/outside Focusable Hours/i}).check();await page.getByRole('button',{name:'Schedule anyway',exact:true}).click();
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
 await page.goto('/calendar?view=month&date=2028-01-04');await expect(page.locator('[data-month-block]')).toHaveCount(3);await expect(page.getByRole('button',{name:'+3 more',exact:true})).toBeVisible();await page.locator(`[data-month-block="${y.id}"]`).focus();await page.keyboard.press('Enter');await expect(blockRegion(page)).toContainText('Originating week 2028-01-10');await expect(blockRegion(page)).toContainText('Work from a different weekly plan');await expect(blockRegion(page)).toContainText('Scheduled for this work1h 30m');await blockRegion(page).getByRole('button',{name:'Reschedule',exact:true}).click();await choose(page,'2028-01-11','13:00','14:00');await page.getByRole('button',{name:'Save new times',exact:true}).click();await expect(page.getByRole('dialog')).toHaveCount(0);expect((await read(page,second.url)).blocks[0].start).toBe('2028-01-11T13:00:00.000Z');
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
