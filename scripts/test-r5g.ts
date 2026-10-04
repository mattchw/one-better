import {spawn} from 'node:child_process';
import {mkdtemp,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {startReviewExperiment} from './r5g/server';
const directory=await mkdtemp(join(tmpdir(),'r5g-browser-')),server=await startReviewExperiment({port:0,outputDirectory:directory});
try{process.exitCode=await new Promise<number>((resolve,reject)=>{const child=spawn(process.execPath,['node_modules/@playwright/test/cli.js','test','--config','scripts/r5g/playwright.config.ts'],{stdio:'inherit',env:{...process.env,R5G_QA_ORIGIN:server.origin,R5G_TEST_OUTPUT:directory}});child.once('error',reject);child.once('exit',code=>resolve(code??1));});}finally{await server.close();await rm(directory,{recursive:true,force:true});}
