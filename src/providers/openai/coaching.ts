import OpenAI from 'openai';
import { CoachingFailure, type Usage } from '../../modules/coaching/domain';
import { promptFor, type AIProvider } from '../../modules/coaching/provider';
import { safeProviderFailure } from '../ai-errors';
export function openAICoach(client:OpenAI,model:string):AIProvider {
  return {name:'openai',model,async generateCoaching(context,schema,signal){
    let usage:Usage|null=null;
    try {
      const response=await client.responses.create({model,store:false,instructions:promptFor(context),input:JSON.stringify(context),max_output_tokens:4096,text:{format:{type:'json_schema',name:'one_better_coaching',strict:true,schema}}},{signal});
      usage={inputTokens:response.usage?.input_tokens??null,outputTokens:response.usage?.output_tokens??null,cachedInputTokens:response.usage?.input_tokens_details?.cached_tokens??null};
      if(response.output.some(item=>item.type==='message'&&item.content.some(c=>c.type==='refusal')))throw new CoachingFailure('refusal');
      if(response.status!=='completed'||!response.output_text)throw new CoachingFailure('invalid_output');
      let output:unknown;try{output=JSON.parse(response.output_text);}catch{throw new CoachingFailure('invalid_output');}
      return {output,usage};
    }catch(e){const failure=safeProviderFailure(e);throw new CoachingFailure(failure.kind,usage);}
  }};
}
