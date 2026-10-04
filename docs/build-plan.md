# Build plan: usable vertical slices

Status: the Phase 0–7A domain is complete. UI Redesign R1 is implemented and verified: **353 domain/service + 263 PostgreSQL + 106 browser/HTTP = 722 tests passed**, plus all six production restart proofs, lint/types/docs/build and manual responsive QA. See [the R1 report](ui-redesign-r1-report.md) and the historical [Phase 7A report](phase-seven-a-report.md). R2 is now implemented and verified: 353 domain/service + 263 PostgreSQL + 120 unique browser/HTTP tests (736 total), plus all six production restart proofs. See [R2 completion](ui-redesign-r2-report.md). The subsequent user-authorized Goals / Focus / Review design refinement is implemented; see [workspace tabs](ui-workspace-tabs-report.md). A real full-week dogfood gate remains recommended before selecting new features.

## Delivery rules

The core MVP ends at Phase 8. Each later slice depends on demonstrated usefulness of the loop, not merely green tests. Ship basic keyboard access, responsive forms, explicit save states, ownership checks, and recovery with every feature.

Each implementation task must declare:

1. The end-to-end user interaction and state transitions.
2. Domain invariants, ownership boundaries, and concurrency rules.
3. Persistence, retries, reload behaviour, and migration effects.
4. Empty, loading, error, stale, and permission states.
5. Edge cases and concrete Given/When/Then acceptance tests.
6. What is explicitly excluded and what evidence permits the next slice.

Do not create an entire backend first. Add schema, service, transport, UI, and tests for one journey together. Do not scaffold unused adapters. If a slice is too large, split at a usable interaction, not at a frontend/backend boundary. Suggested subdivisions below are implementation task sizes; phases are roadmap milestones, not single giant tasks.

## Phase 0 — minimal local engineering foundation

**Depends on:** reviewed architecture (approved). **Usable result:** open a working local shell, see authenticated foundation readiness, and diagnose a database connection problem.

- Create the Next.js/React/TypeScript project, select compatible stable packages, lock versions, configure lint/typecheck/build, and install Drizzle/Zod/testing tools. Implement only current module folders.
- Provide a local Postgres service with a named persistent volume, repeatable migrations, `.env.example` with placeholders, and concise setup/reset/backup notes. Destructive database reset must be explicit.
- Implement Better Auth database sessions with email/password and disabled public sign-up; explicitly provision local accounts through a development CLI. Resolve actor from a verified session; anonymous protected requests are denied. No automatic actor, browser-provided owner, or impersonation endpoint. See ADR 007.
- Add a navigable shell with current-account context, an explicit Phase 0 readiness state, database health/error handling, and no fake Goal records. Do not show unfinished later navigation as working features.

**Acceptance:** clean checkout setup succeeds using documented commands; migration runs twice safely; a server restart retains user and session identities; unavailable database yields an actionable error, not “no goals”; development provisioning refuses production/non-loopback configuration; protected APIs reject anonymous requests; two provisioned users have distinct IDs.

**Tests:** CI scripts run lint/typecheck/test/build; Postgres migration/session/identity persistence and service tests; Playwright sign-in/shell/sign-out/unauthorised smoke and application-restart proof. Verify lockfile/runtime compatibility, not full future auth/calendar behaviour.

**Do not build:** goal mutations, all future tables, OAuth, jobs, integrations, AI, elaborate design system, deployment infrastructure. Auth-required user/session/account/verification tables are the only initial schema.

**Gate:** local shell works with real Postgres and repeatable setup. Proceed directly to Phase 1; avoid a prolonged infrastructure phase.

## Phase 1 — goals, the first real vertical slice

**Depends on:** Phase 0. **Usable result:** create a goal → persist it → edit it → archive it → see it in the UI → reload/restart proves persistence. No milestones/actions yet.

### Interaction contract

- Goals opens on Active. New goal opens an inline form or accessible dialog. Fields: required title and required intended outcome. The Phase 1 brief excludes dates.
- Trim outer whitespace. Proposed limits: title 1–160 Unicode code points; intended outcome 1–2,000 code points. Implement the same counting rule client/server. Newlines in outcomes are allowed; render as plain text.
- No target dates, priority, percentage progress, colours, icons, tags, seasons, or AI fields. Goals express outcomes rather than another task list.
- Save submits once using a stable operation ID. Disable duplicate submits while pending; show saved state only after the database acknowledges. Successful create closes/resets the form and displays the saved goal.
- Edit opens persisted values and submits the expected version. Cancel discards only the unsaved draft. Failure keeps the form/draft and shows retry. Do not overwrite data from another tab.
- Archive is an explicit goal action. A successful archive removes it from Active and displays it in Archived. This is a soft archive retaining outcome/history. No permanent delete, restore UI, or bulk operations in this phase.
- Archived goals are readable and cannot be edited through the phase's commands. Repeated archive is safe/idempotent. A stale edit cannot reactivate an archived goal.
- Active/Archived views have distinct empty states. Sort by creation descending, then stable ID; editing does not unexpectedly reorder cards. Titles need not be unique.
- Keyboard focus moves to the first field when opening a dialog and returns to the triggering control on close; labels and field errors are associated; Escape/cancel behaves consistently. At narrow widths the form/actions remain usable.

### Persistence and invariants

