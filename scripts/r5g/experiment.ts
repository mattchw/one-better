import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {z} from 'zod';
import {canonical,fingerprint} from '../../src/modules/coaching/context';
import {reviewOutputSchema,type CoachingContext,type CoachingRun} from '../../src/modules/coaching/domain';
import {reviewInsightGrounded} from '../../src/modules/coaching/review-validation';
import {reviewQuestion} from '../../src/modules/coaching/review-questions';
import {reviewQualityKinds,reviewPrivacyMarkers} from '../../tests/review-insight-fixture';

export const evaluationQuestions=[
 {key:'betterDecision',text:'Which version helped me make a better Carry/Defer/Drop decision?'},
 {key:'aiAddedValue',text:'Did the AI version add anything beyond the deterministic question?'},
 {key:'aiNuance',text:'Did the AI introduce nuance that the template missed?'},
 {key:'aiVerbosity',text:'Did it become more verbose without becoming more useful?'},
 {key:'coachDisappeared',text:'Would I notice if the Coach section disappeared?'},
 {key:'weeklyReading',text:'Would I voluntarily read this every week?'},
] as const;
const answer=z.enum(['Yes','No','Unsure','Not applicable']);
export const evaluationRowSchema=z.strictObject({scenario:z.enum(reviewQualityKinds),provider:z.enum(['openai','anthropic']),betterDecision:z.enum(['A','B','C','No meaningful difference']),aiAddedValue:answer,aiNuance:answer,aiVerbosity:answer,coachDisappeared:answer,weeklyReading:answer,notes:z.string().max(2000)});
export const evaluationSchema=z.strictObject({experimentId:z.string().regex(/^[0-9a-f]{64}$/),responses:z.array(evaluationRowSchema).length(6).refine(rows=>new Set(rows.map(r=>r.scenario)).size===6,'Each frozen scenario needs one response.'),productPreference:z.enum(['Keep AI Review coaching','Replace Review AI with deterministic coaching questions','Remove Review coaching entirely and keep only evidence/reflection']),reason:z.string().trim().min(1).max(4000)});

const descriptions={
 gap_reflection:{title:'Execution gap + approved reflection',brief:'Onboarding: 240m committed, 60m scheduled, 30m recorded. Capacity reduced from 720m to 540m. Finalized reflections report production/support disruption. Human Carry intent is 90m; no following plan.'},
 already_addressed:{title:'Following week already addressed',brief:'Onboarding is 60/60/60m. The essay Goal had no reviewed-week commitment. The following week already commits and schedules 60m for the essay. R5F suppresses the historical attention topic.'},
 repeated_carry:{title:'Repeated finalized Carry',brief:'Onboarding is 120/60/30m. The same Action has two finalized Carry decisions total: one prior Review and this Review. No following plan. A finalized reflection asks for a changed approach.'},
 clean:{title:'Clean week',brief:'Onboarding is 60m committed, 60m scheduled and 60m recorded. No eligible unresolved Review relationship.'},
 completed:{title:'Tracking gap but Action completed',brief:'Onboarding is 240/60/30m, but the authoritative Action state is Completed. R5F suppresses needs-attention coaching; recorded Focus is not completion.'},
 no_reflection:{title:'Gap without permitted reflection',brief:'Onboarding is 240/60/30m. Weekly/Daily reflections are Draft and excluded. No permitted explanatory reflection and no following plan.'},
};
type Observation={kind:string;provider:'openai'|'anthropic';model:string;run:CoachingRun;rawOutput:unknown};
export function comparisonView(context:CoachingContext,observation:Observation){
 const stale=observation.run.fingerprint!==fingerprint(context),parsed=reviewOutputSchema.safeParse(observation.rawOutput);
 const valid=!stale&&observation.run.status==='succeeded'&&parsed.success&&new Set(parsed.data.insights.map(i=>i.candidateId)).size===parsed.data.insights.length&&parsed.data.insights.every(i=>reviewInsightGrounded(i,context));
 return {provider:observation.provider,model:observation.model,status:stale?'stale':valid?'accepted':'withheld',insights:valid&&parsed.success?parsed.data.insights:[]};
}
export async function loadExperiment(root='.'){
 const path=(p:string)=>`${root}/${p}`,initial=JSON.parse(await readFile(path('docs/r5f-evidence/results.json'),'utf8')),haiku=JSON.parse(await readFile(path('docs/r5f-evidence/anthropic-compatibility-results.json'),'utf8'));
 const observations:Observation[]=[...initial.observations.filter((o:Observation)=>o.provider==='openai'&&o.kind!=='provider_failure'),...haiku.observations];
 const scenarios=[];
 for(const kind of reviewQualityKinds){
  const context:CoachingContext=JSON.parse(await readFile(path(`docs/r5f-evidence/${kind}-context.json`),'utf8'));
  if(context.contextType!=='weekly_review'||context.schemaVersion!==3)throw new Error('Expected frozen R5F Review context.');
  const serialized=JSON.stringify(context);for(const key of ['draftDaily','draftWeekly','late','session','google'] as const)if(serialized.includes(reviewPrivacyMarkers[key]))throw new Error('Excluded reflection/metadata found in comparison input.');
  const candidates=context.reviewCandidates??[];
  if(candidates.length>6)throw new Error('Candidate cap exceeded.');
  const topics=candidates.slice(0,2).map(c=>{if(new Set(c.evidenceRefs).size<2)throw new Error('Thin relationship.');return {id:c.id,title:c.title,type:c.type,evidence:c.evidenceRefs.map(key=>{const f=context.facts.find(f=>f.key===key);if(!f)throw new Error('Unknown evidence.');return {key,label:f.label};}),question:reviewQuestion(context,c.id)};});
  const samples=Object.fromEntries(['openai','anthropic'].map(provider=>{const o=observations.find(o=>o.kind===kind&&o.provider===provider);if(!o)throw new Error('Missing frozen AI sample.');return [provider,comparisonView(context,o)];}));
  scenarios.push({id:kind,...descriptions[kind],week:context.week,contextHash:createHash('sha256').update(canonical(context)).digest('hex'),topics,overview:context.facts.filter(f=>f.key==='review_summary'||f.key.startsWith('following:')).map(f=>({key:f.key,label:f.label})),reflections:context.facts.filter(f=>f.key==='weekly_reflection'||f.key.startsWith('daily_reflection:')).map(f=>({label:f.label,note:String(f.data.note)})),samples});
 }
 const body={purpose:'R5G development/QA comparison; frozen synthetic R5F data only',strategies:{A:'Evidence only',B:'Evidence + reviewed deterministic question',C:'Evidence + existing validated AI Coach/Question'},scenarios,questions:evaluationQuestions};
 return {...body,experimentId:createHash('sha256').update(canonical(body)).digest('hex')};
}
