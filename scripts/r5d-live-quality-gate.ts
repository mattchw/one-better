import assert from 'node:assert/strict';
import {createHash,randomBytes,randomUUID} from 'node:crypto';
import {mkdir,mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawn,type ChildProcess} from 'node:child_process';
import {once} from 'node:events';
import {createInterface} from 'node:readline/promises';
import {setTimeout as delay} from 'node:timers/promises';
import {parse} from 'dotenv';
import {Pool} from 'pg';
import Anthropic from '@anthropic-ai/sdk';
import {migrate} from 'drizzle-orm/node-postgres/migrator';
import {connectDatabase} from '../src/db/connect';
import {ApplicationError} from '../src/domain/errors';
import {anthropicCoach} from '../src/providers/anthropic/coaching';
import {readAIConfiguration} from '../src/modules/coaching/configuration';
import {coachingRepository} from '../src/modules/coaching/repository';
import {coachingService} from '../src/modules/coaching/service';
import {canonical,fingerprint} from '../src/modules/coaching/context';
import {grounded,outputSchema,rationaleAllowed,type CoachingContext,type CoachingScope} from '../src/modules/coaching/domain';
import {systemPrompt,structuredSchema,type AIProvider} from '../src/modules/coaching/provider';
import {requireTestDatabaseURL} from './test-database';
import {seedR5C,r5cWeek,r5cReviewWeek,r5cNow,r5cPassword,r5cMarkers} from '../tests/r5c-scenario';

