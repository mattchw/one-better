# Phase 7A — Weekly Review and Deliberate Rollover

Completed and verified on 3 October 2026. **711 tests passed**, all previous regression coverage remains green, and the local production app is healthy on port 3100. Only Phase 7A was implemented. [ADR 018](decisions/018-weekly-review-and-deliberate-rollover.md) records the decisions. Stop here and use the full deterministic loop for a real week before selecting another feature.

## Delivered interaction

Weekly Review is available from the existing app navigation at /review. It defaults to the most recently finished committed week; /review?week=YYYY-MM-DD selects a Monday. Finished committed weeks are navigable. Current/future weeks explain that the week is unfinished; missing or never-committed weeks explain that there was no committed plan. Read-only page loads do not create a Review or fabricate a baseline.

Inspect original intent, ordered Amendment reasons/full snapshots, final planning totals, scheduled versus recorded focus, seven daily-reflection states and every logical commitment that appeared. Write one weekly note, choose Carry/Defer/Drop for every still-actionable commitment, and explicitly save a durable Draft. Reload restores the note, choices and budgets. Finish opens a confirmation containing the original/final facts, changes, execution, daily context, note and all decisions. Drop requires a separate archival confirmation. Finalization is terminal; the page shows the frozen note/decisions and a following-week Planning link.

## Model and migration

Additive [0011_weekly_reviews.sql](../src/db/migrations/0011_weekly_reviews.sql) adds exactly two tables, bringing the public application/auth table count to 22. All eleven previous migration files are unchanged and their SHA-256 hashes matched the normal database ledger before applying only 0011. The local ledger now contains twelve migrations. Clean-database and repeat migration execution passed in PostgreSQL tests and production restart proofs.

| Table | Stored state | Integrity |
| --- | --- | --- |
| weekly_review | UUID, owner, Plan, draft/finalized status, note, version, createdAt, updatedAt, nullable finalizedAt | Owned Plan FK; one Review per owner/Plan; bounded note, lifecycle/time checks; immutable identity and terminal UPDATE trigger |
| weekly_review_decision | Owner, Plan, Review, logical commitment, Action, carry/defer/drop kind, nullable proposed budget, inspected source guards | Review/logical identity/Action ownership FKs; Review + logical ID primary key; kind/budget/source-shape checks; child INSERT/UPDATE only while parent is Draft |

Decisions retain inspected Action/Goal/Milestone identities and versions for deliberate concurrency review. Stable historical labels, outcome and finish condition derive from existing immutable baseline/Amendment context. There is no new planning snapshot, execution snapshot, carry-application table or predecessor column on historical commitments. Focused SQL triggers protect lifecycle writes. There is no product DELETE, reopen or correction route; privileged fixture/administrative deletion remains outside the product lifecycle.

Notes allow up to 4,000 Unicode characters; Draft notes may be empty, final notes may not. Carry budgets are integer minutes from 1 to 10,080. Strict full-state commands allow up to 500 distinct logical decisions and use the existing 32 KiB HTTP body limit.

## Commitment-history derivation

Pure derivation processes the original committed baseline followed by all Amendments sorted by sequence. A map keyed by logical commitment ID retains the frozen first context, baseline-versus-Amendment origin, first sequence/timestamp/budget, latest budget before removal or final plan, dropped status and final membership. Rows sort deterministically by first sequence, frozen title and logical identity.

Removed commitments remain visible and still require a decision if their source is actionable. Re-adding the same Action creates a different logical lineage, so both histories retain their own scheduled/actual evidence. Multiple lineages of one Action must choose the same decision kind; Drop archives that Action once. Multiple Carry proposals may have different budgets, but the Action may enter the destination Plan only once.

## Planning, schedule and execution facts

Original capacity/reserve/commitment totals come from the existing baseline; final values come from the existing last Effective Plan. All Amendment reasons remain visible. Nothing reconstructs an alternative planning snapshot or modifies an earlier budget.

Scheduled focus sums the full elapsed duration of owned, planned TimeBlocks belonging to the reviewed Plan's logical histories. Cancelled intervals remain explanatory context and contribute zero scheduled duration. This follows Plan ownership; it is distinct from local-week allocation of actual effort.

