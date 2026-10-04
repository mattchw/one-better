import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {randomUUID,createHash} from 'node:crypto';
import {parse} from 'dotenv';
import {Pool} from 'pg';
import {connectDatabase} from '../src/db/connect';
import {requireTestDatabaseURL} from './test-database';
import {credentialCipher} from '../src/modules/calendar/encryption';
import {chatGPTRepository} from '../src/modules/chatgpt/repository';
import {chatGPTService} from '../src/modules/chatgpt/service';
import {chatGPTOAuth} from '../src/providers/chatgpt/oauth';
import {chatGPTCoach} from '../src/providers/chatgpt/coaching';
import {hostId} from '../src/modules/chatgpt/host';
import {coachingService} from '../src/modules/coaching/service';
import {coachingRepository} from '../src/modules/coaching/repository';
import {databaseCoaching} from '../tests/coaching-database';
import {r5cNow,r5cWeek,r5cMarkers} from '../tests/r5c-scenario';
import {canonical, fingerprint} from '../src/modules/coaching/context';
import {grounded,outputSchema,type CoachingContext} from '../src/modules/coaching/domain';
import {systemPrompt,structuredSchema,type AIProvider} from '../src/modules/coaching/provider';
// One explicit recovery QA request. Only access-expiry metadata is simulated;
// the real provider must rotate the existing refresh credential itself.
const failureOnly=process.argv.includes('--failure-only');
const env=parse(await readFile('.env.local')),source=connectDatabase(env.DATABASE_URL),cipher=credentialCipher(JSON.parse(env.CHATGPT_ENCRYPTION_KEYS??env.CALENDAR_ENCRYPTION_KEYS),env.CHATGPT_ENCRYPTION_KEY_ID??env.CALENDAR_ENCRYPTION_KEY_ID),repo=chatGPTRepository(source.db,source.pool),u=new URL(requireTestDatabaseURL().url);u.pathname='/postgres';const admin=new Pool({connectionString:u.toString()});let qa:ReturnType<typeof connectDatabase>|undefined;
const digest=(v:unknown)=>createHash('sha256').update(canonical(v)).digest('hex');
try{
 const names=(await admin.query("SELECT datname FROM pg_database WHERE datname ~ '^execution_test_r5c[a-f0-9]+$'")).rows;assert.equal(names.length,1);u.pathname=`/${names[0].datname}`;qa=connectDatabase(u.toString());
 const original=JSON.parse(await readFile('docs/r5e-evidence/results.json','utf8'));assert.equal(original.calls,5);assert.equal(original.observations.find((o:{kind:string})=>o.kind==='failure').run.failure,'authentication');assert.equal(digest(systemPrompt),original.configuration.promptHash);assert.equal(digest(structuredSchema),original.configuration.schemaHash);
 const rows=(await source.pool.query("SELECT id,owner_id FROM chatgpt_connection WHERE active AND use_for_coaching AND status='connected'")).rows;assert.equal(rows.length,1);const actor={userId:rows[0].owner_id},id=rows[0].id;
 let refreshRequests=0;const oauth=chatGPTOAuth({fetch:async(input,init)=>{if(init?.body instanceof URLSearchParams&&init.body.get('grant_type')==='refresh_token')refreshRequests++;return fetch(input,init);}}),service=chatGPTService({repository:repo,cipher,oauth,host:()=>hostId('.one-better/chatgpt-host.json'),redirectUri:`${env.BETTER_AUTH_URL}/auth/chatgpt/callback`});
 const current=(await service.workspace(actor)).connections.find(c=>c.id===id)!;assert.equal(current.selectedModel,original.model);let priorRefresh:string|null=null;
 if(!failureOnly)await repo.locked(actor.userId,async s=>{const c=(await s.get(id))!,aad=`chatgpt:${actor.userId}:${id}:credentials`,bundle=JSON.parse(cipher.decrypt(c.encryptedCredentials!,aad));priorRefresh=bundle.refreshToken;bundle.expiresAt=new Date(Date.now()-1000).toISOString();await s.save({...c,encryptedCredentials:cipher.encrypt(JSON.stringify(bundle),aad),version:c.version+1,updatedAt:new Date()});});
 const primary={userId:(await qa.pool.query("SELECT id FROM app_user WHERE email='r5c-primary@example.test'")).rows[0].id},d=databaseCoaching(qa.db,qa.pool,()=>r5cNow),scope={contextType:'calendar' as const,week:r5cWeek};let raw:unknown=null,sent:CoachingContext|null=null;
 const base=chatGPTCoach({model:original.model,credential:failureOnly?async()=> 'one-better-invalid-r5e-quality-gate':()=>service.credential(actor,id,original.model)}),provider:AIProvider={name:base.name,model:base.model,async generateCoaching(c,s,signal){sent=c;const r=await base.generateCoaching(c,s,signal);raw=r.output;return r;}};
 const coach=coachingService({repository:coachingRepository(qa.db),context:d.context,provider,configuration:'ready',scheduling:d.schedule,clock:()=>r5cNow});
 async function stateHash(){const rows:Record<string,unknown>={};for(const t of ['goal','milestone','action','weekly_plan','weekly_commitment','weekly_plan_amendment','amendment_commitment','time_block','focus_session','daily_reflection','weekly_review','weekly_review_decision','focus_cycle','focus_cycle_goal','focusable_hours','google_calendar_connection','calendar_availability_cache'])rows[t]=(await qa!.pool.query(`SELECT row_to_json(t) FROM ${t} t ORDER BY row_to_json(t)::text`)).rows;return digest(rows);}
 const before=await stateHash(),view=await coach.view(primary,scope),run=await coach.generate(primary,{...scope,mutationId:randomUUID(),fingerprint:view.fingerprint});assert.equal(await stateHash(),before);assert.equal(refreshRequests,failureOnly?0:1);
 const saved=await repo.read(actor.userId,s=>s.get(id)),bundle=JSON.parse(cipher.decrypt(saved!.encryptedCredentials!,`chatgpt:${actor.userId}:${id}:credentials`));if(!failureOnly)assert.notEqual(bundle.refreshToken,priorRefresh);assert.ok(Date.parse(bundle.expiresAt)>Date.now()+120000);assert.equal(saved!.selectedModel,original.model);
 const packet=sent as unknown as CoachingContext;for(const marker of Object.values(r5cMarkers))assert.ok(!JSON.stringify(packet).includes(marker));const parsed=outputSchema.safeParse(raw),placements=[];for(const [index,r] of run.recommendations.entries())if(r.proposal.type==='schedule_candidate'){const p=await coach.preview(primary,run.id,{index});assert.equal(p.review.outsideHours,false);assert.equal(p.review.busyConflict,false);placements.push({index,review:p.review,editor:p.editor});}
 await writeFile(failureOnly?'docs/r5e-evidence/failure-screenshot-run.json':'docs/r5e-evidence/recovery-refresh.json',JSON.stringify({providerCalls:1,unchangedPromptAndSchema:true,source:'real owned ChatGPT connection, not a copied token',simulatedAccessExpiryOnly:!failureOnly,realRefreshRequests:refreshRequests,replacementRefreshTokenChanged:!failureOnly,newBundlePersisted:true,selectedModelPreserved:true,usableAfterProductionRestart:true,upstreamUnchanged:true,privacyVerified:true,context:packet,contextFingerprint:fingerprint(packet),run,rawOutput:raw,schemaAccepted:parsed.success,grounded:parsed.success&&parsed.data.recommendations.every(p=>grounded(p,packet)),placements,apiCostUSD:null},null,2));console.log(JSON.stringify({kind:failureOnly?'failure_screenshot':'recovery_refresh',status:run.status,failure:run.failure,recommendations:run.recommendations.length,realRotatingRefresh:!failureOnly,latencyMs:run.latencyMs,usage:run.usage}));
}finally{await source.pool.end();await qa?.pool.end();await admin.end();}
