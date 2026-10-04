# Phase 3A — Weekly Planning and Immutable Baseline

Completed 2 October 2026. Implemented **Phase 3A only**. All 31 acceptance cases are covered. Phase 3B is proposed below; no amendments or later-phase functionality exist.

The deliberate loop is now Goal/Milestone/Action → choose week → protect capacity/reserve → choose Actions and explicit budgets → save Draft → review → commit the original baseline. The normal production preview is available at `http://127.0.0.1:3100/planning`.

## Models and persistence

`weekly_plan`: UUID identity; server-supplied owner; Monday `week_start_date` as PostgreSQL date; pinned IANA timezone; Draft/Committed state; provisional capacity minutes; reserve minutes; optimistic version; creation/update/commit timestamptz instants. Unique `(owner_id, week_start_date)` enforces one Plan per owner/week. `(owner_id,id)` is a composite owned reference target. State/time checks require a null commit time for Draft and a valid non-null time for Committed.

`weekly_commitment`: UUID identity; server-supplied owner; Plan ID; source Action ID; independent budget minutes; JSONB source identity/version guard; nullable JSONB planning snapshot; creation/update instants. Composite owned Plan and Action foreign keys use restrictive deletion. Unique `(owner_id,plan_id,action_id)` prevents duplicate Actions within a week. The same Action can appear in different weeks. There is no commitment completion lifecycle, priority, deliverable, scheduling state or global Action “planned” status. Retained Commitment IDs/creation times survive full-state Draft saves.

Additive migration: `src/db/migrations/0004_weekly_planning_baseline.sql`, with journal/snapshot metadata. Its owner/identity indexes precede the composite foreign keys; the generated statement order was adjusted in this new migration only. A lifecycle null check was made explicit before applying it. Clean migrations-only disposable databases pass. The migration is also applied to the normal local database. No packages were added or changed.

Earlier SQL files are unchanged, verified with SHA-256:

| Migration | SHA-256 |
| --- | --- |
| 0000 | `0d1292bd5b90d1a59caa0b5550c5acc3011398689cc264097665378fe921a40b` |
| 0001 | `23b428bf33db687fdc648389b0e9ddc75d8acbcf2cf2c44aa3fe1d9a1fdfc926` |
| 0002 | `dbb65f5f2a8093186fc768149235e6ab9bb9ef31f54bea6240e9dce8f8d99c21` |
| 0003 | `c8bd7483e7b2929672cba4aa123714b06bf76e183a99b1e2e1c31e62027b6b6a` |

## Week identity and timezone

Weeks start Monday. The current week is calculated from the verified owner's existing account IANA timezone using Intl local-date parts. Calendar arithmetic operates on dates, without treating a week as 168 elapsed hours. Plan identity contains the local Monday date, not a UTC start instant and not timezone in the uniqueness key. Timezone is pinned at creation for historical display; account timezone changes do not rekey existing Plans.

Creation permits current/future weeks and rejects finished weeks server-side and in the UI. Existing historical Plans remain viewable. Existing historical Drafts remain editable until commitment: the brief restricts new past creation, not historical Draft editing. Date validation accepts canonical dates from 2000 through 9999; the UI date picker uses the valid Monday-containing range. Week-start preferences are deferred.

Tests cover London's spring transition where `2026-03-29T23:30Z` is already local Monday 30 March, both occurrences of the autumn repeated local hour, Tokyo/Los Angeles Monday boundaries, leap days and year boundaries. A real PostgreSQL test changes account timezone and proves the saved week/timezone identity remains unchanged.

## Capacity, reserve and budgets

Provisional capacity is a manual estimate of focus-capable effort during the week. It is not waking time, working hours, calendar free time, Action estimates, scheduled time or actual focus time. Protected reserve is focus capacity deliberately left uncommitted for fatigue, interruptions, overruns, thinking and ordinary life.

`usable = provisional capacity − reserve`; `total = sum of weekly budgets`; `remaining = usable − total`. Capacity and each budget are positive whole minutes up to 10,080. Reserve is whole minutes, nonnegative and strictly below capacity. At most 50 Actions may be selected, within the existing 32 KiB JSON-command bound. The UI displays hours/minutes while inputs explicitly use minutes.

Empty and over-capacity Drafts can save; neither can commit. There is no reserve override, automatic budget shrinking or estimate writeback. Budgets begin blank. Both a partial allocation below an Action estimate and an allocation above it are valid. Healthy remaining capacity uses calm copy/color, without a utilization score or reward for adding work.