Recorded focus sums exact elapsed milliseconds intersected with current User IANA local Monday 00:00 through the following Monday 00:00. Local dates advance through the existing Temporal-based day arithmetic, never a fixed 168-hour addition. London DST weeks of 167, 168 and 169 elapsed hours are tested. A Sunday 23:40–Monday 00:25 session contributes 20 minutes to the ending week and 25 to the following week. Completed, partial and abandoned outcomes all contribute actual elapsed effort; no clipping to scheduled block intervals, estimate-based cap or inferred Action completion occurs.

An active session crossing the ending boundary contributes a fixed amount to the finished week and does not block review finalization. A previous Plan's session continuing into this week appears as separate execution context and contributes to the weekly total while keeping its original logical identity. It is not manufactured into a current-week commitment or rollover obligation.

The UI keeps budget, scheduled time and recorded focus independent. Explicit Action lifecycle is authoritative. Zero-session scheduled work says “No focus session recorded”; there is no score, percentage grade, red/green week, utilisation target or success/failure inference.

## Daily Reflection cutoff

Derive the seven local dates in the week. A Draft Weekly Review can indicate unfinished Daily Reflection drafts without treating their text as finalized evidence. Missing/unfinalized dates have explicit neutral states.

After Weekly Review finalization, include Daily Reflection text only when it is finalized and DailyReflection.finalizedAt <= WeeklyReview.finalizedAt. Finalized daily text is already immutable, so the timestamp cutoff preserves what the Review considered without copying seven bodies. A real PostgreSQL test finalizes Friday's Draft after the Weekly Review and proves it remains excluded. Equality at the cutoff is covered by pure-domain tests. The finalized page displays the cutoff timestamp.

## Carry, Defer and Drop

An Open owned Action under an Active Goal and either no Milestone or an Active Milestone requires a decision, including work removed midweek. Completed/Archived/effectively historical sources show their terminal context and need no decision. Finalized rows without a recorded choice also explain their current terminal source context, rather than only saying no rollover is required; this remains explicitly current context, not a new lifecycle snapshot.

- **Carry:** an explicit proposal for the following week. The first proposed budget input starts blank; the prior latest budget is visual context only. Saving/finalizing Carry changes no source estimate, prior budget, schedule, actuals or next-week Plan.
- **Defer:** keep the Action Open with its estimate unchanged. It receives no special insertion and remains an ordinary eligible candidate in future planning.
- **Drop:** archive the underlying Action on successful Review finalization. The row and confirmation explicitly state that archived Actions currently cannot be restored. A separate checkbox must confirm the identified Drop Actions.

Save/finalize validate every chosen decision's current source eligibility, identities, relationships and versions. Source edits, completion, archival or terminal parent changes require explicit review of the changed context; stale Carry, Defer and Drop intentions do not silently finalize.

## Atomic finalization and concurrency

Reuse the existing owner-scoped receipt transaction and lock conventions: receipt, User NO KEY UPDATE, owned Review/Plan, sorted Goals, sorted current Milestones, then sorted Actions. The User lock stabilizes timezone and serializes relevant owner writes; source locks protect inspected source relationships and eligibility. All source guards and all required decisions validate before any archival.

Drop calls the existing Action domain archive transition and extracted existing repository persistence inside this transaction. No second archive lifecycle was invented. Deduplicate Drop targets by Action. Replace Draft decisions, archive valid Actions, freeze the note/children, advance Review version, set authoritative finalizedAt and store the original result receipt atomically. A conflict or failure rolls everything back. An injected SQL failure after archival proves the Action, Review, children and missing receipt all roll back before a successful retry.

Real PostgreSQL races cover two Draft saves, save/decision changes versus finalization, and Action edit versus finalization. Exactly one matching version wins; the resulting source/review state is consistent. Independent tests cover stale edits/completion/archive, Goal archival and Milestone completion. Immutable SQL UPDATE/child UPDATE attempts and service reopen/edit attempts fail after finalization.

Browser conflicts retain attempted note and decisions. Adopting current Review/source context is explicit and does not erase the attempted note. Newly terminal work requires removing the stale decision before resaving. Unsaved week navigation is guarded; no keystroke autosave. An uncertain command disables dependent changes and offers retry of its exact original mutation ID/body, then reads current truth.

## Idempotency and restart evidence

Review Draft saves and finalization hash normalized semantic commands using the existing owner/UUID receipt namespace. Matching receipt replay precedes lifecycle, version and source checks. Changed semantics with a reused ID conflict; the same UUID under another owner is independent.