- Persist User, Goal, and MutationReceipt only. Goal uses UUID, server-owned user ID, title/outcome, created_at, updated_at, archived_at, integer version.
- All list/get/mutations are owner-scoped; unknown and other-owner IDs return the same unavailable response. Require the actor at every transport entry point, even in local mode.
- Create/edit/archive and their receipts commit atomically. Same user/operation ID + same payload returns the original result without a second goal; different payload under the same key conflicts. No uniqueness on title. Replay the original successful snapshot for all three commands, even after later edits/archive. Receipt primary key is owner + mutation ID; hashes include command kind, ID/version, and normalized fields. See ADR 008.
- Edit/archive use expected-version checks. Updating a stale row returns conflict with the actor's current record; user can reload it and explicitly reapply the draft. No last-write-wins behaviour.
- A browser tab's draft is transient; the committed database row is authoritative. Local storage is not used as the goals database. A failed initial load cannot be replaced by an empty write.
- Validation failure performs no database mutation. Archiving retains the row. Server timestamps cannot be supplied by the client. No query cache shared across owners.

### Acceptance tests

| ID | Given / when | Then |
| --- | --- | --- |
| G1 | Empty account; enter valid title/outcome and Save | Exactly one owned row and one visible card; success after acknowledgement |
| G2 | A created goal; hard reload and open a new browser context | Same ID/fields appear from the server without browser storage |
| G3 | A created goal; restart web process and read again | Same goal persists in Postgres; automated DB persistence/restart check plus browser smoke |
| G4 | Open Edit; change title/outcome and save | Same ID, incremented version, correct values after reload |
| G5 | Open Edit; change draft then Cancel | Database and displayed saved values remain unchanged |
| G6 | Archive a goal; view Active/Archived, reload both | Hidden in Active, retained in Archived with full fields; no deletion |
| G7 | Empty/whitespace or over-limit fields or malformed commands | Inline errors; no row; max boundary accepted consistently |
| G8 | Duplicate submit or lost response; retry the same operation | One row/result; reuse of key with altered payload rejected |
| G9 | Database unavailable on load/create/edit/archive | Explicit error; no false empty/saved state; draft retained for retry |
| G10 | Two tabs edit version 1; first saves, second submits | Second conflicts; first's data survives; explicit refresh/reapply path |
| G11 | Another tab archives while Edit is open | Stale edit conflicts; archived goal remains archived |
| G12 | User B reads/edits/archives User A's IDs via service/HTTP test actor | No private data or mutation; same unavailable semantics as nonexistent ID |
| G13 | Duplicate titles, Unicode boundaries, plain-text markup | Separate valid goals; consistent length checks; no executable markup |
| G14 | Keyboard-only flow and narrow viewport | Create/edit/archive/view flow is operable and errors are announced |

Use domain tests for validation/transitions, real Postgres tests for isolation/version/idempotency/retention, and Playwright for G1–G6 plus relevant failure/concurrency interactions. Test actor injection belongs in harness/service composition, never a public API. A full-page reload alone cannot distinguish local storage from durable persistence, so G2/G3 are required.

**Do not build:** goals nested in projects/seasons, milestones/tasks, weekly planning, timers, integrations, AI, restore/permanent delete, drag-and-drop, task counts, invented progress percentages.

**Gate:** G1–G14 pass, lint/typecheck/build pass, and a short manual walkthrough creates, edits, archives, reloads, and restarts successfully. This contract is the recommended first implementation slice after the minimal Phase 0.

### Phase 1 actual result — 2 October 2026

Implemented owned Goal create/display/edit/soft-archive and retained Archived view, with required title/outcome only. The subsequent brief explicitly excluded target dates. `0001_goals.sql` adds Goal/MutationReceipt without modifying Phase 0 SQL. All three commands use owner-scoped atomic receipts/original result replay; edit/archive use row locks plus expected versions and typed conflicts. Dialogs preserve failed drafts and require review before resubmitting conflicts. See [ADR 008](decisions/008-goal-command-receipts.md) and [Phase 1 report](phase-one-report.md).

Measured checks: 22 domain/service tests, 21 real PostgreSQL tests, 13 Chromium tests; production process restart preserves Goals and all receipt types; lint/typecheck/docs/optimized build pass, audit 0 vulnerabilities. Normal-account manual create/reload/edit/archive/Archived reload and responsive/keyboard checks pass. G1–G14 apply with the date-free amendments above. Phase 2 is proposed only; no Phase 2 modules/schema/UI were created.

## Phase 2A — Goal Milestones

**Depends on:** approved Phase 1. **Authorization:** implement 2A only; Actions require a separate review. **Usable result:** open an owned Goal, describe observable checkpoints, record intentional completion evidence, and retain trustworthy history.

**Scope:** Goal detail with compact Active/Completed/Archived navigation; create and edit title/success condition; deliberate completion with optional evidence; confirmed soft archive; durable reload/restart. A Milestone always belongs to exactly one owned Goal; its parent identity never changes.

**Rules:** active → completed OR active → archived, both terminal. Only active checkpoints beneath an active Goal may change. Archived Goals preserve every child unchanged as read-only history. Completion does not change the Goal or any numerical progress. All existing-row commands require the read version; stale commands conflict and retain drafts. Reuse the Phase 1 owner-scoped command receipts for create/edit/complete/archive, including original-result replay after later history changes. Parent Goal lock precedes child lock, serializing Goal archive races. Composite owner/Goal foreign key enforces persistence integrity. See [ADR 009](decisions/009-milestone-history-and-parent-locks.md).

**Acceptance:** the latest Phase 2A brief's twenty cases are the gate: explanatory empty view; valid creation and server validation; one result for duplicate create; reload and process restart; edit/version and replay; stale edits; completion/definition/timestamp/evidence and replay; stale completion and terminal immutability; retained archive and replay; stale archive/archived immutability; owner isolation; archived-parent restrictions; separate user command namespaces. Domain/service, real PostgreSQL, HTTP/browser, production restart, and manual UX evidence is recorded in the [Phase 2A report](phase-two-a-report.md).

**Do not build:** Actions/tasks/checklists, nesting/order/dates/dependencies, progress/weights/priorities/tags, recurring checkpoints, attachments/URLs/metrics, AI, planning/calendar/focus/reviews/notifications, moving, reopen/restore or hard deletion.

