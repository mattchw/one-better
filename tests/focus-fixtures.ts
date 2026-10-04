import { randomUUID } from "node:crypto";
import type { FocusContext, FocusSession } from "../src/modules/focus/domain";
import { context,block } from "./scheduling-fixtures";
export const focusNow="2026-10-06T08:45:00.123Z";
export function focusContext():FocusContext {const c=context(),b=block();return {block:b,plan:c.plan,effective:c.effective,userTimezone:c.userTimezone,blocks:[b],sessions:[]};}
export function focusSession(extra:Partial<FocusSession>={}):FocusSession{return {id:randomUUID(),timeBlockId:randomUUID(),startedAt:focusNow,endedAt:null,outcome:null,endNote:null,version:1,createdAt:focusNow,updatedAt:focusNow,...extra};}
