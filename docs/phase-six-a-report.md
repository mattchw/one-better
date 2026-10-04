# Phase 6A — Focus Sessions / Actual Execution

Status: complete, 3 October 2026. Authorized scope is Phase 6A only; Phases 0–5A approved. All 51 acceptance cases pass. Next phase remains proposal only.

## Implemented result and schema

Dedicated authenticated Focus navigation shows today's planned blocks in the User's IANA timezone, ordered by start. Normal start is one click. Weekly Planning links to a selected block so the user can return later in the same week. The active screen presents frozen Action/Goal/optional Milestone context, original schedule, a count-up elapsed timer and independent budget/scheduled/recorded totals. End intentionally reports completed-as-planned, partial-progress or abandoned with an optional short note; it never completes an Action. The next session against the same block is a new record.

One additive `focus_session` table stores UUID, owner, required TimeBlock ID, startedAt, nullable endedAt/outcome/endNote, version, createdAt and updatedAt. Relationships/context are inherited through the block rather than duplicated. Version 1 is active, with no outcome/note; ending records version 2 and strictly positive elapsed interval. Notes are trimmed plain text, nullable when blank, bounded to 1,000 Unicode code points, validated for malformed Unicode/null characters. No duration column, segment, activity/heartbeat table, queue or periodic writes. [ADR 016](decisions/016-focus-sessions-and-execution-lock.md) records the contract and architectural execution-lock refinement.

## Active invariant, lifecycle and historical scheduling

The partial unique PostgreSQL index on owner where endedAt is null enforces exactly zero/one globally active session per user. Users remain independent. New start resolves actor-owned block/context, checks current User-local committed week, valid planned interval and inspected block version; future/historical/cancelled blocks reject. Early, late and another day within the current week are allowed. Dropped membership requires an explicit server acknowledgement; it does not restore work or amend the plan. Attempting a second start exposes only the actor's current active session, with Return to focus; nothing is silently ended/replaced.

Any Focus Session, active or ended, permanently prevents normal reschedule/cancel of its TimeBlock, even when execution begins before planned start. The original block's state, interval, context, version and timestamps remain unchanged. Scheduling preview/final commands independently enforce this execution lock; UI derives it and hides ordinary controls. Prior Phase 5A placement/edit/cancel behavior remains intact before execution.

Ending is an expected-version transition with server time. Same-instant/backwards clock fails without fabricating duration or persisting a receipt. Ended rows cannot edit/reopen/delete through the product; a specific SQL update trigger also rejects terminal changes and identity/start/context rewrites. Restrictive composite owned-block FK and lifecycle/time/note checks independently protect persistence. Test cleanup may delete disposable rows; there is no product deletion endpoint.

## Time and recorded-duration semantics

The normal injectable server clock supplies UTC startedAt/endedAt after transaction locks. No browser timestamp is accepted. Browser/restart tests use a process-owned clock file guarded by isolated `execution_test_<suffix>` loopback database and loopback app origin; no HTTP override exists. The manual walkthrough uses the real server clock.

Ended recorded duration = endedAt − startedAt, preserving milliseconds and sub-minute timestamps. Every outcome counts, including abandoned. Sum once per block and across its logical commitment through associated blocks; do not round individual sessions. Historical/scheduling totals include ended sessions only. The active Focus presentation adds its current elapsed duration to those totals and labels it “Recorded session time so far.” Final human display floors aggregate minutes; a positive sub-minute result is `<1m`. None of these values mutates Action estimates, weekly budgets, scheduled minutes, capacity, reserve, baselines or amendments.

Active elapsed derives from saved start to sampled serverNow plus browser time since that sample. One-second UI ticks only redraw; returning visibility recalculates elapsed, and private recovery reads discover current persistence. Visible 15-second reads and same-origin BroadcastChannel invalidation update other-tab truth; they never persist timer ticks. A read revision guard prevents older responses overwriting newer mutation results. End-note drafts remain in memory and survive ordinary stale/uncertain failures; recovery reads do not discard an open draft.

