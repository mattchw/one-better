import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {randomUUID,createHash} from 'node:crypto';
import {createInterface} from 'node:readline/promises';
import {parse} from 'dotenv';
import {Pool} from 'pg';
import Anthropic from '@anthropic-ai/sdk';
import {connectDatabase} from '../src/db/connect';
import {requireTestDatabaseURL} from './test-database';
import {databaseCoaching} from '../tests/coaching-database';
import {r5cNow,r5cWeek} from '../tests/r5c-scenario';
import {canonical,fingerprint} from '../src/modules/coaching/context';
import {grounded,outputSchema,rationaleAllowed,type CoachingContext} from '../src/modules/coaching/domain';
import {coachingService} from '../src/modules/coaching/service';
import {coachingRepository} from '../src/modules/coaching/repository';
import {anthropicCoach} from '../src/providers/anthropic/coaching';
import {systemPrompt,structuredSchema,type AIProvider} from '../src/modules/coaching/provider';
import {readAIConfiguration} from '../src/modules/coaching/configuration';
const original=JSON.parse(await readFile('docs/r5d-evidence/results.json','utf8'));
const previous=original.observations.find((o:{kind:string})=>o.kind==='regenerate');
assert.equal(previous.run.failure,'invalid_output');assert.ok(!original.observations.some((o:{kind:string})=>o.kind==='acceptance'));
// Regression: evaluate the exact original provider payload with the corrected
// validator before making one fresh request. No prompt/model/scenario change.
assert.ok(outputSchema.parse(previous.rawOutput).recommendations.every(r=>rationaleAllowed(r.rationale)));
let environment:Record<string,string|undefined>={};for(const p of ['.env','.env.local'])try{environment={...environment,...parse(await readFile(p))};}catch{}environment={...environment,...process.env};
const config=readAIConfiguration({...environment,AI_PROVIDER:'anthropic'}).provider;assert.equal(config?.model,original.model);
const url=new URL(requireTestDatabaseURL().url);url.pathname='/postgres';const admin=new Pool({connectionString:url.toString()});const rows=(await admin.query("SELECT datname FROM pg_database WHERE datname ~ '^execution_test_r5c[a-f0-9]+$'")).rows;await admin.end();assert.equal(rows.length,1);url.pathname=`/${rows[0].datname}`;
const database=connectDatabase(url.toString()),clock=()=>r5cNow,d=databaseCoaching(database.db,database.pool,clock),scope={contextType:'calendar' as const,week:r5cWeek},terminal=createInterface({input:process.stdin,output:process.stdout});
const artifact='docs/r5d-evidence/regenerate-followup.json';
const digest=(v:unknown)=>createHash('sha256').update(canonical(v)).digest('hex');
try{
 const actor={userId:(await database.pool.query("SELECT id FROM app_user WHERE email='r5c-primary@example.test'")).rows[0].id};
 const context=await d.context(actor,scope);assert.equal(fingerprint(context),previous.contextFingerprint,'The follow-up must use exactly the same facts as the withheld regeneration.');assert.equal(digest(systemPrompt),original.configuration.promptHash);assert.equal(digest(structuredSchema),original.configuration.schemaHash);
 const base=anthropicCoach(new Anthropic({apiKey:config!.key,baseURL:'https://api.anthropic.com',maxRetries:0,timeout:25000,logLevel:'off'}),config!.model);
 let raw:unknown=null,sent:CoachingContext|null=null;
 const provider:AIProvider={name:base.name,model:base.model,async generateCoaching(packet,schema,signal){sent=packet;assert.equal(fingerprint(packet),previous.contextFingerprint);const r=await base.generateCoaching(packet,schema,signal);raw=r.output;return r;}};
 const service=coachingService({repository:coachingRepository(database.db),context:d.context,provider,configuration:'ready',scheduling:d.schedule,clock});
 const state=async()=>{const result:Record<string,unknown>={};for(const t of ['goal','action','weekly_plan','weekly_commitment','weekly_plan_amendment','amendment_commitment','focus_session','daily_reflection','weekly_review','weekly_review_decision','focus_cycle','focus_cycle_goal','focusable_hours','calendar_availability_cache'])result[t]=(await database.pool.query(`SELECT row_to_json(t) FROM ${t} t WHERE owner_id=$1 ORDER BY row_to_json(t)::text`,[actor.userId])).rows;return digest(result);};
 const before=await state(),blocksBefore=(await database.pool.query('SELECT * FROM time_block WHERE owner_id=$1',[actor.userId])).rows;
 const view=await service.view(actor,scope),run=await service.generate(actor,{...scope,mutationId:randomUUID(),fingerprint:view.fingerprint});assert.equal(await state(),before);assert.equal((await database.pool.query('SELECT * FROM time_block WHERE owner_id=$1',[actor.userId])).rows.length,blocksBefore.length);
 const parsed=outputSchema.safeParse(raw),report:Record<string,unknown>={reason:'Fix overly broad duration guard: available hours is qualitative, not a new duration',providerCalls:1,unchangedPrompt:true,unchangedModel:true,unchangedScenario:true,priorPayloadPassesCorrectedValidator:true,contextFingerprint:fingerprint(sent!),run,rawOutput:raw,schemaAccepted:parsed.success,grounded:parsed.success?parsed.data.recommendations.every(r=>grounded(r,context)):false,approximateTextCostUSD:run.usage&&run.usage.inputTokens!==null&&run.usage.outputTokens!==null?(run.usage.inputTokens+(run.usage.cachedInputTokens??0)*0.1+run.usage.outputTokens*5)/1e6:null};
 await writeFile(artifact,JSON.stringify(report,null,2));console.log(JSON.stringify({status:run.status,failure:run.failure,recommendations:run.recommendations.length,latencyMs:run.latencyMs,usage:run.usage,cost:report.approximateTextCostUSD}));
 if(run.status==='succeeded'&&run.recommendations[0]?.proposal.type==='schedule_candidate'){
  const preview=await service.preview(actor,run.id,{index:0});assert.equal(preview.review.outsideHours,false);assert.equal(preview.review.busyConflict,false);report.preview=preview;await writeFile(artifact,JSON.stringify(report,null,2));
  await terminal.question('Inspect live Preview and explicitly Schedule block in the disposable UI, then press Enter: ');
  const blocks=(await d.schedule.view(actor,context.planId!)).blocks,candidate=run.recommendations[0].candidate!;
  assert.ok(blocks.some(b=>Date.parse(b.start)===Date.parse(candidate.start)&&Date.parse(b.end)===Date.parse(candidate.end)&&b.commitmentId===candidate.commitmentId&&!blocksBefore.some(p=>p.id===b.id)),'No explicit UI acceptance was observed.');
  assert.equal(await state(),before,'UI scheduling changed Goal/Action/plan/reflection/execution data.');assert.equal((await service.view(actor,scope)).run?.stale,true);
  report.acceptance={source:'live saved recommendation → existing UI Preview → explicit Schedule block',accepted:true,onlyTimeBlockChanged:true,adviceStaleAfterAcceptance:true,scheduledMinutes:(await d.schedule.view(actor,context.planId!)).commitments.find(c=>c.id===candidate.commitmentId)!.scheduledMinutes};await writeFile(artifact,JSON.stringify(report,null,2));console.log('PASS: explicit UI acceptance creates only a TimeBlock and stales the advice.');
 }
}finally{terminal.close();await database.pool.end();}