The new production restart proof performs two real process stop/start cycles. A Draft note and three decisions survive the first restart and browser reload. Create/edit/finalize original results replay after the second restart. The database contains one finalized Review, three decisions and three Review receipts. Drop stays at its original archival timestamp/version with no repeated archival; Carry/Defer Actions and historical planning/execution/daily rows remain byte-for-byte unchanged. No next Plan was created. All five Weekly Review HTTP surfaces return safe 503 errors when PostgreSQL is unavailable. Browser tests also deliberately lose save and finalization acknowledgements, then retry exactly.

## Explicit next-week handoff

The immediately following local week shows finalized Carry intents with frozen Goal/Milestone/Action context, prior latest budget and saved proposal. If no Draft exists, the user creates it explicitly first. Add lets the user edit the chosen budget, then uses the existing ordinary Weekly Plan Draft-save command with optional owned Review/logical-decision proof. The transaction validates that the proof belongs to this owner, is finalized Carry for the previous week, and refers to the selected Action. Normal locked fresh source validation follows.

The destination receives its own new logical commitment ID and normal eventual committed snapshot. Its actual budget can differ from the Review proposal. Already-present Action membership is derived and shown as already included; there is no duplicate or application ledger. Committed destinations offer existing manual Planning/Amendment workflow without creating an Amendment. Ineligible sources display the specified changed/unavailable message while preserving historical intent. Deferred work remains an ordinary candidate. Old ordinary Plan-save receipt hashes remain unchanged when optional Carry proof is absent; all prior planning replay proofs pass.

The disposable manual proof confirmed **150 minutes prior latest budget → 90 minutes Review proposal → explicit 75 minutes next-week chosen budget**, a new logical identity, and unchanged original Review/Plan/Amendment/TimeBlock/Focus/Daily/non-Drop source rows.

## Ownership and transport

Ownership is derived solely from the authenticated actor. All projections, child reads, Plan/source queries and mutations are scoped to that actor. Composite FKs preserve owned relationships. Foreign and missing Review IDs have indistinguishable errors; forged foreign Drop lineage and Carry proof are rejected. User B cannot read A's facts/decisions, save/finalize A's Review, archive A's Action or apply A's Carry. Shared mutation UUIDs across owners remain independent.

Use existing authentication, Origin checking, strict payloads, safe errors and private no-store responses. Unsupported DELETE/reopen routes remain absent. Derived reads use coherent read-only repeatable-read transactions without receipts or provider calls.

## Exact verification

The complete npm run check exited **0**, including every previous test. Evidence log: `.cache/phase7a-check.log` (ignored local artifact). A final presentation-only adjustment adds the terminal-source explanation to finalized rows; all seven affected browser tests, lint/typecheck, a fresh production build and the Weekly Review restart proof passed again afterward. No domain/database mutation changed. Follow-up evidence: `.cache/phase7a-final-ui.log` (ignored local artifact). These logs are unavailable in clean checkouts.

| Gate | Final result |
| --- | --- |
| Documentation required files, relative links and Markdown fences | PASS |
| ESLint, zero warnings allowed | PASS |
| TypeScript, no emit | PASS |
| Domain/service/provider tests | **349 passed, 25 files, 900 ms**; 22 new Phase 7A cases |
| Real PostgreSQL tests | **263 passed, 12 files, 26.84 s**; 22 new Phase 7A cases |
| Chromium browser/HTTP tests | **99 passed, 3.1 min**, including 7 new Phase 7A tests; no failing tests or retries |
| Optimized production build | PASS in complete gate (1,690 ms compile / 2.8 s TypeScript / 102 ms generation) and final UI follow-up (**2.4 s compile / 2.7 s TypeScript / 8/8 pages in 123 ms**) |
| Six production restart scripts | PASS; twelve persistence stop/start cycles across existing foundation/Calendar/scheduling/Focus/daily and new weekly proof, plus unavailable-DB probes |
| Final terminal-source UI follow-up | PASS; all **7 affected browser tests in 16.3 s**, lint/typecheck/build, and two more Weekly Review persistence restart cycles |
| Disposable manual desktop review/handoff | PASS; final DB assertions verified archive/new identity/history independence; disposable app/database cleaned |
| Narrow-screen review/keyboard/conflict behavior | PASS; 390 px screenshot inspected, no horizontal overflow; Escape/cancel and navigation guard tested |
| Normal local additive migration and production health | PASS; 11 old hashes match, only 0011 applied, twelve ledger entries, health returns ready on port 3100 |

