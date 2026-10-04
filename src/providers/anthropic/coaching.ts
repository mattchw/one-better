import Anthropic from '@anthropic-ai/sdk';
import { CoachingFailure, type Usage } from '../../modules/coaching/domain';
import { promptFor, type AIProvider } from '../../modules/coaching/provider';
import { safeProviderFailure } from '../ai-errors';
// Anthropic rejects maxItems. Keep the application schema and cap intact;
// remove only this unsupported keyword from the provider wire representation.
export function anthropicWireSchema(schema:Record<string,unknown>){
 const copy=structuredClone(schema) as {properties?:{insights?:{maxItems?:number}}};
 if(copy.properties?.insights)delete copy.properties.insights.maxItems;
 return copy;
}
export function anthropicCoach(client:Anthropic,model:string):AIProvider {
  return {name:'anthropic',model,async generateCoaching(context,schema,signal){
    let usage:Usage|null=null;
    try {
      const response=await client.messages.create({model,max_tokens:4096,system:promptFor(context),messages:[{role:'user',content:JSON.stringify(context)}],output_config:{format:{type:'json_schema',schema:anthropicWireSchema(schema)}}},{signal});
      usage={inputTokens:response.usage.input_tokens,outputTokens:response.usage.output_tokens,cachedInputTokens:response.usage.cache_read_input_tokens??null};
      if(response.stop_reason==='refusal')throw new CoachingFailure('refusal');
      if(response.stop_reason!=='end_turn'||response.content.length!==1||response.content[0].type!=='text')throw new CoachingFailure('invalid_output');
      let output:unknown;try{output=JSON.parse(response.content[0].text);}catch{throw new CoachingFailure('invalid_output');}
      return {output,usage};
    }catch(e){const failure=safeProviderFailure(e);throw new CoachingFailure(failure.kind,usage);}
  }};
}
