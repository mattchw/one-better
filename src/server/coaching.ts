import 'server-only';
import OpenAI from 'openai';
import Anthropic from '@anthropic-ai/sdk';
import { and, eq, sql } from 'drizzle-orm';
import { focusSession, timeBlock } from '../db/schema';
import { coachingService } from '../modules/coaching/service';
import { coachingRepository } from '../modules/coaching/repository';
import { coachingContextReader } from '../modules/coaching/reader';
import { planRepository } from '../modules/planning/repository';
import { readAIConfiguration, testAIBaseURL } from '../modules/coaching/configuration';
import { openAICoach } from '../providers/openai/coaching';
import { anthropicCoach } from '../providers/anthropic/coaching';
import { planning } from './planning';
import { focusCycles } from './focus-cycles';
import { scheduling } from './scheduling';
import { amendments } from './amendments';
import { focusAvailability } from './availability';
import { weeklyReviews } from './weekly-reviews';
import { runtime } from './runtime';
import { executionClock } from './execution-clock';
import type { Actor } from '../domain/actor';
import { chatGPT,chatGPTConfiguration } from './chatgpt';
import { chatGPTCoach } from '../providers/chatgpt/coaching';
import { planGranted } from '../modules/chatgpt/domain';
export async function coaching(actor:Actor){
  const config=readAIConfiguration(process.env),options=config.provider;
  const baseURL=testAIBaseURL(process.env);
  let provider=options?.name==='openai'?openAICoach(new OpenAI({apiKey:options.key,baseURL:baseURL?`${baseURL}/v1`:'https://api.openai.com/v1',timeout:25_000,maxRetries:0,logLevel:'off'}),options.model):options?.name==='anthropic'?anthropicCoach(new Anthropic({apiKey:options.key,baseURL:baseURL??'https://api.anthropic.com',timeout:25_000,maxRetries:0,logLevel:'off'}),options.model):null;
  let configuration=config.state;
  const connectionConfig=chatGPTConfiguration();
  if(connectionConfig){const service=chatGPT(),active=(await service.workspace(actor)).connections.find(c=>c.active&&c.useForCoaching);if(active){const ready=active.status==='connected'&&planGranted(active.scopes)&&!!active.selectedModel&&active.models.some(m=>m.slug===active.selectedModel);provider=ready?chatGPTCoach({model:active.selectedModel!,credential:()=>service.credential(actor,active.id,active.selectedModel!),baseURL:connectionConfig.testOrigin?`${connectionConfig.testOrigin}/v1`:undefined}):null;configuration=ready?'ready':'incomplete';}}
  const db=runtime().db;
  const context=coachingContextReader({clock:executionClock,cycles:actor=>focusCycles().workspace(actor),planning:(actor,week)=>planning().workspace(actor,week),candidates:actor=>planRepository(db).candidates(actor),scheduling:(actor,id)=>scheduling().view(actor,id),effective:async(actor,id)=>(await amendments().history(actor,id)).effective,availability:(actor,week)=>focusAvailability().read(actor,week),review:(actor,week)=>weeklyReviews().workspace(actor,week),outcomes:async(actor,id)=>{
    const rows=await db.select({outcome:focusSession.outcome,count:sql<number>`count(*)::int`}).from(focusSession).innerJoin(timeBlock,and(eq(timeBlock.id,focusSession.timeBlockId),eq(timeBlock.ownerId,focusSession.ownerId))).where(and(eq(focusSession.ownerId,actor.userId),eq(timeBlock.planId,id))).groupBy(focusSession.outcome);return rows;
  }});
  return coachingService({repository:coachingRepository(db),context,provider,configuration,scheduling:scheduling(),clock:executionClock});
}