**Gate:** all twenty cases and prior Phase 0/1 tests pass; lint, typecheck, build, documents and audit pass; manual inspection confirms outcome checkpoints and intentional evidence-based completion. Stop after the completion report and use this slice before authorizing 2B.

### Phase 2A actual result — 2 October 2026

Implemented the Goal detail/checkpoint slice with required success conditions, optional completion evidence, terminal Completed/Archived history, parent-archive read-only restrictions, composite ownership FK, expected versions and reused Phase 1 receipts. All twenty acceptance cases pass. Final full gate: 38 domain/service + 42 PostgreSQL + 20 Chromium = 100 tests; production restart, lint, typecheck, document check, build and 0-vulnerability audit pass. Normal-account manual walkthrough confirms intentional completion and unchanged three-state history after parent archive. See the [completion report](phase-two-a-report.md). Phase 2A is complete; stop before Actions.

## Phase 2B — Goal-Aligned Actions

**Authorization:** latest explicit Phase 2B brief, following approved 2A. **Usable result:** capture concrete executable work beneath an owned Goal, optionally associate an active milestone in that exact Goal, edit/reassign/complete/archive, and retain history across reload/restart.

Every Action has one immutable Goal; **no standalone Actions**. Required title, optional doneWhen/estimateMinutes/milestoneId, open/completed/archived, version and lifecycle instants. Only Open + active Goal + absent/active linked Milestone is mutable. No escaping a terminal Milestone by detachment. Parent transitions retain all Action rows/states/estimates unchanged. Estimate means current effort only.

Reuse the owner-scoped receipt protocol and original snapshots with `action.*` command kinds. Goal and Milestone hashes stay unchanged. Goal locks serialize parent transitions, followed by current/destination milestones in stable order and the Action; observed expected versions provide one winner. PostgreSQL composite FKs enforce owned exact-Goal relationships. React consumes server-derived mutability and valid selectors; drafts survive conflicts, and uncertain retries keep identical commands.

**Gate:** all 28 brief acceptance cases, prior checks, domain/service, real PostgreSQL relationship/receipt/race tests, authenticated browser journeys, actual production restarts, lint/typecheck/documents/build/audit and manual UX. Evidence is in [Phase 2B report](phase-two-b-report.md); decisions in [ADR 010](decisions/010-goal-aligned-actions.md).

**Excluded:** standalone/inbox work, weekly commitments/planning, schedules/actuals/focus, dates/priorities/ordering/kanban/subtasks/tags/recurrence/bulk work, AI/integrations, reopening or hard deletion. Stop at the Phase 2B report. Phase 3 is proposed only.

### Phase 2B actual result — 2 October 2026

Goal-aligned Actions are implemented with all 28 acceptance cases passing. Exactly one immutable owned Goal; optional active exact-Goal Milestone; central effective mutability; terminal Action/parent history; independent current effort estimates; one-winner versions and reused original-result receipts. Final full gate: 55 domain/service + 81 PostgreSQL + 27 Chromium/HTTP = **163 passed**; real production restart, lint/typecheck/documents/build and 0-vulnerability audit pass. Normal-account manual capture/edit/reassign/complete/archive/reload and parent-readonly walkthrough pass. Earlier SQL hashes unchanged; additive migration applied locally. See the [report](phase-two-b-report.md). Stop here; Phase 3 is proposed only.

## Phase 3A — Weekly Planning and Immutable Baseline

**Depends on:** approved Phase 2B. **Authorization:** Phase 3A only under the latest brief. **Usable result:** choose a Monday-start current/future week, manually protect capacity/reserve, deliberately select eligible Actions with separate budgets, save a Draft, explicitly review/commit, and retain the original baseline after source changes and reload/restart.

**Rules:** one Plan per owner/local Monday date, pinned account timezone, Draft → Committed only. Usable minutes = provisional focus capacity − protected reserve; both are manually entered. Weekly budgets are independent of Action estimates. Over-capacity Drafts are allowed and clearly shown, but cannot commit; empty Drafts cannot commit. No automatic selection, ranking, shrinking, reserve override, completion lifecycle or scheduled/actual time.

**Implementation:** WeeklyPlan + WeeklyCommitment only. Full-state Draft saves use expected versions and the existing receipts. Reuse Action effective mutability. Source guards require review of edits/reassignment; locked source validation and atomic committed snapshots preserve Action/Goal/Milestone meaning. Committed UI offers history without mutation controls. See [ADR 011](decisions/011-weekly-planning-immutable-baseline.md).

**Gate:** all 31 requested acceptance cases; previous and new domain/service/Postgres/browser tests; actual production process restart with Draft and committed history; lint/typecheck/docs/build/audit; normal-account 12h capacity / 3h reserve / 6–7h commitments walkthrough. Exact results and acceptance mapping are in the [Phase 3A report](phase-three-a-report.md).

**Excluded:** amendments, post-commit editing, closing, rollover, availability settings/calendar reads, schedules/focus/actuals/reviews, AI and all integrations. Earlier Phase 3A/3B/3C ordering, working-window setup, commitment ordering/deliverables and over-budget override proposals are superseded by this brief.

### Phase 3A actual result — 2 October 2026

Implemented the dedicated planning page, two-table baseline, owned full-state Draft saves, explicit source review and atomic commitment. Final verification: **80 domain/service + 118 PostgreSQL + 37 Chromium/HTTP = 235 passed**, including all previous tests; lint/typecheck/docs/production build and two real process restarts pass; dependency audit reports **0 vulnerabilities**. Normal-account current-week walkthrough: **12h capacity / 3h reserve / 9h usable / 6h 30m committed / 2h 30m breathing room**; over-capacity Draft visibly blocks commitment; committed snapshots retain original wording/estimate after source edits and reload. Additive migration is applied locally and earlier SQL hashes remain unchanged. See the [completion report](phase-three-a-report.md) for all 31 acceptance cases and limitations. Stop at this boundary.

