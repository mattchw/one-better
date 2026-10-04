# Deterministic planning engine

R5B adds optional proposals over the existing arithmetic and scheduling rules. AI cannot define capacity, reserve, budgets, overlap, coverage or lifecycle legality. Scheduling proposals use the existing preview and are explicitly accepted through the ordinary TimeBlock command. Review proposals navigate to human planning. [ADR 020](decisions/020-ai-coaching-proposals.md) defines this implemented boundary; older broader AI ideas remain future proposals.

Status: approved with review amendments, 2 October 2026. No LLM participates in authoritative time arithmetic.

## Implemented Phase 3A: manually budget a deliberate week

Manual capacity remains authoritative; Phase 4A adds separate Google busy-time context without calculating capacity. Choose a Monday local date using the existing account IANA timezone. Enter provisional focus-capable capacity and protected reserve manually. Usable = capacity − reserve; committed budget = sum of explicitly entered weekly budgets; remaining = usable − committed budget. A 720-minute capacity with 180-minute reserve and 390-minute commitments leaves 150 healthy uncommitted minutes. No utilization reward or warning applies to that breathing room.

Capacity/budget use positive whole minutes up to 10,080; reserve is nonnegative and less than capacity. Empty and over-capacity Drafts are valid to save, invalid to commit. Budgets neither derive from nor overwrite Action estimates. Central Action mutability determines eligibility. Source-version/relationship changes require review; commit freezes snapshots, budgets and capacity transactionally. See [ADR 011](decisions/011-weekly-planning-immutable-baseline.md). Draft → Committed only; Phase 3B adds immutable full-plan amendments as described below.

## Future scheduling design — not implemented in Phase 3A/3B

The following calendar/window/day-cap/placement rules are a later roadmap, not the current manual capacity calculation. No AvailabilityProfile, daily budget, schedule, actuals or jobs exists. Phase 4A implements only CalendarList + FreeBusy advisory.

## Inputs and outputs

Inputs: a pinned week date/timezone; working windows and breaks; daily focus cap; reserve fraction; selected calendar snapshots and coverage; existing local blocks; ordered weekly commitments; task readiness; block-size preferences; current plan/settings/snapshot versions; and an injected current instant.

Output: raw free intervals, usable focus capacity, reserve, commitment budget, scheduled and unscheduled minutes, over-capacity amount, freshness/coverage state, a proposed set of placements, and a reason for each unplaced item. The same complete input produces the same output. No randomness, provider payloads, network reads, or hidden priority scoring inside the pure engine.

## Week and interval meaning

- Week begins Monday 00:00 and ends the following Monday 00:00 in the pinned IANA planning timezone. Use local calendar-date arithmetic, not seven times 24 elapsed hours.
- Convert boundaries to UTC instants for overlap/arithmetic. Store original local dates/zones for all-day events and plan identity.
- Intervals are half-open `[start,end)`. A meeting ending at 10:00 does not collide with a block starting at 10:00. Apply a separate configurable meeting buffer before subtracting busy time; default proposed buffer is 10 minutes either side.
- Reject ambiguous/nonexistent manually entered times and show the affected date/zone for explicit correction. For an availability window with an ambiguous/nonexistent boundary, mark that day unresolved and require a day override; do not silently shift it. Test the spring gap and autumn repeated hour in Europe/London.
- All-day busy events occupy the provider calendar's date range in that calendar's timezone, end date exclusive. Clip to the user's working windows; holidays do not consume 24 hours of focus capacity. Do not assume every all-day item is busy.

## Capacity calculation

For each day:

1. Expand configured working windows using local dates and timezone. Union overlapping windows and subtract breaks. Full-week reporting retains elapsed windows; the future-placement calculation separately removes time before the injected current instant. Never subtract past blocks from a capacity total that already excludes their elapsed windows.
2. Normalize selected calendar busy occurrences. Cancelled, transparent/free, and explicitly declined occurrences do not block. Treat tentative/not-yet-responded busy invitations conservatively as busy. Unknown permissions or incomplete coverage means unknown capacity, not an empty calendar.
3. Add meeting buffers, clip to windows, and union busy intervals across calendars before subtraction. Mirrored meetings cannot double-subtract time. Recurring events use expanded occurrences and exceptions from the adapter.
4. Identify exported app blocks by verified reference. Exclude their remote copies from ordinary busy subtraction; subtract/reserve each local block once. If the remote copy differs, flag a conflict and treat the union of desired/observed intervals as occupied for new placement until resolved.
5. For total focus-capacity reporting, compute free intervals before subtracting the user's valid existing local blocks, then discard fragments below the minimum block size. Keep a separate raw-free total so fragmentation is visible.
6. Let `usable_d` be the remaining eligible minutes, `cap_d` the user's daily focus cap, and `r` the reserve fraction in `[0,1)`. Proposed day budget is `floor(min(usable_d, cap_d) * (1-r))` whole minutes. Reserve is `min(usable_d,cap_d) - budget_d`; minutes above the daily cap are also intentionally unavailable to focus planning.
7. Subtract existing scheduled blocks from the free intervals for candidate placement and their full-day allocation from the day budget. Remove elapsed candidate intervals. The remaining placement ceiling is the smaller of the residual day budget and eligible future free minutes. If a calendar/settings change makes future blocks invalid or total day allocation exceed the new budget, retain history and flag the future conflict/over-capacity state rather than moving blocks automatically.

