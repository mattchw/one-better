import OpenAI from 'openai';
import type {ResponseOutputItem} from 'openai/resources/responses/responses';
import {CoachingFailure,type Usage} from '../../modules/coaching/domain';
import {promptFor,type AIProvider} from '../../modules/coaching/provider';
import {safeProviderFailure} from '../ai-errors';
export class ChatGPTStreamFailure extends CoachingFailure {constructor(public readonly stage:'admission'|'failed'|'incomplete'|'interrupted',kind:ConstructorParameters<typeof CoachingFailure>[0],usage:Usage|null=null){super(kind,usage);}}
export function chatGPTCoach(options:{model:string;credential:()=>Promise<string>;baseURL?:string;fetch?:typeof fetch}):AIProvider{return {name:'openai',model:options.model,async generateCoaching(context,schema,signal){
 let usage:Usage|null=null,opened=false,terminal=false;
 try{const token=await options.credential(),client=new OpenAI({apiKey:token,baseURL:options.baseURL??'https://api.openai.com/v1',timeout:25_000,maxRetries:0,logLevel:'off',fetch:options.fetch});
 // Transport-only change: equivalent instructions and context. OAuth rejects
 // string input and max_output_tokens; no unsupported request fields or tools.
 const stream=await client.responses.create({model:options.model,store:false,stream:true,instructions:promptFor(context),input:[{role:'user',content:JSON.stringify(context)}],text:{format:{type:'json_schema',name:'one_better_coaching',strict:true,schema}}},{signal});opened=true;
 let output:unknown;const completedItems=new Map<number,ResponseOutputItem>();
 for await(const event of stream){
  // The plan route may omit output from the terminal envelope. Retain only
  // completed items, and never expose them before response.completed.
  if(event.type==='response.output_item.done'){
   if(!Number.isInteger(event.output_index)||event.output_index<0||event.output_index>=16||Buffer.byteLength(JSON.stringify(event.item))>64_000)throw new CoachingFailure('invalid_output',usage);
   completedItems.set(event.output_index,event.item);
  }
  if(event.type==='response.failed'||event.type==='response.incomplete'||event.type==='response.completed'){
   const r=event.response;usage={inputTokens:r.usage?.input_tokens??null,outputTokens:r.usage?.output_tokens??null,cachedInputTokens:r.usage?.input_tokens_details?.cached_tokens??null};
   if(event.type==='response.failed'){const code=r.error?.code as string|undefined;throw new ChatGPTStreamFailure('failed',code?.includes('usage_limit')?'rate_limit':'unavailable',usage);}
   if(event.type==='response.incomplete')throw new ChatGPTStreamFailure('incomplete','invalid_output',usage);
   terminal=true;if(r.status!=='completed')throw new CoachingFailure('invalid_output',usage);
   const items=r.output.length?r.output:[...completedItems.entries()].sort((a,b)=>a[0]-b[0]).map(([,item])=>item);
   const messages=items.filter(item=>item.type==='message');if(messages.some(m=>m.content.some(c=>c.type==='refusal')))throw new CoachingFailure('refusal',usage);
   const text=messages.flatMap(m=>m.content.flatMap(c=>c.type==='output_text'?[c.text]:[])).join('');
   if(!text||Buffer.byteLength(text)>64_000)throw new CoachingFailure('invalid_output',usage);try{output=JSON.parse(text);}catch{throw new CoachingFailure('invalid_output',usage);}break;
  }
  if(event.type==='error')throw new ChatGPTStreamFailure('failed','unavailable',usage);
 }
 if(!terminal)throw new ChatGPTStreamFailure('interrupted','unavailable',usage);
 return {output,usage:usage!};
 }catch(e){if(e instanceof CoachingFailure)throw e;const f=safeProviderFailure(e);throw new ChatGPTStreamFailure(opened?'interrupted':'admission',f.kind,usage);} 
}};}