## Phase 3B — Immutable Weekly Plan Amendments

**Depends on:** approved Phase 3A. **Authorization:** Phase 3B only. **Usable result:** transiently revise the Current Plan, review a concise computed difference, supply a reason, and confirm one immutable complete amendment. The original baseline and all prior amendments remain independently inspectable.

**Representation:** owned Amendment + complete Commitment snapshots, positive unique per-Plan sequence, required 1–500 code-point reason. Latest sequence is effective; baseline is effective before the first amendment. No event stream or baseline migration. Carry existing snapshots/identity/guards exactly, including beneath terminal sources; changing a budget never refreshes context. Additions require current owned eligible Actions and fresh reviewed source guards; re-add after a historical drop captures fresh text.

**Rules:** one Plan lock/version serializes the linear history. Only technical WeeklyPlan.version advances; baseline content/timestamps/rows stay unchanged. Existing receipts atomically replay the original result. Current/future committed weeks may amend using current User timezone; past weeks remain read-only. No-op and over-capacity confirmations are rejected. Zero capacity is valid only with zero reserve/no commitments; positive capacity may intentionally have no commitments. Phase 3A original rules stay intact.

**Gate:** all 42 brief cases, all prior/new unit/service/PostgreSQL/browser checks, actual production restart and original receipt replay, lint/typecheck/docs/build/audit, and a normal-account midweek-change walkthrough. See [ADR 012](decisions/012-immutable-weekly-amendments.md) and the [Phase 3B report](phase-three-b-report.md) for exact evidence.

**Excluded:** amendment edits/deletes/branches/merges, durable drafts, plan closing/rollover, calendar/scheduling/focus/actuals/reviews/AI/integrations. Phase 3B stopped at this boundary; the separately authorized Phase 4A contract follows below.

### Phase 3B actual result — 2 October 2026

Full-snapshot amendments, Current Plan, original/history inspection and pure diffs implemented. Final verification: **119 domain/service + 150 PostgreSQL + 47 Chromium/HTTP = 316 passed**, including all prior tests; actual production restart/receipt proof, lint/typecheck/documents/build and **0-vulnerability audit** pass. Detailed evidence is recorded in the [report](phase-three-b-report.md). Manual example: original **12h / 3h reserve / 6h 30m committed / 2h 30m uncommitted**; Amendment 1 **9h / 2h reserve / 5h 15m committed / 1h 45m uncommitted**; Amendment 2 protects **2h 30m reserve**, retaining **1h 15m uncommitted**. Original and first amendment remain intact after reload.

## Phase 4A — Google Calendar Connection + Free/Busy Advisory

**Depends on:** approved Phase 3B. **Usable result:** explicitly connect a separate Google Calendar account, select readable calendars, refresh existing busy timing alongside independently manual Weekly Planning, reconnect and intentionally disconnect.

CalendarList + FreeBusy only, exact two narrow scopes, Google Auth Library authorization-code/PKCE/offline flow, actor-bound expiring state, actual grant verification, external-key AES-256-GCM, one owned connection, versioned explicit selection up to 50 calendars. Full CalendarList pagination; unknown roles excluded; no primary auto-selection. Inaccessible selections require review.

Pure exact Monday/local-day instant boundaries, clipped interval union including nesting/adjacency/DST, seven daily busy totals and weekly busy minutes. On-demand refresh only. Minimal complete cache preserves last-successful fetchedAt; partial/errors stay unavailable or stale with prior timing, never free. Disconnect clears secrets/selection/cache/pending consent and attempts revocation even though provider failure cannot block local erasure. All Goals/Milestones/Actions/manual Drafts/baselines/Amendments stay unchanged.

**Verification:** all earlier suites plus domain/service/provider fixtures, real PostgreSQL ownership/encryption/concurrency/non-mutation, authenticated fake-provider browser journeys, actual production-process restart/cache freshness proof, manual product quality gate, lint/type/docs/build/audit. Live Google walkthrough remains conditional on local credentials and separately reported. See [ADR 013](decisions/013-freebusy-advisory.md) and [report](phase-four-a-report.md).

**Excluded:** Events.list, event metadata/mirrors, event recurrence/cancellation interpretation, cursor/sync-token/410 machinery, watches/webhooks, background polling/jobs/queues, working windows/open-time/capacity calculations, recommendations, Calendar writes/scheduling/focus/reviews/AI/other adapters. Earlier snapshot-first event strategy is explicitly deferred until a concrete product feature needs event-level data.

## Phase 4B — Focusable Hours + Deterministic Calendar-Open Time

**Authorization:** Phase 4B only, approved Phase 4A prerequisite. Explicit owned recurring hours settings, minute wall-clock storage, atomic full-state version/receipt saves, current User timezone expansion, tested compatible DST resolution, half-open interval intersection/subtraction, known/stale/unknown/incomplete advisory and daily concrete lists. No defaults or automatic Plan changes. Finished weeks omit live settings. [ADR 014](decisions/014-focusable-hours-and-advisory-open-time.md).

**Gate:** all 50 acceptance cases; previous/new unit/service, real PostgreSQL, browser, actual process-restart persistence/replay, lint/typecheck/docs/build/audit; realistic manual product gate. [Completion report](phase-four-b-report.md) records exact evidence, deviations, limitations and next-slice proposal.

**Stop after 4B.** Real Google OAuth/provider walkthrough is non-blocking for this provider-independent slice, but required before hosted Calendar use or any Calendar writing. No TimeBlocks or writes implemented.

### Phase 4B actual result