## Eligibility, source review and snapshots

Eligible candidates are owned Open Actions beneath an active Goal and absent/active exact-Goal Milestone. The Planning module reuses central Action effective mutability and relationship validation. Selecting/saving/committing never writes source entities or their lifecycle/estimates.

A Draft selection carries Action version, Goal identity/version and optional Milestone identity/version. Refreshing data never silently accepts new guards, drops work or changes budgets. A source edit, parent edit or move to another active Milestone requires explicit source review and acceptance followed by saving the Draft. A terminal source requires deliberate removal. Commit revalidates every selected source while holding the established source locks and returns Action-specific issues on conflict. Foreign/missing source IDs return the same unavailable response, without source contents.

At commit, freeze Action ID/title/done condition/estimate; Goal ID/title/outcome; optional Milestone ID/title/success condition; each budget; Plan capacity/reserve/week/timezone. All snapshots, state, committedAt, version increment and receipt are atomic. Injecting a failure after the aggregate write rolls back the Plan, all Commitment rows and the receipt.

Committed reads do not join current source contents. Source IDs remain traceable and restrictive foreign keys retain history. After commitment, normal API/service operations reject additions, removals, capacity/reserve/budget changes, snapshot rewrites and further commitment. No mutation controls appear in the committed UI. Editing/completing/archiving Actions or editing/terminal transitions of parents leave the entire baseline DTO unchanged.

## Ownership, concurrency and retry

Every endpoint/page derives the Actor from a verified database session. Browser owner/timezone/state/snapshot fields are rejected by strict command schemas. All repository reads/writes filter the owner. Composite foreign keys also reject cross-owner Plan/Action relationships. Foreign and missing Plan IDs are indistinguishable across fetch/save/commit. Anonymous requests fail; exact-origin POST/PATCH enforcement, private no-store responses and bounded JSON parsing are reused.

Write lock order: existing owner receipt → Plan → sorted Goals → sorted current Milestones → sorted Actions. Source writers already lock Goal → sorted Milestones → Action and never lock Plans. Re-read Action associations after acquiring Goals; this stabilizes active-Milestone moves and avoids opposite-order cross-Plan source deadlocks. Expected Plan version plus SQL Draft/version predicates prevent lost aggregate updates. Edit/edit, removal/budget, capacity/selection, save/commit and distinct commit/commit races each persist one winner.

Creation, full-state Draft saves and commit reuse `mutation_receipt`. New kinds are `weekly-plan.create`, `weekly-plan.save`, `weekly-plan.commit`; Goal/Milestone/Action hashes remain unchanged. Canonical Action-ID ordering makes the same selection set logically equivalent. Changed payload/version/Plan/kind with the same key conflicts; owner namespaces remain independent. Successful retries replay the original result even after commitment, terminal source changes, restart or the week becoming past. The UI retains the exact uncertain command, locks editing and retries it; afterward it reads current state before rendering controls, because a receipt snapshot can be older than current truth.

Stale-version UI conflicts retain capacity, reserve, selections and budgets for explicit latest-plan review. Reviewing a now-committed Plan shows the baseline and retains unsaved choices only as reference. Unsaved navigation is blocked until save/discard; failed refreshes retain useful local choices and display an error instead of a false empty list.

## Verification and exact results

Final complete `npm run check` passes. Previous Goals, Milestones, Actions, authentication and restart checks remain included.

| Check | Exact result |
| --- | --- |
| Domain/service Vitest | **80 passed**, 10 files; 25 new planning cases |
| Real PostgreSQL Vitest | **118 passed**, 5 files; 37 new planning cases |
| Chromium/HTTP Playwright | **37 passed**; 10 new planning journeys |
| Total automated tests | **235 passed**, including 72 new cases |
| Actual production process restart | PASS: two stop/start cycles; saved Drafts, committed frozen context, original Plan receipts, source terminal history, browser reload and unavailable-DB recovery |
| ESLint | PASS, zero warnings |
| TypeScript | PASS |
| Document/link/fence checks | PASS |
| Optimized Next.js production build | PASS, including planning page and four route families |
| Dependency audit | **0 vulnerabilities**: info/low/moderate/high/critical all 0 |
| Normal local migration/production preview | PASS |

The restart proof creates two saved Drafts before the first restart, asserts their exact persistence and original create/save receipts, then commits one before changing source entities. A second real restart retains both the committed baseline and the other Draft under now-terminal sources. Create/save/commit receipts replay their original results. Planning history reloads in the browser; all new endpoints return 503 and the page shows explicit recovery when the database is unavailable. Neither reload alone nor a mocked repository substitutes for this proof.

