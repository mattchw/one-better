# R5D — AI Recommendation Quality Hardening

Date: 3 October 2026. Scope complete. Calendar safety, restraint, staleness and explicit acceptance improved materially on the unchanged live Haiku scenarios. **The overall recommendation-quality gate is not fully passed: the finalized Review response violated the prose contract and was withheld.** No stronger model, OAuth, new AI capability, autonomous action, tool loop, background generation, memory or chat was implemented.

R5C is accepted as complete with a failed recommendation-quality gate. Its historical [report](r5c-live-ai-quality-gate.md) and evidence remain the baseline. This report records the new contract, every live result, one discovered validator bug and its corrective verification; it does not discard failed answers or declare a winning provider.

## Failures addressed

R5C allowed models to invent timestamps, then rejected past/illegal placements. All three observed scheduling proposals were past. Reference validation passed while invented weekdays, implied Action completion, an invented repeated-Carry pattern and unnecessary well-planned-week advice survived in prose.

R5D moves possibility and factual derivation to the application. The provider chooses which supplied decision signal/candidate deserves mention and writes a short qualitative explanation. It cannot supply authoritative timestamps, entity targets, quantities or headings.

## Deterministic architecture

`modules/coaching/candidates.ts` uses the owned Scheduling view, current Effective Plan, current actionable sources, pinned Plan timezone, user Focusable Hours, fresh FreeBusy-derived availability and exact captured request time. It intersects focus windows with Calendar-open intervals and the pinned local week, subtracts all planned local TimeBlocks, and offers only future, same-local-day intervals. Cancelled blocks do not occupy space; executed planned blocks retain their original interval and do occupy space.

Policy is deliberately bounded: up to three eligible commitments with at least 30 minutes unscheduled; up to two alternatives each; quarter-hour grid; at most 60 elapsed minutes per candidate, bounded by remaining budget. Alternatives may overlap each other; they are options, not a batch schedule. Duplicate recommendations for the same signal are rejected. No candidate exceeds the unscheduled budget or claims stale/unknown coverage is free. Without fresh Calendar coverage or configured hours, AI scheduling candidates are omitted and ordinary human scheduling remains available.

Opaque IDs are stable hashes of owned Plan/commitment and wall-clock placement. IDs resolve only against the current supplied packet and signal's allowed candidate list; they are not authorization tokens. Guessing an ID cannot cross an ownership boundary. Ambiguous/shifted DST boundaries are conservatively omitted; intervals spanning a transition use elapsed minutes and must round-trip through the existing `resolvePlacement` policy. Overnight and 24:00-ended placements remain unsupported.

The service calls the ordinary scheduling Preview for every candidate **before any provider request**, checking future start, interval equality, hours coverage, fresh Calendar status, no busy conflict and resulting schedule within commitment budget. It checks again after the provider returns, at Preview, and through the ordinary editor's existing acceptance/receipt guards. A slot that expires while the model is answering cannot become actionable.

`modules/coaching/signals.ts` generates at most twelve provider-neutral signals. They are facts rather than ratings:

| Signal | Deterministic rule |
| --- | --- |
| Significant unscheduled work | At least 60 minutes and at least a quarter of the commitment budget remain unscheduled. Legal candidate IDs are attached when available. |
| Fully scheduled | Scheduled minutes meet/exceed the deliberately committed budget. Context only: `worthConsidering=false`, cannot independently support advice. |
| No recorded Focus | No recorded Focus on a current commitment and a planned block has already ended. Future unexecuted blocks do not qualify; missing recording never proves no work. |
| Repeated Carry | The same Action has Carry decisions in at least two consecutive finalized reviewed weeks immediately preceding the scoped week. Draft, missing and non-Carry weeks break the sequence. |
| Focus without commitment | An unarchived currently selected Focus Goal has no effective commitment in the scoped week. Offers human review, not automatic work creation. |
| Recent attention | Two most recent finalized reviewed weeks have no recorded Focus for the selected Goal. Calendar suppresses this signal if current work already has protected time. This is a recording fact, not proof of no activity. |
| Review execution difference | Budget is at least 60 minutes and budget versus recorded Focus differs by at least 60 minutes and half the budget. Scheduled and recorded facts remain separate. |
| Review amendment | A recorded amendment changed total committed minutes by at least 60. This initial rule does not detect every substantial reallocation with zero net change. |

Only `worthConsidering` signals may support a recommendation. The model may still abstain. Fully scheduled signals remain useful supporting context without manufacturing decisions from the mere existence of data.

