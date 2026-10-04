import {expect,it} from 'vitest';
import {buildContext,fingerprint} from '../../src/modules/coaching/context';
import {reviewOutputSchema} from '../../src/modules/coaching/domain';
import {reviewInsightGrounded} from '../../src/modules/coaching/review-validation';
import {reviewInsightFixture,reviewPrivacyMarkers} from '../review-insight-fixture';
import {reviewSuggestions} from '../coaching-fixture';

it('assembles a meaningful execution relationship and relevant finalized reflection without causality',()=>{
 const c=buildContext(reviewInsightFixture()),candidate=c.reviewCandidates![0];expect(candidate.type).toBe('planning_execution_gap');
 expect(candidate.evidenceRefs.length).toBeGreaterThanOrEqual(4);expect(candidate.reflectionRefs).toHaveLength(2);
 const text=JSON.stringify(c);expect(text).toContain('240m committed; 60m scheduled; 30m recorded');expect(text).toContain(reviewPrivacyMarkers.daily);expect(text).toContain(reviewPrivacyMarkers.weekly);expect(candidate.allowedInterpretation.join(' ')).toContain('not an established cause');
 for(const m of [reviewPrivacyMarkers.draftDaily,reviewPrivacyMarkers.draftWeekly,reviewPrivacyMarkers.late,reviewPrivacyMarkers.session,reviewPrivacyMarkers.google])expect(text).not.toContain(m);
});
it('suppresses historical attention that is already materially addressed in the following week',()=>{
 const input=reviewInsightFixture('already_addressed'),c=buildContext(input);expect(c.reviewCandidates).toEqual([]);
 input.following!.scheduling!.commitments[0].scheduledMinutes=0;input.following!.scheduling!.blocks=[];
 const fresh=buildContext(input);expect(fresh.reviewCandidates?.[0].type).toBe('focus_cycle_attention_gap');expect(fingerprint(fresh)).not.toBe(fingerprint(c));
});
it('a Goal membership fact alone, no reviewed week, or terminal source cannot become an insight',()=>{
 for(const kind of ['completed','clean'] as const)expect(buildContext(reviewInsightFixture(kind)).reviewCandidates).toEqual([]);
 const input=reviewInsightFixture();input.review=null;expect(buildContext(input).reviewCandidates).toEqual([]);
});
it('requires distinct consecutive finalized Carry decisions; draft/missing/non-Carry breaks the pattern',()=>{
 const input=reviewInsightFixture('repeated_carry');expect(buildContext(input).reviewCandidates?.[0].type).toBe('repeated_carry');
 for(const change of ['draft','defer','missing'] as const){const value=structuredClone(input);if(change==='draft')value.recent[0].review!.status='draft';else if(change==='defer')value.recent[0].review!.decisions[0].kind='defer';else value.recent=[];expect(buildContext(value).reviewCandidates?.some(c=>c.type==='repeated_carry')).toBe(false);}
});
it('current Focus changes and intentional Defer suppress attention and change freshness',()=>{
 const input=reviewInsightFixture('already_addressed');input.following=undefined;const before=buildContext(input);expect(before.reviewCandidates?.some(c=>c.type==='focus_cycle_attention_gap')).toBe(true);
 input.cycles.current!.goals.pop();expect(buildContext(input).reviewCandidates).toEqual([]);expect(fingerprint(buildContext(input))).not.toBe(fingerprint(before));
 const gap=reviewInsightFixture();gap.review!.review!.decisions[0].kind='defer';gap.review!.amendments=[];expect(buildContext(gap).reviewCandidates).toEqual([]);
});
it('no permitted reflection can still support a bounded deterministic gap without invented explanation',()=>{
 const c=buildContext(reviewInsightFixture('no_reflection'));expect(c.reviewCandidates?.[0].reflectionRefs).toEqual([]);expect(c.reviewCandidates?.[0].allowedInterpretation.join(' ')).toContain('do not invent an interruption');
 expect(JSON.stringify(c)).not.toMatch(/PRIVATE_DRAFT/);const p=reviewSuggestions(c)[0];expect(reviewInsightGrounded(p,c)).toBe(true);expect(reviewInsightGrounded({...p,interpretation:'An interruption displaced protected work.'},c)).toBe(false);
});
it('closed Review schema allows zero, caps two and rejects mutation fields or broad legacy prose',()=>{
 const c=buildContext(reviewInsightFixture()),insights=reviewSuggestions(c);expect(reviewOutputSchema.safeParse({insights}).success).toBe(true);expect(reviewOutputSchema.parse({insights:[]})).toEqual({insights:[]});
 for(const output of [{insights:Array(3).fill(insights[0])},{recommendations:[]},{insights:[{...insights[0],type:'carry'}]},{insights:[{...insights[0],interpretation:'x'.repeat(481)}]}])expect(reviewOutputSchema.safeParse(output).success).toBe(false);
});
it('candidate membership and bounded prose reject fabricated topics, history, causes, decisions and non-questions',()=>{
 const c=buildContext(reviewInsightFixture()),p=reviewSuggestions(c)[0];expect(reviewInsightGrounded(p,c)).toBe(true);expect(reviewInsightGrounded({...p,candidateId:'invented'},c)).toBe(false);
 for(const interpretation of ['The interruption caused the execution gap.','It carried across two weeks.','You should prioritize this work.','Drop this commitment.','Consider whether this aligns with priorities.'])expect(reviewInsightGrounded({...p,interpretation},c)).toBe(false);
 expect(reviewInsightGrounded({...p,reflectionQuestion:'Revisit your priorities.'},c)).toBe(false);
});
it('following protected time constrains a historical gap rather than recommending more protection',()=>{
 const input=reviewInsightFixture(),next=reviewInsightFixture('already_addressed').following!;next.effective!.commitments[0].actionId=input.sources[0].actionId;next.workspace.view!.plan.commitments[0].actionId=input.sources[0].actionId;input.following=next;
 const c=buildContext(input),p=reviewSuggestions(c)[0];expect(c.reviewCandidates![0].following.scheduledMinutes).toBe(60);expect(reviewInsightGrounded(p,c)).toBe(true);expect(reviewInsightGrounded({...p,interpretation:'Protect more time for deliberate execution.'},c)).toBe(false);
});