Test fixtures delete Commitment/Plan rows before referenced source rows in the disposable databases. The normal walkthrough uses a separate Goal. Logs are in ignored `.cache/phase-three-a-check.log` and `.cache/phase-three-a-audit.json`.

## Acceptance mapping

All cases below pass; D = domain/service, P = real PostgreSQL, B = browser, R = real process restart, M = manual normal-account walkthrough.

| Case | Evidence |
| --- | --- |
| 1 Current/future Plan | D creation; P current/future/timezone; B shell/week navigation; M current week |
| 2 Unique owner/week | P concurrent creation + direct unique constraint + separate owners |
| 3 Capacity | D arithmetic; P saved fields; B/M 12h/3h/9h |
| 4 Capacity validation | D strict bounds/reserve; P invalid commands + DB checks |
| 5 Eligible candidates | D central mutability; P all terminal/foreign contexts; B terminal exclusion |
| 6 Goal-level Action | P Goal-level selection; B/M capacity editor |
| 7 Milestone Action | P linked selection; B/M persistence/testing |
| 8 Budget independence | D/P unchanged estimates; B/M 120→180, 240→120, 45→90 |
| 9 Duplicate blocked | D/P validation and DB unique constraint |
| 10 Draft edits | P full-state edits/removal/empty Draft; B/M budget changes |
| 11 Draft concurrency | P edit/edit, remove/budget, capacity/selection; B retained stale choices |
| 12 Draft retry | D hash/replay; P original save after later state; B identical lost-response retry |
| 13 Reload | B/M saved Draft hard reload |
| 14 Actual restart | R two saved Drafts persist after stopping/starting production |
| 15 Over-capacity Draft | P save accepted; B/M visible excess and corrected save notice |
| 16 Over-capacity commit blocked | D/P no mutation/receipt; B disabled review |
| 17 Empty commit blocked | D/P no mutation/receipt; B disabled review |
| 18 Source revalidation | P nine edit/terminal/association scenarios + source race; B explicit review/removal |
| 19 Commit | D/P atomic valid commit; B/M review/cancel/explicit commit |
| 20 Atomic snapshots | D copied snapshots; P all fields + injected rollback; R exact baseline persistence |
| 21 Idempotent commit | P same-key concurrent retries/original result; B lost response; R replay |
| 22 Competing commit | P distinct commit/commit and save/commit one winner |
| 23 Immutable committed Plan | D/P terminal commands rejected; B/M absent mutation controls |
| 24 Source edit | P full DTO unchanged; B/R snapshots; M title and estimate changed |
| 25 Action completion | P full DTO unchanged; B/R history after completion |
| 26 Action archive | P/R full DTO unchanged after archive |
| 27 Parent change | P Goal/Milestone edits and terminal transitions; B/R history |
| 28 Understandable history | P no source joins; B/R retained original context; M original title/estimate |
| 29 Ownership isolation | D/P foreign/missing fetch/save/commit/source; B HTTP/anonymous/strict ownership |
| 30 Command isolation | D namespaces/hashes; P same UUID separate owners and cross-command rejection |
| 31 Timezone/Monday/DST | D six zone/DST cases + calendar arithmetic; P real timezone/rekey check |

## Normal-account UX walkthrough

Used the authenticated normal account in the existing in-app browser, against the optimized production build and normal PostgreSQL database. Created Goal `b5e7e9c7-6056-42b9-90c9-ef38affaec48` (“Phase 3A — a useful weekly planning loop”), one observable Milestone and three realistic Actions through the existing UI. Planned the current week of **28 September 2026**, Europe/London.

| Action at commitment | Action estimate | This week's budget |
| --- | --- | --- |
| Build weekly capacity editor | 2h | 3h |
| Implement planning persistence | 4h | 2h |
| Test planning UX with a realistic week | 45m | 1h 30m |

Entered **12h capacity**, protected **3h reserve**, leaving **9h usable**. Committed **6h 30m**, leaving **2h 30m uncommitted** in addition to protected reserve. Temporarily increased one budget to produce a 13h 30m Draft, saved it, confirmed the 4h 30m excess and blocked review, then deliberately reduced it. Reload retained the saved choices. Review displayed the complete numbers/context; “Keep drafting” initially received focus and returned safely; a separate “Commit this week” established baseline version 4.

