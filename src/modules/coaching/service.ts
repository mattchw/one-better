import { createHash } from 'node:crypto';
import { z } from 'zod';
import type { Actor } from '../../domain/actor';
import { ApplicationError } from '../../domain/errors';
import { parseCommand } from '../goals/domain';
import type { Placement, PlacementReview, SchedulingView } from '../scheduling/domain';
import { fingerprint } from './context';
import { CoachingFailure, generateSchema, grounded, outputSchema, reviewOutputSchema, placementOf, previewRecommendationSchema, scopeSchema, targetHref, type CheckedRecommendation, type CoachingContext, type CoachingRun, type CoachingScope, type CoachingView, type ScheduleCandidate } from './domain';
import { structuredSchema,reviewStructuredSchema, type AIProvider } from './provider';
import {reviewInsightGrounded} from './review-validation';
export type StoredRun = CoachingRun & { requestHash:string };
export interface CoachingRepository {
  get(actor:Actor,id:string):Promise<StoredRun|null>;
  latest(actor:Actor,scope:CoachingScope):Promise<StoredRun|null>;
  claim(actor:Actor,run:StoredRun):Promise<{created:boolean;run:StoredRun}>;
  finish(actor:Actor,run:StoredRun):Promise<StoredRun>;
}
export type CoachingDependencies = {
  repository:CoachingRepository;
  context:(actor:Actor,scope:CoachingScope,requestTime?:string)=>Promise<CoachingContext>;
  provider:AIProvider|null;
  configuration:'ready'|'disabled'|'incomplete';
  scheduling:{preview(actor:Actor,planId:string,input:Placement):Promise<PlacementReview>;view(actor:Actor,planId:string):Promise<SchedulingView>};
  clock?:()=>string;
  timeoutMs?:number;
};
const candidateLegal=(c:ScheduleCandidate,r:PlacementReview,now:string)=>Date.parse(c.start)>Date.parse(now)&&!r.outsideHours&&r.hoursConfigured&&r.calendarStatus==='fresh'&&r.busyConflict===false&&r.resultingMinutes<=r.budgetMinutes&&Date.parse(c.start)===Date.parse(r.interval.start)&&Date.parse(c.end)===Date.parse(r.interval.end);
const unavailable=()=>new ApplicationError('NOT_FOUND','This coaching run is unavailable.');
export function coachingService(deps:CoachingDependencies) {
  const clock=deps.clock??(()=>new Date().toISOString());
  const publicRun=(run:StoredRun,context:CoachingContext)=>{const {requestHash:_hash,...dto}=run;void _hash;const stale=run.fingerprint!==fingerprint(context);return {...dto,...run.contextType==='weekly_review'?{recommendations:stale?[]:run.recommendations.filter(r=>'interpretation' in r.proposal)}:{},stale,interrupted:run.status==='pending'&&Date.parse(clock())-Date.parse(run.generatedAt)>60_000};};
  async function context(actor:Actor,scope:CoachingScope) {
    // Double-read versioned, purpose-specific facts, not private raw DTOs. Do not send
    // a mixed read if any relevant source changed while composing the packet.
    const requestTime=clock();
    const first=await deps.context(actor,scope,requestTime),second=await deps.context(actor,scope,requestTime);
    if(fingerprint(first)!==fingerprint(second))throw new ApplicationError('CONFLICT','Planning facts changed. Refresh the coaching panel and try again.');
    // Reuse the ordinary scheduling authority before sending any candidate. A
    // mixed/expired advisory never grants a model a slot the editor would reject.
    const valid:ScheduleCandidate[]=[];
    for(const candidate of second.scheduleCandidates){
      try{const review=await deps.scheduling.preview(actor,second.planId!,placementOf(candidate));if(candidateLegal(candidate,review,requestTime))valid.push(candidate);}catch{/* unavailable candidate omitted */}
    }
    const ids=new Set(valid.map(c=>c.id));
    return {...second,scheduleCandidates:valid,facts:second.facts.filter(f=>!f.key.startsWith('schedule_candidate_')||ids.has(f.key)),signals:second.signals.map(s=>({...s,candidateIds:s.candidateIds.filter(id=>ids.has(id))}))};
  }
  return {
    async view(actor:Actor,input:unknown):Promise<CoachingView>{
      const scope=parseCommand(scopeSchema,input);
      if(!deps.provider)return {enabled:false,provider:null,configuration:deps.configuration,fingerprint:null,run:null};
      const snapshot=await context(actor,scope),run=await deps.repository.latest(actor,scope);
      return {enabled:true,provider:deps.provider.name,configuration:deps.configuration,fingerprint:fingerprint(snapshot),run:run?publicRun(run,snapshot):null};
    },
    async generate(actor:Actor,input:unknown) {
      const {mutationId,...command}=parseCommand(generateSchema,input),provider=deps.provider;
      const scope:CoachingScope={contextType:command.contextType,week:command.week};
      if(!provider)throw new ApplicationError('CONFLICT','Connect an AI provider to get planning insights.');
      const hash=createHash('sha256').update(JSON.stringify({kind:'coaching.generate',...command,provider:provider.name,model:provider.model})).digest('hex');
      const existing=await deps.repository.get(actor,mutationId);
      if(existing){if(existing.requestHash!==hash)throw new ApplicationError('CONFLICT','This request identifier already belongs to another coaching request.');return publicRun(existing,await context(actor,scope));}
      const snapshot=await context(actor,scope),digest=fingerprint(snapshot);
      if(digest!==command.fingerprint)throw new ApplicationError('CONFLICT','These facts changed. Refresh the coaching panel before requesting advice.',{kind:'COACHING_STALE'});
      const initial:StoredRun={id:mutationId,contextType:command.contextType,week:command.week,fingerprint:digest,provider:provider.name,model:provider.model,generatedAt:clock(),status:'pending',recommendations:[],failure:null,usage:null,latencyMs:null,requestHash:hash};
      const claim=await deps.repository.claim(actor,initial);
      if(!claim.created){if(claim.run.requestHash!==hash)throw new ApplicationError('CONFLICT','This request identifier already belongs to another coaching request.');return publicRun(claim.run,snapshot);}
      const controller=new AbortController(),started=Date.now();let timer:ReturnType<typeof setTimeout>|undefined;
      let result:StoredRun={...initial};
      try{
        if(Buffer.byteLength(JSON.stringify(snapshot),'utf8')>96_000)throw new CoachingFailure('context_too_large');
        const response=await Promise.race([provider.generateCoaching(snapshot,command.contextType==='weekly_review'?reviewStructuredSchema:structuredSchema,controller.signal),new Promise<never>((_,reject)=>{timer=setTimeout(()=>{controller.abort();reject(new CoachingFailure('timeout'));},deps.timeoutMs??30_000);})]);
        result.usage=response.usage;
        if(command.contextType==='weekly_review'){
          const parsed=reviewOutputSchema.safeParse(response.output);
          if(!parsed.success||new Set(parsed.data.insights.map(r=>r.candidateId)).size!==parsed.data.insights.length||parsed.data.insights.some(r=>!reviewInsightGrounded(r,snapshot)))throw new CoachingFailure('invalid_output');
          const recommendations:CheckedRecommendation[]=parsed.data.insights.map(proposal=>{const candidate=snapshot.reviewCandidates!.find(c=>c.id===proposal.candidateId)!;return {proposal,title:candidate.title,candidate:null,evidence:candidate.evidenceRefs.map(key=>({key,label:snapshot.facts.find(f=>f.key===key)!.label})),placement:null,unavailable:null,href:null};});
          result={...result,status:'succeeded',recommendations};
        }else{
        const parsed=outputSchema.safeParse(response.output);
        if(!parsed.success||new Set(parsed.data.recommendations.map(r=>r.signalId)).size!==parsed.data.recommendations.length||parsed.data.recommendations.some(r=>!grounded(r,snapshot)))throw new CoachingFailure('invalid_output');
        const recommendations:CheckedRecommendation[]=[];
        for(const proposal of parsed.data.recommendations){
          const signal=snapshot.signals.find(s=>s.id===proposal.signalId)!;
          const candidate=proposal.type==='schedule_candidate'?snapshot.scheduleCandidates.find(c=>c.id===proposal.candidateId)!:null;
          let placement:PlacementReview|null=null,reason:string|null=null;
          if(candidate){
            try{placement=await deps.scheduling.preview(actor,snapshot.planId!,placementOf(candidate));if(!candidateLegal(candidate,placement,clock())){placement=null;reason='This candidate is no longer available. Refresh coaching.';}}
            catch(e){reason=e instanceof ApplicationError?e.message:'This placement could not be validated. Refresh coaching.';}
          }
          // All supporting signal facts, plus the selected slot, are displayed;
          // a model cannot omit inconvenient quantities by citing only one key.
          const evidenceKeys=[...new Set([...signal.evidenceRefs,...candidate?[candidate.id]:[]])];
          recommendations.push({proposal,title:signal.title,candidate,evidence:evidenceKeys.map(key=>({key,label:snapshot.facts.find(f=>f.key===key)!.label})),placement,unavailable:reason,href:proposal.type==='review_plan'&&signal.target?targetHref(signal.target,command.week):null});
        }
        result={...result,status:'succeeded',recommendations};
        }
      }catch(e){result={...result,status:'failed',failure:e instanceof CoachingFailure?e.kind:'unavailable',usage:e instanceof CoachingFailure?e.usage??result.usage:result.usage,recommendations:[]};}
      finally{clearTimeout(timer);controller.abort();}
      result.latencyMs=Date.now()-started;
      const saved=await deps.repository.finish(actor,result);
      return publicRun(saved,await context(actor,scope));
    },
    async preview(actor:Actor,id:string,input:unknown) {
      id=parseCommand(z.uuid(),id);const {index}=parseCommand(previewRecommendationSchema,input);
      const run=await deps.repository.get(actor,id);if(!run)throw unavailable();
      const snapshot=await context(actor,{contextType:run.contextType,week:run.week});
      if(run.status!=='succeeded'||run.fingerprint!==fingerprint(snapshot))throw new ApplicationError('CONFLICT','This advice is stale. Refresh coaching before previewing it.',{kind:'COACHING_STALE'});
      const checked=run.recommendations[index];
      if(!checked||checked.proposal.type!=='schedule_candidate'||run.contextType!=='calendar'||!snapshot.planId||!grounded(checked.proposal,snapshot))throw unavailable();
      const proposal=checked.proposal,candidate=snapshot.scheduleCandidates.find(c=>c.id===proposal.candidateId)!;
      const review=await deps.scheduling.preview(actor,snapshot.planId,placementOf(candidate));
      if(!candidateLegal(candidate,review,clock()))throw new ApplicationError('CONFLICT','This candidate is no longer available. Refresh coaching.',{kind:'COACHING_STALE'});
      const view=await deps.scheduling.view(actor,snapshot.planId);
      const commitment=view.commitments.find(c=>c.id===candidate.commitmentId);if(!commitment)throw unavailable();
      return {view,review,editor:{commitmentId:candidate.commitmentId,snapshot:commitment.snapshot,prefill:{date:candidate.localDate,startTime:candidate.startLocalTime,endTime:candidate.endLocalTime}}};
    },
  };
}
