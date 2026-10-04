import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import type { Actor } from "../../domain/actor";
import { ApplicationError } from "../../domain/errors";
import { validate } from "../calendar/domain";
import { endSessionSchema, finishSession, ownedSession, requireStart, startSessionSchema, type FocusContext, type FocusSession, type FocusWorkspace, type OwnedSession } from "./domain";
export interface FocusTransaction {
  context(id: string): Promise<FocusContext>;
  active(): Promise<FocusSession | null>;
  session(id: string): Promise<OwnedSession | null>;
  insert(value: FocusSession): Promise<FocusSession>;
  end(value: FocusSession, expectedVersion: number): Promise<FocusSession>;
}
export interface FocusRepository {
  workspace(actor: Actor, now: string, selected?: string): Promise<FocusWorkspace>;
  get(actor: Actor, id: string): Promise<OwnedSession | null>;
  execute(actor: Actor, mutationId: string, hash: string, apply: (tx: FocusTransaction)=>Promise<FocusSession>): Promise<FocusSession>;
}
const hash=(value:unknown)=>createHash("sha256").update(JSON.stringify(value)).digest("hex");
export function focusService(repository: FocusRepository, clock=()=>new Date().toISOString(), newId:()=>string=randomUUID) {
  return {
    async workspace(actor:Actor,selected?:string) {if(selected)validate(z.uuid(),selected);return repository.workspace(actor,clock(),selected);},
    async get(actor:Actor,id:string) {validate(z.uuid(),id);return ownedSession(await repository.get(actor,id),actor.userId);},
    async start(actor:Actor,id:string,input:unknown) {
      validate(z.uuid(),id);const {mutationId,...value}=validate(startSessionSchema,input);
      return repository.execute(actor,mutationId,hash({kind:"focus.start",id,...value}),async tx=>{
        // Resolve ownership before returning an existing active session.
        const context=await tx.context(id),active=await tx.active();
        if(active)throw new ApplicationError("CONFLICT","You already have an active focus session. Return to focus to continue or end it.",{kind:"ACTIVE_SESSION",current:active});
        const now=clock();requireStart(context,value.expectedBlockVersion,value.acknowledgeRemoved,now);
        return tx.insert({id:newId(),timeBlockId:id,startedAt:now,endedAt:null,outcome:null,endNote:null,version:1,createdAt:now,updatedAt:now});
      });
    },
    async end(actor:Actor,id:string,input:unknown) {
      validate(z.uuid(),id);const value=validate(endSessionSchema,input),{mutationId,...payload}=value;
      return repository.execute(actor,mutationId,hash({kind:"focus.end",id,...payload}),async tx=>{
        const session=ownedSession(await tx.session(id),actor.userId);
        return tx.end(finishSession(session,value,clock()),value.expectedVersion);
      });
    },
  };
}