Today uses exact User-IANA local-day boundaries, including DST and intervals spanning a changed-user-zone midnight. Plan-pinned zone displays stored schedule/history with UTC offset labels. Sessions can overrun scheduled end, cross midnight or remain active into a later week without automatic termination. Recovery/end remain allowed globally after the starting week; a new old-week start rejects. Entire elapsed duration stays with the original block/commitment, without daily allocation rules or productivity inference.

## Amendments, frozen labels and quantities

Carry/budget amendments leave sessions and blocks untouched; only derived current budget changes. Dropping work preserves ended history and the running session, with a visible current-plan warning. Re-addition has a new logical ID and zero inherited scheduled/recorded time. Frozen block snapshots keep all labels meaningful after Action/Goal edits, source completion/archive or parent transitions. Current source state is not used to relabel execution history.

Action estimate ≠ weekly commitment budget ≠ scheduled time ≠ recorded session time. A successful session outcome is only the user's report about this session. No Action/parent completion, block cancellation/completion, automatic amendment, capacity change or progress score is introduced.

## Ownership, transactions, concurrency and receipts

HTTP resolves the verified database session Actor and rejects client owner/context/time injection. Every query scopes to that actor. Foreign/missing block/session/selected-workspace IDs return indistinguishable 404 messages with no foreign DTO. Anonymous APIs reject 401; wrong Origin rejects 403; strict payload validation rejects 400; unsupported edit/delete rejects 405; unavailable PostgreSQL rejects 503. Responses remain private/no-store. Focus recovery does not call Google.

Reuse existing owner-scoped original-result receipts and distinct `focus.start`/`focus.end` payload hashes. Lock receipt → stable User NO KEY UPDATE → owned block then Plan for start; receipt → User → owned session for end. Shared scheduling User locking prevents an early start racing with cancel/reschedule from both succeeding. Plan locks stabilize start's membership check against amendments. Different commands from the same session version have one ending winner; next start either observes the existing active session or proceeds after its end commits. SQL partial uniqueness independently reinforces the active invariant. Identical concurrent start retries produce one receipt/session. Successful original start/end DTOs replay after later states and process restart; changed-payload reuse rejects. Any failed final validation/SQL rolls back session and receipt.

## Migration

`0009_local_focus_sessions.sql` adds only the Focus Session table, composite TimeBlock identity index, active uniqueness/read indexes, lifecycle/time/note constraints and a specific immutable-history update trigger. The supporting unique block index precedes the new FK. No earlier migration is edited. Clean migrations-only construction and repeated migration run in real disposable PostgreSQL. Before applying it locally, all nine approved migration files matched the hashes already recorded in PostgreSQL. The additive local migration succeeded; all ten applied hashes now match their files. The verified production app was restarted on port 3100 and `/api/health` returns 200.

## All 51 acceptance cases

D = [domain](../tests/domain/focus.test.ts), S = [service](../tests/services/focus.test.ts), P = [PostgreSQL](../tests/db/focus.test.ts), B = [browser](../tests/e2e/focus.spec.ts), R = [production restart](../scripts/prove-focus-restart.ts). Earlier suites remain part of the final gate.

