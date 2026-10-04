# Phase 3B — Immutable Weekly Plan Amendments

Completed 2 October 2026. Scope: Phase 3B only. Phase 4A is proposed, not implemented.

## Result

A committed week can now change deliberately without rewriting its original intent. Amend plan opens an exact transient copy of the Current Plan; the owner changes capacity/reserve/budgets/membership, supplies a reason, reviews a computed difference and confirms. One immutable full snapshot is appended. Current Plan leads the page, with Original Plan and chronological amendment history independently inspectable. Empty revised plans and zero-capacity reality are supported. Finished weeks remain read-only.

Architecture, domain, product, planning/integration documents, ADRs 001–011, build plan, prior completion reports, planning code, ownership/source-lock/receipt conventions and existing tests were reviewed. Relevant installed Next.js server/client and route-handler guides were read. No dependency or authentication design changes were needed.

## Schema and representation

Additive migration `0005_immutable_weekly_amendments.sql` adds two tables, without converting/migrating baseline content:

| Table | Persisted content / constraints |
| --- | --- |
| weekly_plan_amendment | UUID; owned Plan; positive sequence; reason; capacity/reserve; UTC creation instant; technical version at confirmation. Unique Plan/sequence, unique owner/identity and restrictive composite owned Plan FK. Required trimmed reason 1–500 Unicode code points. Capacity 0–10,080 with valid reserve. |
| amendment_commitment | Composite PK (amendment_id,logical commitment id); owner; Action; budget; immutable source guard and mandatory Action/Goal/optional Milestone snapshot. Unique amendment/Action, restrictive owned Amendment and Action FKs, budget 1–10,080 and practical JSON shape/Action-identity constraints. |

Full snapshot means every amendment contains the entire effective capacity/reserve and commitment set. There is no event stream, generic revision table, mutable amendment lifecycle or durable amendment draft. Zero membership persists metadata with no child rows. SQL indexes are created before their referenced composite FKs so a clean database reconstructs successfully. Migration metadata/snapshot and journal are updated normally. The shared receipt JSON union includes Amendment; the existing receipt table/protocol is unchanged.

Earlier SQL SHA-256 values remain exactly unchanged:

| Migration | SHA-256 |
| --- | --- |
| 0000 | `0d1292bd5b90d1a59caa0b5550c5acc3011398689cc264097665378fe921a40b` |
| 0001 | `23b428bf33db687fdc648389b0e9ddc75d8acbcf2cf2c44aa3fe1d9a1fdfc926` |
| 0002 | `dbb65f5f2a8093186fc768149235e6ab9bb9ef31f54bea6240e9dce8f8d99c21` |
| 0003 | `c8bd7483e7b2929672cba4aa123714b06bf76e183a99b1e2e1c31e62027b6b6a` |
| 0004 | `a824ca6b99da8cb8ae2946a45576db0af66192c01babbed0d54800b6e769c713` |
| 0005 (new) | `090b8916130edfaf691d599475b4d5032b407238bb3e4365e018afb4eb43293a` |

## Effective Plan and snapshot semantics

The pure Effective Plan projection selects the highest amendment sequence, otherwise the committed baseline. It returns copies rather than shared mutable references. History is sorted chronologically by sequence, even when timestamps coincide. Committed/history reads are repeatable-read owned snapshots and never join live source contents for historical presentation.

For every confirmation, begin from the predecessor effective snapshot. Carried commitments preserve logical ID, source guard, Action ID/title/doneWhen/estimate, Goal ID/title/outcome, and optional Milestone ID/title/successCondition. The service applies only explicitly submitted budgets. It neither reads carried sources for eligibility nor writes their definitions/estimates/lifecycle. Completed/archived Actions or terminal parents therefore do not silently invalidate/remove historical membership.

Drops omit membership from the new snapshot; baseline and previous snapshots keep it. An Action absent from the predecessor is a new addition, including re-addition after a historical drop. Such additions require reviewed current relationship/version guards and current owned Open/active-Goal/absent-or-active-Milestone eligibility under existing source locks. They receive fresh context and a new logical identity. Changed or terminal additions require explicit removal/review/re-addition; no source refresh is smuggled into confirmation. Within one unsaved editor, removing and undoing an existing eligible selection restores its carried context because final membership still belongs to the predecessor.

