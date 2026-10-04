"use client";
import { useEffect, useRef, useState } from 'react';
import type { CoachingRun, CoachingScope, CoachingView } from '@/modules/coaching/domain';
import type { PlacementReview, SchedulingView } from '@/modules/scheduling/domain';
import type { Editor } from './time-blocks-view';
import { request, errorInfo } from './mutation-client';
type Preview = { view:SchedulingView;review:PlacementReview;editor:Editor };
const failures:Record<string,string>={timeout:'The coach took too long. Try again when you’re ready.',authentication:'The AI provider connection needs attention.',rate_limit:'The AI provider is busy. Try again in a moment.',model_unavailable:'The configured AI model is unavailable.',invalid_output:'The coach’s response could not be verified.',refusal:'The coach could not offer advice for these facts.',context_too_large:'This context is too large for a short coaching request.',unavailable:'Coaching is temporarily unavailable.'};
export function CoachPanel({contextType,week,revision,locked=false,onPreview}:{contextType:CoachingScope['contextType'];week:string;revision:string;locked?:boolean;onPreview?:(preview:Preview,trigger:HTMLButtonElement)=>void}) {
  const [view,setView]=useState<CoachingView|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState(''),[pending,setPending]=useState<object|null>(null);
  const requestSequence=useRef(0),flight=useRef(false),mounted=useRef(true);
  const url=`/api/coaching?contextType=${contextType}&week=${week}`;
  useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;};},[]);
  useEffect(()=>{
    let active=true;
    async function read(){if(!active||flight.current||document.visibilityState==='hidden')return;const sequence=++requestSequence.current;
      try{const next=await request<CoachingView>(url);if(active&&sequence===requestSequence.current){setView(next);setError('');}}catch{if(active&&sequence===requestSequence.current)setError('Coaching could not be loaded. Your planning tools are still available.');}}
    // Reads only; provider generation is always an explicit button action.
    void read();const timer=setInterval(()=>void read(),60_000);window.addEventListener('focus',read);document.addEventListener('visibilitychange',read);
    return()=>{active=false;clearInterval(timer);window.removeEventListener('focus',read);document.removeEventListener('visibilitychange',read);};
  },[url,revision]);
  async function load(){try{setView(await request<CoachingView>(url));setError('');}catch{setError('Coaching could not be loaded. Try again.');}}
  async function generate(command:object){if(flight.current)return;flight.current=true;requestSequence.current++;setBusy(true);setError('');setPending(command);
    try{await request<{run:CoachingRun}>('/api/coaching',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(command)});setPending(null);await load();}
    catch(e){const info=errorInfo(e);setError(info.message);if(!['UNCERTAIN','DATABASE_UNAVAILABLE'].includes(info.code))setPending(null);}
    finally{flight.current=false;if(mounted.current)setBusy(false);}
  }
  async function preview(index:number,trigger:HTMLButtonElement){if(!view?.run||flight.current)return;flight.current=true;setBusy(true);setError('');
    try{const result=await request<Preview>(`/api/coaching/${view.run.id}/preview`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({index})});onPreview?.({...result,editor:{...result.editor,initialReview:result.review,coaching:{runId:view.run.id,index}}},trigger);}
    catch(e){setError(errorInfo(e).message);await load();}finally{flight.current=false;setBusy(false);}
  }
  const run=view?.run,disabled=locked||busy||!!pending;
  return <section className="coach-panel workspace-panel" aria-label={contextType==='calendar'?'Coach':"Coach’s perspective"}>
    <div className="coach-heading"><h2>{contextType==='calendar'?'Coach':"Coach’s perspective"}</h2><span>✧ Optional</span></div>
    {error&&<p role="alert" className="coach-error">{error}</p>}
    {!view?<> <p className="canvas-description">{error?'Your Calendar and reviews remain usable.':'Loading coaching…'}</p>{error&&<button className="quiet-button" disabled={disabled} onClick={()=>void load()}>Retry coaching</button>}</>:!view.enabled?<><p className="canvas-description">Connect an AI provider to get planning insights.</p>{view.configuration==='incomplete'&&<p className="small-note">Complete the provider’s server configuration to enable coaching.</p>}</>:<>
      <details className="coach-privacy"><summary>What is shared?</summary><p>{contextType==='calendar'?'Current Focus, this week’s plan, relevant Actions, availability and recent recorded totals. Reflection text and session notes are excluded.':'Deterministic Review patterns, relevant following-week plan facts, and permitted finalized weekly and daily reflections. Draft and late-finalized text and session notes are excluded.'}</p><p>Sent to {view.provider==='openai'?'OpenAI':'Anthropic'} only when you request coaching. Suggestions are saved; nothing is scheduled automatically.</p></details>
      {run&&<p className="coach-generated">Generated {new Intl.DateTimeFormat('en-GB',{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'}).format(new Date(run.generatedAt))} · {run.provider==='openai'?'OpenAI':'Claude'}</p>}
      {run?.stale&&<p className="coach-stale" role="status">Facts changed since this advice. Refresh coaching before using it.</p>}
      {run?.status==='pending'&&<p role="status" className="canvas-description">{run.interrupted?'This request was interrupted. Refresh to start a new attempt.':'The coach is considering this snapshot…'}</p>}
      {run?.status==='failed'&&<p className="coach-error" role="status">{failures[run.failure??'unavailable']}</p>}
      {run?.status==='succeeded'&&!run.stale&&!run.recommendations.length&&<p className="canvas-description">No useful suggestion is supported by these facts. Keep room for what matters.</p>}
      {run?.status==='succeeded'&&run.recommendations.map((checked,index)=>{const r=checked.proposal;return <article className="coach-suggestion" key={`${run.id}:${index}`}><h3>{checked.title??'Saved advice'}</h3>{checked.candidate&&<p className="coach-time">{checked.candidate.localDate} · {checked.candidate.startLocalTime}–{checked.candidate.endLocalTime} · {checked.candidate.durationMinutes}m</p>}{'interpretation' in r?<div className="coach-review-insight"><p className="small-note">Pattern to consider · Week of {week}</p><h4>Evidence</h4><ul>{checked.evidence.map(f=><li key={f.key}>{f.label}</li>)}</ul><h4>Coach</h4><p>{r.interpretation}</p><h4>Question</h4><p className="coach-question">{r.reflectionQuestion}</p></div>:<details className="coach-evidence"><summary>Why?</summary><h4>Evidence</h4><ul>{checked.evidence.map(f=><li key={f.key}>{f.label}</li>)}</ul><h4>Coach</h4><p>{r.rationale??'Refresh coaching for an explanation using the current evidence contract.'}</p></details>}
        {checked.unavailable&&<p className="coach-stale">Unavailable · {checked.unavailable}</p>}{r.type==='schedule_candidate'&&checked.placement&&!checked.unavailable&&<button className="quiet-button" disabled={disabled||run.stale||!onPreview} onClick={e=>void preview(index,e.currentTarget)}>Preview</button>}
        {r.type==='review_plan'&&checked.href&&<a className="coach-review-link" aria-disabled={disabled||run.stale} onClick={e=>{if(disabled||run.stale)e.preventDefault();}} href={checked.href}>Review choices →</a>}
      </article>;})}
      {pending?<button className="quiet-button" disabled={locked||busy} onClick={()=>void generate(pending)}>Retry same coaching request</button>:<button className="quiet-button coach-refresh" disabled={locked||busy||run?.status==='pending'&&!run.interrupted||!view.fingerprint} onClick={()=>void generate({contextType,week,fingerprint:view.fingerprint,mutationId:crypto.randomUUID()})}>{busy?'Getting coaching…':run?'Refresh coaching':'Get coaching'}</button>}
    </>}
    {locked&&view?.enabled&&<p className="small-note">Finish the current edit before requesting coaching.</p>}
  </section>;
}
