import type {CoachingContext,ReviewInsightCandidate} from './domain';

// R5G experiment library only. Normal Review rendering does not import this.
// Context modifiers choose wording for an eligible existing relationship; they
// never resurrect suppressed topics or introduce a recommendation type.
export const reviewedReviewQuestions={
 planning_execution_gap:'Did this work lack protected time, or is there work or displacement that the Focus record does not capture?',
 amendment_execution_context:'Did the revised capacity change what you intended to protect, and does the recorded execution suggest the next budget needs adjusting?',
 repeated_carry:'What keeps this work worth another Carry decision, and what would make a new attempt different from renewing the same intent?',
 focus_cycle_attention_gap:'Was giving this Goal no weekly commitment intentional, or does its place in the current Focus Cycle need to change?',
 reflection_supported_context:'Does the reflection point to displaced protected time, or to a change the plan itself needs?',
 next_week_already_addressed:'With time already protected in the following week, has that plan addressed this pattern, or is a different change still needed?',
} as const;
export type ReviewedQuestionKey=keyof typeof reviewedReviewQuestions;
export function reviewQuestion(context:CoachingContext,candidateId:string,stale=false):{key:ReviewedQuestionKey;text:string}|null{
 if(stale||context.contextType!=='weekly_review')return null;
 const c=context.reviewCandidates?.find(c=>c.id===candidateId);
 if(!c||new Set(c.evidenceRefs).size<2||!c.evidenceRefs.every(key=>context.facts.some(f=>f.key===key)))return null;
 let key:ReviewedQuestionKey=c.type;
 if(c.following.scheduledMinutes>0&&c.following.budgetMinutes>0)key='next_week_already_addressed';
 else if((c.type==='planning_execution_gap'||c.type==='amendment_execution_context')&&c.reflectionRefs.length&&c.reflectionRefs.every(r=>c.evidenceRefs.includes(r)))key='reflection_supported_context';
 const text=reviewedReviewQuestions[key];return typeof text==='string'?{key,text}:null;
}
export const supportedReviewQuestionTypes:ReviewInsightCandidate['type'][]=['planning_execution_gap','amendment_execution_context','repeated_carry','focus_cycle_attention_gap'];
