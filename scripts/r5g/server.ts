import {createServer} from 'node:http';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {evaluationSchema,loadExperiment} from './experiment';

export async function startReviewExperiment(options:{port?:number;outputDirectory:string;onEvaluation?:(path:string)=>void}){
 if(process.env.NODE_ENV==='production')throw new Error('R5G comparison is a development/QA tool only.');
 const experiment=await loadExperiment(),directory=fileURLToPath(new URL('.',import.meta.url));let origin='';
 const server=createServer(async(req,res)=>{try{
  res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; frame-ancestors 'none'; form-action 'self'");
  if(req.headers.host!==new URL(origin).host){res.writeHead(403);res.end();return;}
  const url=new URL(req.url??'/',origin);
  const json=(value:unknown,status=200)=>{res.writeHead(status,{'Content-Type':'application/json'});res.end(JSON.stringify(value));};
  if(req.method==='GET'&&url.pathname==='/comparison.json'){json(experiment);return;}
  if(req.method==='GET'&&['/','/workspace.js','/workspace.css'].includes(url.pathname)){const name=url.pathname==='/'?'workspace.html':url.pathname.slice(1);res.writeHead(200,{'Content-Type':name.endsWith('.js')?'text/javascript':name.endsWith('.css')?'text/css':'text/html'});res.end(await readFile(`${directory}${name}`));return;}
  if(req.method==='POST'&&url.pathname==='/evaluation'){
   if(req.headers.origin!==origin||req.headers['content-type']!=='application/json'){json({error:'Expected same-origin JSON evaluation.'},403);return;}
   let body='';for await(const chunk of req){body+=chunk;if(Buffer.byteLength(body)>32000){json({error:'Evaluation too large.'},413);return;}}
   let value:unknown;try{value=JSON.parse(body);}catch{json({error:'Invalid JSON.'},400);return;}
   const parsed=evaluationSchema.safeParse(value);if(!parsed.success||parsed.data.experimentId!==experiment.experimentId){json({error:'Complete each evaluation against the current frozen experiment.'},400);return;}
   await mkdir(options.outputDirectory,{recursive:true});const path=`${options.outputDirectory}/user-evaluation-${randomUUID()}.json`;
   await writeFile(path,JSON.stringify({...parsed.data,submittedAt:new Date().toISOString(),source:'explicit user submission in local QA harness'},null,2),{flag:'wx',mode:0o600});options.onEvaluation?.(path);json({saved:true});return;
  }
  json({error:'Not found.'},404);
 }catch{res.writeHead(500);res.end('The local comparison could not be loaded.');}});
 await new Promise<void>(resolve=>server.listen(options.port??3106,'127.0.0.1',resolve));const address=server.address();if(!address||typeof address==='string')throw new Error('Expected loopback listener.');origin=`http://127.0.0.1:${address.port}`;
 return {origin,experiment,close:()=>new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve()))};
}