Implemented and verified all 50 acceptance cases: **230 domain/service/provider + 179 real PostgreSQL + 64 Chromium/HTTP = 473 passed**, including all prior tests, zero browser retries. Four actual production stop/start cycles, original receipt replay after later replacement, additive local migration, unchanged prior SQL, lint/typecheck/documents/optimized build and manual product walkthrough pass. Cached offline dependency audit reports **0 vulnerabilities**; a fresh online advisory lookup was blocked by automatic approval review and is not claimed. Real Google OAuth + CalendarList/FreeBusy verification remains required before hosted use or future external writes. See the [completion report](phase-four-b-report.md). The normal production preview has been restarted. Stop at this boundary.

## Proposed Phase 4C / 5A — Local Time Blocking

The next smallest slice should turn one Weekly Commitment into one or more **explicitly manually placed local TimeBlocks**, using advisory open intervals. Keep commitment budgets distinct from scheduled minutes; prevent internal overlap, respect focusable windows, warn about Google busy conflicts, preserve immutable planning history, and make every placement/change user-controlled. Establish concurrency/retry/ownership and DST time-entry acceptance cases before implementation. A deterministic suggestion is optional later; start with manual placement to validate the UX.

Create no Google events. Only after the local block model/UX is useful and a real Google OAuth + FreeBusy walkthrough passes should a separate external-publication slice consider dedicated focus-calendar writes. The Phase 5 export design below is a future option, not immediate implementation authorization.

## Phase 5A — Local Time Blocking

**Authorization:** Phase 5A only, following approved Phase 4B. Reuse stable carried commitment IDs; minimally register owned logical identity for baseline/amendment foreign-key references. Only current Effective Plan membership in committed current/future weeks may schedule. Local UUID blocks persist unambiguous instants, frozen context, planned/cancelled/version/timestamps. Same Plan-local day/week, future placement, preserved past history, owner-wide half-open overlap under transactional serialization. Separate server acknowledgements for outside Focusable Hours and known Google busy; stale labelled and unknown never free. Under/over budget is allowed and neutral; no planning/source mutation. Budget/carry/drop/re-add alignment is derived, with deliberate orphan cancellation. Existing owner receipts/version checks and exact retry semantics apply.

**Preparatory polish:** three-number availability summary retained; daily intervals and Calendar Load share one details area collapsed by default. Commitment/scheduling decisions remain primary; no unrelated redesign.

**Proof:** domain/service, real PostgreSQL races/ownership/migrations, real sign-in browser flows, actual process restart/replay, production build and manual realistic-week quality gate. Exact results and all 30 acceptance cases: [Phase 5A report](phase-five-a-report.md). [ADR 015](decisions/015-local-time-blocks.md).

**Actual result:** 537 tests (264 domain/service/provider, 198 real PostgreSQL, 75 browser), six production restart proof cycles, lint/types/docs/build/migrations passed. Manual two-90m schedule, overlap/busy/outside/over-budget, reschedule, budget/drop amendment and orphan cancellation passed. Cached offline audit reports zero vulnerabilities; fresh registry audit remains unverified.

**Stop here:** no Google writing, suggestions, optimizer, Focus/actuals/reviews, AI, recurrence, buffers, minimum duration, drag/drop or other integrations. Recommend Phase 6A Focus Sessions as the next proposal after observing manual placement, subject to its own acceptance contract. A real Google read-only account walkthrough remains a prerequisite for future writes.

## Future scheduling/export roadmap — requires separate approval

**Depends on:** Phase 4. **Usable result:** preview blocks, accept them, see confirmed Google publication, and move/cancel linked blocks safely.

**Preflight spike:** app-created-calendar scope/create behaviour, stable valid event IDs, ownership markers, conditional writes, remote deletion, ambiguous create response, and crash after remote write. Use an explicit test output calendar; never ordinary events.

**Tasks:** 5A deterministic preview/partial placement with plain-language reasons; 5B acceptance + revision + outbox + dedicated output-calendar publication; 5C explicit move/cancel and remote-conflict detection/representation. Unrestricted two-way resolution is deferred. A pending operation is always visible; it is not presented as fully scheduled in Google.

**Rules:** no overlap, no placement beyond working/day/week budgets, no hidden movement, no active/past-block reschedule, no writing unrelated events. Stable operation identities and tombstones; local commit and Google confirmation are separate; refresh/revalidate before acceptance and publication. First accepted schedule is retained as calendar baseline.

**Acceptance/tests:** fit two commitments around meetings; partial result retains unplaced minutes; double acceptance creates no duplicate; two concurrent placements cannot overlap; timeout-after-create reconciles one event; crash/retry confirms correctly; remote move/delete records a conflict without overwriting either side; cancellation cannot be undone by delayed retry; ordinary event IDs cannot be mutation targets. Test DST, buffers, fragment rules, race conditions, outbox recovery, and sandbox writes.

**Do not build:** drag-and-drop first, optimal global solver, recurring focus events, multi-person meeting scheduling, AI scheduling, primary-calendar modification, automated replanning.

**Gate:** safe create/move/cancel and recovery pass under deliberately induced failure before scheduling real weeks.

## Phase 6A — Focus Sessions / Actual Execution

**Authorization:** Phase 6A only after approved local Time Blocking. Required owned TimeBlock, server start/end instants, nullable active outcome/note, ended immutable completed/partial/abandoned context, existing versions/receipts. PostgreSQL partial uniqueness protects one active session globally per owner. Start only current User-local committed weeks; early/late and multiple sequential sessions allowed. Dropped membership needs acknowledgement; future/historical/cancelled starts reject. An active session continues across schedule/day/week boundaries without timeout.

**Execution lock:** any session permanently freezes its TimeBlock's original planned interval/state from normal reschedule/cancel, including early starts. Shared User locking serializes against scheduling; Plan locking stabilizes membership. Amendments retain sessions and old lineage, never stop execution, and do not assign old actuals to a re-add.

