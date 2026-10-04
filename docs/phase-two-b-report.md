# Phase 2B completion report — Goal-Aligned Actions

Date: 2 October 2026. Scope: latest Phase 2B brief only. Phases 0/1/2A remain supported. Weekly planning is proposed only.

## Implemented scope and schema

Concrete executable work beneath Goal detail: create/edit/reassign/complete/archive Actions, explanatory empty state, primary Open view, compact Completed/Archived history, reload persistence and original-result retries. No standalone/inbox work. This supersedes tentative optional-Goal proposals; operational/unaligned work must be justified by observed usage before a future slice.

`action`: UUID id; server-supplied text owner_id; required immutable UUID goal_id; optional UUID milestone_id; required title; optional done_when and estimate_minutes; state; version; created_at/updated_at/completed_at/archived_at timestamptz. Required title 1–160 and optional done condition up to 2,000 trimmed Unicode code points; well-formed Unicode/no NUL. Blank/absent doneWhen normalizes to null; absent/null estimate and association remain null. Estimate bounds 1–10,080 whole minutes provide a simple sanity ceiling, not a weekly allowance. String/fractional/negative/zero/excessive estimates fail with field feedback.

Every Action belongs to exactly one owned Goal. The Goal cannot move. Optional milestone assignment/reassignment/detachment requires an active owned same-Goal milestone or null, while the Action is effectively mutable. Composite FK `(owner_id, goal_id)` references Goal; `(owner_id, goal_id, milestone_id)` references Milestone’s new unique identity index. Restrictive deletion preserves referenced parents. Lifecycle/version/field/instant checks and an owner/Goal/state/created/id index enforce practical persistence integrity.

Additive migration: [0003_goal_aligned_actions.sql](../src/db/migrations/0003_goal_aligned_actions.sql). Its Milestone unique index precedes the FK that needs it. Drizzle snapshot/journal are updated. No preceding migration SQL changed; SHA-256 verification covers 0000/0001/0002. Migration application is repeatable and all tests reconstruct a clean real PostgreSQL schema without push/SQLite. No dependencies added.

## Lifecycle, parent terminal behavior and estimate semantics

Open→Completed or Open→Archived are the only transitions. Both terminal states retain identity, definition, association, estimates, creation and terminal instants. No edit/reopen/restore/cross-transition/hard-delete. Completion requires the observed version, records completedAt, increments once and asks for no evidence.

The central domain `actionMutability` permits changes only for Open + active Goal + no milestone/active milestone. Archived Goal and Completed/Archived Milestone transitions **leave every Action row/state/estimate unchanged**. Existing Open work may remain Open as read-only history. A terminal milestone’s Open Action cannot detach/reassign to evade history. New assignments to terminal milestones fail; new Actions beneath archived Goals fail. Action completion never changes parent state/version/progress.

Estimate is the current effort estimate only. Edits may explicitly replace or clear it; completion/archive/parent transitions preserve it. No commitment, schedule, actual-minute, focus or percentage fields or aggregation are introduced.

## Concurrency, receipts and ownership

All commands reuse the Phase 1 receipt transaction. Only the result DTO union extends to Action; no second framework/table. New `action.create/edit/complete/archive` hash kinds bind normalized fields, immutable target, association and observed version. Existing Goal/Milestone kinds/hashes/results remain unchanged. Owner + mutation UUID identifies the command. Successful identical replay returns its **original snapshot**, even after edits, completion, parent terminal transitions and process restart. Changed logical payload/target/version/kind/aggregate with that UUID fails `CONFLICT/MUTATION_ID`. Failed transactions persist neither receipt nor partial Action.

Lock order: receipt → owned Goal → current/destination Milestones in sorted UUID order → Action. All existing Goal/Milestone writers already acquire that Goal lock. After obtaining it, Action service re-reads the current association, locks same-Goal milestones and the Action, checks the observed version and effective mutability, then atomically replaces. Parent versions are untouched. Distinct concurrent edits/transitions/reassignments have exactly one winner and a typed VERSION conflict with the owner’s current snapshot. Parent races serialize; no post-terminal escape/write. Goal-wide serialization favors correctness over unrelated-action throughput in this personal slice.

Every transport resolves the actor from a signed, DB-validated session. Repository predicates scope owner, Goal and Milestone. Browser owner/Goal-move fields are rejected. Foreign and missing resources give the same safe unavailable result without snapshots. Receipts are separately namespaced by owner; matching UUIDs across users create separate results. API responses are private/no-store, POST/PATCH enforce exact origin and existing JSON limits. React receives owned DTOs without owner identity. Catalog reads use one repeatable-read, read-only snapshot to keep parent states, child rows, selectors and mutability consistent.

## UI and useful drafts

Goal outcome remains above Milestones and Actions. Concrete Action language and examples distinguish executable work from observable outcome checkpoints. Optional doneWhen/estimate/active milestone keep a title-only capture quick. The effort label expressly distinguishes estimates from time commitments. Empty state asks for a small useful pool. There is no generic dashboard, inbox, ordering, kanban or backlog scoring.