Weekly focus budget `C = sum(budget_d)` uses full-week windows. Commitment budget `K = sum(active weekly commitment budget minutes)`. Scheduled minutes `S = sum(non-cancelled block minutes)`; report per-commitment allocation too. Overcommitment `max(0,K-C)`. Unallocated full-week capacity `max(0,C-S)` is a budget ceiling, not a promise that elapsed time or fragmentation allows another block. Report a separate remaining placement ceiling from step 7. Unscheduled commitment minutes are `sum(max(0, commitment budget - its scheduled minutes))`. Never subtract actual effort from the original budget or overwrite it.

From the focus slice, confirmed actuals also constrain remaining daily effort: calculate consumed past effort as the larger of past scheduled minutes and confirmed actual minutes, then reserve accepted future minutes. Use this consumption only for remaining placement ceilings; retain original commitment/schedule budgets for review. Unconfirmed actuals remain visibly uncertain. A session overrun or unplanned focus can therefore reduce remaining capacity without rewriting the original plan.

Phase 3A uses manually entered provisional focus capacity and reserve, without windows/busy entries. Future calendar integration can introduce an availability profile. After connecting Google, all selected inputs need a complete covered snapshot for the relevant interval. Proposed freshness target: five minutes for active planning; stale snapshots show their age and disable acceptance until refreshed. The target is a product policy to validate in Phase 4, not a guarantee that Google will not change immediately afterward.

### Example fixture

Five days each contain six working hours and two non-overlapping busy hours after buffering. Each therefore has four eligible free hours. With a four-hour daily cap and 25% reserve, budget is three hours/day: 15 hours/week, with five hours reserved. An 18-hour commitment plan is three hours over budget. Six scheduled hours leave nine budget hours unallocated and twelve commitment hours unscheduled. Scheduling cannot erase the three-hour shortfall.

If a day instead contains eight 15-minute gaps and the minimum block is 30 minutes, those two raw free hours yield zero eligible focus slots. If a two-hour meeting appears twice across calendars, subtract its buffered union once.

## Actions and commitments

An Action describes concrete work, with an optional done condition. Its current effort estimate is independent of weekly allocation, scheduled time, actual time and progress. Every Action has an immutable Goal and optionally a same-Goal Milestone. No standalone Actions. A commitment describes this week's deliverable and budget; it can be a portion of a larger task. Phase 3A selection retains source guards; committing freezes the original Plan and its context snapshots. Post-commit changes will require explicit amendments; their representation remains unchosen until Phase 3B.

An active commitment needs a positive whole-minute budget; unestimated tasks remain candidates but cannot be scheduled. Only effectively mutable Open Actions beneath active Goals and absent/active Milestones may be newly selected. Already-running sessions can finish, and historical records remain. Task dependency graphs and multiple concurrent tasks per block are postponed; no blocker fields are authorized in Phase 2B.

## Suggested placement algorithm

Start with a predictable greedy algorithm that is easy to explain. It is not a claim of optimal placement.

1. Preserve all accepted blocks and user-pinned choices. Replanning considers only explicitly selected future unstarted blocks; never move an active/past block.
2. Sort active ready commitments by user order, then stable commitment ID. A soft target date can narrow suggested days but is not a hidden priority override.
3. For each remaining commitment budget, search eligible intervals chronologically, enforcing remaining day/week budget. Proposed defaults: minimum 30 minutes, preferred 60, maximum 120. All values are configurable and copied into the plan snapshot.
4. Place up to preferred duration, bounded by free interval, remaining commitment budget, maximum block size, and daily allowance. Split only if the task permits splitting. An unsplittable task needs one sufficiently large interval.
5. If the remainder is below the minimum, leave it unscheduled with a reason. Do not round it up into extra work. Never cross a meeting, break, day/window boundary, or week boundary. Do not manufacture slots outside working hours.
6. Subtract each proposed placement before considering the next. Return partial proposals and reasons such as insufficient_capacity, fragmented_space, task_blocked, missing_estimate, or stale_calendar.