// Finite, explicit development QA invocation. No production job/agent/repair loop.
const live=process.argv.includes('--live'),serve=process.argv.includes('--serve'),artifacts='docs/r5d-evidence',origin='http://127.0.0.1:3104';
let configuration:Record<string,string|undefined>={};for(const path of ['.env','.env.local']){try{configuration={...configuration,...parse(await readFile(path))};}catch{/* optional */}}configuration={...configuration,...process.env};
const selected=readAIConfiguration({...configuration,AI_PROVIDER:'anthropic'}).provider;
if(live)assert.ok(selected?.name==='anthropic'&&selected.model==='claude-haiku-4-5-20251001','Use the unchanged R5C pinned Claude Haiku model and a server-side development API key.');
const {url}=requireTestDatabaseURL(),target=new URL(url),adminURL=new URL(url),name=`execution_test_r5c${randomBytes(6).toString('hex')}`;target.pathname=`/${name}`;adminURL.pathname='/postgres';
const admin=new Pool({connectionString:adminURL.toString()}),database=connectDatabase(target.toString()),directory=await mkdtemp(join(tmpdir(),'r5d-quality-')),clockFile=join(directory,'now');
const digest=(value:unknown)=>createHash('sha256').update(canonical(value)).digest('hex');
let created=false,child:ChildProcess|undefined,terminal:ReturnType<typeof createInterface>|undefined,calls=0;
const observations:Record<string,unknown>[]=[];
async function coreHash(){const rows:Record<string,unknown>={};for(const t of ['goal','milestone','action','weekly_plan','weekly_commitment','weekly_plan_amendment','amendment_commitment','commitment_identity','time_block','focus_session','daily_reflection','weekly_review','weekly_review_decision','focus_cycle','focus_cycle_goal','focusable_hours','google_calendar_connection','calendar_availability_cache'])rows[t]=(await database.pool.query(`SELECT row_to_json(t) FROM ${t} t ORDER BY row_to_json(t)::text`)).rows;return digest(rows);}
async function save(){await mkdir(artifacts,{recursive:true});await writeFile(join(artifacts,'results.json'),JSON.stringify({live,calls,model:selected?.model??null,endpoint:'https://api.anthropic.com/v1/messages',configuration:{authentication:'server-side development API key',maxOutputTokens:4096,sdkTimeoutMs:25000,applicationTimeoutMs:30000,maxRetries:0,structuredOutput:'output_config.format JSON schema',promptHash:digest(systemPrompt),schemaHash:digest(structuredSchema)},observations},null,2));}
try{
 await admin.query(`CREATE DATABASE "${name}"`);created=true;await migrate(database.db,{migrationsFolder:'src/db/migrations'});const scenario=await seedR5C(database);await writeFile(clockFile,r5cNow);
 assert.equal(scenario.contexts.calendar.signals.some(s=>s.kind==='repeated_carry'),false,'One prior Carry must not become repeated Carry.');
 assert.equal(scenario.contexts.restrained.signals.filter(s=>s.worthConsidering).length,0);
 assert.ok(scenario.contexts.calendar.scheduleCandidates.length>0);
 await mkdir(artifacts,{recursive:true});await writeFile(join(artifacts,'scenario.json'),JSON.stringify({fixture:'tests/r5c-scenario.ts (unchanged domain scenario; clean-restraint estimate from final R5C run)',week:r5cWeek,reviewWeek:r5cReviewWeek,requestTime:r5cNow,timezone:'Europe/London',contexts:scenario.contexts,fingerprints:scenario.fingerprints,assertions:{privacySentinels:true,finalizedReflectionCutoff:true,noRepeatedCarryFromSingleReview:true,wellPlannedNoDecisionSignal:true,futureCandidates:true}},null,2));
 if(!live){console.log('PASS: unchanged frozen R5C scenarios prepared; no provider requests.');await save();}
 else{
  const repository=coachingRepository(database.db);
  async function generate(kind:'calendar'|'restrained'|'review'|'regenerate'|'failure'){
   assert.ok(calls<5,'Five explicit QA requests maximum.');
   const actor=kind==='restrained'?scenario.restrained:scenario.primary,scope:CoachingScope=kind==='review'?scenario.reviewScope:scenario.scope;
   let raw:unknown=null,packet:CoachingContext|null=null;
   const actual=anthropicCoach(new Anthropic({apiKey:kind==='failure'?'one-better-invalid-r5d-quality-gate':selected!.key,baseURL:'https://api.anthropic.com',timeout:25000,maxRetries:0,logLevel:'off'}),selected!.model);
   const provider:AIProvider={name:actual.name,model:actual.model,async generateCoaching(context,schema,signal){calls++;packet=context;const r=await actual.generateCoaching(context,schema,signal);raw=r.output;return r;}};
   const service=coachingService({repository,context:scenario.services.context,provider,configuration:'ready',scheduling:scenario.services.schedule,clock:scenario.clock});
   const before=await coreHash(),view=await service.view(actor,scope),run=await service.generate(actor,{...scope,mutationId:randomUUID(),fingerprint:view.fingerprint});
   assert.equal(await coreHash(),before,'Coaching altered upstream data.');assert.ok(packet);
   const sent=packet as CoachingContext,text=JSON.stringify(sent);if(scope.contextType==='calendar')for(const marker of Object.values(r5cMarkers))assert.ok(!text.includes(marker));
   else{assert.ok(text.includes(r5cMarkers.daily)&&text.includes(r5cMarkers.weekly));for(const marker of [r5cMarkers.draftDaily,r5cMarkers.draftWeekly,r5cMarkers.late,r5cMarkers.session,r5cMarkers.calendar])assert.ok(!text.includes(marker));}
   const parsed=outputSchema.safeParse(raw),placements=[];
   for(const [index,r] of run.recommendations.entries())if(r.proposal.type==='schedule_candidate'&&r.placement&&!r.unavailable){const p=await service.preview(actor,run.id,{index});assert.ok(Date.parse(p.review.interval.start)>Date.parse(r5cNow));assert.equal(p.review.outsideHours,false);assert.equal(p.review.busyConflict,false);placements.push({index,review:p.review,editor:p.editor,legal:true});}
   const usage=run.usage,cost=usage&&usage.inputTokens!==null&&usage.outputTokens!==null?(usage.inputTokens+(usage.cachedInputTokens??0)*0.1+usage.outputTokens*5)/1e6:null;
   observations.push({kind,run,rawOutput:raw,contextFingerprint:fingerprint(sent),schemaAccepted:parsed.success,grounded:parsed.success?parsed.data.recommendations.every(r=>grounded(r,sent)):null,rationalesAllowed:parsed.success?parsed.data.recommendations.every(r=>rationaleAllowed(r.rationale)):null,placements,upstreamUnchanged:true,privacyVerified:true,approximateTextCostUSD:cost});
   await writeFile(join(artifacts,`${kind}-context.json`),JSON.stringify(sent,null,2));await save();
   console.log(JSON.stringify({kind,status:run.status,failure:run.failure,recommendations:run.recommendations.length,latencyMs:run.latencyMs,usage,cost,legalPreviews:placements.length}));
   return {run,service,placements};
  }
  if(serve){
   child=spawn(process.execPath,['node_modules/next/dist/bin/next','start','--hostname','127.0.0.1','--port','3104'],{env:{...process.env,NODE_ENV:'production',DATABASE_URL:target.toString(),BETTER_AUTH_URL:origin,EXECUTION_TEST_CLOCK_FILE:clockFile,AI_PROVIDER:'anthropic',ANTHROPIC_API_KEY:selected!.key,ANTHROPIC_MODEL:selected!.model,OPENAI_API_KEY:'',OPENAI_MODEL:'',AI_TEST_BASE_URL:'',GOOGLE_CALENDAR_CLIENT_ID:'',GOOGLE_CALENDAR_CLIENT_SECRET:'',GOOGLE_CALENDAR_REDIRECT_URI:'',CALENDAR_ENCRYPTION_KEYS:'',CALENDAR_ENCRYPTION_KEY_ID:'',CALENDAR_TEST_ORIGIN:''},stdio:'ignore'});
   for(let i=0;i<120;i++){if(child.exitCode!==null)throw new Error('QA process exited.');try{if((await fetch(`${origin}/api/health`)).ok)break;}catch{}await delay(250);}
   console.log(JSON.stringify({origin,primaryEmail:'r5c-primary@example.test',restraintEmail:'r5c-restrained@example.test',disposablePassword:r5cPassword,provider:selected!.model}));
   terminal=createInterface({input:process.stdin,output:process.stdout});
  }
  async function inspect(label:string){if(terminal)await terminal.question(`${label} saved. Enter to continue QA: `);}
  const calendar=await generate('calendar');await inspect('Calendar');await generate('restrained');await inspect('Well planned');await generate('review');await inspect('Review');
  const blockInput={commitmentId:scenario.current.commitments.find(c=>c.actionId===scenario.main.actions[0].id)!.id,date:'2028-01-06',startTime:'10:00',endTime:'11:00'};
  const review=await scenario.services.schedule.preview(scenario.primary,scenario.current.id,blockInput);
  await scenario.services.schedule.create(scenario.primary,scenario.current.id,{...blockInput,mutationId:randomUUID(),expectedPlanVersion:review.planVersion,reviewKey:review.reviewKey,acknowledgeOutsideHours:false,acknowledgeBusy:false});
  assert.equal((await calendar.service.view(scenario.primary,scenario.scope)).run?.stale,true);
  await assert.rejects(calendar.service.preview(scenario.primary,calendar.run.id,{index:0}),(e:unknown)=>e instanceof ApplicationError&&e.details?.kind==='COACHING_STALE');
  observations.push({kind:'staleness',oldRunId:calendar.run.id,staleAfterOrdinaryBlockCreation:true,oldPreviewRejected:true,newUnscheduledMinutes:135});await save();await inspect('Stale advice');
  const fresh=await generate('regenerate');await inspect('Regenerated advice / Preview');
  // Explicit synthetic QA acceptance through the existing deterministic service.
  // No new AI apply route: ordinary version/receipt and fresh review remain required.
  if(fresh.placements.length){const p=fresh.placements[0];await scenario.services.schedule.create(scenario.primary,scenario.current.id,{...p.editor.prefill,commitmentId:p.editor.commitmentId,mutationId:randomUUID(),expectedPlanVersion:p.review.planVersion,reviewKey:p.review.reviewKey,acknowledgeOutsideHours:false,acknowledgeBusy:false});observations.push({kind:'acceptance',source:'explicit QA acceptance of live recommendation through ordinary scheduling service',runId:fresh.run.id,preview:p.review,after:(await scenario.services.schedule.view(scenario.primary,scenario.current.id)).commitments.map(c=>({id:c.id,budget:c.budgetMinutes,scheduled:c.scheduledMinutes}))});}
  const failure=await generate('failure');assert.equal(failure.run.failure,'authentication');assert.ok((await scenario.services.plans.workspace(scenario.primary,r5cWeek)).view);await scenario.services.schedule.preview(scenario.primary,scenario.current.id,{...blockInput,date:'2028-01-07',startTime:'09:00',endTime:'10:00'});
  observations.push({kind:'failure_isolation',corePlanningReadable:true,manualPreviewUsable:true});await save();await inspect('Provider failure');
  if(terminal)while((await terminal.question('R5D inspection complete. Enter stop: ')).trim()!=='stop')console.log('No provider request made.');
 }
}finally{terminal?.close();if(child&&child.exitCode===null){const stopped=once(child,'exit');child.kill('SIGTERM');await stopped;}await database.pool.end();if(created)await admin.query(`DROP DATABASE "${name}" WITH (FORCE)`);await admin.end();await rm(directory,{recursive:true,force:true});}
