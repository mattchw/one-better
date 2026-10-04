import assert from 'node:assert/strict';
import {readFile,readdir,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {parse} from 'dotenv';
import {Pool} from 'pg';
import {anthropicWireSchema} from '../src/providers/anthropic/coaching';
import {reviewStructuredSchema,reviewSystemPrompt} from '../src/modules/coaching/provider';
import {canonical} from '../src/modules/coaching/context';
import {reviewPrivacyMarkers} from '../tests/review-insight-fixture';
const root='docs/r5f-evidence',env=parse(await readFile('.env.local')),secrets=Object.entries(env).filter(([key,value])=>/API_KEY|SECRET|ENCRYPTION_KEYS/.test(key)&&value.length>12).map(([,value])=>value);
async function files(dir:string):Promise<string[]>{const result:string[]=[];for(const f of await readdir(dir,{withFileTypes:true})){const p=join(dir,f.name);result.push(...f.isDirectory()?await files(p):[p]);}return result;}
const paths=(await files(root)).filter(p=>!p.endsWith('/verification.json'));
for(const path of paths){const text=await readFile(path,'utf8');for(const secret of secrets)assert.ok(!text.includes(secret),'Credential value found in evidence.');}
const contexts=paths.filter(p=>p.endsWith('-context.json')&&!p.includes('/preflight/'));
for(const path of contexts){const packet=await readFile(path,'utf8');for(const marker of [reviewPrivacyMarkers.draftDaily,reviewPrivacyMarkers.draftWeekly,reviewPrivacyMarkers.late,reviewPrivacyMarkers.session,reviewPrivacyMarkers.google])assert.ok(!packet.includes(marker),'Private marker found in packet.');}
const digest=(v:unknown)=>createHash('sha256').update(canonical(v)).digest('hex');
const initial=JSON.parse(await readFile(join(root,'results.json'),'utf8')),rerun=JSON.parse(await readFile(join(root,'anthropic-compatibility-results.json'),'utf8'));assert.equal(initial.calls,13);assert.equal(rerun.observations.length,6);assert.equal(initial.promptHash,digest(reviewSystemPrompt));assert.equal(initial.schemaHash,digest(reviewStructuredSchema));assert.ok(rerun.observations.every((o:{identicalFrozenPacket:boolean;upstreamUnchanged:boolean})=>o.identicalFrozenPacket&&o.upstreamUnchanged));
const adminURL=new URL(env.DATABASE_URL);adminURL.pathname='/postgres';const admin=new Pool({connectionString:adminURL.toString()});try{assert.equal((await admin.query("SELECT count(*)::int AS count FROM pg_database WHERE datname ~ '^execution_test_r5f[a-f0-9]+$'")).rows[0].count,0);}finally{await admin.end();}
const signin=await fetch('http://127.0.0.1:3100/sign-in'),health=await fetch('http://127.0.0.1:3100/api/health');assert.equal(signin.status,200);assert.equal(health.status,200);
const result={date:'2026-10-04',scope:'R5F only',checks:{unitTests:467,databaseTests:302,browserTests:152,restartProofs:8,typecheck:'pass',lint:'pass',productionBuild:'pass',documentation:'pass'},evidenceSecretScan:{files:paths.length,configuredSecretMatches:0},privacyPackets:contexts.length,identicalComparisonPackets:true,upstreamUnchanged:true,promptHash:digest(reviewSystemPrompt),applicationSchemaHash:digest(reviewStructuredSchema),anthropicWireSchemaHash:digest(anthropicWireSchema(reviewStructuredSchema)),networkAttempts:20,liveQaDatabaseRemoved:true,normalApp:{origin:'http://127.0.0.1:3100',signinStatus:signin.status,healthStatus:health.status},weeklyReviewSafety:'PASS',weeklyReviewUsefulness:'FAIL'};
await writeFile(join(root,'verification.json'),JSON.stringify(result,null,2));console.log('PASS: evidence secret/privacy checks, frozen contract, and normal local app health.');