Observations:

- Leaving 2h 30m uncommitted felt acceptable in this walkthrough: the calm capacity panel explicitly called it healthy breathing room, with no target or utilization reward.
- Blank budgets and individual Add choices required a decision; no Action was automatically selected. Capacity/reserve and the over-capacity block made collecting work costly in visible capacity rather than presenting a second undifferentiated backlog.
- Goal title/outcome and optional Milestone stayed visible in candidate, selected, review and history views, answering why effort was being allocated.
- Estimate and weekly budget were visibly different. The three deliberately unequal allocations remained independent, including a partial allocation of a larger Action.
- Review/cancel/commit felt intentional. Committed state, time, absent controls and the baseline explanation made the boundary clear.
- Three choices formed a focused plan without rewarding count. This is more informative than stars because it records a particular week, a capacity trade-off, deliberate budgets and durable original context. It is not yet evidence of sustained real-world productivity benefit.
- After commitment, edited the capacity Action to “Refine the weekly capacity editor after feedback” and changed its estimate from 120 to 95 minutes. The committed view still showed **Build weekly capacity editor**, **2h estimate**, **3h budget** and unchanged totals after hard reload.
- The measured copy defect was an over-capacity save confirmation using healthy-remaining copy. The final implementation instead says “Draft saved. Resolve over-capacity before committing.” The browser journey asserts this directly.
- Minutes-only entry requires mental conversion from hours; repeated Goal context creates a longer page. Neither prevented the three-Action walkthrough. Record these as later polish observations, without adding speculative input formats or a dense table.

Screenshot proof: `.cache/visual/phase-three-a-week.png` (local ignored artifact). The browser is left on the committed week. This is an engineering walkthrough, not a longitudinal pilot or independent user research.

## Deviations, limitations and deferred work

The latest Phase 3A brief supersedes earlier proposals for active/closed Plans, working windows/daily caps, commitment deliverables/order/status and a revision table. [ADR 011](decisions/011-weekly-planning-immutable-baseline.md) records this refinement of baseline intent. Two tables implement the minimum baseline; amendment representation is not predetermined.

Conservative source-version guards invalidate on any source/parent version change. Saved Drafts are durable; unsaved form choices are transient and are not an offline draft store. Lists have no pagination yet. No manual commitment ordering is persisted. Domain/service and SQL Draft/version predicates enforce baseline immutability for normal commands; privileged direct database edits remain outside that product contract. Capacity is manual and says nothing about remaining calendar placement. The pinning/date policy and bounds are intentionally simple.

No amendments, post-commit editing, closing, rollover, daily planning, availability windows, Calendar, scheduling, scheduled/actual minutes, focus sessions, commitment completion status, reviews, scores, AI, ranking, priorities/dates, standalone/inbox work, notifications, reminders, recurrence, Notion/Jira/GitHub/Slack/OpenAI/Anthropic integrations were implemented.

## Phase 3B recommendation — proposal only

Prefer **small immutable full-plan amendment snapshots** as the option to evaluate next. The walkthrough used only three commitments, and the 50-selection bound keeps a complete snapshot small. Reconstructing current intent from patches would add relationship, omission, ordering and retry semantics without a demonstrated benefit. A complete accepted amendment should explain the change, retain relevant presentation snapshots and link to the original baseline and previous accepted intent. Derive a human-readable added/dropped/budget/capacity/reserve comparison from successive snapshots; do not build event sourcing.

Keep the original Phase 3A Plan/Commitment baseline permanently unchanged. Give users an explicit amendment Draft/review/accept flow with a reason, owned source validation, expected version and the existing receipt protocol. Changing capacity or reserve is deliberate; over-capacity acceptance remains blocked. Retained baseline work can remain historical even when its live source is terminal; new additions must be eligible. Precisely define when amended items capture refreshed context, rather than quietly relabeling unchanged historical choices.

The next design review must still compare full snapshots against structured append-only changes and settle the smallest representation, identity/current-version rules and source-refresh semantics. This is a recommendation grounded in the small-plan walkthrough, not an approved schema. Acceptance should demonstrate Baseline → Amendment 1 → Amendment 2; adding, deliberately dropping, changing budgets/capacity/reserve; original/current/diff display; immutable older snapshots; source changes; one-winner concurrency; original-result retries; ownership; reload/restart. It must always answer “What did I originally commit to?” and “What changed afterward?” Scheduling, closing, rollover and reviews remain outside Phase 3B unless separately authorized.
