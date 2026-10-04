# Phase 6B — Daily Execution / End-of-Day Reflection

Implemented 3 October 2026 against approved Phase 6A. This report covers Phase 6B only; Weekly Review/rollover is proposed at the end and is not implemented. All 37 acceptance cases and the complete final gate pass.

## Delivered interaction

`/today` derives today's local date from the authenticated User timezone. `/today?date=YYYY-MM-DD` supports previous/next/Today and a date picker, bounded 2000–9999. Focus and Today link naturally; Focus remains the execution surface. The page shows scheduled and recorded focus, factual outcome counts, distinct logical commitments, individual session history, frozen Action/Goal/Milestone context, cancelled historical intervals, and one optional reflection.

A block with no associated session says **No focus session recorded**. A block whose sessions occurred on other dates instead says that explicitly. Neither implies missed/failed work. There are no percentages, scores, grades, streaks or utilisation targets. Completed, partial and abandoned sessions all contribute their timestamp-derived elapsed time.

Draft notes save explicitly, survive reload/restart, and can be edited repeatedly. No keystroke autosave. Finish requires a saved non-empty note; the dialog first rereads current facts/version and displays scheduled/recorded totals plus the note. Keep draft receives initial focus; Escape returns focus to Finish. Confirm produces read-only finalized text with authoritative timestamp. Future pages can display schedules but have no reflection inputs. Forgotten past dates have no expiry.

## Daily derivation and time boundaries

Pure `localDayRange`, `intervalMilliseconds`, `durationWithinLocalDay`, `deriveDay` and `activeChangesDay` are in `src/modules/reviews/domain.ts`. Temporal maps the requested calendar date in the current User IANA timezone to local midnight and next local midnight. This is a half-open interval; London 29 March 2026 lasts 23 hours, 25 October lasts 25. New York transitions and the skipped Apia 2011 date are covered too.

For each session use `max(start, dayStart)` → `min(endOrNow, dayEnd)` when positive. Monday 23:40 → Tuesday 00:25 therefore contributes 20m and 25m. A session begun yesterday 23:50 and active today 08:00 contributes fixed 10m yesterday and live 8h today. Session time is never clipped to the TimeBlock. Exact milliseconds, including fractions derived from timestamps, are summed before the existing display helper rounds to whole minutes. No timer ticks or derived totals are persisted.

The repository reads in one read-only repeatable-read transaction. It selects owned blocks intersecting the day plus blocks attached to intersecting sessions, even when scheduled on another date. It fetches all associated sessions to distinguish absent history from execution elsewhere. Cancelled blocks remain visible; only Planned block interval overlap contributes scheduled milliseconds. Recorded totals sum all intersecting sessions independently of schedule, Action estimates or commitment budgets. Logical commitment identity/frozen labels remain unchanged; no live source record is needed for historical comprehension. Phase 6A whole-session commitment aggregation remains independent from this daily allocation.

If account timezone changes, daily boundaries follow the new current timezone while Plan/block instants retain their pinned meaning. A pinned block that now crosses a User-local midnight is divided by intersection across the new dates, conserving total duration. The UI labels both display and planning zones when different. Reflection date identity remains the calendar date; this slice introduces no account-timezone history table.

Today's active total is labelled **so far**. One-second browser display derives from a sampled server clock plus elapsed browser time; visible polling/focus/visibility/BroadcastChannel recovery rereads authoritative facts. Past contribution stays bounded even while the session continues. Later ending that session can resolve its outcome label/count; the closed day's elapsed contribution remains fixed. Deliberately starting new Focus after a reflection was finished is permitted: text stays immutable and summaries remain derived.

## DailyReflection persistence and lifecycle

Additive `0010_daily_reflections.sql` and generated Drizzle metadata add one table with UUID id, owner FK, localDate, status, note, integer version, createdAt, updatedAt, nullable finalizedAt. Unique `(ownerId, localDate)`; canonical 2000–9999 date; note at most 4,000 Unicode code points; Draft/finalized lifecycle and chronological timestamp checks. Draft may have empty normalized text. Finalized requires non-empty saved text, version at least 2, finalizedAt equal to updatedAt. A focused UPDATE trigger makes id/owner/date/creation immutable, requires each Draft update to increment version exactly once, and rejects finalized updates. No application DELETE/reopen/edit-finalized/correction route exists; administrative SQL used to clean disposable fixtures is outside the product lifecycle.

