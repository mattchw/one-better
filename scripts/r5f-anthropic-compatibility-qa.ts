import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {createInterface} from 'node:readline/promises';
import {parse} from 'dotenv';
import {Pool} from 'pg';
import Anthropic from '@anthropic-ai/sdk';
import {connectDatabase} from '../src/db/connect';
import {requireTestDatabaseURL} from './test-database';
import {databaseCoaching} from '../tests/coaching-database';
import {reviewQualityNow,reviewQualityWeek,reviewQualityKinds} from '../tests/review-insight-fixture';
import {coachingService} from '../src/modules/coaching/service';
import {coachingRepository} from '../src/modules/coaching/repository';
import {anthropicCoach} from '../src/providers/anthropic/coaching';
import {canonical} from '../src/modules/coaching/context';
import {reviewOutputSchema} from '../src/modules/coaching/domain';
import {reviewInsightGrounded} from '../src/modules/coaching/review-validation';
const target=new URL(requireTestDatabaseURL().url),adminURL=new URL(target);adminURL.pathname='/postgres';const admin=new Pool({connectionString:adminURL.toString()});
const names=(await admin.query("SELECT datname FROM pg_database WHERE datname ~ '^execution_test_r5f[a-f0-9]+$'")).rows;assert.equal(names.length,1);target.pathname='/'+names[0].datname;await admin.end();
const db=connectDatabase(target.toString()),env=parse(await readFile('.env.local')),clock=()=>reviewQualityNow,d=databaseCoaching(db.db,db.pool,clock),provider=anthropicCoach(new Anthropic({apiKey:env.ANTHROPIC_API_KEY,maxRetries:0,timeout:25000,logLevel:'off'}),env.ANTHROPIC_MODEL?.trim()||'claude-haiku-4-5-20251001'),terminal=createInterface({input:process.stdin,output:process.stdout}),observations:unknown[]=[];
async function core(){const result:unknown[]=[];for(const t of ['goal','milestone','action','weekly_plan','weekly_commitment','weekly_plan_amendment','amendment_commitment','time_block','focus_session','daily_reflection','weekly_review','weekly_review_decision','focus_cycle','focus_cycle_goal','focusable_hours'])result.push((await db.pool.query(`SELECT row_to_json(t) FROM ${t} t ORDER BY row_to_json(t)::text`)).rows);return canonical(result);}
try{for(const kind of reviewQualityKinds){const email=`r5f-${kind}@example.test`,users=(await db.pool.query('SELECT id FROM app_user WHERE email=$1',[email])).rows;assert.equal(users.length,1);const actor={userId:users[0].id},scope={contextType:'weekly_review' as const,week:reviewQualityWeek},context=await d.context(actor,scope),original=JSON.parse(await readFile(`docs/r5f-evidence/${kind}-context.json`,'utf8'));assert.equal(canonical(context),canonical(original));let raw:unknown=null;
 const service=coachingService({repository:coachingRepository(db.db),context:d.context,provider:{...provider,async generateCoaching(...args){assert.equal(canonical(args[0]),canonical(original));const r=await provider.generateCoaching(...args);raw=r.output;return r;}},configuration:'ready',scheduling:d.schedule,clock});const before=await core(),view=await service.view(actor,scope),run=await service.generate(actor,{...scope,mutationId:randomUUID(),fingerprint:view.fingerprint});assert.equal(await core(),before);const parsed=reviewOutputSchema.safeParse(raw);observations.push({kind,provider:provider.name,model:provider.model,run,rawOutput:raw,schemaAccepted:parsed.success,grounded:parsed.success?parsed.data.insights.every(p=>reviewInsightGrounded(p,context)):null,identicalFrozenPacket:true,upstreamUnchanged:true,latencyMs:run.latencyMs,usage:run.usage});await writeFile('docs/r5f-evidence/anthropic-compatibility-results.json',JSON.stringify({reason:'Transport-only unsupported maxItems removal; same application schema, same frozen packets and prompt.',observations},null,2));console.log(JSON.stringify({kind,status:run.status,failure:run.failure,insights:run.recommendations.length,latencyMs:run.latencyMs,usage:run.usage,email}));await terminal.question('Capture repaired Haiku result; Enter to continue: ');
}}finally{terminal.close();await db.pool.end();}