Test runners emit their existing NO_COLOR/FORCE_COLOR environment warning; lint itself has no warnings. No dependencies or lockfile were changed for Phase 7A.

Dependency audit: allowed **npm audit --offline --json** reports zero vulnerabilities at all severities across 646 dependency entries in the cached advisory result. Evidence: `.cache/phase7a-audit-offline.json` (ignored local artifact, unavailable in clean checkouts). This is a cached/offline result, not a fresh registry advisory lookup. The earlier online attempt was rejected by automatic approval review; no fresh lookup or network bypass was attempted for this phase.

## Acceptance evidence — all 65 cases

Evidence key: D = [pure domain tests](../tests/domain/weekly-reviews.test.ts); S = [service tests](../tests/services/weekly-reviews.test.ts); P = [real PostgreSQL tests](../tests/db/weekly-reviews.test.ts); B = [browser/HTTP tests](../tests/e2e/weekly-reviews.spec.ts); R = [actual restart proof](../scripts/prove-weekly-review-restart.ts); M = [disposable manual proof](../scripts/weekly-review-walkthrough.ts) and screenshots below. Ranges are inclusive and cover every supplied acceptance case.

| Cases | Verified behavior | Evidence |
| --- | --- | --- |
| 1–5 | Finished committed Draft creation; reject current/future; missing/uncommitted useful state; one owned Review/Plan | D, P, B |
| 6–11 | Exact original/final summaries; two reasons; removed and added histories retained; earlier budgets untouched | D, P, B, M |
| 12–13 | Planned blocks summed; cancelled context excluded from scheduled total | D, P, B, M |
| 14–16 | Exact local-week intersections, cross-week clipping, abandoned effort included | D, P |
| 17–18 | Neutral unrecorded wording and independent facts without grades | B, M |
| 19–21 | Seven dates, finalized/missing/unfinished states; later daily finalization excluded | D, P, B, M |
| 22–26 | Durable note/decisions, reload/restart, stale Draft cannot overwrite | P, B, R, M |
| 27–29 | Required choices for every actionable lineage, including midweek removal; terminal work needs none | D, P, B |
| 30–32 | Positive explicit fresh Carry budget; sources/history unchanged; no automatic destination Plan | D, S, P, B, R, M |
| 33–36 | Following-week context, explicit normal Draft add, new identity, independently edited budget | P, B, M |
| 37–39 | Already included prevents duplicate; terminal source blocks add; committed destination gets no automatic Amendment | P, B |
| 40–42 | Defer leaves Action/estimate untouched, creates nothing, remains ordinary candidate | P, B, R, M |
| 43–46 | Disclosed/confirmed archival, valid atomic Drop, immutable historical Plan, source conflict rollback | S, P, B, R, M |
| 47–50 | Empty note/missing choice/invalid budget/source changes block finalization | D, S, P, B |
| 51–54 | Atomic terminal Review/decisions + Drops, original-result retry and restart without repeat effects | S, P, B, R |
| 55–60 | Baseline/Amendments/blocks/sessions/daily unchanged; Carry/Defer source bytes unchanged | P, B, R, M |
| 61–65 | Foreign reads/mutations/Carry/Drop blocked; owner-scoped receipt IDs | P, B |

Additional coverage proves active cross-week finalization, old-Plan continuation into the current weekly total, re-added same-Action lineages with one archive, SQL failure after archival, parent/source races, anonymous/Origin/cache/payload controls, unavailable PostgreSQL and keyboard/unsaved-navigation recovery.

## Manual product findings

Used a disposable simulated **week of 5 October**, not the normal user's data. The fixture has four histories (three original commitments, one removed midweek, one newly added and explicitly completed), two Amendments, planned/cancelled/unrecorded blocks, completed/partial/abandoned Focus outcomes, three finalized Daily Reflections and one unfinished draft. Its facts are **6h original budget / 5h15 final / 4h scheduled / 1h46 recorded**. A simulated server clock exposes a legitimately finished test week without permitting client-supplied production clock overrides.

The desktop interaction sequence took 31 seconds after opening the review: inspect a daily note, enter fresh 90-minute Carry, choose Defer/Drop, write/save the note, reload, inspect confirmation, confirm archival, reload read-only history, follow the next-week link, explicitly create an empty Draft, edit the proposed 90 to 75 and Add, then reload. This automated walkthrough is comfortably under five minutes for known fixture data; it does **not** establish a new human user's comprehension time. A real full-week dogfood is still required.

