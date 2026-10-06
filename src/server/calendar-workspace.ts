import {quickPlanningContext} from './quick-planning';
import {calendarSelection} from '../components/calendar-navigation';
import {readCalendarProjection} from '../modules/scheduling/calendar-reader';
import {focusCycles} from './focus-cycles';
import 'server-only';
import type {Actor} from '../domain/actor';
import {planning} from './planning';
import {scheduling} from './scheduling';
import {amendments} from './amendments';
import {focusAvailability} from './availability';
import {accountRepository} from '../modules/account/repository';
import {readAccountContext} from '../modules/account/service';
import {runtime} from './runtime';
import {focus} from './focus';
import type {FocusWorkspace as ExecutionWorkspace} from '../modules/focus/domain';
import type {FocusWorkspace} from '../modules/availability/service';
// Page composition only. The underlying services retain all ownership and lifecycle rules.
export async function calendarInitial(actor:Actor,input:{week?:string;date?:string;view?:string;placeFirst?:string;taskAdded?:string}={}) {
 const account=await readAccountContext(actor,accountRepository(runtime().db));
 const selection=calendarSelection(input,account.timezone,Date.now());
 const workspace=await planning().workspace(actor,selection.week);
 const schedule=selection.scale!=='month'&&workspace.view?.plan.state==='committed'?await scheduling().view(actor,workspace.view.plan.id):null;
 const activity=schedule?await amendments().history(actor,schedule.planId):null;
 const effective=activity?.effective??null;
 let context:FocusWorkspace|null=null;
 try{if(selection.scale!=='month')context=await focusAvailability().read(actor,workspace.weekStartDate);}catch{/* Saved local work remains usable when advisory context fails. */}
 let execution:ExecutionWorkspace|null=null;
 try{if(selection.scale!=='month')execution=await focus().workspace(actor);}catch{/* Focus context can be retried without hiding the calendar. */}
 const cycles=selection.scale==='week'?await focusCycles().workspace(actor):undefined;
 const projection=selection.scale==='week'?null:await readCalendarProjection(runtime().db,actor,selection.date,selection.scale,account.timezone);
 const quickPlanning=selection.scale==='week'&&workspace.view?.plan.state!=='committed'&&workspace.weekStartDate>=workspace.currentWeekStartDate?await quickPlanningContext(actor,workspace.weekStartDate):null;
 return {placeFirst:schedule?.canSchedule&&schedule.commitments.some(c=>c.id===input.placeFirst)?input.placeFirst:undefined,taskAdded:schedule?.commitments.some(c=>c.id===input.taskAdded)?input.taskAdded:undefined,quickPlanning,accountTimezone:account.timezone,legacyWeek:!!input.week&&!input.date&&!input.view,selection,projection,cycles,workspace,schedule,effective,activity,context,execution,now:Date.now(),accountName:account.name};
}