Draft creation starts version 1. Save uses the current expected version; finalize increments it, sets terminal status and authoritative server finalizedAt. Browser input cannot set identity ownership, status, timestamps or timezone. A supplied existing reflection ID must retain its original date.

Finalization checks note, current version, authoritative clock and User-local date inside the write transaction. Reject a future date and any current-day active session that can change its elapsed contribution, including zero elapsed just-started sessions. A crossed-midnight active session does not block finalizing a closed past day. No arbitrary expiry for forgotten days. No session, TimeBlock, Plan, Amendment, commitment, Action or Milestone is changed or duplicated during reflection.

## Concurrency, receipts and recovery

Reuse the existing owner-scoped MutationReceipt protocol unchanged, extending only its typed result union. Normalized hashes bind `daily-reflection.save` or `daily-reflection.finalize`, resource/date, expected version and note as applicable. Same owner/UUID/payload returns the original successful DTO even after edits/finalization; changed payload or command kind conflicts. Different owners may use the same UUID independently. Pure reads never write receipts. Reflection and receipt commit or roll back together.

Lock order is receipt → User NO KEY UPDATE → owned reflection. This shared User lock serializes Focus start/end and scheduling with the final active check. Concurrent first creates, saves and save-versus-finalize have one version winner. Start-before-finalize blocks finalization; finalize-before-start may finish and a later deliberate session can then start. No changing-day finalization bypass occurs through interleaving.

Passive refresh updates facts while retaining attempted text and the inspected saved reflection version. Stale saves show only the owner's latest note, preserve attempted text and require explicit Review latest before saving with its new version. If another tab finalized, explicit review shows terminal saved text and retains the attempted note in a disclosure. A lost/uncertain response retains the exact mutation body and locks editing/navigation until Retry same command, then rereads current truth. Dirty date navigation is blocked with explicit Save/Discard; full navigation has a browser beforeunload guard. Transient text never acknowledged by Save is not guaranteed after closing/reloading a tab.

## Ownership and transport

Actor comes solely from the verified database-backed session. All projection joins and reflection reads/writes filter authenticated owner. Foreign/missing reflection IDs have the same safe unavailable response, apart from random diagnostic requestId. No foreign current DTO is returned. HTTP uses established Origin validation, bounded strict JSON, private/no-store responses and safe errors: anonymous 401, foreign/missing 404, wrong Origin 403, invalid payload/date 400, state/version 409, unsupported PATCH/DELETE 405, unavailable PostgreSQL 503. All four new API surfaces have production unavailable-DB proof. No provider/network call occurs during daily reads or reflection commands.

## Acceptance evidence — all 37 requested cases

D = `tests/domain/reviews.test.ts` and `tests/services/reviews.test.ts`; P = real PostgreSQL `tests/db/reviews.test.ts`; B = `tests/e2e/reviews.spec.ts`; R = `scripts/prove-review-restart.ts`; M = disposable production `scripts/review-walkthrough.ts` plus manual Chrome UI.

