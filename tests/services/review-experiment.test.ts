import {it,expect} from 'vitest';
import {readFile,mkdtemp,readdir,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {loadExperiment,comparisonView,evaluationSchema} from '../../scripts/r5g/experiment';
import {startReviewExperiment} from '../../scripts/r5g/server';
it('replays all six frozen scenarios without leaking rejected prose or excluded bodies',async()=>{
 const experiment=await loadExperiment();expect(experiment.scenarios).toHaveLength(6);
 for(const id of ['already_addressed','clean','completed']){const s=experiment.scenarios.find(s=>s.id===id)!;expect(s.topics).toEqual([]);for(const p of ['openai','anthropic'])expect(s.samples[p]).toMatchObject({status:'accepted',insights:[]});}
 const c=experiment.scenarios.find(s=>s.id==='repeated_carry')!;expect(c.topics[0].question?.key).toBe('repeated_carry');expect(c.samples.openai.insights).toEqual([]);expect(c.samples.anthropic.insights).toEqual([]);
 const text=JSON.stringify(experiment);expect(text).not.toMatch(/PRIVATE_DRAFT|PRIVATE_LATE|PRIVATE_SESSION|PRIVATE_GOOGLE|interruption clarified priorities|two prior reviews|need to differ/);
});
it('rechecks existing AI schema, grounding and freshness before any replay display',async()=>{
 const context=JSON.parse(await readFile('docs/r5f-evidence/gap_reflection-context.json','utf8')),o=JSON.parse(await readFile('docs/r5f-evidence/results.json','utf8')).observations[0];expect(comparisonView(context,o).status).toBe('accepted');
 expect(comparisonView({...context,stateFingerprint:'changed'},o)).toMatchObject({status:'stale',insights:[]});
 const bad=structuredClone(o);bad.rawOutput.insights[0].candidateId='fabricated';expect(comparisonView(context,bad)).toMatchObject({status:'withheld',insights:[]});
 bad.rawOutput.insights=Array(3).fill(o.rawOutput.insights[0]);expect(comparisonView(context,bad).insights).toEqual([]);
});
it('requires explicit complete user evaluations; rejects cross-origin, duplicate cases and stale experiment IDs',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'r5g-http-')),server=await startReviewExperiment({port:0,outputDirectory:directory});
 try{const e=server.experiment,body={experimentId:e.experimentId,responses:e.scenarios.map(s=>({scenario:s.id,provider:'openai',betterDecision:'B',aiAddedValue:'No',aiNuance:'No',aiVerbosity:'Yes',coachDisappeared:'No',weeklyReading:'Yes',notes:'Synthetic HTTP test only.'})),productPreference:'Replace Review AI with deterministic coaching questions',reason:'Synthetic test only.'};
  const post=(value:unknown,origin=server.origin)=>fetch(`${server.origin}/evaluation`,{method:'POST',headers:{'Content-Type':'application/json',Origin:origin},body:JSON.stringify(value)});
  expect((await post(body,'https://untrusted.test')).status).toBe(403);expect((await post({...body,experimentId:'0'.repeat(64)})).status).toBe(400);
  expect(evaluationSchema.safeParse({...body,responses:Array(6).fill(body.responses[0])}).success).toBe(false);
  expect((await readdir(directory))).toEqual([]);expect((await post(body)).status).toBe(200);expect(await readdir(directory)).toHaveLength(1);
 }finally{await server.close();await rm(directory,{recursive:true,force:true});}
});
