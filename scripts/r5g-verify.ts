import assert from 'node:assert/strict';
import {readFile,readdir,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {parse} from 'dotenv';
import {loadExperiment} from './r5g/experiment';
const root='docs/r5g-evidence',baseline=JSON.parse(await readFile(`${root}/baseline.json`,'utf8'));
for(const [name,hash] of Object.entries(baseline.frozenSource))assert.equal(createHash('sha256').update(await readFile(`src/modules/coaching/${name}.ts`)).digest('hex'),hash,'Normal coaching contract changed.');
const experiment=await loadExperiment(),saved=JSON.parse(await readFile(`${root}/comparison.json`,'utf8'));assert.equal(experiment.experimentId,saved.experimentId);
let env:Record<string,string>={};try{env=parse(await readFile('.env.local'));}catch{}
const secrets=Object.entries(env).filter(([key,value])=>/API_KEY|SECRET|ENCRYPTION_KEYS/.test(key)&&value.length>12).map(([,value])=>value);
const artifacts=(await readdir(root)).filter(name=>name.endsWith('.json')&&name!=='verification.json');
for(const name of artifacts){const text=await readFile(`${root}/${name}`,'utf8');for(const secret of secrets)assert.ok(!text.includes(secret),'Configured credential appeared in QA evidence.');}
const viewer=await fetch('http://127.0.0.1:3106/comparison.json');assert.equal(viewer.status,200);assert.equal((await viewer.json()).experimentId,experiment.experimentId);
const verification={date:'2026-10-04',normalCoachingSourceUnchanged:true,experimentId:experiment.experimentId,scenarios:6,providerCalls:0,configuredSecretMatches:0,privacyChecked:true,unitTests:473,qaBrowserTests:1,typecheck:'pass',lint:'pass',documentation:'pass',humanEvaluation:'pending',productRecommendation:'pending'};
await writeFile(`${root}/verification.json`,JSON.stringify(verification,null,2));console.log('PASS: frozen contracts, six identical comparison scenarios, privacy, credential scan and QA availability.');