The full whitelist is hashed for staleness, including relevant source versions/eligibility, blocks, history, Focus Cycle, plan and hours. The **transmitted facts** are narrower: signal evidence, legal candidates, selected Goal/Cycle context, distinct capacity/budget facts, aggregate execution/availability, and permitted Review reflections. Raw block/history rows, Action estimates and optional source rows no longer reach the provider. The model does not scan loose history to discover Carry patterns or reinterpret estimates as required remaining work.

## Revised output and evidence

```json
{
  "recommendations": [
    {
      "type": "schedule_candidate",
      "signalId": "signal_unscheduled_<owned commitment>",
      "candidateId": "schedule_candidate_<opaque hash>",
      "rationale": "Protecting manageable work can help follow through while preserving flexibility.",
      "evidenceRefs": ["commitment:<owned commitment>", "goal:<owned goal>"]
    }
  ]
}
```

The existing `observation` and `review_plan` forms now use the same `signalId`, `rationale` and `evidenceRefs`; review navigation resolves from the signal's server-owned target. `schedule_candidate` replaces `schedule_time`, as explicitly requested; there are no additional capabilities. Provider output has no title, date, start/end, duration, commitment ID or mutation target fields. Extra fields, unsupported types, unknown/foreign candidate/signal/evidence IDs, inappropriate Review scheduling and duplicate signal advice reject the entire answer. Closed JSON schemas remain identical for both official SDK adapters; strict Zod independently checks shape, lengths and the three-recommendation limit.

The server derives the heading, time line, navigation and complete supporting Evidence. A model cannot hide inconvenient quantities by citing only a subset: the UI shows all supporting signal facts and the selected candidate. Why? has **Evidence** and **Coach** sections, without chain-of-thought. Commitment evidence displays committed, scheduled, still-unscheduled and recorded Focus quantities separately; candidate evidence displays the actual local date/time, timezone, duration and availability status. Human Carry/Defer/Drop choices and Action completion remain untouched.

Rationale is limited to 320 characters and qualitative advice. The guard rejects digits, spelled numerical quantities, weekdays/month/date language, common historical/completion assertions, Carry/Defer/Drop wording, quoted titles, UUIDs and unexpected capitalized proper nouns. It is a conservative lexical guard, not semantic proof. No automatic model repair, retry or extra generation follows a rejected response. Empty output is a durable success, not an error.

Existing private R5B runs are retained. The version-2 context invalidates their fingerprints; old free-form scheduling payloads cannot reach Preview. The UI shows saved evidence with a refresh explanation when the legacy rationale field is absent. No database migration or persistence schema redesign was necessary.

## Time and consistency

The service captures exact authoritative server request time once and supplies it to both owned context reads. The model never decides whether a slot is past. Candidate start must be strictly later than that instant, including the current minute. Calendar-open boundaries containing seconds round upward to the next legal quarter hour; truncation can never place a candidate inside the preceding busy interval. Exact request time is supplied in the packet but is not itself part of the material fingerprint; fixed-grid candidates, their expiry, elapsed-work signals and local-day rollover change the digest. Clock ticks alone do not make all advice stale.

Scheduling/Calendar/Focusable server composition now shares `executionClock`, including its existing guarded test-only override. Normal development/production still uses current system time. The first browser run exposed a fixture-cache freshness mismatch from inconsistent test-clock wiring; correcting the composition made candidate generation, ordinary Preview and the isolated UI agree on the same time. A preparation assertion was also updated for the narrowed evidence packet before any provider call.

Two consistent reads are not a single global SQL snapshot. Data can change afterward; fresh Preview and transactional scheduling guards remain the acceptance authority. Provider downtime, expired time, stale Calendar information or a changed plan cannot grant permission to mutate anything.

## Frozen live scenarios and configuration

The domain scenario remains `tests/r5c-scenario.ts`, with the clean well-planned variant already used in the final R5C run. No domain data was changed to obtain better model output. Only fixture assertions were adapted to the new packet shape. New disposable account/row UUIDs are expected on each isolated run.

