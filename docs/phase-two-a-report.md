# Phase 2A — Goal Milestones completion report

2 October 2026. Scope: Phase 2A only. Phase 0/1 remain the approved foundation. Actions are proposed below and have no implementation.

## Implemented experience

Goal titles open an owned Goal detail view with the outcome and compact Active/Completed/Archived Milestone navigation. Empty active Goals explain observable progress. Create/edit ask only for title and success condition. Completion shows the declared condition, asks whether it happened, and optionally captures evidence/result. Archive deliberately confirms retained history. Completed/archived cards have no mutation controls. Selected history views survive reload. Forms support keyboard focus/return, narrow layouts, plain-text rendering, safe errors and drafts retained through conflict review. Loading failure never becomes a false empty state.

## Domain, schema and relationship

`0002_milestones.sql` creates one Milestone table: UUID identity; owner; immutable required Goal identity; title; successCondition; state; version; created/updated/completed/archived instants; optional evidence. Composite `(owner_id, goal_id)` references the existing unique Goal `(owner_id, id)` with restrictive deletion. The schema rejects mismatched ownership, missing parents, invalid lengths/versions, invalid states, evidence outside completion, and inconsistent terminal timestamps. Owner/Goal/state/creation index supports scoped reads. Existing Phase 0/1 migrations are unchanged; clean databases are reproduced from all three migrations, and migration reruns pass.

Required text is trimmed: title 1–160 Unicode code points, condition 1–2000. Evidence is optional, plain text, at most 2000 code points; absent, null and blank normalize to null. Markup is displayed as text. No attachments, special URL handling or structured metrics. Timestamps are timestamptz, returned as UTC ISO strings. Server commands reject extra fields, including owner/Goal moves, dates and direct state changes. Duplicate titles are allowed; creation order is stable, without product ordering controls.

## Lifecycle and archived Goals

Only `active → completed` and `active → archived` exist. Edit changes only the active title/condition. Completion retains the definition, sets completedAt/evidence and increments version. Archive retains identity/definition, sets archivedAt and increments version. Both terminal states forbid edit/complete/archive, so neither completion evidence nor historical success conditions are silently rewritten. There is no reopen, restore or hard-delete route.

Goal archival preserves every child row, lifecycle, version, definition, timestamps and evidence unchanged. Historical children remain readable in all views, with a read-only banner and no mutation controls. All new child writes require an active parent. Learning of parent archival while a dialog is open keeps the draft and refreshes parent visibility. Milestone completion never changes Goal fields/version or creates progress, Actions or side effects.

## Concurrency and receipt reuse

Every existing-row command requires expectedVersion. The transaction claims/locks the existing owner+mutationId receipt, then locks the owned parent Goal, then the child; the scoped SQL replacement also checks Goal identity, version and active state. Different simultaneous operations based on one version have one winner; the loser gets `CONFLICT/VERSION` with the already-owned current snapshot. Parent locking serializes create/edit/complete/archive with Goal archive. Commands can finish before archival or be rejected after it; no child change is accepted after the parent wins.

The Phase 1 receipt transaction was extracted into one small `executeReceipt<Goal | Milestone>` helper. Same table, key, SHA-256 normalized-command hash, JSON original result and atomic rollback; no second mechanism or broader command framework. Existing Goal hash kinds and JSON remain unchanged. Milestone hash kinds are `milestone.create/edit/complete/archive`, binding target, expected version and applicable normalized fields/evidence. Same owner/key/semantics replays the original successful snapshot, even after child or parent archival. Altered semantics, target, version, evidence or aggregate with the same key conflicts. Different owners have independent namespaces. Failed commands roll back both claim and write. Receipts retain the Phase 1 indefinite-retention policy.

Browser submission keeps one logical command until acknowledgement. A lost response locks fields and offers retry of the identical payload/ID. Version conflict retains edited fields or completion evidence; review displays the latest definition before another explicit submission. Terminal or parent-archived conflicts cannot be resubmitted. There is no collaborative merge.