| Product question | Observed finding |
| --- | --- |
| Original intention versus final plan | Side-by-side summaries and first/latest row budgets distinguish them clearly. |
| What changed | Two visible reasons explain the capacity/reserve/budget changes without reconstructing snapshots; full snapshots can be expanded. |
| Scheduled versus actual | Independent factual figures and neutral zero-session copy are understandable; no grade is introduced. |
| Daily context | An expanded finalized daily note explains interruptions; unfinished text remains outside final evidence. |
| Carry/Defer/Drop | Native selectors and consequence copy make the choices clear; terminal work has no decision control. |
| Fresh Carry budget | Blank input forced a deliberate 90-minute choice instead of copying the old 150-minute value. |
| Drop consequence | Row warning, named Drop list and separate checkbox disclose archival and lack of restore. |
| Start next week | Direct link plus explicit Draft creation/Add starts a new plan without auto-filled commitments; 75-minute add keeps the old 90-minute proposal unchanged. |
| Verbosity | The page is long on a narrow screen; repeated Goal context and the confirmation's repeated evidence are the main friction. Native disclosures contain long snapshots/session/daily detail. |

The standalone test Planning page showed unavailable calendar advisory alongside a successful deliberate handoff. It did not block manual capacity or Carry. No live Google request was part of this walkthrough; this observation cannot verify real Calendar integration. Current-week shortcuts in the pre-existing Planning UI use wall-clock time while this disposable fixture advances only the guarded execution clock; the following-week link itself selects the correct explicit test week.

Visual evidence was saved locally at `.cache/visual/phase-seven-a-review.png` (finalized desktop review), `.cache/visual/phase-seven-a-handoff.png` (explicit next-week handoff), and `.cache/visual/phase-seven-a-narrow.png` (390px review). These ignored artifacts are unavailable in clean checkouts. The manual script asserts underlying rows before cleaning its own disposable database and server. The normal app now runs the verified build with the additive migration.

## Limitations and deferred features

- Finalized Weekly Reviews and Daily Reflections cannot be reopened, deleted or corrected through the product. Drop cannot currently be restored. Record actual correction/restore needs during dogfood.
- Saved Drafts are durable. Unsaved conflict text/choices live only in browser memory and are lost if the page/process is closed before saving; there is no keystroke autosave.
- Source guard checks are intentionally conservative: even an eligible source edit requires explicit context review and resave. Multiple historical lineages of one Action require a consistent decision kind.
- Read models derive current User-timezone week allocation and current source eligibility; there is no new frozen execution/timezone snapshot. An active cross-week contribution is fixed, but its later ended outcome can become visible in live execution context. Finalized note/decisions and daily cutoff remain fixed.
- TimeBlocks use full owned planned durations for scheduled totals; actuals use exact local-week elapsed intersections. The quantities measure different facts.
- Large histories are unpaginated, and the 500-decision/32 KiB command limits are practical upper bounds. No bulk analytics, charts or long-term trends were added.
- Offline cached audit is not fresh vulnerability verification. Real Google OAuth/list/FreeBusy/refresh/reconnect/disconnect remains unverified and nonblocking for this local slice.

No AI, coaching, judgment, automatic rollover/replanning, automatic next Plan/Amendment, completion inference, scheduling suggestions, Calendar writes or new integrations were implemented. Existing immutable history remains independent; only explicitly confirmed Drop changes source lifecycle.

## Next recommendation: real full-week dogfood gate

Use one real Monday–Sunday week through Goals/Actions, deliberate commitments, availability, local blocks, Focus, daily notes, amendments, Weekly Review and explicit next-week handoff. Record time to understand and finish the review, abandoned steps, missing evidence, stale-conflict recovery, correction needs and whether fresh Carry budgets improve planning. Pay particular attention to repeated context/page length and the repeated confirmation evidence. Do not choose a next feature solely because the architecture permits it.

Candidate later slices, subject to observed usage and separate authorization, are UX/hardening, deterministic placement suggestions, AI planning/review proposals, ingestion from Notion/Jira/GitHub, or Calendar writing. No candidate is selected or implemented here. Before any Calendar-writing work, independently complete real test-account OAuth, Calendar listing, actual FreeBusy, refresh/reconnect and disconnect/revocation. That hard gate remains outstanding.
