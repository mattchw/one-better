import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import type { Actor } from "../../domain/actor";
import { ApplicationError } from "../../domain/errors";
import { validate } from "../calendar/domain";
import { cancelBlockSchema, createBlockSchema, editBlockSchema, evaluatePlacement, ownedBlock, previewSchema, requireFutureBlock, requireUnexecuted, requireScheduling, schedulingView, type OwnedBlock, type Placement, type PlacementReview, type SchedulingContext, type TimeBlock } from "./domain";
export interface SchedulingTransaction {
  context(planId: string): Promise<SchedulingContext>;
  block(id: string): Promise<OwnedBlock | null>;
  insert(value: TimeBlock): Promise<TimeBlock>;
  replace(value: TimeBlock, expectedVersion: number): Promise<TimeBlock>;
}
export interface SchedulingRepository {
  read(actor: Actor, planId: string): Promise<SchedulingContext>;
  get(actor: Actor, blockId: string): Promise<OwnedBlock | null>;
  execute(actor: Actor, mutationId: string, hash: string, apply: (tx: SchedulingTransaction) => Promise<TimeBlock>): Promise<TimeBlock>;
}
const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
export function reviewPlacement(context: SchedulingContext, value: Placement, now: string): PlacementReview {
  const review = evaluatePlacement(context,value,now);
  return {...review,reviewKey:hash({value,review,calendarIdentity:context.calendarIdentity,calendar:context.calendar,hours:context.hours,userTimezone:context.userTimezone,blocks:context.blocks.map(b=>({id:b.id,version:b.version,start:b.start,end:b.end,state:b.state}))})};
}
export function schedulingService(repository: SchedulingRepository, clock=()=>new Date().toISOString(), newId:()=>string=randomUUID) {
  return {
    async view(actor: Actor, planId: string) { validate(z.uuid(),planId); return schedulingView(await repository.read(actor,planId),clock()); },
    async get(actor: Actor, id: string) { validate(z.uuid(),id); return ownedBlock(await repository.get(actor,id),actor.userId); },
    async preview(actor: Actor, planId: string, input: unknown) { validate(z.uuid(),planId); const value=validate(previewSchema,input); return reviewPlacement(await repository.read(actor,planId),value,clock()); },
    async create(actor: Actor, planId: string, input: unknown) {
      validate(z.uuid(),planId);const {mutationId,...value}=validate(createBlockSchema,input);
      return repository.execute(actor,mutationId,hash({kind:"time-block.create",planId,...value}),async tx=>{
        const context=await tx.context(planId),now=clock();
        const placement={commitmentId:value.commitmentId,date:value.date,startTime:value.startTime,endTime:value.endTime};
        const review=reviewPlacement(context,placement,now);checkApproval(review,value);
        const snapshot=context.effective.commitments.find(c=>c.id===value.commitmentId)!.snapshot;
        return tx.insert({id:newId(),planId,commitmentId:value.commitmentId,...review.interval,snapshot:structuredClone(snapshot),state:"planned",version:1,createdAt:now,updatedAt:now,cancelledAt:null});
      });
    },
    async edit(actor: Actor, id: string, input: unknown) {
      validate(z.uuid(),id);const {mutationId,...value}=validate(editBlockSchema,input);
      return repository.execute(actor,mutationId,hash({kind:"time-block.edit",id,...value}),async tx=>{
        const block=ownedBlock(await tx.block(id),actor.userId),context=await tx.context(block.planId),now=clock();
        const review=reviewPlacement(context,{commitmentId:value.commitmentId,date:value.date,startTime:value.startTime,endTime:value.endTime,blockId:id,expectedVersion:value.expectedVersion},now);checkApproval(review,value);
        return tx.replace({...block,...review.interval,version:block.version+1,updatedAt:now},value.expectedVersion);
      });
    },
    async cancel(actor: Actor, id: string, input: unknown) {
      validate(z.uuid(),id);const {mutationId,...value}=validate(cancelBlockSchema,input);
      return repository.execute(actor,mutationId,hash({kind:"time-block.cancel",id,...value}),async tx=>{
        const block=ownedBlock(await tx.block(id),actor.userId),context=await tx.context(block.planId),now=clock();requireScheduling(context,now);requireFutureBlock(block,value.expectedVersion,now);requireUnexecuted(context,id);
        return tx.replace({...block,state:"cancelled",version:block.version+1,updatedAt:now,cancelledAt:now},value.expectedVersion);
      });
    },
  };
}
function checkApproval(review: PlacementReview, input: {expectedPlanVersion:number;reviewKey:string;acknowledgeOutsideHours:boolean;acknowledgeBusy:boolean}) {
  if (input.expectedPlanVersion!==review.planVersion) throw new ApplicationError("CONFLICT","The Current Plan changed. Review this placement against the latest plan.",{kind:"EFFECTIVE_VERSION"});
  if (input.reviewKey!==review.reviewKey) throw new ApplicationError("CONFLICT","Scheduling context changed. Review the times and warnings again before confirming.",{kind:"REVIEW_CHANGED"});
  if (review.outsideHours&&!input.acknowledgeOutsideHours) throw new ApplicationError("CONFLICT","Part of this block is outside your normal Focusable Hours. Explicitly acknowledge it to schedule anyway.",{kind:"OUTSIDE_HOURS"});
  if (review.busyConflict&&!input.acknowledgeBusy) throw new ApplicationError("CONFLICT","This overlaps Google-reported busy time. Explicitly acknowledge it to schedule anyway.",{kind:"GOOGLE_BUSY"});
}
