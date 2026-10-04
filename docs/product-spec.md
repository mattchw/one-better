# Product specification

Status: approved with review amendments. Updated 2 October 2026.

## Purpose and user

Help one software engineer make meaningful progress by committing to a realistic week, protecting time, recording what happened, and changing the next plan accordingly. Support a second account later without sharing private data. Team management is outside the initial product.

The central loop is **goals → weekly commitments → calendar plan → focused execution → actual-vs-planned review → replanning**. Goals define why; actions describe work; commitments limit what belongs in the week; blocks say when; sessions record effort; reviews connect evidence to the next decision.

Optimise for progress toward intended outcomes. Hours and completed tasks are supporting evidence, not a productivity score or proof that a goal has been achieved.

## Core journeys

1. **Define what matters.** Create a goal with a title and required intended outcome. Edit it as understanding improves. Archive goals that no longer deserve attention. Add milestones and small actions only when useful.
2. **Choose a realistic week.** View active actions, choose a small set of commitments, estimate this week's effort, order them deliberately, and compare the budget with capacity. Defer work explicitly. Unselected actions remain outside the week.
3. **Make time.** Select calendars that constrain availability. See working windows, meetings, reserve, and usable free slots. Preview deterministic placement, adjust it, then accept focus blocks. Show unscheduled effort instead of squeezing everything in.
4. **Execute.** Open today's block and start a session with its action/outcome visible. Pause, resume, note interruptions, and finish complete, partial, or abandoned. The timer survives reload; the app asks about long gaps rather than silently crediting them.
5. **Review the day.** Compare the original plan, amended plan, and actual focus; distinguish missed blocks, unscheduled work, incomplete actions, and unrecorded actuals. Add a brief reflection. Replan future blocks explicitly.
6. **Review and choose again.** See goal evidence, commitment outcomes, estimation error, capacity changes, and rollover candidates. Select what to carry into a new week. Old plans remain intact.

## MVP through Phase 8

| Capability | Included |
| --- | --- |
| Goals | Create, edit, archive, view archived, optional outcome milestones and related actions |
| Weekly plan | Ordered commitments, estimates, manual availability initially, calendar-informed capacity later, explicit deferral |
| Google Calendar | Select input calendars, read busy periods, show sync health; create/move/cancel linked blocks on a dedicated app-created calendar |
| Scheduling | Preview, accept, manual adjustments, conflict detection, partial placement, clear pending/failed/conflicted publication |
| Focus | One active session per user, timer with pause/resume, notes, interruption count, explicit completion outcome |
| Reviews | Daily/weekly planned-versus-actuals, original baseline preserved, outcome evidence, reflection, deliberate next-week choices |
| Foundations | Durable storage, account ownership, validation, meaningful tests, keyboard-accessible forms and clear errors |

AI is optional after the core MVP; no provider is needed to use Phases 0–8. No live Google credentials are needed for the first local goal slice.

## Out of scope

Shared workspaces, teams, billing, native mobile apps, offline-first reconciliation, automatic task imports, Google Tasks, Jira/GitHub/Slack adapters, two-way Notion editing, recurring-task rules, automatic priority scoring, habit streaks, gamification, a chat-first interface, autonomous calendar edits, global schedule optimisation, automatic goal-completion percentages, and an adapter for every possible provider.

Basic responsive behaviour and accessibility belong in every slice. Advanced onboarding, shortcuts, push notifications, and visual refinement can follow the MVP. No competitor UI or implementation is copied.

## Interaction principles

**The application should make under-committing easy.** Reserve time deliberately and make selecting less work a first-class successful planning decision.

- Each screen answers a decision: what matters, what belongs this week, when, what now, what happened, or what changes.
- Keep a week intentionally small. Start with a suggested three commitments and a warning above five, not a hard limit. Validate this with use.
- Make overcommitment and unscheduled minutes visible. Allow a deliberately over-budget commitment plan with an acknowledgement; never allow an invalid calendar placement.
- Distinguish loading, genuinely empty data, stale data, and failures. A failed load must never appear as an empty plan.
- Changes become saved only after server acknowledgement. Failure preserves the draft and offers retry. Concurrent edits must not silently overwrite another tab.
- Defer without guilt. Missed work is evidence for a better next plan, not a debt automatically added to every week.
- AI produces proposals, never authoritative state. Acceptance uses the same services and invariants as manual changes.

## Proposed pilot success criteria

These are product targets to validate, not achieved metrics or universal benchmarks. Run a four-week solo pilot after Phase 8, with short interviews/notes at each week's review.

- Three of four weeks complete the full loop, including a deliberate next-week decision.
- Weekly commitment selection and initial calendar planning take at most 15 minutes in at least three weeks.
- At least one meaningful outcome or milestone advances each week, backed by user-entered evidence.
- Most planned blocks have an explicit disposition by review; report unrecorded work separately, never assume zero effort or completion.
- The user can explain why a week is over capacity and sees fewer involuntary rollovers by week four. Do not impose an arbitrary utilisation target.
- No silent lost writes, duplicate exported blocks, edits to unrelated calendar events, or cross-account reads/writes in acceptance tests and the pilot.

