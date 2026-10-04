import assert,{AssertionError} from 'node:assert/strict';
import {createHash,randomBytes,randomUUID} from 'node:crypto';
import {spawn,type ChildProcess} from 'node:child_process';
import {once} from 'node:events';
import {createInterface} from 'node:readline/promises';
import {setTimeout as delay} from 'node:timers/promises';
import {mkdtemp,mkdir,readFile,writeFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {parse} from 'dotenv';
import {Pool} from 'pg';
import {migrate} from 'drizzle-orm/node-postgres/migrator';
import OpenAI from 'openai';
import Anthropic from '@anthropic-ai/sdk';
import {connectDatabase} from '../src/db/connect';
import {ApplicationError} from '../src/domain/errors';
import {readAIConfiguration} from '../src/modules/coaching/configuration';
import {coachingService} from '../src/modules/coaching/service';
import {coachingRepository} from '../src/modules/coaching/repository';
import {canonical,fingerprint} from '../src/modules/coaching/context';
import {grounded,outputSchema,type CoachingContext,type CoachingRun,type CoachingScope} from '../src/modules/coaching/domain';
import {systemPrompt,structuredSchema,type AIProvider} from '../src/modules/coaching/provider';
import {openAICoach} from '../src/providers/openai/coaching';
import {anthropicCoach} from '../src/providers/anthropic/coaching';
import {requireTestDatabaseURL} from './test-database';
import {seedR5C,r5cWeek,r5cReviewWeek,r5cNow,r5cPassword} from '../tests/r5c-scenario';

// Explicit, finite QA operations only. This is not a production capability/job.
const live=process.argv.includes('--live'),origin='http://127.0.0.1:3104';
async function loadConfiguration(){let local:Record<string,string>={};for(const path of ['.env','.env.local']){try{local={...local,...parse(await readFile(path))};}catch{ /* Optional local file. */ }}return {...local,...process.env};}
let configuration=await loadConfiguration();
const options=(name:'openai'|'anthropic')=>readAIConfiguration({...configuration,AI_PROVIDER:name}).provider;
if(live&&!options('openai')&&!options('anthropic'))throw new Error('Live R5C requires a provider key and exact model ID in server-side development configuration. Keep secrets out of chat.');
const {url}=requireTestDatabaseURL(),target=new URL(url),adminURL=new URL(url),name=`execution_test_r5c${randomBytes(6).toString('hex')}`;target.pathname=`/${name}`;adminURL.pathname='/postgres';
const admin=new Pool({connectionString:adminURL.toString()}),database=connectDatabase(target.toString()),directory=await mkdtemp(join(tmpdir(),'r5c-quality-')),clockFile=join(directory,'now'),artifacts='docs/r5c-evidence';
let child:ChildProcess|undefined,created=false,input:ReturnType<typeof createInterface>|undefined;
const runs:Record<string,CoachingRun>={},observations:Record<string,unknown>[]=[];
let calls=0;
const digest=(value:unknown)=>createHash('sha256').update(canonical(value)).digest('hex');
const promptHash=digest(systemPrompt),schemaHash=digest(structuredSchema);
async function stop(){if(child&&child.exitCode===null){const ended=once(child,'exit');child.kill('SIGTERM');await ended;}child=undefined;}
async function start(provider:'openai'|'anthropic'){
 await stop();const selected=options(provider)!;
 child=spawn(process.execPath,['node_modules/next/dist/bin/next','start','--hostname','127.0.0.1','--port','3104'],{env:{...process.env,NODE_ENV:'production',DATABASE_URL:target.toString(),BETTER_AUTH_URL:origin,EXECUTION_TEST_CLOCK_FILE:clockFile,AI_PROVIDER:provider,OPENAI_API_KEY:configuration.OPENAI_API_KEY??'',ANTHROPIC_API_KEY:configuration.ANTHROPIC_API_KEY??'',OPENAI_MODEL:configuration.OPENAI_MODEL??'',ANTHROPIC_MODEL:configuration.ANTHROPIC_MODEL??'',AI_TEST_BASE_URL:'',GOOGLE_CALENDAR_CLIENT_ID:'',GOOGLE_CALENDAR_CLIENT_SECRET:'',GOOGLE_CALENDAR_REDIRECT_URI:'',CALENDAR_ENCRYPTION_KEYS:'',CALENDAR_ENCRYPTION_KEY_ID:'',CALENDAR_TEST_ORIGIN:''},stdio:'ignore'});
 for(let i=0;i<120;i++){if(child.exitCode!==null)throw new Error('R5C production process exited.');try{if((await fetch(`${origin}/api/health`)).ok){console.log(JSON.stringify({origin,provider,model:selected.model,week:r5cWeek,reviewWeek:r5cReviewWeek,primaryEmail:'r5c-primary@example.test',restraintEmail:'r5c-restrained@example.test',disposablePassword:r5cPassword}));return;}}catch{}await delay(250);}throw new Error('R5C process did not become ready.');
}
function provider(name:'openai'|'anthropic',failure=false):AIProvider{
 const selected=options(name)!;const key=failure?'one-better-invalid-r5c-quality-gate':selected.key;
 return name==='openai'?openAICoach(new OpenAI({apiKey:key,baseURL:'https://api.openai.com/v1',maxRetries:0,timeout:25000,logLevel:'off'}),selected.model):anthropicCoach(new Anthropic({apiKey:key,baseURL:'https://api.anthropic.com',maxRetries:0,timeout:25000,logLevel:'off'}),selected.model);
}
async function coreHash(){const rows:Record<string,unknown>={};for(const t of ['goal','milestone','action','weekly_plan','weekly_commitment','weekly_plan_amendment','amendment_commitment','commitment_identity','time_block','focus_session','daily_reflection','weekly_review','weekly_review_decision','focus_cycle','focus_cycle_goal','focusable_hours','google_calendar_connection','calendar_availability_cache'])rows[t]=(await database.pool.query(`SELECT row_to_json(t) FROM ${t} t ORDER BY row_to_json(t)::text`)).rows;return digest(rows);}
async function saveEvidence(){await mkdir(artifacts,{recursive:true});await writeFile(join(artifacts,'results.json'),JSON.stringify({status:live?'Live observations recorded; human review and completion report still required':'Prepared only: no live provider evidence',live,calls,promptHash,schemaHash,providers:['openai','anthropic'].map(name=>({provider:name,model:options(name as 'openai'|'anthropic')?.model??null,endpoint:name==='openai'?'https://api.openai.com/v1/responses':'https://api.anthropic.com/v1/messages'})),observations},null,2));}
try{
 await admin.query(`CREATE DATABASE "${name}"`);created=true;await migrate(database.db,{migrationsFolder:'src/db/migrations'});const scenario=await seedR5C(database);await writeFile(clockFile,r5cNow);await mkdir(artifacts,{recursive:true});
 await writeFile(join(artifacts,'scenario.json'),JSON.stringify({synthetic:true,simulatedNow:r5cNow,timezone:'Europe/London',week:r5cWeek,reviewWeek:r5cReviewWeek,promptHash,schemaHash,fingerprints:scenario.fingerprints,contexts:scenario.contexts,assertions:{stableContext:true,threeFocusGoals:true,mostlyUnscheduled:true,fullyScheduled:true,calendarOpen:true,recordedSessions:true,priorCarry:true,calendarPrivacy:true,reviewPrivacyAndCutoff:true,restraintFullyScheduled:true}},null,2));
 console.log('PASS: frozen synthetic Calendar / well-planned / finalized Review scenarios, stable fingerprints, owned facts and privacy/cutoff sentinels. No provider has been called.');
 if(live){
  const repository=coachingRepository(database.db),baselineHash=await coreHash();
  async function generate(kind:'calendar'|'review'|'restrained'|'regenerate'|'failure',name:'openai'|'anthropic'){
   if(calls>=10)throw new Error('Finite R5C budget reached: ten explicit provider requests maximum.');
   const key=`${kind}-${name}`;assert.ok(!runs[key],'Each comparison cell is run once; no silent regeneration.');
   if(kind==='regenerate')assert.ok(observations.some(o=>o.kind==='staleness'),'Mutate the scenario deliberately before regeneration.');
   const actor=kind==='restrained'?scenario.restrained:scenario.primary,scope:CoachingScope=kind==='review'?scenario.reviewScope:scenario.scope,context=await scenario.services.context(actor,scope);
   const expected=kind==='restrained'?scenario.fingerprints.restrained:kind==='review'?scenario.fingerprints.review:kind==='calendar'?scenario.fingerprints.calendar:null;
   if(expected)assert.equal(fingerprint(context),expected,'Comparison scenario changed before both provider runs.');
   const selected=provider(name,kind==='failure');let raw:unknown=null,calledContext:CoachingContext|null=null;
   const instrumented:AIProvider={name:selected.name,model:selected.model,async generateCoaching(packet,schema,signal){assert.equal(digest(systemPrompt),promptHash);assert.equal(digest(schema),schemaHash);assert.equal(fingerprint(packet),fingerprint(context));calledContext=packet;calls++;const result=await selected.generateCoaching(packet,schema,signal);raw=result.output;return result;}};
   const service=coachingService({repository,context:scenario.services.context,provider:instrumented,configuration:'ready',scheduling:scenario.services.schedule,clock:scenario.clock}),before=await coreHash();
   const run=await service.generate(actor,{...scope,mutationId:randomUUID(),fingerprint:fingerprint(context)});assert.equal(await coreHash(),before,'Generation changed upstream domain records.');assert.ok(calledContext);runs[key]=run;
   const parsed=outputSchema.safeParse(raw),referencesGrounded=parsed.success?parsed.data.recommendations.every(r=>grounded(r,context)):null;
   const placementChecks=[];
   for(const [index,r] of run.recommendations.entries()){if(r.proposal.type!=='schedule_candidate')continue;if(r.placement&&!r.unavailable){const p=await service.preview(actor,run.id,{index});placementChecks.push({index,legal:true,afterSimulatedNow:Date.parse(p.review.interval.start)>Date.parse(r5cNow),outsideHours:p.review.outsideHours,busyConflict:p.review.busyConflict,review:p.review});}else placementChecks.push({index,legal:false,unavailable:r.unavailable});}
   if(kind==='failure'){assert.equal(run.status,'failed');assert.equal(run.failure,'authentication');assert.ok((await scenario.services.plans.workspace(actor,r5cWeek)).view);await scenario.services.schedule.preview(actor,scenario.current.id,{commitmentId:scenario.current.commitments.find(c=>c.actionId===scenario.main.actions[0].id)!.id,date:'2028-01-07',startTime:'09:00',endTime:'10:00'});}
   observations.push({kind,provider:name,model:selected.model,contextFingerprint:fingerprint(context),run,rawApplicationOutput:raw,schemaAccepted:parsed.success,referencesGrounded,placementChecks,upstreamUnchanged:true,approximateCostUSD:null,costNote:'Price separately using the exact configured model, returned tokens and official rates; metadata does not contain billed dollars.'});
   await saveEvidence();await writeFile(join(artifacts,`${key}-context.json`),JSON.stringify(context,null,2));console.log(JSON.stringify({kind,provider:name,model:run.model,status:run.status,failure:run.failure,latencyMs:run.latencyMs,usage:run.usage,recommendations:run.recommendations.length,unavailablePlacements:placementChecks.filter(p=>!p.legal).length}));
  }
  async function stale(){assert.ok(runs['calendar-openai']&&runs['calendar-anthropic'],'Generate both providers against the same frozen week first.');assert.equal(await coreHash(),baselineHash);const action=scenario.main.actions[0],commitment=scenario.current.commitments.find(c=>c.actionId===action.id)!,value={commitmentId:commitment.id,date:'2028-01-06',startTime:'10:00',endTime:'11:00'},review=await scenario.services.schedule.preview(scenario.primary,scenario.current.id,value);assert.equal(review.outsideHours,false);assert.equal(review.busyConflict,false);const block=await scenario.services.schedule.create(scenario.primary,scenario.current.id,{...value,mutationId:randomUUID(),expectedPlanVersion:review.planVersion,reviewKey:review.reviewKey,acknowledgeOutsideHours:false,acknowledgeBusy:false});
   const context=await scenario.services.context(scenario.primary,scenario.scope),checks=[];
   for(const name of ['openai','anthropic'] as const){const run=runs[`calendar-${name}`];assert.notEqual(run.fingerprint,fingerprint(context));const service=coachingService({repository,context:scenario.services.context,provider:provider(name),configuration:'ready',scheduling:scenario.services.schedule,clock:scenario.clock});await assert.rejects(service.preview(scenario.primary,run.id,{index:0}),(e:unknown)=>e instanceof ApplicationError&&e.code==='CONFLICT'&&e.details?.kind==='COACHING_STALE');checks.push({provider:name,runId:run.id,stale:true,previewRejected:true,actionableSchedulingProposals:run.recommendations.filter(r=>r.proposal.type==='schedule_candidate'&&r.placement&&!r.unavailable).length});}
   observations.push({kind:'staleness',acceptedManualTimeBlock:block.id,oldFingerprint:scenario.fingerprints.calendar,newFingerprint:fingerprint(context),checks});await saveEvidence();console.log('PASS: ordinary explicit TimeBlock creation stales both saved runs; both old previews conflict before mutation.');
  }
  console.log('Commands: show openai|anthropic; calendar openai|anthropic; restrained openai|anthropic; review openai|anthropic; stale; regenerate openai|anthropic; failure openai|anthropic; stop. Maximum ten live requests; no automatic provider calls.');
  input=createInterface({input:process.stdin,output:process.stdout});
  while(true){const command=(await input.question('R5C command: ')).trim(),[kind,name]=command.split(/\s+/);if(kind==='stop')break;try{configuration=await loadConfiguration();if(kind==='stale'){await stale();continue;}if(name!=='openai'&&name!=='anthropic')throw new Error('Choose an explicit supported provider.');if(!options(name)){console.log(`${name} key/model not configured; no provider request made.`);continue;}if(kind==='show')await start(name);else if(['calendar','restrained','review','regenerate','failure'].includes(kind))await generate(kind as Parameters<typeof generate>[0],name);else throw new Error('Use a documented R5C command.');}catch(e){console.error(e instanceof ApplicationError?e.message:e instanceof AssertionError?e.message:'QA operation failed; inspect saved sanitized evidence before retrying.');}}
 }else console.log('Preparation only: live results, quality review and screenshots remain pending credentials. Run with --live after configuring both providers.');
 await saveEvidence();
}finally{input?.close();await stop();await database.pool.end();if(created)await admin.query(`DROP DATABASE "${name}" WITH (FORCE)`);await admin.end();await rm(directory,{recursive:true,force:true});}
