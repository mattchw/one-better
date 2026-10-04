import {rationaleAllowed,type CoachingContext,type ReviewInsight} from './domain';

// Keep the existing quantity/name/history restrictions. Richer candidates narrow
// the semantic task; lexical checks are additional defenses, not a quality score.
export function reviewInsightGrounded(insight:ReviewInsight,context:CoachingContext){
 const candidate=context.reviewCandidates?.find(c=>c.id===insight.candidateId);
 if(context.contextType!=='weekly_review'||!candidate||candidate.evidenceRefs.length<2||!candidate.evidenceRefs.every(key=>context.facts.some(f=>f.key===key)))return false;
 const prose=[insight.interpretation,insight.reflectionQuestion];
 if(prose.some(text=>!rationaleAllowed(text)))return false;
 if(prose.some(text=>/\b(because|caus\w*|due to|led to|resulted in|therefore|explains?|proves?|prevented|made you|should|must|ought|need to|schedule|prioriti[sz]\w*)\b/i.test(text)))return false;
 if(!candidate.reflectionRefs.length&&prose.some(text=>/\b(interrupt\w*|blocker\w*|disrupt\w*|incident\w*|distract\w*|fatigue|motivation|illness|stress)\b/i.test(text)))return false;
 if(candidate.following.scheduledMinutes>0&&prose.some(text=>/\b(protect|add|increase)\s+(more|extra|additional|further)\s+(time|blocks?)\b|^(protect|add|increase)\b/i.test(text)))return false;
 if(!/\?$/.test(insight.reflectionQuestion)||insight.reflectionQuestion.split('?').length!==2||!/^(what|which|how|why|would|could|is|does|did|was|if|given)\b/i.test(insight.reflectionQuestion))return false;
 // A safe but wholly interchangeable topic must at least engage the candidate's
 // assembled relationship; human QA still decides specificity and usefulness.
 const anchors=candidate.type==='planning_execution_gap'?/\b(protected|scheduled|recorded|execution|gap)\b/i:candidate.type==='repeated_carry'?/\b(attempt|approach|condition|renewed|intent)\b/i:candidate.type==='amendment_execution_context'?/\b(capacity|amendment|revised|execution)\b/i:/\b(absence|commitment|chosen|intentional|attention)\b/i;
 return anchors.test(insight.interpretation);
}