**Independent actuals:** precise ended elapsed duration from timestamps, all outcomes retained. Saved totals exclude active; live Focus labels its additional elapsed duration “so far.” No Action completion, capacity/budget/schedule mutation, segments/pause, heartbeats, corrections, reviews, AI, placement suggestions or Calendar writes.

**Usable flow:** authenticated Focus navigation → chronological today list in User timezone or selected current-week block → one-click start (removed work adds acknowledgement) → calm elapsed/context view → reload/navigation/restart recovery → compact deliberate outcome/note → preserved history/actual totals → another session. Planning shows recorded totals and execution locks. [ADR 016](decisions/016-focus-sessions-and-execution-lock.md); [Phase 6A report](phase-six-a-report.md).

**Gate:** all 51 requested cases, complete prior/new domain/service/PostgreSQL/browser suites, real active-session and receipt restart proofs, lint/types/docs/build, permitted dependency audit and realistic manual product walkthrough. Exact final results are in the report.

**Historical Phase 6A recommendation:** Phase 6B was subsequently authorized and is now implemented below. Its scope supersedes the original daily-review roadmap. Real Google OAuth/list/FreeBusy/refresh/reconnect/disconnect must be manually proven before any separately designed writing phase.

## Original Phase 7 roadmap — superseded by Phase 6B

The following is historical planning context, not current implementation scope. Corrections, unplanned sessions, daily baseline snapshots and rescheduling remain excluded by the approved Phase 6B brief.

**Depends on:** Phase 6. **Usable result:** understand today's plan, actual effort, missed/partial/unrecorded work, and amend future work.

**Tasks:** 7A daily comparison + persisted reflection; 7B explicit actual correction with evidence and reschedule selected future blocks through the existing service.

**Rules:** use the daily baseline defined in planning-engine.md, show original/current/actual separately, split confirmed actuals across local boundaries, show unplanned sessions. “No recorded work” cannot imply no work happened. Correcting actuals retains original bounds/reason and cannot introduce overlap. Plan amendments never rewrite baselines.

**Acceptance/tests:** 120 baseline planned/75 actual shows -45 minutes with partial/unknown status distinct; moving/cancelling a block preserves original-plan visibility; unplanned session appears separately; reflection and correction persist after reload; overlapping correction rejected; historical task edit leaves plan comparison intact. Test projections, corrections, and one complete daily browser review.

**Do not build:** AI summaries, productivity ratings, guilt/streak mechanics, auto-rescheduling all missed work.

**Gate:** a daily review produces a clear next decision in a few minutes.

## Original Phase 8 roadmap — historical context superseded by Phase 7A

The following is historical planning context. The authorized Phase 7A contract below supersedes this proposal. Actual corrections and automated progress remain deferred; no subsequent feature is authorized.

**Depends on:** Phase 7. **Usable result:** review the week, identify meaningful outcome progress, and explicitly select the next week's commitments.

**Tasks:** 8A weekly aggregates, milestone/outcome evidence, under/overplanning, and reflection; 8B carry/defer/drop choices create a new linked plan without changing the old one.

**Rules:** distinguish commitment budget, baseline/current scheduled minutes, and confirmed actuals; goal progress uses evidence. Closed-week revisions remain immutable; later actual corrections appear as corrected actuals. Rollover is selected with a fresh budget, once per destination week; no automatic carry-forward debt.

**Acceptance/tests:** daily sums match weekly confirmed seconds before display rounding; actual effort and deliverable status differ correctly; next-week choices create new commitment IDs linked to predecessors; retry cannot duplicate rollover; old estimates/baselines/actuals retained; timezones and cross-week sessions handled. Test review projections and a browser journey from goal→week→calendar→focus→review→next week.

**Do not build:** AI coach, imports, integration catalogue, dashboards unrelated to decisions, automatic outcome scores.

**Gate:** four-week pilot validates the product-spec success criteria. This completes the core MVP; if the loop is not useful, improve it before expanding.

## Phase 9 — optional AI proposal coach

**Depends on:** useful Phase 8 loop. **Usable result:** request one structured planning/review suggestion, inspect/edit/reject it, and accept via existing commands.

**Tasks:** 9A consent/context preview + one provider + fake shared contract; 9B validated recommendation storage/acceptance and small evaluation set; a second provider only when needed.

**Rules:** no calendar write tools; minimally approved context; schema and semantic validation; version-bound/idempotent acceptance; refusal/timeouts preserve manual planning; no silent cross-provider fallback.

**Acceptance/tests:** helpful/empty/refused/malformed response handled; invented task IDs and collisions rejected; stale recommendation cannot apply; double acceptance creates one command; evaluation fixtures test recommendation usefulness and safety constraints. Test provider contracts and one acceptance browser journey. Review API credentials and provider data controls before enabling live calls.

**Do not build:** autonomous agents, persistent chat history, model routing platform, embeddings/vector database, prompt marketplace.

## Phase 10 — selective Notion context/import

**Depends on:** Phase 8; independent of Phase 9. **Usable result:** preview selected source items, import a few into actions, preserve provenance.

**Spike:** verify current API version/data-source semantics, permissions and mapping on one real source.

**Rules/acceptance/tests:** same selected source imported twice creates one linked source/action; source changes produce an explicit diff; local edits remain authoritative; revoked access/source deletion retains local plan history; reconnect does not duplicate import. Fixture contracts plus one select/preview/import/reload journey.

**Do not build:** workspace ingestion, two-way synchronization, generic ETL, migration of an entire Notion system, Google Tasks adapter.

## Phase 11 — justified automation/integration slices

**Depends on:** a specific unmet need observed in the loop. Each adapter needs its own small acceptance contract.

Start with optional Slack DND tied to a user-started focus session and reliable restoration. Later, selected Jira/GitHub work can provide read-only candidates with provenance. Any external workflow write requires an explicit concrete user action and the established outbox/ownership rules.

