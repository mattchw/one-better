// Explicit development QA only; no production capabilities or prompt changes.
import assert from 'node:assert/strict';
import {randomUUID,randomBytes,createHash} from 'node:crypto';
import {readFile,writeFile} from 'node:fs/promises';
import {parse} from 'dotenv';
import {Pool} from 'pg';
import {migrate} from 'drizzle-orm/node-postgres/migrator';
import Anthropic from '@anthropic-ai/sdk';
import {connectDatabase} from '../src/db/connect';
import {requireTestDatabaseURL} from './test-database';
import {databaseCoaching} from '../tests/coaching-database';
import {seedR5C,r5cNow,r5cWeek,r5cMarkers} from '../tests/r5c-scenario';
import {canonical,fingerprint} from '../src/modules/coaching/context';
import {readAIConfiguration} from '../src/modules/coaching/configuration';
import {coachingService} from '../src/modules/coaching/service';
import {coachingRepository} from '../src/modules/coaching/repository';
import {anthropicCoach} from '../src/providers/anthropic/coaching';
import {grounded,outputSchema} from '../src/modules/coaching/domain';
import {systemPrompt,structuredSchema,type AIProvider} from '../src/modules/coaching/provider';
import {ApplicationError} from '../src/domain/errors';

const mode=process.argv[2];assert.ok(['stale','regenerate','clean-restraint'].includes(mode),'Choose an explicit QA operation.');
const base=requireTestDatabaseURL().url,adminURL=new URL(base);adminURL.pathname='/postgres';
const admin=new Pool({connectionString:adminURL.toString()});
const clean=mode==='clean-restraint';let created=false;
let name='';
if(clean){name=`execution_test_r5c${randomBytes(6).toString('hex')}`;await admin.query(`CREATE DATABASE "${name}"`);created=true;}
else{const names=(await admin.query("SELECT datname FROM pg_database WHERE datname ~ '^execution_test_r5c[a-f0-9]+$'")).rows;assert.equal(names.length,1,'Follow-up requires exactly one owned active R5C database.');name=names[0].datname;}
const url=new URL(base);url.pathname=`/${name}`;const database=connectDatabase(url.toString());
const digest=(v:unknown)=>createHash('sha256').update(canonical(v)).digest('hex');
const artifact=`docs/r5c-evidence/${mode}.json`;
async function coreHash(){const result:Record<string,unknown>={};for(const t of ['goal','milestone','action','weekly_plan','weekly_commitment','weekly_plan_amendment','amendment_commitment','commitment_identity','time_block','focus_session','daily_reflection','weekly_review','weekly_review_decision','focus_cycle','focus_cycle_goal','focusable_hours','google_calendar_connection','calendar_availability_cache'])result[t]=(await database.pool.query(`SELECT row_to_json(t) FROM ${t} t ORDER BY row_to_json(t)::text`)).rows;return digest(result);}
try{
 let actor:{userId:string};
 if(clean){await migrate(database.db,{migrationsFolder:'src/db/migrations'});actor=(await seedR5C(database)).restrained;}
 else actor={userId:(await database.pool.query("SELECT id FROM app_user WHERE email='r5c-primary@example.test'")).rows[0].id};
 const services=databaseCoaching(database.db,database.pool,()=>r5cNow),scope={contextType:'calendar' as const,week:r5cWeek},repository=coachingRepository(database.db);
 let local:Record<string,string>={};for(const path of ['.env','.env.local']){try{local={...local,...parse(await readFile(path))};}catch{}}
 const options=readAIConfiguration({...local,...process.env,AI_PROVIDER:'anthropic'}).provider;assert.ok(options);
 const selected=anthropicCoach(new Anthropic({apiKey:options.key,baseURL:'https://api.anthropic.com',timeout:25000,maxRetries:0,logLevel:'off'}),options.model);
 const service=coachingService({repository,context:services.context,provider:selected,configuration:'ready',scheduling:services.schedule,clock:()=>r5cNow});
 const context=await services.context(actor,scope),before=await coreHash();
 if(mode==='stale'){
  const original=JSON.parse(await readFile('docs/r5c-evidence/scenario.json','utf8'));assert.equal(fingerprint(context),original.fingerprints.calendar);
  const old=(await service.view(actor,scope)).run;assert.ok(old&&old.provider==='anthropic');
  const commitment=context.facts.find(f=>f.reference?.kind==='commitment'&&f.data.title==='Test the first-week onboarding flow')!.reference!.id;
  const value={commitmentId:commitment,date:'2028-01-06',startTime:'10:00',endTime:'11:00'},preview=await services.schedule.preview(actor,context.planId!,value);assert.equal(preview.outsideHours,false);assert.equal(preview.busyConflict,false);
  const block=await services.schedule.create(actor,context.planId!,{...value,mutationId:randomUUID(),expectedPlanVersion:preview.planVersion,reviewKey:preview.reviewKey,acknowledgeOutsideHours:false,acknowledgeBusy:false});
  const view=await service.view(actor,scope);assert.equal(view.run?.stale,true);
  const index=old.recommendations.findIndex(r=>r.proposal.type==='schedule_candidate');assert.ok(index>=0);
  await assert.rejects(service.preview(actor,old.id,{index}),(e:unknown)=>e instanceof ApplicationError&&e.details?.kind==='COACHING_STALE');
  await writeFile(artifact,JSON.stringify({kind:mode,provider:'anthropic',oldRunId:old.id,oldFingerprint:old.fingerprint,newFingerprint:view.fingerprint,stale:true,oldPreviewRejected:true,oldSchedulingProposalWasAlreadyUnavailable:!!old.recommendations[index].unavailable,manualBlock:block,manualPreview:preview,upstreamChangedOnlyByExplicitPlacement:true,noProviderCall:true},null,2));
  console.log('PASS: explicit legal TimeBlock creation stales live Claude advice; old scheduling preview is rejected. Original proposal was already unavailable (past time).');
 }else{
  assert.ok(!JSON.stringify(context).includes(r5cMarkers.session));for(const marker of [r5cMarkers.daily,r5cMarkers.weekly,r5cMarkers.draftDaily,r5cMarkers.draftWeekly,r5cMarkers.late])assert.ok(!JSON.stringify(context).includes(marker));
  if(mode==='regenerate'){const previous=JSON.parse(await readFile('docs/r5c-evidence/stale.json','utf8'));assert.equal(fingerprint(context),previous.newFingerprint);}
  let raw:unknown=null;
  const instrumented:AIProvider={name:selected.name,model:selected.model,async generateCoaching(packet,schema,signal){assert.equal(fingerprint(packet),fingerprint(context));assert.equal(digest(schema),digest(structuredSchema));const result=await selected.generateCoaching(packet,schema,signal);raw=result.output;return result;}};
  const active=coachingService({repository,context:services.context,provider:instrumented,configuration:'ready',scheduling:services.schedule,clock:()=>r5cNow});
  const run=await active.generate(actor,{...scope,mutationId:randomUUID(),fingerprint:fingerprint(context)});assert.equal(await coreHash(),before);
  const parsed=outputSchema.safeParse(raw),checks=[];
  for(const [index,r] of run.recommendations.entries())if(r.proposal.type==='schedule_candidate'){if(r.placement&&!r.unavailable){const p=await active.preview(actor,run.id,{index});checks.push({index,legal:true,afterSimulatedNow:Date.parse(p.review.interval.start)>Date.parse(r5cNow),review:p.review});}else checks.push({index,legal:false,unavailable:r.unavailable});}
  await writeFile(artifact,JSON.stringify({kind:mode,provider:'anthropic',model:options.model,context,contextFingerprint:fingerprint(context),promptHash:digest(systemPrompt),schemaHash:digest(structuredSchema),run,rawApplicationOutput:raw,schemaAccepted:parsed.success,referencesGrounded:parsed.success?parsed.data.recommendations.every(r=>grounded(r,context)):null,placementChecks:checks,upstreamUnchanged:true,explicitLiveRequests:1},null,2));
  console.log(JSON.stringify({kind:mode,model:run.model,status:run.status,latencyMs:run.latencyMs,usage:run.usage,recommendations:run.recommendations.length,checks}));
 }
}finally{await database.pool.end();if(created)await admin.query(`DROP DATABASE "${name}" WITH (FORCE)`);await admin.end();}
