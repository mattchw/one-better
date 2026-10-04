import {readFile,writeFile} from 'node:fs/promises';
import {parse} from 'dotenv';
import Anthropic from '@anthropic-ai/sdk';
import {reviewSystemPrompt,reviewStructuredSchema} from '../src/modules/coaching/provider';
const env=parse(await readFile('.env.local')),context=JSON.parse(await readFile('docs/r5f-evidence/gap_reflection-context.json','utf8'));
let result:Record<string,unknown>={};
try{const r=await new Anthropic({apiKey:env.ANTHROPIC_API_KEY,maxRetries:0,timeout:25000,logLevel:'off'}).messages.create({model:env.ANTHROPIC_MODEL?.trim()||'claude-haiku-4-5-20251001',max_tokens:4096,system:reviewSystemPrompt,messages:[{role:'user',content:JSON.stringify(context)}],output_config:{format:{type:'json_schema',schema:reviewStructuredSchema}}});result={status:'succeeded',usage:r.usage};}
catch(error){const e=error as {status?:number;error?:unknown};const body=JSON.stringify(e.error);result={status:e.status??null,creditBalance:/credit balance/i.test(body),schemaIssue:/schema|maxItems|additionalProperties/i.test(body),maxItemsIssue:/maxItems/i.test(body),modelIssue:/model.*not found|model.*not supported/i.test(body)};}
await writeFile('docs/r5f-evidence/anthropic-admission-diagnostic.json',JSON.stringify(result,null,2));console.log(result);