- Exact model: **`claude-haiku-4-5-20251001`**; same Haiku 4.5 as R5C.
- SDK: pinned `@anthropic-ai/sdk@0.131.0`; official `https://api.anthropic.com/v1/messages`; development API key read server-side from `.env.local`, never committed, logged or sent to the browser.
- Shared prompt/schema hashes and non-secret settings are in [results](r5d-evidence/results.json). `output_config.format` structured JSON; 4,096 output tokens; SDK timeout 25 seconds; application deadline 30 seconds; zero SDK retries; no tools or explicit prompt caching.
- OpenAI remains the pinned `openai@7.27.0` Responses adapter with `store:false` and the same strict JSON schema. OpenAI/Anthropic automated HTTP fixtures and browser flows both pass. **No real OpenAI API request was made; there is no OpenAI live-quality conclusion.** OAuth remains outside R5D.
- Request time: **5 January 2028, 08:00 UTC**; Europe/London; current week 3–9 January; explicit historical Review week 27 December–2 January.
- Active Focus Cycle: “Make the weekly loop useful and sustainable”, 20 December–31 January, three selected Goals: beta/onboarding, sustainable running, practical essay.
- Current plan: onboarding 240m committed/45m scheduled/30m recorded, run 60m committed/scheduled/recorded, essay 60m committed/scheduled with its block still future. Capacity 720m, reserve 180m, usable 540m; commitment budget 360m. Estimates remain independent.
- Focusable Hours: weekdays 09:00–12:00 and 14:00–16:00. Synthetic fresh FreeBusy excludes Wednesday 10:00–11:00, Thursday 09:00–10:00 and Friday 14:00–15:00. Local TimeBlocks are also subtracted.
- Prior finalized Review: onboarding 120m committed/60m scheduled/30m recorded, one human Carry decision proposing 90m. An older weekly review is draft: this is **one Carry, not repeated Carry**.
- Finalized daily and weekly notes are permitted only in explicit Review. Draft daily/weekly, daily finalized after the terminal cutoff, Focus Session notes and Google account/calendar metadata use exclusion sentinels.
- Well-planned account: all three 60m budgets fully scheduled; onboarding and run have recorded completed Focus Sessions; essay is still future; estimates are 60m, as in R5C's final clean-restraint fixture. There is no justified decision signal and no candidate.

[Scenario state and sent packets](r5d-evidence/scenario.json) retain exact quantities, IDs and privacy assertions. No Google API was contacted. All live/model/UI mutations used disposable loopback test databases, which were removed afterward.

## Live results and cost

There were six real provider requests: the five planned QA cells plus one explicit corrective regeneration after a genuine validator false positive. Five returned structured responses; the deliberate invalid-key request returned authentication failure. Schema-compatible output is not the same as application-accepted output.

| Cell | Latency | Input / output tokens | Raw / accepted recommendations | Application result | Approximate USD |
| --- | ---: | ---: | ---: | --- | ---: |
| Calendar | 6,472ms | 3,893 / 181 | 1 / 1 | Accepted; legal scheduling Preview | 0.004798 |
| Clean well-planned week | 1,463ms | 3,145 / 8 | 0 / 0 | Successful abstention | 0.003185 |
| Finalized Review | 4,559ms | 3,002 / 269 | 2 / 0 | Withheld: prose contract violation | 0.004347 |
| Regenerate after TimeBlock creation, before correction | 2,227ms | 3,892 / 175 | 1 / 0 | Withheld: validator false positive | 0.004767 |
| Invalid development key | 219ms | unavailable | 0 / 0 | Authentication failure; core usable | not inferred |
| Corrective regeneration, identical facts/prompt/model | 2,404ms | 3,892 / 173 | 1 / 1 | Accepted; live UI Preview → Schedule | 0.004757 |

Cache-read usage was zero throughout. Total observed input: **17,824 tokens**; output: **806**. Approximate response-token cost: **$0.021854**. This includes costs of rejected answers and the corrective request; it is not an invoice and does not infer cost from missing failure usage. Service latency includes the provider response and selected-candidate validation, rather than total page/context preparation time.