| Case | Proven behavior | Evidence |
| --- | --- | --- |
| 1 | User IANA timezone identifies today; no UTC date assumption | D/P/B timezone change |
| 2 | Planned requested-day blocks appear | D/P/B/M |
| 3 | Cancelled blocks visible, excluded from scheduled total | D/P/B/M |
| 4 | Multiple sessions aggregate per block without merging rows | D/P/B/M |
| 5 | Actual time aggregates across multiple blocks | D/P/B/M |
| 6 | Abandoned duration retained | D/P/B/M |
| 7 | Early/late actuals not clipped to schedule | D/P realistic 09:50–12:20 local |
| 8 | Midnight split conserves elapsed time | D/P ended 20m/25m |
| 9 | Active past day fixed, today live | D/P/B fixed 10m vs 8h→9h |
| 10 | DST-sensitive elapsed local-day duration | D 23/25h; B repeated fall hour 1h |
| 11 | Past scheduled/no-session neutral language | B/M no focus session recorded |
| 12 | No productivity score/percentage | B assertion and M inspection |
| 13 | Scheduled/actual/budget/estimate independent | D/P/B/M 4h vs 2h |
| 14 | Daily review source/planning/execution unchanged | D input immutability; P/R/M exact JSON row snapshots |
| 15 | One reflection per owner/date | P unique constraint/concurrent create |
| 16 | Create/save Draft | D/P/B/M |
| 17 | Draft browser reload | B/R/M |
| 18 | Draft actual process restart | R real production stop/start |
| 19 | Draft repeated expected-version edits | D/P/B |
| 20 | Stale save cannot overwrite latest; attempted text retained | P one winner, B two tabs |
| 21 | Future create forbidden | D/P/B; no UI controls |
| 22 | Non-empty saved Draft finalizes | D/P/B/R/M; empty rejects |
| 23 | Authoritative finalizedAt | P/R exact injected server instant |
| 24 | Finalized immutable | P SQL/service, B no textarea/edit/delete, R reload |
| 25 | Finalization retry original result | P duplicate simultaneous/exact replay; B lost response; R restart |
| 26 | Forgotten past reflection finalizes | D/P date 2000; B crossed-midnight past |
| 27 | Current-day active disallows finish | D/P zero elapsed, B disabled plus HTTP 409 |
| 28 | Past day finalizes during cross-midnight active | D/P/B |
| 29 | Capacity unchanged | P/R/M full planning row snapshots |
| 30 | Reserve unchanged | P/R/M full planning row snapshots |
| 31 | Commitment budgets unchanged | P/R/M commitment snapshots |
| 32 | Amendments unchanged | P after explicit budget amendment; R/M snapshots |
| 33 | No Action/Milestone completion | P snapshots/Action remains Open; R/M |
| 34 | B cannot derive A's day | P/B distinct accounts with empty owned projection |
| 35 | B cannot read/edit/finalize A's reflection | D/P/B service/HTTP |
| 36 | Foreign/missing IDs indistinguishable | D/P/B compare safe errors excluding requestId |
| 37 | Owner-scoped mutation IDs | P two owners reuse same UUID |

## Measured verification

`npm run check` completed with exit 0 on 3 October 2026:

| Check | Exact final result |
| --- | --- |
| Documents | Six required documents, ADR links and Markdown fences PASS |
| ESLint | PASS, zero warnings/errors |
| TypeScript | PASS |
| Domain/service | **327 passed**, 23 files, **854ms** (289 prior + 38 new) |
| Real PostgreSQL | **241 passed**, 11 files, **18.59s** (221 prior + 20 new) |
| Chromium/HTTP | **92 passed**, **2.9m** (85 prior + 7 new) |
| Total tests | **660 passed**, including every prior phase test |
| Production build | Next.js 16.3.8 Turbopack PASS; compilation **1615ms**; 8/8 static pages generated **241ms**; `/today` and all four new API routes present |
| Actual production restart proofs | **Five scripts pass, ten data-persistence restart cycles**: foundation/planning/amendments, calendar/availability, scheduling, Focus, Daily Reflection |
| Final manual checks | Two disposable simulated-day walkthroughs pass; second verifies corrected centered dialog in final build; source/planning/block/session byte snapshots unchanged |
| Normal local app | Only additive 0010 applied; prior ten migration hashes unchanged; production server restarted on `127.0.0.1:3100`, sole listener, health **200** |

The new restart proof saves Draft, actually stops/starts the production process, reads/reloads the same Draft, then edits/finalizes and stops/starts again. Original create/edit/finalize DTO receipts replay exactly while current truth remains one finalized reflection at version 3 with three receipts. It independently asserts all source/planning/block/session JSON rows unchanged and 503 on every new API with unavailable PostgreSQL. This goes beyond repository/connection re-instantiation.

Earlier migration SQL was not edited: all 0000–0009 SHA-256 hashes exactly match their ten applied normal-database ledger entries. Clean disposable PostgreSQL migrates entirely from 0000–0010 and repeated migration is safe. No dependency versions or lockfile were changed. The first sandboxed build cached a local-worker port error; clearing only generated Turbopack cache allowed the authorized production compiler to complete normally. Early test assertion/import issues were corrected before the final successful full gate.

