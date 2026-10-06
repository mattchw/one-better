import { effectivePlan, planDifference, type Amendment } from '@/modules/amendments/domain';
import type { WeeklyPlan } from '@/modules/planning/domain';
import {goalTitle} from '@/modules/planning/general';
import { duration } from './planning-presentation';
export function WeekActivity({plan,changes}:{plan:WeeklyPlan;changes:Amendment[]}) {
 const stamp=(value:string)=>new Intl.DateTimeFormat('en-GB',{timeZone:plan.timezone,day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'}).format(new Date(value));
 return <details className="week-activity"><summary>Week activity</summary><ol>
  <li><time>{stamp(plan.committedAt!)}</time><p>Started the week with {plan.commitments.map(c=>c.snapshot?.action.title??'a task').join(', ')||'an empty list'}.</p></li>
  {changes.map((change,index)=>{
   const previous=index?changes[index-1]:effectivePlan(plan,[]);
   const diff=planDifference(previous,change);
   const edits=change.commitments.flatMap(c=>{const old=previous.commitments.find(v=>v.id===c.id);if(!old)return [];const lines=[];if(old.snapshot.action.title!==c.snapshot.action.title)lines.push(`Renamed ${old.snapshot.action.title} to ${c.snapshot.action.title}.`);if(old.snapshot.goal?.id!==c.snapshot.goal?.id)lines.push(`Moved ${c.snapshot.action.title} to ${goalTitle(c.snapshot.goal)}.`);return lines;});
   return <li key={change.id}><time>{stamp(change.createdAt)}</time>
    {diff.added.map(c=><p key={c.id}>Added {c.snapshot.action.title}.</p>)}
    {diff.dropped.map(c=><p key={c.id}>Removed {c.snapshot.action.title} from this week.</p>)}
    {diff.budgets.map(c=><p key={c.actionId}>Changed {c.title} to {duration(c.next)}.</p>)}
    {edits.map((line,i)=><p key={i}>{line}</p>)}
    {!edits.length&&!diff.added.length&&!diff.dropped.length&&!diff.budgets.length&&<p>Updated the week’s settings.</p>}
   </li>;
  })}
 </ol></details>;
}