**Acceptance/tests:** scopes minimal; failures do not block focus/planning; DND restored on end/crash recovery without clobbering a user's newer state; source candidates deduplicate; no unsolicited messages. Run contract and recovery tests per adapter.

**Do not build:** every adapter, an automation-builder UI, autonomous issue/calendar modification, notification spam.

## Phase 12 — refinement based on use

**Depends on:** measured friction after Phase 8. **Usable result:** faster onboarding and smoother repeated planning/focus/review.

Prioritise specific observed issues: keyboard navigation, accessible agenda changes, responsive layout, restrained notifications, export/deletion workflow for wider release, and performance. Test the affected journeys; retain privacy/ownership/recovery guarantees.

**Do not build:** a visual redesign that delays the loop, speculative widgets, native apps, or social/gamification features without evidence.

## Review decisions and deferred choices

The modular monolith, local-first slices, dedicated output calendar, busy-only Phase 4A with event synchronization deferred until justified, baseline/actual semantics, and AI proposal boundary are approved with the review amendments. Exact runtime/package versions are checked at scaffolding; hosted database/deployment provider is selected when deployment is requested; OAuth operational constraints at Phase 4; actual-gap thresholds during Phase 6; AI model/data controls at Phase 9; Notion API version at Phase 10.

Current implementation authorization includes the user-supplied Goals / Focus / Review visual reference, composing the completed Phase 0–7A domain. The reference refinement is presentation work; no new domain phase is authorized. Next-slice recommendations are proposals only. Goal dates remain excluded.

## Phase 0 completion proof checklist

Demonstrate local boot; clean migrations-only Postgres schema creation; real sign-in; server-only session-to-User context; anonymous protected-route rejection; two distinct ownership identities; database/session persistence across app restart; domain/service tests; at least one authenticated browser smoke; passing lint, TypeScript, Postgres/unit/browser tests, and production build. Record each result in the completion report. No SQLite substitute, Goals implementation, Calendar scopes, jobs, or speculative infrastructure.

## Phase 6B — Daily Execution / End-of-Day Reflection

**Authorized scope:** `/today?date=YYYY-MM-DD` derives the authenticated owner's scheduled blocks and intersecting Focus Sessions, alongside one optional owned reflection. Neutral scheduled/recorded totals, individual session history, cancelled context, frozen Action/Goal/Milestone labels, date navigation, and current-week planning link. Focus remains the start/end surface.

**Invariants:** interpret each date in the User's current IANA timezone using local midnight → next local midnight, including 23/25-hour DST days. Allocate actual elapsed milliseconds by half-open interval intersection; sum before display rounding; include all outcomes without clipping to planned intervals. Past-day active contribution is fixed at midnight while today's is live. Cancelled blocks remain visible and do not count as scheduled time. No-session language records uncertainty rather than failure.

**Persistence:** additive `0010_daily_reflections.sql`, one unique owner/date, Draft → Finalized terminal note. Explicit Draft saves, optimistic versions, 4,000 Unicode code points, authoritative timestamps, unchanged owner-scoped receipts. Finalization requires a saved non-empty current-version note, disallows future dates and current-day contributing active sessions, permits forgotten past dates. Receipt → owner → reflection locking serializes Focus start/end with finalization. Reads use a read-only repeatable-read transaction and have no receipts. No execution snapshots stored in the reflection.

**Gate:** all 37 cases, prior/new domain/service, real PostgreSQL, browser, actual production-process Draft/replay restart proofs, lint/types/docs/build, permitted audit and simulated-day product walkthrough. See [report](phase-six-b-report.md) and [ADR 017](decisions/017-daily-execution-and-reflections.md).

**Excluded:** weekly review/rollover, scores/percentages/streaks, AI, calendar writes, automatic amendments or completion, corrections/reopen/delete, rich text/tags/search/attachments, generic journals or analytics. Older roadmap correction/gap/snapshot proposals are superseded for this slice.

## Earlier Phase 7A proposal — superseded by the approved contract below

Use original immutable baseline, ordered Amendments, current commitment budgets, scheduled TimeBlocks, Focus actuals, Daily Reflections and explicit Action states to answer original intent, changes, attention and unfinished work. Keep effort separate from deliverable completion and show frozen lineage. Handle week-boundary allocation explicitly while retaining source sessions.

Rollover must be a user-selected carry/defer/drop decision reviewed with fresh next-week budgets and versions. Creation of destination commitments is owner-scoped, atomic and idempotent, with explicit predecessor lineage and no edits to the original week. Never automatically carry every unfinished item. First settle completed/archived source eligibility, destination Draft merging and duplicate rollover semantics in an acceptance contract. No AI in the first weekly review. This is a recommendation, not implementation authorization.

### Phase 6B actual result — 3 October 2026

All 37 acceptance cases pass. Final full gate: **327 domain/service + 241 real PostgreSQL + 92 browser/HTTP = 660 tests**; lint/typecheck/docs/production build and five production restart scripts (ten persistence cycles) pass. Two disposable simulated-day product walkthroughs confirm **4h scheduled / 2h recorded**, completed/partial/abandoned work, unrecorded/cancelled blocks, durable Draft and deliberate terminal text. Offline cached audit reports zero vulnerabilities; no fresh registry audit is claimed. All prior SQL hashes match the existing ledger; only 0010 is applied locally, and the normal app is restarted/healthy. See [Phase 6B report](phase-six-b-report.md). Stop here; Phase 7A remains a proposal only.

## Phase 7A — Weekly Review and Deliberate Rollover

Finished committed User-local weeks support one owned explicit-save Draft → terminal WeeklyReview. Derive every logical commitment ever present in the baseline/ordered Amendments, original/final summaries, independent scheduled and exact week-intersected Focus actuals, and daily reflection context. Seven-date finalized context uses DailyReflection.finalizedAt <= WeeklyReview.finalizedAt; later finalized daily text is excluded without copying bodies. Action lifecycle remains authoritative, with no scores or inferred completion.