Rates used: Haiku 4.5 input $1/MTok, output $5/MTok, cache reads $0.10/MTok, from [Anthropic pricing](https://platform.claude.com/docs/en/about-claude/pricing). The [structured-output documentation](https://platform.claude.com/docs/en/build-with-claude/structured-outputs) describes the Messages format used. No account discounts, taxes or unreported charges are inferred. [Primary results](r5d-evidence/results.json) and [corrective result](r5d-evidence/regenerate-followup.json) retain raw structured outputs, schema/grounding checks, usage and cost estimates.

### Live validator bug and correction

The original regeneration contained “within available hours”. The initial guard rejected the word `hours` unconditionally, although no new duration was asserted. That was an application bug, not fabricated provider output. The corrected rule permits qualitative availability language and modal “may”, while still rejecting numerical durations, “an hour” and month/date assertions. A dedicated provider-neutral regression test covers both sides.

The exact original raw payload passes the corrected validator; it remains recorded as the original failed durable run. One additional explicit request used the **identical** context fingerprint, prompt hash, schema hash, model and domain state. It returned another legal candidate and passed. The prompt was not tuned, no scenario was amended between these two requests, and no failed result was relabeled successful.

## Human recommendation review

No numerical productivity score is assigned. This table assesses every raw recommendation, including those withheld.

| Recommendation | Grounding | Usefulness | Specificity | Actionability | Restraint | Evidence |
| --- | --- | --- | --- | --- | --- | --- |
| Calendar: onboarding candidate | Heading, slot, budget and actuals are server facts. Prose refers to supported onboarding/beta intent and protecting essay/recovery; no new quantities or history. | Protects time for a substantially unscheduled deliberate commitment. | Tied to this Focus Cycle and onboarding commitment. | Exact legal Preview; explicit scheduling required. | One bounded block, no fill-all-hours advice. | Current-Focus Goal, 240m budget, 45m scheduled, 195m unscheduled, 30m recorded, legal slot. |
| Review: onboarding execution difference, withheld | The half-budget scheduling gap and interrupted-support/Carry reflection are substantially supported. However the rationale recites quantities/history instead of leaving facts in Evidence. | Interruption reflection is relevant, but scheduling the remaining historical-week work is ambiguous and too prescriptive. | Refers to the finalized reviewed commitment/reflection. | Does not provide a valid future next step in this historical context. No mutation occurred. | No whole-calendar filling; still unnecessary Carry-momentum language. | References point to real summary/commitment; prose goes beyond the permitted qualitative contract. Withheld rather than claimed grounded. |
| Review: essay without historical commitment, withheld | The selected Goal has no commitment in that reviewed week. “One concrete lesson” comes from the Focus intent. | Could support deliberate reconsideration, but “this week” blurs historical Review with the already-planned current week. | Goal-specific but temporally ambiguous. | Asks the human to confirm or consider deferral; it does not set a decision. | No invented work; mention is still weaker than a clear historical observation. | Goal reference is valid; numerical/decision wording violates the prose boundary. |
| Original regeneration, false-positive withholding | Qualitative rationale and selected candidate are supported; the corrected guard accepts this exact raw payload. | Protects deliberately committed beta work after the new block. | Current commitment and current availability. | Valid server candidate, but the initial overly broad guard prevented Preview. | One block and flexibility preserved. | Current 105m scheduled/135m unscheduled facts; no invented repeated-Carry claim. |
| Corrective regeneration, accepted | Server evidence reflects 240m committed, 105m scheduled, 135m unscheduled and 30m recorded. Prose contains no new amounts or historical claims. | Protects another manageable part of committed beta work. | Specific commitment and candidate; prose is concise but somewhat generic. | Reached the existing UI Preview and explicit Schedule block successfully. | Leaves unscheduled budget and protected reserve intact. | Exact current server evidence and fresh legal candidate justify the decision. |

Before/after examples: R5C offered a past Tuesday interval and called it Thursday; R5D has no timestamp-output fields and offered server-computed Wednesday 09:00–10:00. R5C invented a second Carry week after replanning; R5D emits no repeated-Carry signal because only one prior finalized Carry exists and supplies no raw history for pattern invention. R5C's clean well-planned week returned two unnecessary suggestions; R5D returned the raw empty array. These are observed examples, not a statistical provider ranking.

## Staleness, privacy and failure verification

After the first legal Calendar answer, the QA workflow deliberately created the same Thursday 10:00–11:00 onboarding block used in R5C. Scheduled onboarding rose 45→105 minutes; unscheduled budget fell 195→135. The old candidate's own Wednesday slot remained legal, but **the advice still became stale because its supporting plan facts changed**. The old Preview returned `COACHING_STALE`; the visible Preview button was disabled.

Regeneration used the current facts and offered the same still-legal Wednesday candidate, now with current remaining budget. After correcting the guard, the saved live recommendation reached the ordinary UI Preview: 105m already scheduled; 165m after the proposed block; 75m still unscheduled; inside Focusable Hours; fresh Calendar; no Google busy overlap. A deliberate **Schedule block** click created only that TimeBlock. Goal, Action, Plan/budget, amendments, sessions and reflection hashes were unchanged; the accepted advice then became stale. [Corrective/acceptance evidence](r5d-evidence/regenerate-followup.json) records this separately from provider generation.

Calendar packet sentinel checks excluded every reflection body, session/end note and Google account/calendar identifier. Review packets included only the permitted finalized daily/weekly text; draft weekly/daily, late-finalized daily and session-note markers were absent. Raw history bodies never reach either purpose. Review generation left human decisions byte-for-byte unchanged, including the failed response. Authenticated owner-scoped readers/repositories and cross-owner regression tests remain the reference boundary.

A real invalid-key request produced sanitized `authentication`, with no exposed provider error body/credentials. Calendar and planning remained readable and ordinary manual scheduling Preview still worked. No automatic retry or substitute provider was invoked. Merely opening/reloading panels does not generate coaching.

## Verification and screenshots

Automated verification passed:

- 432 unit/service/provider tests across 31 files.
- 287 PostgreSQL tests across 14 files.
- All 144 browser tests; the Anthropic-specific coaching fixture run also passed all six tests. These use isolated simulated providers, not paid APIs.
- All seven actual production restart proofs, plus a final coaching restart proof on the final build.
- Type checking, lint, document checks and production build.

The final seconds-boundary correction was covered by the new deterministic regression and final unit suite/build/restart proof. The full browser suite had completed before that isolated correction; it was not rerun because the interaction contract did not change. The normal local app was restarted on port 3100 and its health endpoint returned ready. Disposable live-QA servers/accounts/databases were cleaned up.

The meaningful coverage includes future/current-minute legality, local day/week end, DST round trips, overlap subtraction, Calendar/Focusable intersection, effective/actionable membership, bounded stable IDs, consecutive finalized Carry, signal thresholds, evidence resolution, fabricated IDs/extra timestamps, empty output, provider failures, ownership, exact retries, in-flight expiry, midnight crossing, privacy/cutoff and stale acceptance.

All screenshots below show **real saved Haiku output** on the disposable fixture; the Review screenshot intentionally shows its withheld state. No fake successful Review coaching was substituted.

| Screenshot | Evidence |
| --- | --- |
| [Calendar + Why](r5d-evidence/screenshots/calendar-evidence.jpg) | Server quantities/slot separated from qualitative Coach prose. |
| [Scheduling Preview](r5d-evidence/screenshots/scheduling-preview.jpg) | Original live candidate passes hours/freshness/busy/budget checks. |
| [Abstention](r5d-evidence/screenshots/abstention.jpg) | Fully planned fixture, raw zero recommendations, calm success. |
| [Weekly Review withheld](r5d-evidence/screenshots/review-withheld.jpg) | Finalized reflection remains visible; invalid prose is not displayed. |
| [Stale advice](r5d-evidence/screenshots/stale-advice.jpg) | Changed facts, saved historical evidence, disabled Preview. |
| [Regenerated advice](r5d-evidence/screenshots/regenerated-advice.jpg) | Updated 105m scheduled/135m unscheduled facts. |
| [Regenerated Preview](r5d-evidence/screenshots/regenerated-preview.jpg) | Fresh current review before explicit acceptance. |
| [Accepted TimeBlock](r5d-evidence/screenshots/accepted-timeblock.jpg) | Ordinary UI acceptance, budget unchanged, visible new block. |
| [Provider failure](r5d-evidence/screenshots/provider-failure.jpg) | Local failure panel and usable Calendar. |

## Remaining limitations and next phase

The live samples support a clear improvement in Calendar legality, restraint and evidence, **not universal Haiku quality**. Review prose did not meet the new contract and is still a quality-gate limitation. The validator can reject legitimate numerical/history recitation intentionally; it also cannot prove all lowercase entity references, qualitative implications, comparisons or advice are semantically supported. Prompt injection in user-authored content can still degrade output quality, although references/schema/candidates and mutation boundaries remain deterministic. There is no automatic repair loop.

The initial candidate policy is conservative and earliest-slot oriented; it does not optimize energy, context switching, deadlines, preferred block length or whole-week scheduling. Small remaining budgets and uncertain Calendar coverage can correctly receive no scheduling suggestion. Significant amendment detection currently uses net committed-budget change, missing some reallocations. Recent-attention signals reflect recorded Focus only, and absent tracking is not absent work. The two-read assembly is not a global SQL snapshot. Fresh FreeBusy is advisory and can become outdated; normal Preview/acceptance revalidation remains required.

There was no real OpenAI comparison and no automatic provider winner. A suitable next proposed phase is **R5E: a separately designed ChatGPT AI connection and OpenAI live QA using this same deterministic contract**, with the Review prose failure retained as an explicit quality gate. The AI connection would remain separate from One Better identity. R5E is only a proposal here; implementation stops at R5D.