## Ownership and HTTP

Pages and APIs obtain ownership from verified database-backed sessions. Service/repository methods are actor-scoped and never expose unrestricted handler access. Missing/foreign Goals and Milestones return indistinguishable unavailable errors, without foreign snapshots. Composite FK backs the service invariant. Anonymous APIs return 401, cross-origin mutation attempts 403, foreign resources 404; authenticated successful responses are private/no-store. Existing session/Origin/authentication conventions remain unchanged.

Routes: owned Goal detail; GET/POST `/api/goals/[id]/milestones`; GET/PATCH `/api/milestones/[id]`; POST child `/complete` and `/archive`. Health now verifies the new table as well. No public fixture/test endpoint was introduced.

## Acceptance evidence

| Case | Proof |
| --- | --- |
| 1 Empty state | Browser owned Goal detail explains outcome checkpoints and offers Add |
| 2 Create | Service, PG and browser persist one child under exactly its parent |
| 3 Validation | Domain/PG/HTTP reject required/bounded/Unicode/extra-field violations |
| 4 Idempotent create | Five simultaneous PG retries produce one row; browser lost acknowledgement retries identical command |
| 5 Reload | Browser journey reloads active, completed and archived states |
| 6 Process restart | Production restart proof checks all three child states and four receipt types |
| 7 Edit | Service/PG/browser verify fields, immutable parent and version increment |
| 8 Idempotent edit | PG duplicate replay and browser lost response increment once |
| 9 Edit conflict | PG two-edit race and two-browser-tab retained-draft/review flow |
| 10 Complete | Definition/time/evidence retained; intentional browser confirmation moves to Completed |
| 11 Idempotent complete | PG duplicates/replay; browser response loss; restart original snapshot |
| 12 Completion conflict | PG edit/complete, complete/complete and complete/archive races; browser retains evidence against changed condition |
| 13 Completed immutability | Domain/PG/HTTP reject all terminal writes; history cards expose no controls |
| 14 Archive | PG retained identity/row and deliberate browser confirmation/history |
| 15 Idempotent archive | PG duplicates/replay; browser response loss; restart original snapshot |
| 16 Archive conflict | PG edit/archive, complete/archive and archive/archive races preserve winner |
| 17 Archived immutability | Domain/PG reject edit/complete/archive of archived records |
| 18 Ownership | Service/PG/HTTP deny foreign list/get/create/edit/complete/archive; FK rejects foreign-owner child |
| 19 Archived Goal | Service/PG/browser preserve all child states and block new writes; PG parent races cover all four commands |
| 20 Command isolation | PG owner namespaces and cross-aggregate key mismatch; prior Goal HTTP receipt isolation retained |

## Verification results

Final `npm run check` exited 0 on 2 October 2026:

| Check | Exact result |
| --- | --- |
| Document check | Six required documents, ADR links and Markdown fences PASS; rerun after final report PASS |
| Lint | ESLint with max-warnings=0 PASS |
| Typecheck | `tsc --noEmit` PASS |
| Domain/service | 38/38 tests, 6/6 files; 383 ms |
| Real PostgreSQL | 42/42 tests, 3/3 files; 2.95 s; includes all prior auth/Goal tests |
| Chromium HTTP/browser | 20/20 tests; 27.0 s; includes all prior 13 Phase 0/1 browser tests |
| Production build | Next 16.3.8 optimized build PASS; compiled 4.1 s, build TypeScript 2.4 s |
| Production restart | PASS: two app restarts, same account/session/Goal, all three Milestone states, all four original command receipts under an archived parent; unavailable DB 503 on all read/write surfaces |
| Dependency audit | 0 vulnerabilities: info/low/moderate/high/critical all 0; project-configured public registry mirror |
| Local migration | `npm run db:migrate` PASS; additive schema applied to persistent local PG |
| Manual production UX | Normal Local Engineer account: separate walkthrough Goal → empty explanation → create/reload/edit → intentional completion/evidence → Completed reload → second create/archive → Archived reload → third active checkpoint → parent archive → all three states readable unchanged, no mutation controls |