Budgets remain separate from estimates; there is no schedule or actual time. Usable = capacity − reserve; remaining = usable − total budgets. Confirmation rejects over-capacity and no effective planning change, even with a reason. Capacity zero requires reserve zero/no commitments; positive valid capacity may also deliberately drop every commitment. Original Phase 3A capacity >0 and at least one commitment rules remain unchanged.

## Difference and UX

Pure `planDifference` matches commitments by source Action identity, independently of row IDs or source wording. It detects capacity/reserve changes, additions, drops and budget changes, sorted deterministically by Action ID. It reports predecessor/new total and uncommitted capacity. Differences are computed, not persisted. Historical text is read-only; text/reason changes alone cannot create a planning change.

The editor shows live arithmetic and the concise proposed difference; Review amendment opens a modal with the reason and full difference before Confirm amendment. Keep adjusting receives initial focus; Escape returns to editing. Cancel discards transient choices without a command. Focus returns to Amend plan. Week navigation is disabled during an open amendment/uncertain command; before-unload protection warns about transient work. Current Plan stays simple; history shows sequence/time/reason/diff and expandable full snapshots. Original Plan is always exposed. Internal versions/receipt IDs/database metadata are absent from product text.

Stale confirmation retains the unsaved proposal and blocks repeat confirmation. Explicit “Review latest Current Plan and start again” discards it, loads/copies the new effective state, clears reason and asks the user to reapply choices. No automatic merge. Error recovery also compares the open editor's version before accepting a fresh read, preventing a refresh button from silently upgrading an old proposal over somebody else's changes. Unknown outcomes freeze inputs/cancellation and retry the exact original mutation ID/payload. Original-result replay is followed by a fresh Current Plan read before enabling controls. Failed history loads remain explicit errors, not empty history.

## Immutability, concurrency, receipts and ownership

Baseline content includes original capacity/reserve/usable/remaining, membership/identities/budgets/source guards/all snapshots, state and createdAt/updatedAt/committedAt. All remain unchanged after any amendment. The only updated WeeklyPlan column is technical `version`, which serializes effective-plan changes; it does not represent baseline content. Amendment.version records the technical version at its creation and never changes.

One transaction obtains the existing owner/command receipt, locks the owned Plan, checks expected effective version and current User timezone week eligibility, reads predecessor history, locks additions using sorted Goal → Milestone → Action order, validates/generates the snapshot, advances only Plan.version, inserts metadata/complete child rows and stores the original result receipt. Source writers never acquire Plan locks. Unique Plan/sequence and owned references supplement the serialized service. Different concurrent commands from one version have one winner and a typed EFFECTIVE_VERSION conflict. No branches or merge path exist. Identical concurrent retries have one receipt/result/sequence. An injected error after all snapshot inserts proves rollback of amendment metadata, children, Plan.version and receipt together.

Same owner/key/normalized payload replays the original successful Amendment result before later version/source/week restrictions. Changed reason/budget/version/Plan/kind under the same key conflicts. Owner namespaces are separate. A production process restart proof replays Amendment 1 after Amendment 2, terminal source transitions and restart, and retrieves the exact immutable first snapshot. All old Goal/Milestone/Action/Plan receipt assertions remain in that proof.

All transport entries resolve the verified session actor, use private no-store responses and check exact Origin on POST. Strict schemas reject browser owner IDs, historical text, timestamps and unsupported fields. Foreign/missing Plan/history/amendment/source IDs produce indistinguishable unavailable semantics, without private reason/context/current data. Random diagnostic request IDs are intentionally excluded when comparing HTTP failure bodies. Composite owned FKs preserve relational ownership. Unsupported PATCH/PUT/DELETE return 405; there are no amendment edit/delete/reorder commands.

## Acceptance evidence

D = domain/service tests; P = real PostgreSQL; B = authenticated browser/HTTP; R = actual production process restart; M = normal-account manual walkthrough. Test files are `tests/domain/amendments.test.ts`, `tests/services/amendments.test.ts`, `tests/db/amendments.test.ts`, `tests/e2e/amendments.spec.ts` and `scripts/prove-restart.ts`; all prior suites also run.