Server-derived mutability controls visible actions. Milestone changes refresh Action context immediately. Independent `view` and `actionView` URL parameters survive each other and reload. History shows definition, optional finish condition/estimate, milestone context and terminal timestamp in account timezone; no controls on terminal records. Open historical Actions explain their terminal parent. Completion uses a lightweight confirmation with initial Cancel focus; archive confirms and states no restore.

Errors keep entered fields. VERSION conflicts require explicitly loading/reviewing the latest saved definition/estimate/association before a new command with its latest version; drafts are retained. Terminal races keep drafts blocked for review. Lost acknowledgements lock fields/cancel and retain the exact command for Retry same change; successful retries increment once. Known limitation: drafts/command IDs live in the open dialog, not durable local storage; after closing/reloading an uncertain create, inspect saved work before another create. Reads fail explicitly instead of presenting an empty list.

## Acceptance evidence

All 28 brief acceptance cases pass. The table maps each to the final automated and manual evidence.

| Brief case | Evidence |
| --- | --- |
| 1 Empty state | Browser goal-detail explanatory Action state |
| 2 Goal-linked create | Domain/service/PG + title-only browser capture |
| 3 Milestone-linked create | PG/browser optional active exact-Goal link |
| 4 No standalone | Service invalid Goal, PG non-null FK, HTTP no generic create route |
| 5 Invalid milestone | PG cross-Goal/foreign/missing/Completed/Archived assignment; domain destination validation |
| 6 Validation | Domain code-point/malformed/bounds checks, PG/HTTP field validation, browser feedback |
| 7 Idempotent create | Five simultaneous PG retries; browser lost acknowledgement |
| 8 Reload persistence | Main browser flow and history reload |
| 9 Process restart | Real production stop/start twice, same DB session and all Action states |
| 10 Edit | Browser/PG edit, exact version increment, immutable Goal/creation |
| 11 Reassign | Domain/PG A→null→B and A→B; browser link change |
| 12 Cross-Goal reassignment | Exact-Goal FK and scoped service/PG checks |
| 13 Idempotent edit | Concurrent PG duplicates and lost-ack browser retry |
| 14 Edit conflict | PG distinct-ID race; browser useful draft review |
| 15 Complete | Browser intentional confirm and Completed history; PG timestamps |
| 16 Idempotent complete | PG duplicate/replay, browser lost ack, restart replay |
| 17 Completion conflict | PG edit/reassign vs completion and stale terminal versions |
| 18 Completed immutability | Domain/PG edit/reassign/cross-transition blocked; history controls absent |
| 19 Archive | Browser confirm/cancel/archive/history, retained PG row |
| 20 Idempotent archive | PG duplicate/replay, browser lost ack, restart replay |
| 21 Archive conflict | PG edit/archive and complete/archive one-winner races |
| 22 Archived immutability | Domain/PG no edit/reassign/cross-transition; history controls absent |
| 23 Archived Goal | Exact PG before/after Action rows; browser readonly/draft race; restart history |
| 24 Completed milestone | Exact unchanged all-state PG rows, no detach/reassign escape, browser immediate readonly |
| 25 Archived milestone | Same exact-row PG assertions, selectors and browser readonly |
| 26 Ownership | PG all operations, HTTP two-owner and anonymous surface tests |
| 27 Command isolation | PG same UUID separate owners and aggregate/kind mismatch |
| 28 Estimate meaning | Domain/PG preserved values; schema absence of commitment/actual fields; restart checks |

Tests: [domain](../tests/domain/actions.test.ts), [service](../tests/services/actions.test.ts), [PostgreSQL](../tests/db/actions.test.ts), [browser/HTTP](../tests/e2e/actions.spec.ts), [restart proof](../scripts/prove-restart.ts). Prior tests remain; only required Action-first FK fixture cleanup and the migration-created table expectation changed.

## Verification and manual UX

Final `npm run check`: **PASS** (exit 0). All prior tests retained: **55 domain/service** (38 prior + 17 Action), **81 real PostgreSQL** (42 prior + 39 Action), **27 Chromium/HTTP** (20 prior + 7 Action) = **163 tests passed**. No unhandled rejection errors. The browser regression holds an older Action read while a Milestone completion supplies newer context; it proves no stuck loading or stale controls. Documentation check, lint with zero warnings, TypeScript, optimized Next production build and actual process-restart proof all pass. Build compiles the new Action routes and Goal detail; no new planning routes/tables.

Production restart proof stops/starts the owned application process twice against real PostgreSQL, retains the verified User/session and Goal, preserves Goal identity/archive history and all three Milestone/Action states, associations, finish conditions and estimates, and replays all four Action receipts as original snapshots beneath terminal parents. It also verifies all Action reads/mutations return explicit 503 with an unavailable database. This is a real production-process/DB test, not an in-memory mock or browser reload substitute.

