import {expect,it,vi} from 'vitest';
import {randomUUID} from 'node:crypto';
import {buildContext,fingerprint} from '../../src/modules/coaching/context';
import {coachingService,type CoachingRepository,type StoredRun} from '../../src/modules/coaching/service';
import {CoachingFailure} from '../../src/modules/coaching/domain';
import {reviewInsightFixture} from '../review-insight-fixture';
import {coachingOutput,reviewSuggestions} from '../coaching-fixture';

function fixture(){
 const input=reviewInsightFixture(),actor={userId:'review-owner'},other={userId:'other'},rows=new Map<string,StoredRun>(),key=(user:string,id:string)=>`${user}:${id}`;
 const repository:CoachingRepository={get:async(a,id)=>rows.get(key(a.userId,id))??null,latest:async(a,scope)=>[...rows.entries()].filter(([k,v])=>k.startsWith(`${a.userId}:`)&&v.contextType===scope.contextType&&v.week===scope.week).at(-1)?.[1]??null,claim:async(a,r)=>{rows.set(key(a.userId,r.id),r);return {created:true,run:r};},finish:async(a,r)=>{rows.set(key(a.userId,r.id),r);return r;}};
 const generateCoaching=vi.fn(async(context:ReturnType<typeof buildContext>)=>({output:coachingOutput(context),usage:{inputTokens:100,outputTokens:50,cachedInputTokens:0}}));
 const scheduling={preview:vi.fn(async()=>{throw new Error('Review must not preview a schedule');}),view:vi.fn(async()=>{throw new Error('Review must not open a schedule');})};
 const service=coachingService({repository,context:async()=>buildContext(input),provider:{name:'openai',model:'fixture',generateCoaching},configuration:'ready',scheduling,clock:()=>input.requestTime!});
 const command=()=>({...input.scope,mutationId:randomUUID(),fingerprint:fingerprint(buildContext(input))});return {input,actor,other,rows,service,generateCoaching,scheduling,command};
}
it('persists a read-only Evidence/Coach/Question insight, and view/reload never calls a provider',async()=>{
 const f=fixture(),before=structuredClone(f.input);await f.service.view(f.actor,f.input.scope);expect(f.generateCoaching).not.toHaveBeenCalled();const run=await f.service.generate(f.actor,f.command());expect(run.status).toBe('succeeded');expect(run.recommendations[0].proposal).toHaveProperty('reflectionQuestion');expect(run.recommendations[0].evidence).toHaveLength(buildContext(f.input).reviewCandidates![0].evidenceRefs.length);
 expect((await f.service.view(f.actor,f.input.scope)).run?.id).toBe(run.id);expect(f.generateCoaching).toHaveBeenCalledTimes(1);expect(f.scheduling.preview).not.toHaveBeenCalled();expect(f.input).toEqual(before);await expect(f.service.preview(f.actor,run.id,{index:0})).rejects.toMatchObject({code:'NOT_FOUND'});
});
it('rejects unknown/duplicate candidate IDs and unsafe prose without repair or mutation',async()=>{
 for(const kind of ['fabricated','duplicate','cause','decision'] as const){const f=fixture(),before=structuredClone(f.input),p=reviewSuggestions(buildContext(f.input))[0];f.generateCoaching.mockResolvedValue({output:{insights:kind==='duplicate'?[p,p]:[{...p,...kind==='fabricated'?{candidateId:'unknown'}:kind==='cause'?{interpretation:'An interruption caused the execution gap.'}:{reflectionQuestion:'Should you Carry this work?'}}]},usage:{inputTokens:100,outputTokens:50,cachedInputTokens:0}});expect(await f.service.generate(f.actor,f.command())).toMatchObject({status:'failed',failure:'invalid_output',recommendations:[]});expect(f.generateCoaching).toHaveBeenCalledTimes(1);expect(f.input).toEqual(before);}
});
it('following-week changes make Review stale and require a fresh explicit generation',async()=>{
 const f=fixture(),command=f.command(),run=await f.service.generate(f.actor,command),next=reviewInsightFixture('already_addressed').following!;f.input.following=next;
 expect((await f.service.view(f.actor,f.input.scope)).run?.stale).toBe(true);await expect(f.service.generate(f.actor,{...command,mutationId:randomUUID()})).rejects.toMatchObject({details:{kind:'COACHING_STALE'}});expect(f.generateCoaching).toHaveBeenCalledTimes(1);expect((await f.service.generate(f.actor,f.command())).stale).toBe(false);expect(run.id).not.toBe((await f.service.view(f.actor,f.input.scope)).run?.id);
});
it('cross-owner reads reveal no saved insight, and foreign/missing previews are indistinguishable',async()=>{
 const f=fixture(),run=await f.service.generate(f.actor,f.command());expect((await f.service.view(f.other,f.input.scope)).run).toBeNull();for(const id of [run.id,randomUUID()])await expect(f.service.preview(f.other,id,{index:0})).rejects.toMatchObject({code:'NOT_FOUND',message:'This coaching run is unavailable.'});
});
it('zero insights and provider failure are safe, durable outcomes',async()=>{
 const f=fixture();f.generateCoaching.mockResolvedValue({output:{insights:[]},usage:{inputTokens:100,outputTokens:50,cachedInputTokens:0}});expect(await f.service.generate(f.actor,f.command())).toMatchObject({status:'succeeded',recommendations:[]});const before=structuredClone(f.input);f.generateCoaching.mockRejectedValue(new CoachingFailure('authentication'));const c=f.command();expect(await f.service.generate(f.actor,c)).toMatchObject({status:'failed',failure:'authentication',recommendations:[]});await f.service.generate(f.actor,c);expect(f.generateCoaching).toHaveBeenCalledTimes(2);expect(f.input).toEqual(before);
});