| Brief case | Evidence |
| --- | --- |
| 1 baseline-only effective | D highest-sequence/baseline copy; P baseline-only read |
| 2 editor exact current copy | B full workflow and cancel/reopen; M Amendment 2 begins with Amendment 1 |
| 3 cancel no persistence | B complete before/after history equality; M reserve cancellation |
| 4 reason required | D empty/blank/Unicode/length/malformed; P invalid command no writes; B blocked review |
| 5 capacity change | D capacity diff; P baseline equality; B/M 12h→9h |
| 6 reserve change | D reserve diff; P two snapshots; B/M 3h→2h→2h30 |
| 7 budget vs estimate | D carry budget; P live rows unchanged; B frozen 2h estimate with revised budget |
| 8 drop retains history | P drop/re-add; B/M original dropped work inspectable |
| 9 add fresh snapshot | D fresh addition; P changed guard/review; B/M urgent Action |
| 10 added eligibility | D/P foreign/missing/changed/Action terminal/Goal terminal/Milestone terminal |
| 11 carry terminal sources | D absent live sources; P five terminal cases; B terminal parents |
| 12 exact carried snapshot | D copies; P complete logical equality of context/guard/identity; R original snapshots |
| 13 source edit isolation | P renamed/moved/re-estimated source; B source changes; M already-edited capacity Action retains original title/estimate |
| 14 re-add fresh capture | P drop/edit/re-add new identity and current context |
| 15 capacity diff | D parameterized pure diff; B/M confirmation text |
| 16 reserve diff | D parameterized pure diff; B/M second amendment |
| 17 addition diff | D parameterized pure diff; B/M urgent work |
| 18 drop diff | D parameterized pure diff; B/M dropped walkthrough |
| 19 budget diff | D parameterized pure diff; B/M 3h→2h30 |
| 20 no-op | D ignores metadata/text; P NO_CHANGE/no receipt; B reason-only blocked |
| 21 over-capacity | D/service and P OVER_CAPACITY/no writes; B blocked review |
| 22 zero capacity | D bounds; P zero/empty persistence; B legitimate zero plan |
| 23 zero commitments | D/service and P positive/empty; B all dropped |
| 24 append exactly one | P full persistence; same-command race; B confirmation |
| 25 baseline unchanged | P complete content and baseline-row equality excluding only technical version; B original equality; R original equality with expected version advance; M Original Plan |
| 26 Amendment 1 unchanged after 2 | P exact first DTO and rows; B equality; R exact first replay/retrieval; M full snapshot |
| 27 latest Current Plan | D highest sequence; P effective equality; B/M second amendment current summary |
| 28 original view | B original fields; R production browser; M exact 12h/3h/6h30/2h30 baseline |
| 29 history time/reason/diff | B chronological entries/time/reasons/difference/full snapshots; R/M both history entries |
| 30 immutable methods | P repository API shape and retained snapshots; B PATCH/PUT/DELETE 405 |
| 31 idempotent confirmation | P original result after later amendment/finished week/terminal sources; B lost response same payload |
| 32 restart idempotency | R same first/second successful commands after actual process restart |
| 33 one-winner conflict | P concurrent different commands; B two tabs |
| 34 linear history | P unique sequence and one winner; B sequential recovery |
| 35 stale editor review | D typed conflict; B retains fields/restarts explicitly plus error-recovery regression |
| 36 past restriction | D timezone boundary; P later clock blocked/no writes; B finished week UI/API |
| 37 current allowed | D/P/B/M current week |
| 38 future allowed | D/P future week; B future keyboard/narrow workflow |
| 39 ownership isolation | D/P foreign and missing reads/appends/sources; B independent owned/anonymous contexts |
| 40 owner command namespace | P same UUID separate owners; changed namespace/kind/payload conflicts |
| 41 reload persistence | B full two-amendment reload; M reload |
| 42 restart persistence | R both full snapshots/current/history/baseline after actual production restart |

## Verification results