`npm audit --json` against the configured public registry: **0 vulnerabilities** (info/low/moderate/high/critical all zero). Lock/dependencies unchanged. Local `npm run db:migrate` applied the additive migration. SHA-256 verification: all three previous SQL files unchanged. Clean isolated PostgreSQL migrations and repeat application pass. Hosted GitHub CI has not been run; local identical checks are the evidence.

Normal-account manual production walkthrough: created a dedicated “Phase 2B walkthrough — clear next moves” Goal and observable milestone; title-only Goal Action; milestone-linked Action with doneWhen/45-minute estimate; reload/edit to 90 minutes; detach/reassign; intentional completion without evidence; confirmed archive; retained timestamps and definition/context/estimate after reload. Created one linked Open Action with a 15-minute estimate, completed its milestone, observed unchanged Open state/estimate and immediate readonly explanation; verified the completed milestone disappeared from new assignment choices. Created a Goal-only Open Action with a 30-minute estimate, archived the walkthrough Goal, and verified both Open records plus Completed/Archived history remained accessible and readonly after reload. The pre-existing “Read more books” Goal was left unchanged. The walkthrough remains in Archived for inspection.

| UX question | Finding |
| --- | --- |
| Action more concrete than milestone? | Verb-based pieces of work versus declared observable success; completion asks for work done without milestone evidence. |
| Goal behind the work? | Goal outcome stays above both sections; editor repeats Goal context; no detached task surface. |
| Optional doneWhen without friction? | Title-only capture succeeds; the linked interview’s finish condition clarifies its scope. |
| Estimate clearly an estimate? | Editor says current effort, not commitment; cards say Effort estimate; 90 minutes remains 1h 30m in history. |
| Finite useful pool? | Empty state and introduction ask for a few clear next moves; no inbox/backlog accumulation conventions. |
| Hierarchy understandable? | Outcome → observable Milestones → concrete Actions, with optional milestone contextual metadata and independent history views. |
| Unnecessary task-manager features? | No kanban, ordering, scores, dates, tags, bulk tools or other unauthorized controls. |

Responsive/keyboard/plain-text/error checks pass at 390px in Chromium. Manual production screenshot verifies the normal-account hierarchy/history. First test-run fixture cleanup/rejection handling and an early archive-reload assertion were corrected; final gate is clean. Final review also corrected the context-refresh loader race and added the seventh browser regression test. No product behavior was removed or scope expanded.

## Deviations, limitations and deferred ideas

No scope deviation. The previously tentative standalone decision is explicitly resolved against standalone Actions as requested. Estimates use the documented 10,080-minute bound. Edits replace all four editable fields; omission clears optional values, matching the full editor command rather than implicit partial patch semantics. Context reads use a small repeatable-read transaction; no new generalized infrastructure. Direct operator SQL can bypass application lifecycle policy; schema enforces practical relationships/shape, and normal writes exclusively use domain services.

Local loopback deployment only; hosted CI, HTTPS/production hardening, backup/least-privilege operational rollout and wider accessibility testing remain separate work. Receipt retention remains indefinite and dialog drafts are transient. Terminal work has no reopen/restore, parent moves or hard delete. Old receipts return historical results intentionally; UI refreshes current lists after acknowledgements. A large action pool has no pagination/filtering beyond state; validate real use before expanding it.

Deliberately deferred: all weekly planning/commitments, availability scheduling/Calendar, actuals/focus, dates/priorities/ranking/AI, inbox/unaligned work, recurrence/subtasks/checklists/tags/dependencies/kanban/ordering/bulk tools/templates, integrations and automatic progress. Observe actual friction before adding those.

## Exact Phase 3 proposal — no implementation

**3A Weekly commitments:** explicitly select effectively mutable Goal-aligned Actions for a pinned-timezone Monday-based week; provide a concrete weekly deliverable and independent positive commitment effort budget. One Action per week; no automatic inclusion/rollover. Persist selected work and deferral choices, with planning-time title/Goal/Milestone/estimate snapshots. Changing an Action later must not rewrite a commitment snapshot.

**3B Provisional capacity:** manual weekly working windows, breaks, reserve and daily focus caps; deterministic capacity arithmetic and clear over-budget feedback. Mark capacity provisional without Calendar data. Keep Action estimates distinct from weekly budget allocations; no calendar placement or claims of known free time.

**3C Commit and amend:** explicit draft→active (committed) plan, observed versions, owner-scoped retry receipts, immutable first committed baseline, subsequent revision snapshots and deliberate deferral/amendment without altering the baseline. Pin planning timezone and define week identity before coding.

Acceptance proposal: choose a real week in under 15 minutes; 15h capacity/18h budget shows +3h; deferral updates allocation while retaining original commitment baseline; unselected Actions stay outside the week; source edits and timezone changes cannot silently rekey/rewrite history; isolated ownership, one-winner concurrent amendments, idempotent commits and reload/process-restart persistence. Dates on Actions, calendar OAuth/scheduling, focus/actuals, AI, automatic ranking or rollover remain excluded. This proposal needs a separate explicit Phase 3 brief and authorization.
