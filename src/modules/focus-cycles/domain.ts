import { z } from 'zod';
import { ApplicationError } from '../../domain/errors';
import { boundedText, parseCommand } from '../goals/domain';
import { calendarDate } from '../planning/domain';
export type CycleStatus = 'draft' | 'active' | 'finished' | 'archived';
export type CycleGoal = { goalId:string; goalVersion:number; title:string; outcome:string; archivedAt:string|null };
export type FocusCycle = { id:string; title:string; intent:string|null; startDate:string; endDate:string; status:CycleStatus; version:number; createdAt:string; updatedAt:string; activatedAt:string|null; finishedAt:string|null; archivedAt:string|null; goals:CycleGoal[] };
export type CycleWorkspace = { cycles:FocusCycle[]; current:FocusCycle|null; today:string; timezone:string };
const date=z.string().refine(v=>calendarDate(v),'Use a valid local date from 2000 through 9999.');
const intent=z.string().trim().refine(v=>Array.from(v).length<=2000,'Intent must be 2,000 characters or fewer.').refine(v=>v.isWellFormed()&&!v.includes('\0'),'Use valid text.').nullable().optional().transform(v=>v||null);
export const cycleFields=z.object({title:boundedText('Title',160),intent,startDate:date,endDate:date,goals:z.array(z.object({goalId:z.uuid(),goalVersion:z.number().int().min(1).max(2147483646)}).strict()).max(50)}).strict().refine(v=>v.startDate<=v.endDate,{path:['endDate'],message:'End date must be on or after start date.'}).refine(v=>new Set(v.goals.map(g=>g.goalId)).size===v.goals.length,{path:['goals'],message:'Select each Goal once.'});
export const createCycleSchema=cycleFields.safeExtend({mutationId:z.uuid()});
export const updateCycleSchema=createCycleSchema.safeExtend({expectedVersion:z.number().int().min(1).max(2147483646)});
export const transitionCycleSchema=z.object({mutationId:z.uuid(),expectedVersion:z.number().int().min(1).max(2147483646)}).strict();
export type CycleFields=z.infer<typeof cycleFields>;
export type CycleTransition='activate'|'finish'|'archive';
export const cycleId=(id:unknown)=>parseCommand(z.uuid(),id);
export function checkVersion(c:FocusCycle,version:number){if(c.version!==version)throw new ApplicationError('CONFLICT','This Focus Cycle changed. Review the latest saved cycle before trying again.',{kind:'CYCLE_VERSION',current:c});}
export function checkEditable(c:FocusCycle){if(!['draft','active'].includes(c.status))throw new ApplicationError('CONFLICT','This Focus Cycle is read-only.',{kind:'CYCLE_TERMINAL',current:c});}
export const withinCycle=(c:Pick<FocusCycle,'startDate'|'endDate'>,today:string)=>c.startDate<=today&&today<=c.endDate;
export function checkTransition(c:FocusCycle,kind:CycleTransition,today:string){
 if(kind==='activate'&&(c.status!=='draft'||!withinCycle(c,today)||!c.goals.length))throw new ApplicationError('CONFLICT','Activate a Draft with at least one active Goal and dates that include today.',{kind:'CYCLE_ACTIVATION',current:c});
 if(kind==='finish'&&c.status!=='active'||kind==='archive'&&c.status==='archived')throw new ApplicationError('CONFLICT','That transition is unavailable for this Focus Cycle.',{kind:'CYCLE_TERMINAL',current:c});
}
export function currentCycle(cycles:FocusCycle[],today:string){return cycles.find(c=>c.status==='active'&&withinCycle(c,today))??null;}
