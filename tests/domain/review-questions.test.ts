import {it,expect} from 'vitest';
import {buildContext} from '../../src/modules/coaching/context';
import {reviewQuestion,reviewedReviewQuestions} from '../../src/modules/coaching/review-questions';
import {reviewInsightFixture} from '../review-insight-fixture';
it('chooses a reviewed relationship question, with reflection and protected-next-week modifiers',()=>{
 const c=buildContext(reviewInsightFixture()),id=c.reviewCandidates![0].id;
 expect(reviewQuestion(c,id)?.key).toBe('reflection_supported_context');
 c.reviewCandidates![0].following={state:'committed',budgetMinutes:90,scheduledMinutes:90,carryIntentMinutes:90};
 expect(reviewQuestion(c,id)?.key).toBe('next_week_already_addressed');
 const without=buildContext(reviewInsightFixture('no_reflection'));expect(reviewQuestion(without,without.reviewCandidates![0].id)?.key).toBe('planning_execution_gap');
 const carry=buildContext(reviewInsightFixture('repeated_carry'));expect(reviewQuestion(carry,carry.reviewCandidates![0].id)?.key).toBe('repeated_carry');
});
it('does not resurrect suppressed, unknown, thin or stale topics and has no generic fallback',()=>{
 for(const kind of ['already_addressed','completed','clean'] as const){const c=buildContext(reviewInsightFixture(kind));expect(c.reviewCandidates).toEqual([]);expect(reviewQuestion(c,'anything')).toBeNull();}
 const c=buildContext(reviewInsightFixture()),candidate=c.reviewCandidates![0];expect(reviewQuestion(c,candidate.id,true)).toBeNull();
 candidate.evidenceRefs=[candidate.evidenceRefs[0]];expect(reviewQuestion(c,candidate.id)).toBeNull();
 expect(Object.values(reviewedReviewQuestions).join(' ')).not.toMatch(/aligns? with your priorities|Should you reconsider|What would you change\?/i);
});
it('attention wording does not invent persistent neglect or infer completion from recording',()=>{
 const input=reviewInsightFixture('already_addressed');input.following=undefined;const c=buildContext(input),candidate=c.reviewCandidates!.find(c=>c.type==='focus_cycle_attention_gap')!;
 expect(reviewQuestion(c,candidate.id)?.text).toContain('no weekly commitment');expect(reviewQuestion(c,candidate.id)?.text).not.toMatch(/keeps|always|repeated|finish/);
});
