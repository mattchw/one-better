"use client";
import { useState, type ReactNode } from "react";
import type { ReviewAnalytics } from "@/modules/weekly-reviews/analytics";
import { recordedTime } from "./focus-view";
import { duration } from "./planning-presentation";
import { BetterStreak } from "./better-streak";
import type { HabitProgress } from "@/modules/reviews/habit";
import { FeedbackMetrics } from "./feedback-presentation";

const dateLabel=(date:string,options:Intl.DateTimeFormatOptions={weekday:"short"})=>new Intl.DateTimeFormat("en-GB",{timeZone:"UTC",...options}).format(new Date(`${date}T12:00Z`));
export function ReviewDashboard({data,summary,weekly=true,navigationBlocked=false,habit}:{data:ReviewAnalytics;summary?:ReactNode;weekly?:boolean;navigationBlocked?:boolean;habit?:HabitProgress}) {
  const [chosen,setChosen]=useState(data.daily.find(d=>d.date===data.today)?.date??data.daily.at(-1)!.date);
  const day=data.daily.find(d=>d.date===chosen)??data.daily[0];
  const periodEnd=data.daily.at(-1)!.date,live=data.today>=data.startDate&&data.today<=periodEnd;
  const max=Math.max(60*60000,...data.daily.flatMap(d=>[d.scheduledMilliseconds,d.recordedMilliseconds]));
  const goalMax=Math.max(60*60000,...data.goals.flatMap(g=>[g.scheduledMilliseconds,g.recordedMilliseconds,(g.budgetMinutes??0)*60000]));
  const reflections=data.daily.filter(d=>d.reflection==="finalized").length;
  return <section className="review-dashboard" aria-label={weekly?"Weekly analytics dashboard":"Daily analytics dashboard"}>
    <div className={`review-overview ${habit?"has-habit":""}`}><div className="review-overview-main"><div className="review-analytics-hero">
      <div className="review-analytics-mark" aria-hidden="true"><i/><i/><i/></div>
      <div><span className="review-analytics-kicker">{live?"Your progress, so far":data.startDate>data.today?"A look ahead":weekly?"Your week in perspective":"Your day in perspective"}</span><h2>{data.recordedMilliseconds>0?"Make sense of the time you gave." : data.scheduledMilliseconds>0?"Your plan is here. Actuals come next." : "Start with an honest picture."}</h2>
        <p>{data.recordedMilliseconds>0?`${recordedTime(data.recordedMilliseconds)} of recorded focus across ${data.sessionCount} ${data.sessionCount===1?"session":"sessions"}. Compare it with the time you protected and the Goals you chose.`:data.scheduledMilliseconds>0?`${recordedTime(data.scheduledMilliseconds)} protected on your calendar. No focus time has been recorded for these dates yet.`:"No scheduled blocks or focus sessions for these dates yet. As you plan and work, this dashboard fills with your own data."}</p></div>
      <span className="review-analytics-state">{live?"In progress":data.startDate>data.today?"Upcoming":"Finished period"}</span>
    </div>
    {summary??<FeedbackMetrics label="Weekly analytics summary" className="review-analytics-metrics" items={[{label:"Task time picked",value:data.budgetMinutes===null?"—":duration(data.budgetMinutes)},{label:"Scheduled focus",value:recordedTime(data.scheduledMilliseconds)},{label:"Recorded focus",value:recordedTime(data.recordedMilliseconds)},{label:"Focus sessions",value:data.sessionCount}]}/>}
    </div>{habit&&<BetterStreak habit={habit}/>}</div>
    <div className="review-analytics-grid">
      {weekly&&<>
      <section className="review-analytics-card review-trend" aria-label="Time by day">
        <div className="review-analytics-heading"><div><h2>{weekly?"How your week unfolded":"Protected time and actual focus"}</h2><p>{weekly?"Select a day to inspect the numbers.":"Calendar time and recorded focus are independent."}</p></div><div className="review-chart-legend"><span className="is-scheduled">Scheduled</span><span className="is-recorded">Recorded</span></div></div>
        <div className={`review-day-chart ${weekly?"":"is-daily"}`}>
          {data.daily.map(d=><button key={d.date} className={`review-day-column ${d.future?"is-future":""}`} aria-pressed={chosen===d.date} onClick={()=>setChosen(d.date)} aria-label={`${dateLabel(d.date,{weekday:"long",day:"numeric",month:"short"})}: scheduled ${recordedTime(d.scheduledMilliseconds)}, recorded ${recordedTime(d.recordedMilliseconds)}${d.future?", upcoming":""}`}>
            <span className="review-day-bars" aria-hidden="true"><i className="scheduled-bar" style={{height:`${d.scheduledMilliseconds/max*100}%`}}/><i className="recorded-bar" style={{height:`${d.recordedMilliseconds/max*100}%`}}/></span><span>{dateLabel(d.date)}</span><small>{dateLabel(d.date,{day:"numeric"})}</small>
          </button>)}
        </div>
        <div className="review-day-detail" aria-live="polite"><strong>{dateLabel(day.date,{weekday:"long",day:"numeric",month:"short"})}</strong><span>Scheduled <b>{recordedTime(day.scheduledMilliseconds)}</b></span><span>Recorded <b>{recordedTime(day.recordedMilliseconds)}</b></span><a href={`/today?date=${day.date}`} aria-disabled={navigationBlocked} onClick={e=>{if(navigationBlocked)e.preventDefault();}}>Inspect day →</a></div>
        <p className="review-analytics-caption">Actuals are counted on the day they happened, including work scheduled on another date. {live?"Future days show planned time only. ":""}Cancelled blocks are excluded from scheduled time.</p>
      </section>
      <section className="review-analytics-card review-session-card" aria-label="Session outcomes">
        <div className="review-analytics-heading"><div><h2>Inside your focus time</h2><p>Outcomes reported when ending sessions.</p></div></div>
        <div className="review-session-total"><strong>{data.sessionCount}</strong><span>recorded {data.sessionCount===1?"session":"sessions"}</span></div>
        <dl className="review-outcome-list">{([["Completed as planned",data.outcomes.completed],["Partial progress",data.outcomes.partial],["Abandoned",data.outcomes.abandoned],["Still active",data.outcomes.active]] as const).map(([label,count])=><div key={label}><dt>{label}</dt><dd>{count}</dd></div>)}</dl>
        <p className="review-analytics-caption">Session outcomes do not mark Actions complete. {data.cancelledBlocks} cancelled {data.cancelledBlocks===1?"block":"blocks"} in this period.</p>
      </section>
      </>}
      {(weekly||data.goals.length>0)&&<section className="review-analytics-card review-goal-attention" aria-label="Goal time allocation">
        <div className="review-analytics-heading"><div><h2>Where your attention went</h2><p>Time grouped by the Goal saved with each commitment and block.</p></div></div>
        {data.goals.length?<div className="review-goal-table" role="table" aria-label="Time by Goal"><div className="review-goal-table-head" role="row"><span role="columnheader">Goal</span><span role="columnheader">Picked</span><span role="columnheader">Scheduled</span><span role="columnheader">Recorded</span></div>{data.goals.map(g=><div className="review-goal-row" role="row" key={g.id}><div role="rowheader"><strong>{g.title}</strong><span className="review-goal-bars" aria-hidden="true"><i className="scheduled-bar" style={{width:`${g.scheduledMilliseconds/goalMax*100}%`}}/><i className="recorded-bar" style={{width:`${g.recordedMilliseconds/goalMax*100}%`}}/></span></div><span role="cell" data-label="Picked">{g.budgetMinutes===null?"—":duration(g.budgetMinutes)}</span><span role="cell" data-label="Scheduled">{recordedTime(g.scheduledMilliseconds)}</span><span role="cell" data-label="Recorded">{recordedTime(g.recordedMilliseconds)}</span></div>)}</div>:<p className="review-chart-empty">No Goal-linked work for these dates yet.</p>}
        <p className="review-analytics-caption">{weekly?"Picked time comes from your current weekly task list. Scheduled and recorded time include any planning week contributing to these dates.":"Daily time is grouped by Goal; picked task time belongs to the week."} A dash means no weekly task time was picked.</p>
      </section>}
      {weekly&&<div className="review-evidence-pair">
        <section className="review-analytics-card"><h2>What has evidence</h2><p><span className="review-evidence-dot"/>{data.sessionCount?`${data.sessionCount} focus ${data.sessionCount===1?"session provides":"sessions provide"} a record of how time was spent.`:"No focus sessions recorded yet. Unrecorded work may still have happened."}</p><p><span className="review-evidence-dot"/>{reflections} currently finalized daily {reflections===1?"reflection":"reflections"}{weekly?` across ${data.daily.length} days`:""}.</p></section>
        <section className="review-analytics-card"><h2>Worth a closer look</h2><p><span className="review-evidence-dot is-amber"/>{data.endedBlocksWithoutSessions?`${data.endedBlocksWithoutSessions} ended ${data.endedBlocksWithoutSessions===1?"block has":"blocks have"} no linked session. Inspect the day before deciding what changed.`:"No ended blocks without a linked focus session."}</p><p className="review-analytics-caption">These are observations, not a productivity rating. Missing recordings do not prove the work was missed.</p></section>
      </div>}
    </div>
    {weekly&&<p className="review-analytics-caption review-observed-at">Facts as of {new Intl.DateTimeFormat("en-GB",{timeZone:data.timezone,day:"numeric",month:"short",hour:"2-digit",minute:"2-digit"}).format(new Date(data.observedAt))} · {data.timezone}.{data.outcomes.active>0?" Refresh review facts to update active session time.":""}</p>}
  </section>;
}
