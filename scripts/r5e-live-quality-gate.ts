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
import {credentialCipher} from '../src/modules/calendar/encryption';
import {chatGPTRepository} from '../src/modules/chatgpt/repository';
import {chatGPTService} from '../src/modules/chatgpt/service';
import {chatGPTOAuth} from '../src/providers/chatgpt/oauth';
import {chatGPTCoach,ChatGPTStreamFailure} from '../src/providers/chatgpt/coaching';
import {planGranted} from '../src/modules/chatgpt/domain';
import {hostId} from '../src/modules/chatgpt/host';
import {migrate} from 'drizzle-orm/node-postgres/migrator';
import {connectDatabase} from '../src/db/connect';
import {ApplicationError} from '../src/domain/errors';
import {coachingRepository} from '../src/modules/coaching/repository';
import {coachingService} from '../src/modules/coaching/service';
import {canonical,fingerprint} from '../src/modules/coaching/context';
import {grounded,outputSchema,rationaleAllowed,type CoachingContext,type CoachingScope} from '../src/modules/coaching/domain';
import {systemPrompt,structuredSchema,type AIProvider} from '../src/modules/coaching/provider';
import {requireTestDatabaseURL} from './test-database';
import {seedR5C,r5cWeek,r5cReviewWeek,r5cNow,r5cPassword,r5cMarkers} from '../tests/r5c-scenario';

