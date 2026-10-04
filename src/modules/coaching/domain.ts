import { z } from 'zod';
import { boundedText } from '../goals/domain';
import { weekSchema } from '../planning/domain';
import { type PlacementReview } from '../scheduling/domain';

export const purposeSchema = z.enum(['calendar', 'weekly_review']);
export const scopeSchema = z.strictObject({ contextType: purposeSchema, week: weekSchema });
export const generateSchema = scopeSchema.extend({ mutationId: z.uuid(), fingerprint: z.string().regex(/^[a-f0-9]{64}$/) });
export const previewRecommendationSchema = z.strictObject({ index: z.number().int().min(0).max(2) });
export type CoachingScope = z.infer<typeof scopeSchema>;
export const referenceSchema = z.strictObject({ kind: z.enum(['focus_cycle','goal','action','commitment','time_block','plan']), id: z.uuid() });
export type Reference = z.infer<typeof referenceSchema>;
export type Fact = { key: string; label: string; reference: Reference | null; data: Record<string, unknown> };
export type ScheduleCandidate = { id:string; commitmentId:string; localDate:string; startLocalTime:string; endLocalTime:string; start:string; end:string; durationMinutes:number; remainingUnscheduledMinutes:number; focusableHours:'inside'; calendarStatus:'available' };
export type CoachingSignal = { id:string; kind:'unscheduled'|'fully_scheduled'|'unrecorded'|'execution_difference'|'repeated_carry'|'focus_without_commitment'|'attention'|'amendment'; title:string; evidenceRefs:string[]; target:Reference|null; worthConsidering:boolean; candidateIds:string[] };
export type ReviewInsightCandidate = {
  id:string; type:'planning_execution_gap'|'amendment_execution_context'|'repeated_carry'|'focus_cycle_attention_gap';
  title:string; subjects:Reference[]; evidenceRefs:string[]; week:string; followingWeek:string;
  reflectionRefs:string[]; following:{state:'absent'|'draft'|'committed';budgetMinutes:number;scheduledMinutes:number;carryIntentMinutes:number|null};
  allowedInterpretation:string[];
};
export type CoachingContext = CoachingScope & { schemaVersion:2|3; stateFingerprint:string; requestTime:string; today:string; timezone:string; planId:string|null; facts:Fact[]; signals:CoachingSignal[]; scheduleCandidates:ScheduleCandidate[]; reviewCandidates?:ReviewInsightCandidate[] };
const common = { signalId:z.string().min(1).max(160), rationale:boundedText('Rationale',320), evidenceRefs:z.array(z.string().min(1).max(160)).min(1).max(6) };
export const recommendationSchema = z.discriminatedUnion('type', [
  z.strictObject({type:z.literal('observation'),...common}),
  z.strictObject({type:z.literal('schedule_candidate'),...common,candidateId:z.string().min(1).max(160)}),
  z.strictObject({type:z.literal('review_plan'),...common}),
]);
export const outputSchema = z.strictObject({recommendations:z.array(recommendationSchema).max(3)});
export type Recommendation = z.infer<typeof recommendationSchema>;
export const reviewInsightSchema=z.strictObject({candidateId:z.string().min(1).max(160),interpretation:boundedText('Interpretation',480),reflectionQuestion:boundedText('Question',320)});
export const reviewOutputSchema=z.strictObject({insights:z.array(reviewInsightSchema).max(2)});
// Preserve the existing run storage; Review replaces its broad prose contract.
// These are read-only insights, with no new mutation/recommendation capability.
export type ReviewInsight=z.infer<typeof reviewInsightSchema> & {type?:never;signalId?:never;rationale?:never;evidenceRefs?:never};
export type CheckedRecommendation = { proposal:Recommendation|ReviewInsight; title:string; candidate:ScheduleCandidate|null; evidence:{key:string;label:string}[]; placement:PlacementReview|null; unavailable:string|null; href:string|null };
export type Usage = { inputTokens: number | null; outputTokens: number | null; cachedInputTokens: number | null };
export type Failure = 'timeout' | 'authentication' | 'rate_limit' | 'model_unavailable' | 'unavailable' | 'invalid_output' | 'refusal' | 'context_too_large';
export class CoachingFailure extends Error { constructor(public readonly kind: Failure, public readonly usage:Usage|null=null) { super('Coaching could not be generated.'); } }
export type CoachingRun = CoachingScope & { id:string; fingerprint:string; provider:'openai'|'anthropic'; model:string; generatedAt:string; status:'pending'|'succeeded'|'failed'; recommendations:CheckedRecommendation[]; failure:Failure|null; usage:Usage|null; latencyMs:number|null };
export type CoachingView = { enabled:boolean; provider:'openai'|'anthropic'|null; configuration:'ready'|'disabled'|'incomplete'; fingerprint:string|null; run:(CoachingRun & { stale:boolean; interrupted:boolean })|null };
export const placementOf = (r:ScheduleCandidate) => ({commitmentId:r.commitmentId,date:r.localDate,startTime:r.startLocalTime,endTime:r.endLocalTime});
// Deliberately narrow prose: quantities and temporal/history assertions belong in
// deterministic Evidence. This rejects common unsupported claims, not all semantic
// hallucinations; concise qualitative advice still needs human quality review.
export function rationaleAllowed(text:string) {
  if (/\d|\b(zero|one|two|three|four|five|six|seven|eight|nine|ten|first|second|third|half|quarter|percent|monday|tuesday|wednesday|thursday|friday|saturday|sunday|january|february|march|april|june|july|august|september|october|november|december|yesterday|tomorrow|previous|last|consecutive|repeated|carried|completed|finished|always|never)\b/i.test(text)) return false;
  if (/\b(?:a|an|another|additional|extra|several|many|few|some)\s+(?:hours?|minutes?)\b|\b(?:in|by|during|on)\s+may\b/i.test(text)) return false;
  if (/\b(carry|defer|drop)\b|["“”]|[0-9a-f]{8}-/i.test(text)) return false;
  const prose=text.replace(/(^|[.!?]\s+)[A-Z][a-z]+/g,'');
  return !/\b[A-Z][a-z]+\b/.test(prose.replace(/\b(Focus|Cycle|Goal|Action|Calendar|Review|One|Better)\b/g,''));
}
export function grounded(r:Recommendation, context:CoachingContext) {
  const signal=context.signals.find(s=>s.id===r.signalId&&s.worthConsidering);
  if (!signal || !rationaleAllowed(r.rationale)) return false;
  const allowed=new Set(signal.evidenceRefs);
  if (r.type==='schedule_candidate') {
    const candidate=context.scheduleCandidates.find(c=>c.id===r.candidateId);
    if (context.contextType!=='calendar'||!candidate||!signal.candidateIds.includes(candidate.id)) return false;
    allowed.add(candidate.id);
  }
  if (r.type==='review_plan'&&!signal.target) return false;
  return r.evidenceRefs.some(key=>signal.evidenceRefs.includes(key)) && r.evidenceRefs.every(key=>allowed.has(key)&&context.facts.some(f=>f.key===key));
}
export function targetHref(reference:Reference, week:string) {
  if(reference.kind==='goal')return `/goals/${reference.id}?week=${week}`;
  if(reference.kind==='time_block')return `/focus?block=${reference.id}`;
  if(reference.kind==='focus_cycle')return '/goals';
  return `/planning?week=${week}`;
}