| Command/check | Final result |
| --- | --- |
| npm test | 119 passed, 12 files: prior 80 plus 39 Phase 3B domain/service |
| npm run test:db | 150 passed, 6 files: prior 118 plus 32 Phase 3B; new isolated real PostgreSQL database reconstructed from migrations |
| npm run test:e2e | 47 passed: prior 37 plus 10 Phase 3B Chromium/HTTP; isolated DB and real auth, zero retries |
| Combined tests | **316 passed**, including every previous test |
| npm run test:restart | PASS: real production boot, two deliberate web-process stop/start cycles, original/current/history/receipts survive, production browser/reload inspection, all reads/mutations return 503 for unavailable database |
| npm run lint | PASS, zero warnings |
| npm run typecheck | PASS |
| npm run docs:check | PASS: required docs, links and fences |
| npm run build | PASS: production routes including history/confirm and individual amendment reads |
| npm audit --json | PASS: 0 info/low/moderate/high/critical vulnerabilities, 623 audited dependencies |
| npm run db:migrate | PASS on normal local database; clean test reconstruction also passes |
| Prior migration hashes | 0000–0004 unchanged |

Initial browser/restart runs exposed and resolved cancellation focus restoration, asynchronous lazy-snapshot inspection and whitespace-sensitive test assertions. One HTTP comparison incorrectly included unique diagnostic request IDs and was corrected to compare the actual error semantics. Adding another real-login journey hit the existing production rate limiter; the test helper now waits its advertised retry window instead of bypassing or weakening authentication. Code review found and covered the stale-version error-recovery edge case. Final suite results above supersede those intermediate failed runs.

## Manual product quality gate

Used the existing normal-account current-week Phase 3A baseline: 720 capacity, 180 reserve, 540 usable, budgets 180/120/90 totaling 390, remaining 150 minutes. Its capacity Action had already been edited live to a new title and 95-minute estimate; the editor retained its original “Build weekly capacity editor” wording and 120-minute estimate, proving carry-forward isolation naturally.

Created one small urgent Goal-level Action, “Investigate a production support issue,” with a 45-minute estimate and concrete finish line. Amendment 1 deliberately reduced capacity 720→540, reserve 180→120, dropped the 90-minute UX walkthrough, reduced the capacity-editor budget 180→150, kept persistence at 120, and added the urgent Action at 45. Result: 420 usable, 315 committed and 105 uncommitted. Reason: “Production support reduced available focus time. Drop the UX walkthrough and keep a small urgent investigation.” All five changes plus totals/remaining were clear before confirmation.

Opened Original Plan and recovered its unchanged title/context, three budgets, 12h capacity, 3h reserve, 9h usable, 6h30 committed, 2h30 remaining and original commit timestamp. Started Amendment 2 from the exact 9h/2h/three-commitment effective copy. Changed reserve to 150, cancelled, and verified the saved plan/history stayed at one amendment and 120 reserve. Reopened: reserve was 120 and reason blank. Then confirmed the 150 reserve with reason “Protect another half hour of recovery after production support. Keep the smaller commitment set.” The second difference contains only reserve 2h→2h30 and remaining 1h45→1h15. The first amendment's full snapshot still shows 2h reserve and 1h45 remaining. Reload retained both entries and the latest plan.

| Quality question | Finding |
| --- | --- |
| Intentional change rather than editing history? | Yes: Amend, explicit difference, reason, confirmation and append language distinguish the decision from baseline editing. |
| Immediately understand the change? | Capacity/reserve/drop/budget/add are enumerated, with old/new total and breathing room; no mental list comparison needed. |
| Reason useful rather than annoying? | One short explanation connected the urgent work/reduced capacity to the decision; second reason explains protecting recovery. No categories or compulsory extra structure. |
| Recover exact original? | Yes, one visible Original Plan disclosure reproduces all original choices and timestamp, including the dropped Action. |
| Current Plan simple? | One summary and three commitments lead; history follows. No version/receipt detail appears. |
| Healthy breathing room? | Positive remaining effort receives supportive copy; no fill-the-week prompt. The second amendment protects more reserve without filling remaining capacity. |
| History useful for later review? | Reasons and deterministic predecessor changes explain the week without reinterpreting source edits. This is a qualitative walkthrough, not evidence from an actual weekly review. |
| Lighter than rebuilding? | All retained budgets/context start filled; first change modifies only relevant decisions; second needs one field plus reason/review. Adding new work deliberately starts with a blank budget. |