Manual placement follows the same constraints. A UI warning may allow over-budget weekly commitments; it cannot allow colliding blocks, unknown calendar coverage, or an invalid interval. To spend reserve/change daily limits, the user first makes an explicit settings amendment and obtains a new preview.

## Acceptance and external publication

Preview is non-authoritative. Include plan/settings/snapshot versions and proposed placements. Acceptance verifies the actor, IDs, task state, expected versions, current coverage, overlaps, and budget inside the scheduling service under a per-user scheduling/plan lock. Refresh calendar coverage before acceptance; re-run validation if snapshots changed. An incompatible change returns a new preview for approval.

Commit local accepted blocks, a new plan revision, and outbox intents atomically. Report **saved; calendar sync pending**. The worker refreshes busy coverage again before a write and validates relevant remote versions. A meeting that arrives after local acceptance can turn the operation into a conflict. Google and Postgres have no shared transaction; promise eventual reconciliation, not atomic two-system writes. An external meeting can also arrive after successful publication: subsequent sync detects the collision and asks for replanning.

Cancellation preserves the local block/history with a tombstone and queues only a verified linked export for deletion. Reordering, moving, or cancellation adds an amendment; cancelled blocks remain visible in original-plan review.

## Original plan, actuals, and review arithmetic

Keep the first committed commitment/settings revision as the weekly baseline. Because commitments precede calendar placement, the first accepted schedule is the calendar baseline. Subsequent accepted placements append revisions with reasons. Daily reporting also retains the schedule as of that local day's start (or its first same-day accepted schedule); use stored revisions, not mutable block rows. Clearly identify which baseline a comparison uses.

Planned minutes are accepted block durations from the selected baseline, clipped to the review period. Current planned minutes use the latest revision and report cancellations/additions separately. Actual minutes are confirmed focus-segment elapsed time, excluding pauses and uncertain gaps; clip across local day/week boundaries. Keep integer seconds for actuals until display aggregation to avoid rounding each short segment into extra minutes.

Variance = actual minus baseline planned. Compare commitment budgets and deliverable outcomes separately: working 120 minutes does not mean the weekly deliverable succeeded. Show recorded zero, explicit missed disposition, and unknown/unrecorded as different states. Goal progress requires milestone evidence or a user statement; do not derive an outcome percentage from hours.

Sessions without a block count as unplanned actuals. Sessions linked to a block can run outside its interval: effort counts where it occurred and the review shows the drift. A session finishing “complete” prompts a separate task/commitment completion choice. Paused sessions remain resumable but prevent another active session; explicit abandon ends them.

At weekly review, offer incomplete commitments as candidates. User selection creates new linked commitments with fresh budgets; no automatic rollover, copying of old focus blocks, or mutation of the closed week.

## AI responsibilities

AI may propose decomposition, an ordered commitment list, changes to estimates, coaching questions, review explanations, or preferred placement options. Store suggestions with rationale and source revisions. The user can reject or edit them. Deterministic services compute availability, validate references/ownership, create placements, and perform publication.

AI cannot define calendar truth, claim a task completed, invent actual effort, decide timezone arithmetic, bypass conflicts, or directly call calendar mutation tools. Accepted suggestions use normal command validation; freshness must be checked again even when a recommendation sounds reasonable.

## Required edge-case fixtures

| Case | Expected result |
| --- | --- |
| Touching/overlapping/duplicate busy intervals | Stable union; touching blocks are valid unless explicit buffers apply |
| Calendar fails on page two | No partial snapshot becomes authoritative; prior snapshot marked stale |
| Recurrence exception moved/cancelled | Correct occurrence interval or removal; master not double-counted |
| Private/freebusy-only calendar | Busy still blocks without exposing titles; unavailable coverage stays unknown |
| All-day event in a different timezone | Date range normalized in source zone and clipped correctly |
| DST gap/repeated hour, timezone change, week crossing | Explicit conversion rules, correct elapsed duration, pinned history |
| Existing output copied into input calendars | App reference prevents self-conflict; duplicates union conservatively |
| Two concurrent placement requests | Version/lock prevents overlapping or overspending acceptance |
| Partial capacity or small remainder | Partial schedule and visible unplaced minutes, no overrun |
| Task archived/completed during preview | Acceptance rejects stale task state |
| Remote meeting after acceptance | Pending publication conflicts; existing plan retained for user resolution |
| Timer reload, tab close, sleep, midnight | Persisted segments; uncertain gaps require confirmation; period totals split |
| Actual correction after review | Retained evidence and recomputed actual projection; original plan unchanged |