`npm audit --offline --json` exits 0 with **0 vulnerabilities** (info/low/moderate/high/critical all zero; 646 dependency entries). This is **cached/offline advisory evidence**, not a fresh registry audit. No fresh registry audit was run: prior automatic approval review rejected transmission of audit dependency metadata, and this phase uses the brief's permitted offline policy without bypassing that restriction. No new online audit result is claimed.

After the final manual script/report changes, lint/typecheck/docs were checked again successfully. Final visual evidence: [daily view](../.cache/visual/phase-six-b-day.jpg), [centered confirmation](../.cache/visual/phase-six-b-confirmation.jpg), and the browser suite's [390px view](../.cache/visual/phase-six-b-day-narrow.png).

## Manual product quality gate

A genuine full working-day pilot was not practical within this implementation turn. The explicit minimum was simulated in a disposable production PostgreSQL app on port 3104, synthetic account, guarded injected clock, and separate Chrome tab. No normal account rows, external Google service or user browser tabs were changed.

The day contained a 2h morning block with 80m completed Focus, a 1h afternoon block with 35m partial and 5m abandoned Focus, a 1h block with no session, and an extra 1h cancelled interval. Display: **4h scheduled / 2h recorded**, one completed, one partial, one abandoned, and one logical commitment represented. Individual notes explained the afternoon interruption. Every source/planning/block/session row was byte-identical before and after manual Save Draft → reload → Finish → reload.

Findings against the brief's questions:

- The top two totals and outcome context explain the day in under 30 seconds in this small simulation; opening session details explains the interruption without a dashboard.
- Scheduled/actual feels informative without a grade; cancelled work is visible but absent from the schedule total.
- No focus session recorded appropriately leaves the reason unknown; it does not pretend a block was missed.
- One primary note accommodated progress, interruptions and a tomorrow reminder without forcing separate categories.
- Save Draft was useful: a paragraph was recoverable after reload and could be left unfinished.
- Finalization is intentional but short: inspect two totals and the note, then confirm; Keep Draft and Escape retain control.
- The review asks for remembered context rather than accounting for every minute. There are no gaps-to-fill prompts or utilisation targets. Actual Focus time is still elapsed recorded session time, not proof of attention or productivity.
- All fixture blocks deliberately share one Action/commitment; repeated frozen labels add vertical space. Larger real-day readability and the actual habit of returning at day's end still need a pilot. No grouping/dashboard feature was added.
- Manual inspection exposed an incorrect dialog styling class; corrected to the existing `goal-dialog`, then rechecked in the final production build. Final visual evidence is saved with this report.

## Limits and deferred ideas

Finalized typo corrections, reopening/deletion, manual session corrections, pause segments, gap tracking, scoring/percentages, mood/energy/habit tracking, rich text/attachments/tags/search, AI summaries, auto Action completion, suggestions/automatic amendments, automatic scheduling, Calendar writes and all extra integrations remain excluded. No generic journal/activity-feed/analytics tables. Reflection plain text is at most 4,000 Unicode code points. Unsaved/unconfirmed browser drafts are transient. Facts remain derived, so a timezone change, ending an active session or deliberately recording later work may change displayed context while reflection text stays terminal.

Existing full-history queries are appropriate for the current local MVP; large-history indexing/paging should be measured before optimization. No hosted deployment, CI execution or real-working-day pilot is claimed. Real Google OAuth/calendar list/FreeBusy/refresh/reconnect/disconnect is still an unverified prerequisite before any future Calendar-write phase; local fixtures do not satisfy that gate.

## Recommended Phase 7A — proposal only

Build Weekly Review and Deliberate Rollover around original baseline, ordered Amendments/current budgets, scheduled TimeBlocks, Focus actuals, Daily Reflections and explicit Action states. Explain original commitments, what changed, what received attention and what did not. Preserve frozen logical lineage and distinguish effort from deliverable completion; define cross-week allocation explicitly without changing source sessions.

Offer explicit carry/defer/drop choices for unfinished commitments and a reviewed destination-week budget. No automatic carry-forward and no AI. First specify eligible completed/archived-source handling, merging with an existing destination Draft, predecessor links, duplicate rollover guards, expected versions, idempotent retries and ownership. Destination commitments must be new linked identities; original weeks/history remain unchanged. Stop at this proposal: no Weekly Review or rollover code/schema/UI was implemented.