Screenshots inspected: `.cache/visual/phase-three-b-review.png` and `.cache/visual/phase-three-b-amendments.png`; the restored Current Plan summary is captured in `.cache/visual/phase-three-b-current-plan.png`. Production preview remains at `/planning` with two amendments. Existing unrelated sample Goals were left intact. Browser tests include 390px width, keyboard dialog focus/Escape and explicit stale/lost-response handling.

## Deviations, limitations and deferred ideas

No architectural deviation from the brief's full-snapshot decision. An extra immutable technical version on amendment metadata makes original result receipts and revision identity explicit; it is absent from UI text. Existing planning read/source-lock helpers are reused rather than introducing another repository/retry framework. Historical snapshot disclosures render their content on expansion, keeping the normal Current Plan DOM small.

Immutability applies to normal application operations; privileged operator SQL is not prohibited by new triggers. Aggregate total/zero-membership consistency is service enforced, with SQL row bounds/ownership/uniqueness checks. The app has no database-role hardening/account-erasure workflow. History loads all small snapshots with child reads per amendment; pagination is deferred until real usage justifies it. Existing 50-member/10,080-minute/32KiB limits persist. Amendment drafts are intentionally transient and cannot be recovered after an accepted reload. The conservative stale path requires restarting/reapplying rather than merging. Source guards for new additions invalidate on any source/parent version change. Current User timezone can affect which week is still amendable; historical display remains pinned. No browser offline storage is used.

Deferred: durable drafts, undo conveniences, reason categories, rich audit filters/side-by-side history, branches/merges, amendment edits/deletes, closing/reviews/rollover, calendar/scheduling/focus/actuals, AI/recommendations, automations/notifications and all external integrations. Nothing from Phase 4 is implemented.

## Recommended Phase 4A scope — proposal only

Connect Google Calendar separately from application authentication. Keep manual planning usable without consent. For selectable occurrence reads, propose `calendar.calendarlist.readonly` plus `calendar.events.readonly`; a busy-only alternative should be evaluated before choosing scopes. These are read permissions and must be justified by the actual selected-calendar capability, not bundled with broad calendar write access. [Google scope reference](https://developers.google.com/workspace/calendar/api/auth).

Use owner-bound consent state/exact callbacks, encrypted server-only credentials and explicit reconnect/disconnect. If background access is needed, request offline access, handle missing later refresh tokens without discarding prior credentials, serialize refresh, and surface revocation. Real sandbox consent/permissions/refresh must be verified when the slice is authorized. [Google web-server OAuth guide](https://developers.google.com/identity/protocols/oauth2/web-server).

Begin with paginated initial full reads of selected calendars and a bounded occurrence projection for the week. Promote only complete generations. Before adopting incremental sync, spike a stable cursor collection/query, persist its next token only after every page is reconciled, process deleted records and rebuild only provider cache on 410 invalidation. Rolling `timeMin/timeMax` cannot accompany a sync token. Decide bounded-full versus supported stable-cursor implementation in the Phase 4A acceptance contract; avoid shipping two speculative sync engines. [Google sync guide](https://developers.google.com/workspace/calendar/api/guides/sync), [events.list restrictions](https://developers.google.com/workspace/calendar/api/v3/reference/events/list).

Normalize events behind a small read-only provider adapter. Preserve all-day source dates/zones and exclusive end dates; treat timed ranges as half-open instants, clip at local week/working-window boundaries, handle DST/recurring exceptions, union overlapping busy periods and exclude cancelled/free/transparent events. Define treatment of all-day/declined/tentative events explicitly before implementation. Display coverage/freshness/failure honestly. [Google event resource](https://developers.google.com/workspace/calendar/api/v3/reference/events).

Add durable jobs/leases/retries only when background refresh or paginated/token work genuinely requires surviving a request/process lifetime. First expose selected-calendar busy/free information and advisory available hours alongside the user's provisional focus-capacity number. **Never update capacity, reserve, commitments, baseline or amendments automatically.** Free calendar space is evidence for the user's decision, not their focus budget.

Acceptance should prove real sandbox OAuth separate from sign-in, owner isolation, selected calendars, initial pagination failures, cancellation/deletion handling, token invalidation/refresh/restart recovery where used, DST/all-day/boundary/overlap arithmetic, disconnect and unchanged manual planning values. No calendar writes, output-calendar creation, automatic scheduling, focus sessions or AI in this first Calendar slice. Await a separate Phase 4A implementation brief.