| Case | Evidence |
| --- | --- |
| 1. Today eligible list | B chronological today/empty; P User-local date |
| 2. Current-week start | D/S eligibility; P/B start |
| 3. Server startedAt | S/P exact injected milliseconds; B strict browser timestamps |
| 4. Early/late/later week allowed | D/P clock placements; manual real-time start |
| 5. Future week rejects | D/P; B selected future has no Start |
| 6. Finished week rejects | D/P; active cross-week can end |
| 7. Cancelled rejects | D/P; B cancelled selected has no Start |
| 8. Removed work acknowledgement | D/S/P server bypass; B explicit disabled confirmation |
| 9. One active globally | P partial index and service; B competing starts |
| 10. Concurrent one winner | P simultaneous different starts; B simultaneous HTTP 200/409 |
| 11. Different owners active | P simultaneous owned sessions |
| 12. Existing active exposed | S/P current DTO; B stale tab Return to focus |
| 13. Reload recovery | B same ID/47m timer; R production browser |
| 14. Navigate away/return | B Weekly Planning round-trip |
| 15. Actual process restart | R same active session at 37m; manual restart |
| 16. Reconstruct elapsed | D exact duration; B fake-clock/reload/visibility recovery; R |
| 17. Completed-as-planned | D/P exact final transition; B second session |
| 18. Partial progress | D/P; B primary workflow note |
| 19. Abandoned | D/P; B removed-work outcome |
| 20. Optional validated note | D Unicode/null/length/blank; P 1000-code-point persistence; B note/reload |
| 21. Server endedAt | S/P exact milliseconds; R receipt equality |
| 22. Strict later end | D/P same/backwards clock fails without receipt; SQL lifecycle |
| 23. Ended immutable | D/P service and SQL trigger; B unsupported edits/deletes |
| 24. Action remains open | P exact source table plus state; B Action GET after two sessions |
| 25. Planning baseline/amendments unchanged | P exact table snapshots; R exact rows |
| 26. Sequential sessions | P/B two sessions on same block |
| 27. Exact aggregate | D/P milliseconds, B 47m+12m=59m |
| 28. At most one active across sessions | P partial uniqueness/second-start conflict |
| 29. Execution blocks reschedule | D/P early-start final/preflight and race; B hidden control |
| 30. Execution blocks cancel | P final/race; B hidden control |
| 31. Planned interval unchanged | P/R exact block row; manual fixture assertion |
| 32. Budget unchanged | P/R exact Plan/commitment rows; B 3h budget |
| 33. Scheduled unchanged | P/B 120m through sequential sessions |
| 34. Actual independent | D/P/B separate budget/schedule/actual |
| 35. Abandoned duration retained | D/P/B positive recorded duration |
| 36. Overrun retained | D/P cross-day/week 9h; B 9h active; manual late/overrun |
| 37. Budget amendment keeps sessions | P equality; B active 2h budget |
| 38. Drop keeps ended history | P original ended DTO equality after re-add |
| 39. Active survives amendment | P concurrent start/amend; B active source/budget/drop; manual |
| 40. Re-add cannot steal actuals | D/P distinct lineage/zero totals; B old warning and new 0m |
| 41. Start replay original | P after ended/later session; B lost response exact payload; R |
| 42. End replay original | P later state; B lost response exact payload; R |
| 43. Changed payload reuse rejects | P start acknowledgement/end outcome hashes |
| 44. Restart start/end replay | R two real stop/start cycles |
| 45. Competing ends consistent | P one version winner; same-instant SQL constraint |
| 46. Foreign sessions unreadable | D/P/B indistinguishable foreign/missing |
| 47. Foreign start/end forbidden | P/B all surfaces |
| 48. Foreign/missing same | P/B scoped block/session/workspace |
| 49. Owner-scoped mutation IDs | P different owners reuse same start command ID |
| 50. User timezone today | D/P UTC-vs-local; B London/Los Angeles |
| 51. DST-sensitive display | D exact repeated-hour elapsed; B GMT+1→GMT history |

## Verification

Final `npm run check` exited 0, with all previous suites included:

| Check | Exact result |
| --- | --- |
| Documentation, ESLint, TypeScript | Pass; zero lint warnings |
| Domain/service tests | 289 passed across 21 files |
| Real PostgreSQL tests | 221 passed across 10 files |
| Browser tests | 85 passed, 3.0 minutes |
| Total | 595 passed; 58 additions to the approved 537 (25 domain/service, 23 PostgreSQL, 10 browser) |
| Production build | Pass, including all Focus routes |
| Production restart proofs | All four pass: foundation/planning, Calendar/availability, scheduling, Focus; two actual stop/start cycles each, eight total, plus unavailable-database checks |

The Focus proof reconstructs the same persisted active session at 37 minutes after restart/browser reload. A second restart replays both original start/end receipts exactly while current truth remains ended. One ended session and two receipts persist; all source, baseline, amendment and TimeBlock rows remain byte-identical. This is an actual production process proof, not repository re-instantiation. The manual walkthrough additionally exercises a real-clock production restart.

Cached `npm audit --offline --json` reports zero vulnerabilities at every severity; dependency versions/lockfile unchanged. It uses cached advisory information, not a fresh registry lookup. The environment previously rejected live audit metadata transmission; this phase follows the brief's allowed offline policy without bypass. No hosted CI/deployment or real Google credential flow is claimed.

## Manual product quality gate