## Reviewed capacity semantics

**The application should make under-committing easy.** Calendar free time is only the starting interval set. Focus-capable time excludes fragments below the minimum and respects working windows/breaks. Commitment capacity deliberately caps daily effort and reserves spare time. Committed effort sums weekly budgets; scheduled effort sums accepted blocks; actual focused effort sums confirmed segments. Reviews show all three separately. An unscheduled commitment is not a completed task; a filled calendar is not the goal.

The implemented Plan lifecycle is draft → committed, with immutable full-plan amendments appended while a current/future week is amendable. Closing is not implemented. Later scheduling must not replace the committed baseline or reinterpret amendment snapshots. Rollover creates new linked commitments, never moves the old one. Initial external-write conflict handling detects and represents mismatches; automatic/ad-hoc two-way conflict resolution is deferred.

## Implemented Phase 3B amendments

Original committed intent is permanent. A transient editor proposes a full new effective plan; explicit reviewed confirmation appends one immutable owned amendment. Latest sequence is Current Plan, with baseline independently readable. Retained frozen source context is never refreshed, even for budget changes or terminal sources; newly added Actions alone get eligible current snapshots. Pure predecessor differences detect capacity/reserve/add/drop/budget changes. No-op/over-capacity amendments reject, zero commitments are allowed, and zero capacity requires zero reserve/no commitments. Plan.version serializes one linear history without changing baseline content. Exact command retries replay the original amendment before current eligibility/week checks. Phase 4A Calendar availability is independent advisory data and must not automatically change manually chosen capacity. See [ADR 012](decisions/012-immutable-weekly-amendments.md).

## Implemented Phase 4A advisory arithmetic

Calendar load answers which time Google reports occupied, not how much focus is possible. Use current User IANA timezone to convert a requested local Monday and each following date boundary through @js-temporal/polyfill; do not assume 24-hour days or a 168-hour week. Provider-mapped offset-bearing busy instants are half-open, clipped and unioned deterministically. Adjacent intervals merge. Bucket the union at the exact local-day instants; keep precision until display. No event-type interpretation, buffers, working windows, raw free-time total, focus-capacity recommendation or scheduling exists.

WeeklyPlan and amendments retain manually entered capacity/reserve/budgets and frozen history; Calendar fetch/list/select/refresh/disconnect cannot write these aggregates. Current User timezone controls live Calendar context even when a Plan keeps an earlier pinned historical timezone. Complete cache is selection/week/timezone-bound. Partial, missing or stale timing is displayed explicitly, never as free time. Future capacity/placement/event rules above require a separate brief and new evidence; FreeBusy alone does not justify them.

## Implemented Phase 4B — independent Focusable Hours

**Focusable Hours ≠ Calendar-open Focusable Time ≠ Manual Weekly Capacity ≠ Commitment Capacity ≠ Scheduled Time ≠ Actual Focus Time.** Owned recurring local windows describe willingness, not human capacity. Pure expansion/union/intersection/subtraction with the existing selected-calendar complete busy snapshot returns concrete advisory intervals and daily/weekly elapsed-minute totals. Manual capacity minus explicit reserve still determines commitment capacity. Nothing automatically changes a Draft, committed baseline, amendment, source or budget; extra open time creates no obligation.

`src/modules/availability` owns one optional versioned weekly configuration and pure derivation. ISO weekdays 1–7, integer minutes, 24:00 end, empty days/schedule, same-day overlap rejection, adjacent authored windows retained. Full-state saves reuse optimistic versions and atomic owner-scoped receipts. Current User IANA timezone controls live expansion, explicit Temporal compatible gap/fold resolution is explained in the UI, and half-open instant intervals preserve actual DST elapsed time. Derived intervals have no table or additional cache. Fresh/stale/unknown/incomplete status inherits Phase 4A coverage; disconnect retains hours and makes open time unknown. Finished weeks omit the live advisory; history is not reconstructed from today's preferences.

