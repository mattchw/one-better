import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { CoachingContext } from '../src/modules/coaching/domain';
import { coachingOutput } from './coaching-fixture';
export async function startCoachingFixture(){
 let mode='useful',calls=0,lastContext:CoachingContext|null=null;
 const server=createServer(async(req,res)=>{
  try{let raw='';for await(const chunk of req)raw+=chunk;const body=raw?JSON.parse(raw):{};res.setHeader('Content-Type','application/json');
   if(req.url==='/control'){if(req.method==='POST'){mode=body.mode??'useful';if(body.reset)calls=0;}res.end(JSON.stringify({mode,calls,lastContext}));return;}
   if(req.url!=='/v1/responses'&&req.url!=='/v1/messages'){res.statusCode=404;res.end('{}');return;}
   calls++;lastContext=JSON.parse(req.url==='/v1/responses'?body.input:body.messages[0].content);
   if(['authentication','rate_limit','model_unavailable','outage'].includes(mode)){res.statusCode=mode==='authentication'?401:mode==='rate_limit'?429:mode==='model_unavailable'?404:500;res.end(JSON.stringify({error:{type:'api_error',message:'SECRET_FIXTURE_PAYLOAD'}}));return;}
   const output=coachingOutput(lastContext!,mode==='empty'||!lastContext?.planId);
   const text=mode==='malformed'?'bad json':JSON.stringify(output);
   if(req.url==='/v1/responses')res.end(JSON.stringify({id:'resp_fixture',object:'response',created_at:1791010000,status:'completed',output:[{id:'msg_fixture',type:'message',role:'assistant',status:'completed',content:mode==='refusal'?[{type:'refusal',refusal:'Fixture refusal'}]:[{type:'output_text',text,annotations:[]}]}],usage:{input_tokens:100,output_tokens:60,total_tokens:160,input_tokens_details:{cached_tokens:10},output_tokens_details:{reasoning_tokens:0}}}));
   else res.end(JSON.stringify({id:'msg_fixture',type:'message',role:'assistant',model:body.model,content:[{type:'text',text}],stop_reason:mode==='refusal'?'refusal':'end_turn',stop_sequence:null,usage:{input_tokens:100,output_tokens:60,cache_read_input_tokens:10,cache_creation_input_tokens:0}}));
  }catch{res.statusCode=400;res.end('{}');}
 });
 await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
 return {origin:`http://127.0.0.1:${(server.address() as AddressInfo).port}`,close:()=>new Promise<void>((resolve,reject)=>server.close(e=>e?reject(e):resolve()))};
}
export function coachingFixtureEnvironment(origin:string){return {AI_TEST_BASE_URL:origin,AI_PROVIDER:process.env.AI_FIXTURE_PROVIDER==='anthropic'?'anthropic':'openai',OPENAI_API_KEY:'one-better-test-key',ANTHROPIC_API_KEY:'one-better-test-key',OPENAI_MODEL:'fixture-openai',ANTHROPIC_MODEL:'fixture-claude'};}
