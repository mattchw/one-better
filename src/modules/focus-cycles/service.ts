import {createHash,randomUUID} from 'node:crypto';
import type {Actor} from '../../domain/actor';
import type {Goal} from '../goals/domain';
import {parseCommand} from '../goals/domain';
import {ApplicationError} from '../../domain/errors';
import {localDate} from '../focus/domain';
import {createCycleSchema,updateCycleSchema,transitionCycleSchema,cycleId,checkVersion,checkEditable,checkTransition,withinCycle,currentCycle,type FocusCycle,type CycleGoal,type CycleWorkspace,type CycleFields,type CycleTransition} from './domain';
export interface CycleTransaction {
 get(id:string):Promise<FocusCycle|null>; active():Promise<FocusCycle|null>; goals(ids:string[]):Promise<Goal[]>;
 insert(c:FocusCycle):Promise<FocusCycle>; replace(c:FocusCycle):Promise<FocusCycle>;
}
export interface CycleRepository {
 read(actor:Actor):Promise<{cycles:FocusCycle[];timezone:string}>;
 execute(actor:Actor,mutationId:string,hash:string,apply:(tx:CycleTransaction,timezone:string)=>Promise<FocusCycle>):Promise<FocusCycle>;
}
function required(c:FocusCycle|null):FocusCycle{if(!c)throw new ApplicationError('NOT_FOUND','This Focus Cycle is unavailable.');return c;}
function member(g:Goal):CycleGoal{return {goalId:g.id,goalVersion:g.version,title:g.title,outcome:g.outcome,archivedAt:g.archivedAt};}
async function selected(tx:CycleTransaction,fields:CycleFields){const rows=await tx.goals(fields.goals.map(g=>g.goalId));return fields.goals.map(input=>{const g=rows.find(g=>g.id===input.goalId);if(!g)throw new ApplicationError('NOT_FOUND','A selected Goal is unavailable.');if(g.archivedAt||g.version!==input.goalVersion)throw new ApplicationError('CONFLICT','A selected Goal changed or was archived. Review your Goal selection before saving.',{kind:'CYCLE_GOAL'});return member(g);}).sort((a,b)=>a.goalId.localeCompare(b.goalId));}
export function cycleService(repository:CycleRepository,clock=()=>new Date().toISOString(),newId:()=>string=randomUUID){
 const hash=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
 return {
  async workspace(actor:Actor):Promise<CycleWorkspace>{const v=await repository.read(actor),today=localDate(clock(),v.timezone);return {...v,today,current:currentCycle(v.cycles,today)};},
  async create(actor:Actor,input:unknown){const {mutationId,...fields}=parseCommand(createCycleSchema,input);fields.goals.sort((a,b)=>a.goalId.localeCompare(b.goalId));return repository.execute(actor,mutationId,hash({kind:'cycle.create',...fields}),async tx=>{const now=clock();return tx.insert({id:newId(),...fields,goals:await selected(tx,fields),status:'draft',version:1,createdAt:now,updatedAt:now,activatedAt:null,finishedAt:null,archivedAt:null});});},
  async update(actor:Actor,id:string,input:unknown){id=cycleId(id);const {mutationId,expectedVersion,...fields}=parseCommand(updateCycleSchema,input);fields.goals.sort((a,b)=>a.goalId.localeCompare(b.goalId));return repository.execute(actor,mutationId,hash({kind:'cycle.update',id,expectedVersion,...fields}),async(tx,zone)=>{const c=required(await tx.get(id));checkVersion(c,expectedVersion);checkEditable(c);if(c.status==='active'&&!withinCycle(fields,localDate(clock(),zone)))throw new ApplicationError('CONFLICT','Active dates must include today. Finish the cycle before changing to a different horizon.',{kind:'CYCLE_DATES',current:c});return tx.replace({...c,...fields,goals:await selected(tx,fields),version:c.version+1,updatedAt:clock()});});},
  async transition(actor:Actor,id:string,kind:CycleTransition,input:unknown){id=cycleId(id);const {mutationId,expectedVersion}=parseCommand(transitionCycleSchema,input);return repository.execute(actor,mutationId,hash({kind:`cycle.${kind}`,id,expectedVersion}),async(tx,zone)=>{const c=required(await tx.get(id));checkVersion(c,expectedVersion);const now=clock();checkTransition(c,kind,localDate(now,zone));let members=c.goals;
   if(kind==='activate'){const active=await tx.active();if(active)throw new ApplicationError('CONFLICT','Finish or archive your Active cycle before activating another.',{kind:'CYCLE_ACTIVE',current:active});const rows=await tx.goals(c.goals.map(g=>g.goalId));if(rows.length!==c.goals.length||rows.some(g=>g.archivedAt))throw new ApplicationError('CONFLICT','A selected Goal was archived. Edit the cycle and remove unavailable Goals before activating.',{kind:'CYCLE_GOAL'});members=rows.map(member).sort((a,b)=>a.goalId.localeCompare(b.goalId));}
   if(kind!=='activate'&&c.status!=='finished'){const rows=await tx.goals(c.goals.map(g=>g.goalId));members=rows.map(member).sort((a,b)=>a.goalId.localeCompare(b.goalId));}
   return tx.replace({...c,goals:members,status:kind==='activate'?'active':kind==='finish'?'finished':'archived',version:c.version+1,updatedAt:now,activatedAt:kind==='activate'?now:c.activatedAt,finishedAt:kind==='finish'?now:c.finishedAt,archivedAt:kind==='archive'?now:c.archivedAt});});},
 };
}