// Finite, explicit development QA invocation. No production job/agent/repair loop.
const live=process.argv.includes('--live'),serve=process.argv.includes('--serve'),artifacts=live?'docs/r5e-evidence':'docs/r5e-evidence/preflight',origin='http://127.0.0.1:3105';
// Real credentials stay in the existing owned local connection. This finite
// development harness sends only disposable frozen facts, never personal plans.
// It does not copy a rotating refresh token into a second database.
let configuration:Record<string,string|undefined>={};for(const path of ['.env','.env.local']){try{configuration={...configuration,...parse(await readFile(path))};}catch{/* optional */}}
let source:ReturnType<typeof connectDatabase>|undefined,selected:{model:string;displayName:string;credential:()=>Promise<string>}|undefined;
if(live){
 const sourceURL=new URL(configuration.DATABASE_URL!);assert.equal(sourceURL.hostname,'127.0.0.1');
 const keys=configuration.CHATGPT_ENCRYPTION_KEYS??configuration.CALENDAR_ENCRYPTION_KEYS,keyId=configuration.CHATGPT_ENCRYPTION_KEY_ID??configuration.CALENDAR_ENCRYPTION_KEY_ID;assert.ok(keys&&keyId,'Configure server encryption first.');
 source=connectDatabase(sourceURL.toString());
 const rows=(await source.pool.query("SELECT id,owner_id FROM chatgpt_connection WHERE active AND use_for_coaching AND status='connected' AND ($1::uuid IS NULL OR id=$1::uuid)",[process.env.R5E_CONNECTION_ID??null])).rows;
 assert.equal(rows.length,1,'Connect ChatGPT, select a model and explicitly enable coaching. If several accounts are enabled, set R5E_CONNECTION_ID to the owned registration to compare.');
 const actor={userId:rows[0].owner_id},service=chatGPTService({repository:chatGPTRepository(source.db,source.pool),cipher:credentialCipher(JSON.parse(keys),keyId),oauth:chatGPTOAuth(),host:()=>hostId('.one-better/chatgpt-host.json'),redirectUri:`${configuration.BETTER_AUTH_URL}/auth/chatgpt/callback`});
 const c=(await service.workspace(actor)).connections.find(c=>c.id===rows[0].id)!;assert.ok(planGranted(c.scopes)&&c.selectedModel);const model=c.models.find(m=>m.slug===c.selectedModel);assert.ok(model,'Refresh the account model catalog and explicitly select an available model.');
 selected={model:model.slug,displayName:model.displayName,credential:()=>service.credential(actor,c.id,model.slug)};
}
const {url}=requireTestDatabaseURL(),target=new URL(url),adminURL=new URL(url),name=`execution_test_r5c${randomBytes(6).toString('hex')}`;target.pathname=`/${name}`;adminURL.pathname='/postgres';
const admin=new Pool({connectionString:adminURL.toString()}),database=connectDatabase(target.toString()),directory=await mkdtemp(join(tmpdir(),'r5e-quality-')),clockFile=join(directory,'now');
const digest=(value:unknown)=>createHash('sha256').update(canonical(value)).digest('hex');
let created=false,child:ChildProcess|undefined,terminal:ReturnType<typeof createInterface>|undefined,calls=0;
const observations:Record<string,unknown>[]=[];
async function coreHash(){const rows:Record<string,unknown>={};for(const t of ['goal','milestone','action','weekly_plan','weekly_commitment','weekly_plan_amendment','amendment_commitment','commitment_identity','time_block','focus_session','daily_reflection','weekly_review','weekly_review_decision','focus_cycle','focus_cycle_goal','focusable_hours','google_calendar_connection','calendar_availability_cache'])rows[t]=(await database.pool.query(`SELECT row_to_json(t) FROM ${t} t ORDER BY row_to_json(t)::text`)).rows;return digest(rows);}
async function save(){await mkdir(artifacts,{recursive:true});await writeFile(join(artifacts,'results.json'),JSON.stringify({live,calls,model:selected?.model??null,displayName:selected?.displayName??null,endpoint:'https://api.openai.com/v1/responses',configuration:{authentication:'existing owned ChatGPT OAuth registration; no credential copy',store:false,stream:true,sdkTimeoutMs:25000,applicationTimeoutMs:30000,maxRetries:0,structuredOutput:'text.format JSON schema + unchanged application validator',promptHash:digest(systemPrompt),schemaHash:digest(structuredSchema)},usageInterpretation:'ChatGPT plan allowance/credits; token counts are not a dollar API bill. Credit conversion not supplied.',observations},null,2));}
try{
 const baseline=JSON.parse(await readFile('docs/r5d-evidence/results.json','utf8'));assert.equal(digest(systemPrompt),baseline.configuration.promptHash,'R5D semantic instructions changed.');assert.equal(digest(structuredSchema),baseline.configuration.schemaHash,'R5D output schema changed.');
 await admin.query(`CREATE DATABASE "${name}"`);created=true;await migrate(database.db,{migrationsFolder:'src/db/migrations'});const scenario=await seedR5C(database);await writeFile(clockFile,r5cNow);
 assert.equal(scenario.contexts.calendar.signals.some(s=>s.kind==='repeated_carry'),false,'One prior Carry must not become repeated Carry.');
 assert.equal(scenario.contexts.restrained.signals.filter(s=>s.worthConsidering).length,0);
 assert.ok(scenario.contexts.calendar.scheduleCandidates.length>0);
 await mkdir(artifacts,{recursive:true});await writeFile(join(artifacts,'scenario.json'),JSON.stringify({fixture:'tests/r5c-scenario.ts (unchanged domain scenario; clean-restraint estimate from final R5C run)',week:r5cWeek,reviewWeek:r5cReviewWeek,requestTime:r5cNow,timezone:'Europe/London',contexts:scenario.contexts,fingerprints:scenario.fingerprints,assertions:{privacySentinels:true,finalizedReflectionCutoff:true,noRepeatedCarryFromSingleReview:true,wellPlannedNoDecisionSignal:true,futureCandidates:true}},null,2));
 if(!live){console.log('PASS: unchanged R5D scenarios, prompt/schema and privacy assertions prepared; no provider requests.');await save();}
 else{
  const repository=coachingRepository(database.db);
  async function generate(kind:'calendar'|'restrained'|'review'|'regenerate'|'failure'){
   assert.ok(calls<5,'Five explicit QA requests maximum.');
   const actor=kind==='restrained'?scenario.restrained:scenario.primary,scope:CoachingScope=kind==='review'?scenario.reviewScope:scenario.scope;
   let raw:unknown=null,packet:CoachingContext|null=null,transportFailure:string|null=null,terminalResponse:unknown=null;let diagnostic:Promise<void>=Promise.resolve();
   const actual=chatGPTCoach({model:selected!.model,credential:kind==='failure'?async()=> 'one-better-invalid-r5e-quality-gate':selected!.credential,fetch:async(input,init)=>{const response=await fetch(input,init);if(response.ok){diagnostic=response.clone().text().then(text=>{for(const line of text.split('\n'))if(line.startsWith('data:')){try{const event=JSON.parse(line.slice(5).trim());if(['response.completed','response.failed','response.incomplete'].includes(event.type))terminalResponse={type:event.type,status:event.response?.status,output:event.response?.output,usage:event.response?.usage};}catch{/* Not JSON event. */}}if(!terminalResponse)terminalResponse={contentType:response.headers.get('content-type'),body:text};}).catch(()=>{});}return response;}});
   const provider:AIProvider={name:actual.name,model:actual.model,async generateCoaching(context,schema,signal){calls++;packet=context;try{const r=await actual.generateCoaching(context,schema,signal);await diagnostic;raw=r.output;return r;}catch(e){await diagnostic;transportFailure=e instanceof ChatGPTStreamFailure?e.stage:e instanceof Error&&'kind' in e?'completed_output_validation':'credential';throw e;}}};
   const service=coachingService({repository,context:scenario.services.context,provider,configuration:'ready',scheduling:scenario.services.schedule,clock:scenario.clock});
   const before=await coreHash(),view=await service.view(actor,scope),run=await service.generate(actor,{...scope,mutationId:randomUUID(),fingerprint:view.fingerprint});
   assert.equal(await coreHash(),before,'Coaching altered upstream data.');assert.ok(packet);
   const sent=packet as CoachingContext,text=JSON.stringify(sent);if(scope.contextType==='calendar')for(const marker of Object.values(r5cMarkers))assert.ok(!text.includes(marker));
   else{assert.ok(text.includes(r5cMarkers.daily)&&text.includes(r5cMarkers.weekly));for(const marker of [r5cMarkers.draftDaily,r5cMarkers.draftWeekly,r5cMarkers.late,r5cMarkers.session,r5cMarkers.calendar])assert.ok(!text.includes(marker));}
   const parsed=outputSchema.safeParse(raw),placements=[];
   for(const [index,r] of run.recommendations.entries())if(r.proposal.type==='schedule_candidate'&&r.placement&&!r.unavailable){const p=await service.preview(actor,run.id,{index});assert.ok(Date.parse(p.review.interval.start)>Date.parse(r5cNow));assert.equal(p.review.outsideHours,false);assert.equal(p.review.busyConflict,false);placements.push({index,review:p.review,editor:p.editor,legal:true});}
   const usage=run.usage;
   observations.push({kind,run,rawOutput:raw,contextFingerprint:fingerprint(sent),schemaAccepted:parsed.success,grounded:parsed.success?parsed.data.recommendations.every(r=>grounded(r,sent)):null,rationalesAllowed:parsed.success?parsed.data.recommendations.every(r=>rationaleAllowed(r.rationale)):null,placements,upstreamUnchanged:true,privacyVerified:true,terminalResponse,transportFailure,planUsageTokens:usage,apiCostUSD:null});
   await writeFile(join(artifacts,`${kind}-context.json`),JSON.stringify(sent,null,2));await save();
   console.log(JSON.stringify({kind,status:run.status,failure:run.failure,recommendations:run.recommendations.length,latencyMs:run.latencyMs,usage,transportFailure,legalPreviews:placements.length}));
   return {run,service,placements};
  }
  if(serve){
   child=spawn(process.execPath,['node_modules/next/dist/bin/next','start','--hostname','127.0.0.1','--port','3105'],{env:{...process.env,NODE_ENV:'production',DATABASE_URL:target.toString(),BETTER_AUTH_URL:origin,EXECUTION_TEST_CLOCK_FILE:clockFile,AI_PROVIDER:'openai',ANTHROPIC_API_KEY:'',ANTHROPIC_MODEL:'',OPENAI_API_KEY:'one-better-display-only-no-inference',OPENAI_MODEL:selected!.model,CHATGPT_ENCRYPTION_KEYS:'',CHATGPT_ENCRYPTION_KEY_ID:'',CHATGPT_TEST_ORIGIN:'',CHATGPT_HOST_FILE:join(directory,'inspector-host.json'),AI_TEST_BASE_URL:'',GOOGLE_CALENDAR_CLIENT_ID:'',GOOGLE_CALENDAR_CLIENT_SECRET:'',GOOGLE_CALENDAR_REDIRECT_URI:'',CALENDAR_ENCRYPTION_KEYS:'',CALENDAR_ENCRYPTION_KEY_ID:'',CALENDAR_TEST_ORIGIN:''},stdio:'ignore'});
   for(let i=0;i<120;i++){if(child.exitCode!==null)throw new Error('QA process exited.');try{if((await fetch(`${origin}/api/health`)).ok)break;}catch{}await delay(250);}
   // Inspector renders real saved QA runs. It has no OAuth credentials; do not
   // generate via its button. Only this script makes the finite live requests.
   console.log(JSON.stringify({origin,primaryEmail:'r5c-primary@example.test',restraintEmail:'r5c-restrained@example.test',disposablePassword:r5cPassword,provider:selected!.model}));
   terminal=createInterface({input:process.stdin,output:process.stdout});
  }
  async function inspect(label:string){if(terminal)await terminal.question(`${label} saved. Enter to continue QA: `);}
  const calendar=await generate('calendar');await inspect('Calendar / Why / Preview (do not Schedule until the staleness step)');const well=await generate('restrained');observations.push({kind:'restraint_gate',pass:well.run.status==='succeeded'&&well.run.recommendations.length===0});await save();await inspect('Well planned');const reviewRun=await generate('review');observations.push({kind:'review_gate',safetyPassed:reviewRun.run.status==='succeeded'||reviewRun.run.failure==='invalid_output',qualityNeedsHumanReview:reviewRun.run.status==='succeeded'&&reviewRun.run.recommendations.length>0});await save();await inspect('Review');
  const blockInput={commitmentId:scenario.current.commitments.find(c=>c.actionId===scenario.main.actions[0].id)!.id,date:'2028-01-06',startTime:'10:00',endTime:'11:00'};
  const review=await scenario.services.schedule.preview(scenario.primary,scenario.current.id,blockInput);
  await scenario.services.schedule.create(scenario.primary,scenario.current.id,{...blockInput,mutationId:randomUUID(),expectedPlanVersion:review.planVersion,reviewKey:review.reviewKey,acknowledgeOutsideHours:false,acknowledgeBusy:false});
  assert.equal((await calendar.service.view(scenario.primary,scenario.scope)).run?.stale,true);
  await assert.rejects(calendar.service.preview(scenario.primary,calendar.run.id,{index:0}),(e:unknown)=>e instanceof ApplicationError&&e.details?.kind==='COACHING_STALE');
  observations.push({kind:'staleness',oldRunId:calendar.run.id,staleAfterOrdinaryBlockCreation:true,oldPreviewRejected:true,newUnscheduledMinutes:135});await save();await inspect('Stale advice');
  const fresh=await generate('regenerate');await inspect('Regenerated advice / Preview');
  if(fresh.placements.length){
   const p=fresh.placements[0],blocksBefore=(await scenario.services.schedule.view(scenario.primary,scenario.current.id)).blocks;
   if(terminal)await inspect('Explicitly Schedule the live recommendation in the inspector Preview');
   else await scenario.services.schedule.create(scenario.primary,scenario.current.id,{...p.editor.prefill,commitmentId:p.editor.commitmentId,mutationId:randomUUID(),expectedPlanVersion:p.review.planVersion,reviewKey:p.review.reviewKey,acknowledgeOutsideHours:false,acknowledgeBusy:false});
   const candidate=fresh.run.recommendations[p.index].candidate!,blocks=(await scenario.services.schedule.view(scenario.primary,scenario.current.id)).blocks;
   assert.ok(blocks.some(b=>b.commitmentId===candidate.commitmentId&&Date.parse(b.start)===Date.parse(candidate.start)&&Date.parse(b.end)===Date.parse(candidate.end)&&!blocksBefore.some(old=>old.id===b.id)),'Explicit acceptance was not observed.');
   observations.push({kind:'acceptance',source:terminal?'explicit UI Preview → ordinary Schedule block':'explicit finite QA scheduling-service command',runId:fresh.run.id,onlyDisposableTimeBlockChanged:true,staleAfterAcceptance:(await fresh.service.view(scenario.primary,scenario.scope)).run?.stale===true});await save();
  }
  const failure=await generate('failure');assert.equal(failure.run.status,'failed');assert.ok((await scenario.services.plans.workspace(scenario.primary,r5cWeek)).view);await scenario.services.schedule.preview(scenario.primary,scenario.current.id,{...blockInput,date:'2028-01-07',startTime:'09:00',endTime:'10:00'});
  observations.push({kind:'failure_isolation',corePlanningReadable:true,manualPreviewUsable:true});await save();await inspect('Provider failure');
  if(terminal)while((await terminal.question('R5E inspection complete. Enter stop: ')).trim()!=='stop')console.log('No provider request made.');
 }
}finally{await source?.pool.end();terminal?.close();if(child&&child.exitCode===null){const stopped=once(child,'exit');child.kill('SIGTERM');await stopped;}await database.pool.end();if(created)await admin.query(`DROP DATABASE "${name}" WITH (FORCE)`);await admin.end();await rm(directory,{recursive:true,force:true});}