Reconsider scope if the user avoids reviews, spends more time maintaining the app than planning, or treats it as another inbox. More integrations are not the default remedy.

## Five highest-risk assumptions

| Assumption | Risk / disconfirming evidence | Validation and consequence |
| --- | --- | --- |
| A few weekly commitments improve decisions | The user adds every task or ignores selection | Phase 3 manual pilot; measure selection time and deferral. Reduce form fields and redesign the commitment view before scheduling |
| Calendar free space represents real focus capacity | Empty slots are unusable due to energy, context switching, or hidden work | Phase 4 compare suggested capacity with two real weeks; validate working windows, daily cap, minimum slot, and reserve before auto-placement |
| Actuals can be captured with low effort | Timer discipline fails or sessions stay running overnight | Phase 6 pilot with reload/sleep tests; add lightweight explicit correction and unknown states before drawing review conclusions |
| Google sync and ownership can be trusted | Remote edits, revoked tokens, or ambiguous timeouts cause duplication/loss | Phase 4–5 sandbox spike with recurrence exceptions, revocation, concurrent edits, retries, and reconciliation; block writes until ownership tests pass |
| Single-user simplicity will not weaken privacy | Shared identities, unscoped queries, or token leakage become baked in | Phase 0–1 two-owner database tests; Phase 4 real sign-in/token lifecycle spike; no remote deployment until authentication/isolation checks pass |

The hardest technical areas are timezone/recurrence normalization, snapshot freshness, distributed write reconciliation, and honest plan/actual accounting. The hardest product question is whether the weekly loop is worth maintaining.

## Recommended direction changes

Keep outcomes as plain text and progress as evidence, not invented percentages. Begin with a weekly plan and a list/agenda calendar view before drag-and-drop. Use manual capacity until calendar access is connected, clearly marked provisional. Export to a dedicated focus calendar and revalidate accepted schedules. Preserve the first committed plan and log later amendments. Keep AI and Notion behind the completed manual loop; selective import should serve a chosen goal, not populate a giant backlog.

## Phase 2B product decision

Actions are concrete executable work aligned to exactly one immutable Goal, optionally associated with an active Milestone in that same Goal. No standalone Actions/inbox are supported. An Action is a pool candidate, not a weekly commitment, calendar event or focus session. Required title with optional doneWhen and current effort estimate keeps capture small; completion needs no milestone-style evidence. Terminal parent changes preserve Action states unchanged as read-only history. The [Phase 2B report](phase-two-b-report.md) records the implemented slice; weekly planning requires a new brief.

## Phase 3B product decision

Planning may change; history may not. Current/future committed weeks support transient full-plan amendments with a required concise reason, a computed predecessor difference and explicit confirmation. The Current Plan leads the main view; original commitment and chronological amendments remain inspectable. Existing context carries forward exactly; new membership receives fresh eligible context. Empty revised plans and zero-capacity reality are valid outcomes, while no-op/over-capacity amendments are blocked. This and Phase 3A's original-commit validation supersede the earlier tentative over-budget acknowledgement for these slices. Capacity stays manually chosen; proposed read-only Calendar information never makes the decision automatically. [Phase 3B report](phase-three-b-report.md).

## Phase 4A product decision

Optional Google Calendar connection is separate from app sign-in. CalendarList + FreeBusy provide selected-calendar occupied timing without reading event content. Show seven daily busy totals and weekly total/fetch freshness as subordinate context; manual focus capacity/reserve/commitments/history remain independent. No free-hour obligation, utilization score, automatic capacity/recommendation or amendment. Missing timing stays unknown, partial timing incomplete, previous success visibly stale. Working windows/calendar-open focusable time are a Phase 4B proposal only. [Phase 4A report](phase-four-a-report.md).

## Implemented Phase 4B — independent Focusable Hours

**Focusable Hours ≠ Calendar-open Focusable Time ≠ Manual Weekly Capacity ≠ Commitment Capacity ≠ Scheduled Time ≠ Actual Focus Time.** Owned recurring local windows describe willingness, not human capacity. Pure expansion/union/intersection/subtraction with the existing selected-calendar complete busy snapshot returns concrete advisory intervals and daily/weekly elapsed-minute totals. Manual capacity minus explicit reserve still determines commitment capacity. Nothing automatically changes a Draft, committed baseline, amendment, source or budget; extra open time creates no obligation.

`src/modules/availability` owns one optional versioned weekly configuration and pure derivation. ISO weekdays 1–7, integer minutes, 24:00 end, empty days/schedule, same-day overlap rejection, adjacent authored windows retained. Full-state saves reuse optimistic versions and atomic owner-scoped receipts. Current User IANA timezone controls live expansion, explicit Temporal compatible gap/fold resolution is explained in the UI, and half-open instant intervals preserve actual DST elapsed time. Derived intervals have no table or additional cache. Fresh/stale/unknown/incomplete status inherits Phase 4A coverage; disconnect retains hours and makes open time unknown. Finished weeks omit the live advisory; history is not reconstructed from today's preferences.