The manual view clearly distinguishes an observable success condition from effort, completion asks whether that condition happened, and preserved evidence conveys progress without percentages. No unnecessary product fields were added. A screenshot of Completed history under the archived walkthrough Goal is saved locally at `.cache/visual/phase-two-a-history.png`; the example is retained for review, and the production app is available on loopback port 3100. Existing user Goals were not altered by the walkthrough.

The first new PG test run caught harness issues: JSONB property-order comparisons and late rejection handlers. Deep DTO equality and immediate rejection assertions fixed them. The first browser run caught broad alert selectors and a reload before archive acknowledgement; scoped locators and waiting for the acknowledged state fixed them. Final full gate passes with no unhandled test errors. The primary npm audit endpoint returned ENOTCONN; the configured public mirror returned the successful audit above. No dependencies were added or changed.

New coverage is 8 domain, 8 service, 21 PG and 7 browser tests; prior 56 Phase 0/1 tests remain, giving 100 automated tests plus production restart proof. Test DB/browser runners create and drop only their own disposable databases. Fixture cleanup deletes Milestones before Goals under the new restrictive FK. Extra browser fixture sessions use the real auth factory/DB to avoid exhausting the public sign-in rate limit; the main journey still signs in through the real UI. Production restart uses its existing separate test database and owns its application processes.

## Deviations and limitations

No product-scope deviations. The shared browser mutation request utility and extracted receipt helper are minimal reuse of existing Goal behaviour. A distinct ADR documents parent serialization and original replay; receipt storage is not event sourcing. Test assertions compare DTO values, not JSON object property order (PostgreSQL JSONB may reorder keys); all fields/versions/timestamps match.

History is a retained terminal definition/result, not a full edit audit. Receipts are retained indefinitely, as Phase 1; no pruning or retention UI. Drafts survive conflict in the open dialog, not browser closure/reload. Other-tab changes become visible on view refresh/reload or a typed conflict, without live subscriptions. Parent locks serialize writes to siblings; adequate for the single-user scale and deliberately simpler than finer-grained concurrency. Very large milestone lists have no pagination yet. Direct database operators can bypass domain lifecycle/parent immutability; SQL constraints enforce representable lifecycle/ownership, not a trigger-based command system. Local operator-provisioned auth remains the foundation; no deployment or external integration has been requested.

## Deferred work and proposed Phase 2B

Use Milestones briefly before deciding the Action model. Proposed 2B is one concrete next-work slice: create/display/edit/explicitly complete/archive Actions with durable persistence, owner isolation, version conflicts, retry receipts, tests and restart proof. Tentative fields: required title; optional doneWhen; optional positive whole-minute estimateMinutes; optional Goal and Milestone; state open/completed/archived. A linked Milestone requires its exact Goal, with matching ownership. Decide standalone usefulness before locking optional relations; decide terminal/reopen and archived-parent rules in the 2B brief. No Action schema/module/UI exists now.

Keep estimate ≠ weekly commitment budget ≠ schedule ≠ actual focused time. 2B does not include planning, commitments, calendar blocks, focus actuals or automatic Goal/Milestone completion. Nesting, ordering/dragging, dates/dependencies, percentages/weights/priorities/tags, recurrence, attachments/URLs/metrics, AI, notifications, restore/reopen/hard deletion and integrations remain deferred. Stop at Phase 2A completion.

## Previous migration integrity

SHA-256 verified unchanged from the pre-implementation files:

- `0000_auth_foundation.sql`: `0d1292bd5b90d1a59caa0b5550c5acc3011398689cc264097665378fe921a40b`
- `0001_goals.sql`: `23b428bf33db687fdc648389b0e9ddc75d8acbcf2cf2c44aa3fe1d9a1fdfc926`
