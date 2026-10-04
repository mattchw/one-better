import {mkdir,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {loadExperiment} from './r5g/experiment';
import {startReviewExperiment} from './r5g/server';
const output='docs/r5g-evidence';await mkdir(output,{recursive:true});const experiment=await loadExperiment();
const frozenFiles=['domain','context','reader','provider','service','review-candidates','review-validation','candidates','signals'];
const frozenSource=Object.fromEntries(await Promise.all(frozenFiles.map(async name=>[name,createHash('sha256').update(await readFile(`src/modules/coaching/${name}.ts`)).digest('hex')])));
await writeFile(`${output}/comparison.json`,JSON.stringify(experiment,null,2));await writeFile(`${output}/baseline.json`,JSON.stringify({frozenSource,normalProductChanged:false,providerCalls:0},null,2));
console.log('Six frozen scenarios prepared; same Evidence in A/B/C; no provider calls.');
if(process.argv.includes('--serve')){const server=await startReviewExperiment({outputDirectory:output,onEvaluation:path=>console.log(`User evaluation saved: ${path}`)});console.log(`QA comparison: ${server.origin}`);for(const signal of ['SIGINT','SIGTERM'] as const)process.once(signal,()=>{void server.close().then(()=>process.exit(0));});}