Explicit Carry needs a fresh 1–10,080-minute proposal, Defer keeps work ordinarily available, Drop intentionally archives via the existing Action transition during atomic review finalization. Revalidate all inspected Action/parent guards; any conflict/failure rolls back Review, Drops and receipt. Finalized Carry is intent only: following-week Planning explicitly adds eligible work through the existing Draft-save transaction with owned review/decision proof, a fresh new-week identity and editable chosen budget. No automatic Plan, Amendment or rollover. [ADR 018](decisions/018-weekly-review-and-deliberate-rollover.md) is authoritative; [Phase 7A report](phase-seven-a-report.md) records verification. Stop after this slice and run a real full-week dogfood gate before choosing features.

All 65 acceptance cases are covered. Final full gate: **349 domain/service + 263 real PostgreSQL + 99 browser/HTTP = 711 tests**, including all prior coverage; lint, typecheck, documentation checks, optimized production build and six actual production restart proofs (twelve persistence stop/start cycles) pass. Disposable desktop and narrow-screen review walkthroughs cover two Amendments, dropped/added commitments, independent **6h original / 5h15 final / 4h scheduled / 1h46 recorded**, daily context, durable Draft, confirmed Drop, terminal review and explicit **90m proposed → 75m chosen** next-week Carry with a new identity. Historical planning/execution/daily and non-Drop source bytes remain unchanged. Offline cached audit reports zero vulnerabilities; no fresh registry audit is claimed. Prior eleven migration hashes match the local ledger; only additive 0011 is applied, and the normal production app is healthy on port 3100. The largest observed friction is page length and repeated context; validate it during a real full week before authorizing polish, placement suggestions, AI or integrations. Real Google OAuth/CalendarList/FreeBusy/refresh/reconnect/disconnect remains unverified and is a hard gate for any Calendar writes.

## UI redesign track

The user-authorized Settings reference refinement is implemented on the existing domain. Availability, Calendar integration controls and a read-only Account view share the new settings shell. See [Settings refinement](ui-settings-report.md). Reserve remains per-week planning; Focus/Notifications preferences and unsupported provider connections are not added by this visual pass.

The completed Phase 0–7A domain is the foundation. Redesign slices change presentation and interaction composition; they do not authorize new domain features.

1. **R1 — Calendar-First Workspace:** `/calendar` becomes home, effective work/calendar/context canvas, simplified shell, original guarded block editor, responsive day view and explicit Focus entry. See [R1 completion report](ui-redesign-r1-report.md) and [reference-aligned refinement](ui-redesign-r1-refinement-report.md). R1 is complete.
2. **R2 — implemented:** Goal-to-Week presentation, compact capture/edit, direct eligible Action addition to current/future Drafts with explicit budgets, deliberate source-review/conflict recovery, immediate Calendar Draft work and return-to-calendar navigation. Immutable history and mutation guards preserved. See [R2 report](ui-redesign-r2-report.md). The later visual reference refinement is recorded in [workspace tabs](ui-workspace-tabs-report.md).
3. **R3 — implemented:** chronological Focus launchpad, reduced full-height active shell, authoritative elapsed timer, transient scratch-to-end-note handoff and compact completion acknowledgment. Existing Phase 6A lifecycle and persistence invariants remain unchanged. See [R3 report](ui-redesign-r3-report.md) for exact verification, responsive screenshots and manual QA.
4. **R4 — implemented:** concise Daily/Weekly summaries, direct rollover choices with fresh Carry budgets, prominent reflections and collapsed complete evidence. Existing Phase 6B/7A commands and persistence semantics are preserved. Verified with 353 domain/service, 263 PostgreSQL and 18 affected browser tests, Daily/Weekly production restart proofs and responsive manual QA. See [R4 report](ui-redesign-r4-report.md).
5. **R5A — implemented:** owned Focus Cycles, deliberate activation/finish/archive, selected Goals, Current Focus overview, secondary outside work and frozen past context. Additive migration 0012; independent from Goal/plan/execution lifecycle. See [R5A report](ui-redesign-r5a-report.md) and [ADR 019](decisions/019-focus-cycles.md).
6. **R5B — implemented:** optional AI coaching over Current Focus and deterministic planning/execution evidence. Grounded recommendations are previewed and explicitly accepted through existing deterministic services. See the R5B section below.

Focus Cycles and optional proposal-based coaching are implemented in R5A/R5B. Scores, automatic scheduling, drag-and-drop, Google writes and execution automations remain deferred; require separate explicit scope.

## R5B: AI Coaching + Explicit Recommendation Proposals

Optional OpenAI Responses / Anthropic Messages adapters, purpose-specific owned evidence, strict grounded proposals, deterministic preview, existing scheduling acceptance, minimal idempotent runs and fingerprint staleness are implemented. Privacy/ownership/failures are exercised with fake providers and actual SDK HTTP fixtures; live model QA remains conditional on credentials. Stop at this slice. [ADR 020](decisions/020-ai-coaching-proposals.md) and [completion report](ui-redesign-r5b-report.md) record the final design and exact checks.

Final verification: **409 domain/service + 287 PostgreSQL + 144 browser/HTTP = 840 tests**, plus **6 coaching browser cases repeated with Anthropic**. Lint, typecheck, docs, production build, schema generation with no drift and all seven production restart scripts pass. Prior thirteen SQL hashes match the ledger; only additive 0013 is applied, and the updated normal app is healthy on port 3100. Exact synthetic models are `fixture-openai` and `fixture-claude`; neither real API key is configured, so live provider quality/compatibility QA remains unverified. No further AI phase is started.