Read-only Calendar scopes/provider logic are unchanged. No TimeBlocks, scheduling, Calendar writes, one-off exceptions, buffers, minimum block size, automated capacity/reserve/amendment, focus/actuals, jobs or AI. Earlier future scheduling/daily-cap/override examples are proposals only; [ADR 014](decisions/014-focusable-hours-and-advisory-open-time.md) is authoritative for this slice. Exact results and next-slice proposal: [Phase 4B report](phase-four-b-report.md).

## Phase 5A usable slice: make room locally

After committing a current/future week, each current logical commitment shows its weekly budget, independently derived scheduled time and unscheduled/excess difference, plus Add time block. Choose day/start/end, review hours/Calendar/budget context, then confirm. Normal placement requires six control-level interactions (open, three fields, review, confirm); each known hours/busy warning adds a separate acknowledgement. A compact weekly list groups local blocks by day. Future blocks may be rescheduled or intentionally cancelled; cancelled/past history remains preserved.

Budget changes retain blocks; drops preserve review-required blocks; re-added Actions create distinct membership and do not acquire old scheduling. Frozen labels remain understandable after source edits or terminal transitions. Local overlap is a hard error; hours/Google busy are user-controlled exceptions; unknown coverage never claims free time. Availability numbers are compact, with daily intervals and Calendar Load collapsed together by default. No actual-time/completion, suggestions, auto-placement, Calendar writes or AI in this slice. Details: [ADR 015](decisions/015-local-time-blocks.md), [Phase 5A report](phase-five-a-report.md).

## Phase 6A authoritative local execution contract

FocusSession belongs to one owned TimeBlock and inherits its frozen Plan/logical commitment/Action/Goal/optional Milestone context. Start/end use server time, the established receipts and shared owner lock. PostgreSQL enforces one active session per owner; ended history cannot be edited or reopened. Current User-local planning week only, regardless of exact planned clock time; dropped work requires explicit acknowledgement. Existing active sessions remain recoverable across midnight/week/restart and can end independently of amendments/source state.

Any session locks its TimeBlock's original planned interval/state against normal reschedule/cancel. Sequential sessions are allowed. Ended duration derives precisely from timestamps for every outcome; live Focus adds active elapsed only in labelled “so far” totals. Action estimate, commitment budget, scheduled time and recorded session time remain independent. No pause/segments/heartbeat, auto-timeout/completion, correction, review, suggestions, AI, external side effect or Calendar writing. Earlier focus roadmap examples are deferred and superseded for this slice. See [ADR 016](decisions/016-focus-sessions-and-execution-lock.md) and [Phase 6A report](phase-six-a-report.md).

## Phase 6B implemented semantics — 3 October 2026

The daily surface answers what was scheduled, what execution was recorded, what has no associated session, and what to remember. `/today` links naturally to Focus and supports previous/next/date selection. Scheduled and recorded totals are factual, with no grade, percentage, streak, utilisation target or inferred failure. Cancelled historical blocks remain clear. One optional reflection supports explicit durable Draft saves and deliberate terminal finalization after inspecting current facts. Future dates can display schedules but have no reflection controls; forgotten past dates have no arbitrary expiry. A current-day active session must end in Focus before finishing the reflection. Daily use must remain lightweight; see [Phase 6B UX findings](phase-six-b-report.md).

## Phase 7A — Weekly Review and Deliberate Rollover

Finished committed User-local weeks support one owned explicit-save Draft → terminal WeeklyReview. Derive every logical commitment ever present in the baseline/ordered Amendments, original/final summaries, independent scheduled and exact week-intersected Focus actuals, and daily reflection context. Seven-date finalized context uses DailyReflection.finalizedAt <= WeeklyReview.finalizedAt; later finalized daily text is excluded without copying bodies. Action lifecycle remains authoritative, with no scores or inferred completion.

Explicit Carry needs a fresh 1–10,080-minute proposal, Defer keeps work ordinarily available, Drop intentionally archives via the existing Action transition during atomic review finalization. Revalidate all inspected Action/parent guards; any conflict/failure rolls back Review, Drops and receipt. Finalized Carry is intent only: following-week Planning explicitly adds eligible work through the existing Draft-save transaction with owned review/decision proof, a fresh new-week identity and editable chosen budget. No automatic Plan, Amendment or rollover. [ADR 018](decisions/018-weekly-review-and-deliberate-rollover.md) is authoritative; [Phase 7A report](phase-seven-a-report.md) records verification. Stop after this slice and run a real full-week dogfood gate before choosing features.

## Implemented R5B coaching

Calendar offers compact optional Coach proposals; Weekly Review adds Coach’s perspective after deterministic summary/decisions. Get/Refresh coaching is explicit. Up to three grounded observations, existing-commitment schedule proposals or review navigation suggestions are saved privately. Preview and explicit ordinary scheduling acceptance are separate. No automatic scheduling, new Actions, amendments, rollover choices, scores, general chat or external work ingestion. Reflection sharing is purpose-specific and disclosed. [ADR 020](decisions/020-ai-coaching-proposals.md) and [R5B report](ui-redesign-r5b-report.md) define the boundary.
