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
import {credentialCipher} from '../src/modules/calendar/encryption';
import {chatGPTRepository} from '../src/modules/chatgpt/repository';
import {chatGPTService} from '../src/modules/chatgpt/service';
import {chatGPTOAuth} from '../src/providers/chatgpt/oauth';
import {chatGPTCoach} from '../src/providers/chatgpt/coaching';
import {anthropicCoach} from '../src/providers/anthropic/coaching';
import {hostId} from '../src/modules/chatgpt/host';
import {coachingRepository} from '../src/modules/coaching/repository';
import {coachingService} from '../src/modules/coaching/service';
import {canonical} from '../src/modules/coaching/context';
import {reviewOutputSchema,type CoachingContext} from '../src/modules/coaching/domain';
import {reviewInsightGrounded} from '../src/modules/coaching/review-validation';
import {reviewSystemPrompt,reviewStructuredSchema,type AIProvider} from '../src/modules/coaching/provider';
import {seedR5F,r5fPassword} from '../tests/r5f-scenario';
import {reviewQualityNow,reviewPrivacyMarkers} from '../tests/review-insight-fixture';
import {requireTestDatabaseURL,dropIsolatedTestDatabase} from './test-database';

// Finite explicit synthetic QA, never a production generator or repair loop.
const live=process.argv.includes('--live'),serve=process.argv.includes('--serve'),origin='http://127.0.0.1:3105',artifacts=live?'docs/r5f-evidence':'docs/r5f-evidence/preflight';
let configuration:Record<string,string|undefined>={};for(const file of ['.env','.env.local'])try{configuration={...configuration,...parse(await readFile(file))};}catch{/* Optional file. */}
const digest=(v:unknown)=>createHash('sha256').update(canonical(v)).digest('hex');
const target=new URL(requireTestDatabaseURL().url),adminURL=new URL(target);adminURL.pathname='/postgres';const name=`execution_test_r5f${randomBytes(6).toString('hex')}`;target.pathname=`/${name}`;
const admin=new Pool({connectionString:adminURL.toString()}),database=connectDatabase(target.toString()),directory=await mkdtemp(join(tmpdir(),'r5f-quality-')),clockFile=join(directory,'now');
let source:ReturnType<typeof connectDatabase>|undefined,created=false,child:ChildProcess|undefined,terminal:ReturnType<typeof createInterface>|undefined;
const providers:AIProvider[]=[],observations:Record<string,unknown>[]=[],packets=new Map<string,string>();let calls=0;
async function stop(){if(child&&child.exitCode===null){const done=once(child,'exit');child.kill('SIGTERM');await done;}child=undefined;}
async function coreHash(){const data:Record<string,unknown>={};for(const t of ['goal','milestone','action','weekly_plan','weekly_commitment','weekly_plan_amendment','amendment_commitment','time_block','focus_session','daily_reflection','weekly_review','weekly_review_decision','focus_cycle','focus_cycle_goal','focusable_hours'])data[t]=(await database.pool.query(`SELECT row_to_json(t) FROM ${t} t ORDER BY row_to_json(t)::text`)).rows;return digest(data);}
async function save(){await mkdir(artifacts,{recursive:true});await writeFile(join(artifacts,'results.json'),JSON.stringify({live,calls,requestTime:reviewQualityNow,promptHash:digest(reviewSystemPrompt),schemaHash:digest(reviewStructuredSchema),providers:providers.map(p=>({name:p.name,model:p.model})),usageInterpretation:'OpenAI OAuth tokens represent ChatGPT plan usage, not a dollar API bill. Anthropic token counts represent API-key usage; no local billing assertion.',observations},null,2));}
try{
 await admin.query(`CREATE DATABASE "${name}"`);created=true;await migrate(database.db,{migrationsFolder:'src/db/migrations'});const scenario=await seedR5F(database.db,database.pool);await writeFile(clockFile,reviewQualityNow);
 for(const f of scenario.fixtures){const context=await scenario.services.context(f.actor,f.scope),text=JSON.stringify(context);
  for(const marker of [reviewPrivacyMarkers.draftDaily,reviewPrivacyMarkers.draftWeekly,reviewPrivacyMarkers.late,reviewPrivacyMarkers.session,reviewPrivacyMarkers.google])assert.ok(!text.includes(marker),`Privacy exclusion failed: ${f.kind}`);
  if(['already_addressed','clean','completed'].includes(f.kind))assert.equal(context.reviewCandidates!.length,0);else assert.ok(context.reviewCandidates!.length>0);
  if(f.kind==='gap_reflection')assert.ok(context.reviewCandidates![0].reflectionRefs.length>0);
  await mkdir(artifacts,{recursive:true});await writeFile(join(artifacts,`${f.kind}-context.json`),JSON.stringify(context,null,2));packets.set(f.kind,canonical(context));
 }
 await writeFile(join(artifacts,'frozen-contract.json'),JSON.stringify({prompt:reviewSystemPrompt,schema:reviewStructuredSchema,promptHash:digest(reviewSystemPrompt),schemaHash:digest(reviewStructuredSchema),fixtures:'tests/r5f-scenario.ts',cases:scenario.fixtures.map(f=>({kind:f.kind,week:f.scope.week,contextHash:digest(JSON.parse(packets.get(f.kind)!))})),reviewedExpectations:{gap_reflection:'Cautious relationship and useful question, not generic priorities or inferred causality.',already_addressed:'No duplicate protection advice; the attention topic is deterministically suppressed.',repeated_carry:'Actual finalized pattern, no model rollover choice.',clean:'Zero insights.',completed:'Zero needs-attention insight for terminal Action.',no_reflection:'Bounded deterministic relationship, no invented explanatory context.'}},null,2));
 if(!live){await save();console.log('PASS: six frozen owned scenarios and privacy exclusions; no provider calls.');}
 else{
  const sourceURL=new URL(configuration.DATABASE_URL!);assert.equal(sourceURL.hostname,'127.0.0.1');source=connectDatabase(sourceURL.toString());
  const registrations=(await source.pool.query("SELECT id,owner_id FROM chatgpt_connection WHERE active AND use_for_coaching AND status='connected' AND selected_model='gpt-5.6-sol'")).rows;assert.equal(registrations.length,1,'Reconnect the verified GPT-5.6-Sol registration and explicitly enable coaching.');
  const owner={userId:registrations[0].owner_id},connectionId=registrations[0].id,connection=chatGPTService({repository:chatGPTRepository(source.db,source.pool),cipher:credentialCipher(JSON.parse(configuration.CHATGPT_ENCRYPTION_KEYS??configuration.CALENDAR_ENCRYPTION_KEYS!),configuration.CHATGPT_ENCRYPTION_KEY_ID??configuration.CALENDAR_ENCRYPTION_KEY_ID!),oauth:chatGPTOAuth(),host:()=>hostId('.one-better/chatgpt-host.json'),redirectUri:`${configuration.BETTER_AUTH_URL}/auth/chatgpt/callback`});
  providers.push(chatGPTCoach({model:'gpt-5.6-sol',credential:()=>connection.credential(owner,connectionId,'gpt-5.6-sol')}));
  if(configuration.ANTHROPIC_API_KEY?.trim())providers.push(anthropicCoach(new Anthropic({apiKey:configuration.ANTHROPIC_API_KEY,timeout:25_000,maxRetries:0,logLevel:'off'}),configuration.ANTHROPIC_MODEL?.trim()||'claude-haiku-4-5-20251001'));
  if(serve)terminal=createInterface({input:process.stdin,output:process.stdout});
  for(const actual of providers){
   if(serve){await stop();child=spawn(process.execPath,['node_modules/next/dist/bin/next','start','--hostname','127.0.0.1','--port','3105'],{env:{...process.env,NODE_ENV:'production',DATABASE_URL:target.toString(),BETTER_AUTH_URL:origin,EXECUTION_TEST_CLOCK_FILE:clockFile,AI_PROVIDER:actual.name,OPENAI_MODEL:actual.model,ANTHROPIC_MODEL:actual.model,OPENAI_API_KEY:'one-better-inspector-no-generation',ANTHROPIC_API_KEY:'one-better-inspector-no-generation',AI_TEST_BASE_URL:'',CHATGPT_ENCRYPTION_KEYS:'',CHATGPT_ENCRYPTION_KEY_ID:'',CHATGPT_TEST_ORIGIN:'',CHATGPT_HOST_FILE:join(directory,'inspector-host.json'),GOOGLE_CALENDAR_CLIENT_ID:'',GOOGLE_CALENDAR_CLIENT_SECRET:'',CALENDAR_ENCRYPTION_KEYS:'',CALENDAR_ENCRYPTION_KEY_ID:'',CALENDAR_TEST_ORIGIN:''},stdio:'ignore'});
    for(let i=0;i<120;i++){if(child.exitCode!==null)throw new Error('Inspector process exited.');try{if((await fetch(`${origin}/api/health`)).ok)break;}catch{}await delay(250);}
   }
   for(const f of scenario.fixtures){assert.ok(calls<14);let raw:unknown=null,packet:CoachingContext|null=null;
    const provider:AIProvider={name:actual.name,model:actual.model,async generateCoaching(context,schema,signal){calls++;assert.equal(canonical(context),packets.get(f.kind),'Provider comparison context changed.');assert.equal(digest(schema),digest(reviewStructuredSchema));packet=context;const response=await actual.generateCoaching(context,schema,signal);raw=response.output;return response;}};
    const service=coachingService({repository:coachingRepository(database.db),context:scenario.services.context,provider,configuration:'ready',scheduling:scenario.services.schedule,clock:scenario.clock}),before=await coreHash(),view=await service.view(f.actor,f.scope),run=await service.generate(f.actor,{...f.scope,mutationId:randomUUID(),fingerprint:view.fingerprint});
    assert.equal(await coreHash(),before);assert.ok(packet);const parsed=reviewOutputSchema.safeParse(raw);
    observations.push({kind:f.kind,provider:actual.name,model:actual.model,run,rawOutput:raw,schemaAccepted:parsed.success,grounded:parsed.success?parsed.data.insights.every(p=>reviewInsightGrounded(p,packet!)):null,upstreamUnchanged:true,privacyVerified:true,contextHash:digest(packet),latencyMs:run.latencyMs,usage:run.usage});await save();console.log(JSON.stringify({kind:f.kind,provider:actual.name,status:run.status,failure:run.failure,insights:run.recommendations.length,latencyMs:run.latencyMs,usage:run.usage}));
    if(terminal){console.log(JSON.stringify({origin,email:f.email,password:r5fPassword,review:f.scope.week,provider:actual.name}));await terminal.question('Saved live output. Capture this Review; Enter to continue: ');}
   }
  }
  // Explicit synthetic admission failure leaves the actual credential untouched.
  const f=scenario.fixtures[0],failure=chatGPTCoach({model:'gpt-5.6-sol',credential:async()=> 'one-better-invalid-r5f-quality-gate'}),before=await coreHash();
  const service=coachingService({repository:coachingRepository(database.db),context:scenario.services.context,provider:{...failure,async generateCoaching(...args){calls++;return failure.generateCoaching(...args);}},configuration:'ready',scheduling:scenario.services.schedule,clock:scenario.clock}),view=await service.view(f.actor,f.scope),run=await service.generate(f.actor,{...f.scope,mutationId:randomUUID(),fingerprint:view.fingerprint});assert.equal(run.status,'failed');assert.equal(await coreHash(),before);assert.ok((await scenario.services.reviews.workspace(f.actor,f.scope.week)).facts);observations.push({kind:'provider_failure',provider:'openai',run,upstreamUnchanged:true,coreReviewReadable:true});await save();
  if(terminal){console.log(JSON.stringify({email:f.email,password:r5fPassword,review:f.scope.week}));await terminal.question('Capture failure; Enter to stop the inspector: ');}
 }
}finally{terminal?.close();await stop();await source?.pool.end();await database.pool.end();if(created)await dropIsolatedTestDatabase(admin,name);await admin.end();await rm(directory,{recursive:true,force:true});}