Read-only Calendar scopes/provider logic are unchanged. No TimeBlocks, scheduling, Calendar writes, one-off exceptions, buffers, minimum block size, automated capacity/reserve/amendment, focus/actuals, jobs or AI. Earlier future scheduling/daily-cap/override examples are proposals only; [ADR 014](decisions/014-focusable-hours-and-advisory-open-time.md) is authoritative for this slice. Exact results and next-slice proposal: [Phase 4B report](phase-four-b-report.md).

## Implemented Phase 5A: explicit local placement

The user selects a current Effective Plan logical commitment and manually enters one local day/start/end. `evaluatePlacement` converts Plan-pinned wall time into instants, validates same-date/week/future placement, detects owner-wide half-open local overlap, evaluates current User recurring hours and the existing normalized Calendar cache, and returns separate advisories and scheduled-versus-budget totals. A final transaction repeats this check against locked current truth; stale preview or expected version cannot overwrite it.

No suggested-placement algorithm above is implemented. Phase 5A explicitly allows outside-hours work, known busy overlap after acknowledgement, unknown/stale Calendar information, unestimated source Actions already deliberately committed, and scheduled minutes above budget. There are no buffers, minimum duration, daily cap, reserve spending calculation, schedule baseline/revision, provider refresh/write, outbox or automatic Plan Amendment. Compatible DST disambiguation matches Phase 4B and is visibly previewed. Local scheduling is independent operational data. [ADR 015](decisions/015-local-time-blocks.md) supersedes conflicting manual-placement/revision assumptions in the future roadmap above.

## Phase 6A authoritative local execution contract

FocusSession belongs to one owned TimeBlock and inherits its frozen Plan/logical commitment/Action/Goal/optional Milestone context. Start/end use server time, the established receipts and shared owner lock. PostgreSQL enforces one active session per owner; ended history cannot be edited or reopened. Current User-local planning week only, regardless of exact planned clock time; dropped work requires explicit acknowledgement. Existing active sessions remain recoverable across midnight/week/restart and can end independently of amendments/source state.

Any session locks its TimeBlock's original planned interval/state against normal reschedule/cancel. Sequential sessions are allowed. Ended duration derives precisely from timestamps for every outcome; live Focus adds active elapsed only in labelled “so far” totals. Action estimate, commitment budget, scheduled time and recorded session time remain independent. No pause/segments/heartbeat, auto-timeout/completion, correction, review, suggestions, AI, external side effect or Calendar writing. Earlier focus roadmap examples are deferred and superseded for this slice. See [ADR 016](decisions/016-focus-sessions-and-execution-lock.md) and [Phase 6A report](phase-six-a-report.md).

## Phase 6B implemented semantics — 3 October 2026

Daily reflection neither changes nor snapshots planning history. Scheduled elapsed time sums only planned TimeBlock overlap with the requested User-local day; cancelled blocks count zero. Actual elapsed time intersects each Focus Session with that day, regardless of its owning block date or planned interval, and includes abandoned outcomes. Budgets, estimates, schedule and actuals remain independent. Aggregate exact milliseconds before display rounding. Daily actual allocation is separate from the approved Phase 6A whole-session logical-commitment aggregation; original IDs/lineage do not change. Today's active restriction is checked inside the serialized reflection command, not inferred from a browser timer.

## Phase 7A — Weekly Review and Deliberate Rollover

Finished committed User-local weeks support one owned explicit-save Draft → terminal WeeklyReview. Derive every logical commitment ever present in the baseline/ordered Amendments, original/final summaries, independent scheduled and exact week-intersected Focus actuals, and daily reflection context. Seven-date finalized context uses DailyReflection.finalizedAt <= WeeklyReview.finalizedAt; later finalized daily text is excluded without copying bodies. Action lifecycle remains authoritative, with no scores or inferred completion.

Explicit Carry needs a fresh 1–10,080-minute proposal, Defer keeps work ordinarily available, Drop intentionally archives via the existing Action transition during atomic review finalization. Revalidate all inspected Action/parent guards; any conflict/failure rolls back Review, Drops and receipt. Finalized Carry is intent only: following-week Planning explicitly adds eligible work through the existing Draft-save transaction with owned review/decision proof, a fresh new-week identity and editable chosen budget. No automatic Plan, Amendment or rollover. [ADR 018](decisions/018-weekly-review-and-deliberate-rollover.md) is authoritative; [Phase 7A report](phase-seven-a-report.md) records verification. Stop after this slice and run a real full-week dogfood gate before choosing features.