Real production app on disposable port 3104/database and synthetic account, real server clock, separate Chrome tab. Manual fixture includes current-week frozen Goal/Milestone/Action, 3h budget and several local blocks. A deliberately short block near local midnight permits natural real-time early start/overrun/recovery checks alongside a 2h normal planned block. No normal-user rows or Google service are used.

Completed while reviewing recovery, documentation and the regression run. Exact authoritative UTC records:

| Outcome | Started | Ended | Recorded duration |
| --- | --- | --- | --- |
| Partial progress + note | 2026-10-02T22:53:20.289Z | 2026-10-02T23:00:34.503Z | 434,214ms (7m 14.214s) |
| Abandoned + note | 2026-10-02T23:00:44.805Z | 2026-10-02T23:01:49.519Z | 64,714ms (1m 4.714s) |

The first planned block remained Friday 23:57–23:59 London time. Start was early; execution naturally overran its end and crossed local midnight without stopping. An actual process restart, reload and explicit budget/drop amendments preserved that active session. It ended deliberately as partial progress. The second started late against the Friday 22:52–23:22 block, required removed-work acknowledgement, survived reload/re-addition without moving to the new lineage, and ended abandoned. Total recorded elapsed is 498,928ms (8m 18.928s); abandoned time is retained. Reloaded history showed its outcome, note and original planned interval. Weekly Planning displayed the old block actuals/locks and the newly re-added commitment's independent 3h budget, 0m scheduled and 0m recorded.

Quality findings:

- Normal Start is one click and fast enough to use when work begins. The removed-work acknowledgement is appropriate additional friction.
- Frozen Action/Goal/Milestone, schedule and the three quantities provide useful context. The active screen avoids planning forms; the count-up has no deadline alarm or forced stop and felt calm in this short walkthrough.
- The ending dialog and saved confirmation explicitly distinguish the session outcome from Action completion.
- Reload/restart recovery felt trustworthy because the same context and elapsed time returned. Starting again after interruption is a natural fresh session; same-block sequential starts/aggregation are also proven by the browser suite.
- Original scheduled intervals remain visible beside actuals; budget, schedule and recorded elapsed are understandable as independent values. Re-addition's zero totals correctly prevent historical effort being attributed to new intent.
- This was a short real-work check, not evidence of long-term adoption. Daily reflection would make partial/abandoned results easier to use; deferred to the next proposed slice.

The disposable fixture's availability advisory showed its existing unavailable/recovery state during the final planning inspection; Focus and local execution remained usable. Real provider behavior is not claimed. Final fixture assertions proved all original source rows, Action state/estimate, baseline contents and TimeBlock rows unchanged through execution and the intentional amendments. Its server/database/tab were cleaned up. Visual evidence: [active session](screenshots/phase-six-a-focus.png), [reloaded abandoned history](screenshots/phase-six-a-history.png).

## Limitations and next proposal

Elapsed session time is recorded evidence, not measured concentration/productivity. Forgotten sessions continue until explicit ending; no gaps/pause exclusion, timeout, correction or terminal-note editing. Open unsaved end notes and uncertain command payloads are in browser memory; confirmed sessions/receipts persist. History is inspected through blocks/current week/selected block rather than a generic archive or daily-review destination. Full cross-midnight/week duration stays with its original block; daily bucketing awaits a review contract. Client display depends on sampled server time plus local wall-clock change; server start/end remain authoritative. Private recovery reads update other-tab state; this is not realtime push or offline operation.

No Action/TimeBlock completion, pause/resume segments, heartbeat/jobs, productivity scores/streaks/Pomodoro, interruptions/distraction tracking, sound/music, blocking/DND/OS automation, notifications, corrections, review/reflection, placement suggestions/automatic scheduling, AI or external integration. Real Google OAuth/list/FreeBusy/refresh/reconnect/disconnect remains unverified and mandatory before any future write phase with separately designed ownership/conflict rules.

Recommend **Phase 6B — Daily Execution / End-of-Day Reflection**, proposal only. Manual Start is already one click; learning from recorded partial/abandoned sessions and remaining planned work should produce more immediate value than an optimizer. Design one small end-of-day comparison/reflection contract with honest unrecorded-versus-zero semantics. No daily review or placement suggestions implemented here. Stop at Phase 6A.
