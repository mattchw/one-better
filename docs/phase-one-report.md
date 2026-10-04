# Phase 1 completion report

Phase 1 only: owned Goals. Completed locally on 2 October 2026. Phase 2 has not begun. All fourteen Phase 1 acceptance conditions passed. The final aggregate `npm run check` exited 0, with the exact results below.

## Implemented scope and UI

A signed-in user can create, display, edit, and intentionally soft-archive a Goal. `/` shows Active; `/?view=archived` shows retained Archived goals and preserves the view on reload. Cards emphasize a clear name and intended outcome; no task checkbox, deadline, estimate, progress percentage, or future navigation. The foundation's database-identity decoration was removed from the product view; current-account context remains a protected API/service.

Create/edit dialogs label title/outcome and explain what success means. Client validation assists; server validation is independent. Errors attach to fields and are announced. Pending saves disable duplicate submission and a synchronous in-flight guard prevents two rapid handlers. Database acknowledgement precedes “saved.” Cancel/Escape discard only a transient draft and restore focus. Archive explains retention, opens on Cancel, and requires a separate confirm action. Archived cards are readable and have no edit/restore/delete actions.

Failed writes preserve draft and command payload. An uncertain response locks the payload and offers Retry same change. Conflicts preserve attempted values, show the actor's current saved Goal, disable Save, and require Review latest saved version before explicit reapplication. A freshly archived version cannot be edited. Failed initial loads show recovery; failed refreshes show an explicit error, never an empty list. Newlines and markup render as plain text.

Manual product walkthrough used the normal local account: create “Build a dependable planning practice,” reload, revise its outcome, confirm archive, open Archived, reload. That QA Goal remains in Archived; it was not hard-deleted. The outcome stayed understandable without any extra task fields. Mobile width 390 had no horizontal overflow; keyboard-only browser tests covered dialogs/actions. Screenshots are ignored in `.cache/visual/phase-one-archived.jpg` and `phase-one-mobile.jpg`. The manual walkthrough improved the empty state to “No active goals yet,” which is accurate both for a new user and after archiving all active goals.

## Schema and migration

New append-only `src/db/migrations/0001_goals.sql`, generated/reviewed with Drizzle, plus its snapshot/journal entry. Clean databases reconstruct all six tables from migrations; repeated migration application is safe. The local development database has the new migration applied. Phase 0 SQL was not modified: SHA-256 of `0000_auth_foundation.sql` remains `0d1292bd5b90d1a59caa0b5550c5acc3011398689cc264097665378fe921a40b`.

Goal columns: UUID `id`; text UUID `owner_id` referencing app_user with restrictive deletion; required text `title` and `outcome`; positive integer `version` default 1; timestamptz `created_at`, `updated_at`, nullable `archived_at`. Archive state derives from that nullable instant. Length/version/archive-time checks, unique owner/identity key, and owner/archive/creation/ID index enforce persistence boundaries. List order is creation descending then ID descending; editing does not reorder. Titles need not be unique.

MutationReceipt columns: owner, UUID mutation ID, SHA-256 request hash, JSONB original Goal result, creation instant. `(owner_id, mutation_id)` is the primary key. The nullable result is a transaction-local claim; successful service transactions always fill it before commit. Failure rolls the claim back. No unrelated tables were added.

## Domain invariants and service boundaries

Goal title is trimmed and 1–160 Unicode code points; outcome is trimmed and 1–2,000. Newlines/plain text are allowed; null characters and malformed Unicode are rejected. Browser/server share counting; PostgreSQL char_length agrees for valid Unicode. Unknown fields (including owner, date, status, timestamps) are rejected. UUID command/resource IDs and expected integer versions are validated.

Every operation takes an authenticated Actor. Actor→Goal service→owned repository implements list/get/create/edit/archive. Pure domain functions validate active→archived and version transitions; React does not authorize or decide lifecycle truth. Goal ID, owner, creation instant, and outcome survive archive. Archived records are immutable in this phase; no physical-delete or restore service/route exists. Goal DTOs omit server-side owner identity.

## Idempotency

See [ADR 008](decisions/008-goal-command-receipts.md). Hash command kind, Goal ID/expected version when applicable, and normalized fields. Scope IDs to the authenticated owner, across all three command kinds. Reusing an ID with different semantics returns typed 409 MUTATION_ID. A different user's same UUID is an independent namespace.

In one Postgres transaction insert the claim with ON CONFLICT DO NOTHING, lock/read the owned receipt, replay its matching successful result or perform the owned write, then store the result. Concurrent duplicate claims wait on the first transaction. Goal mutation and receipt commit/rollback together. Replay precedes version/lifecycle checks, so create never duplicates and edit/archive never increment twice or raise an artificial stale conflict. Snapshots return the original successful result even after later edits/archive. The UI refreshes current data after acknowledgement.

Retain receipts indefinitely locally, including after archive. No automatic cleanup/job framework. Pruning would limit the retry guarantee; define hosted retention/account erasure explicitly before wider operation.

## Optimistic concurrency

The command carries the originally read version. The transaction locks the owned Goal row; the pure transition checks expected version and active state. The SQL update also predicates on owner + ID + expected version + unarchived state, then increments atomically. Concurrent different commands at one version produce exactly one winner. Typed VERSION conflict contains only the actor's current record; stale archive cannot hide a newer edit, and stale edit cannot reactivate archive. No last-write-wins or text merging.

## Ownership and security

Real Better Auth sessions remain authoritative. Anonymous Goals APIs return 401; the page redirects to sign-in. Exact configured Origin is required for every mutation, including first create. Request bodies are streamed with a 32 KiB bound before parsing. Private no-store applies to reads, results, and errors. Query-string owner IDs do not affect scope; body owner IDs are rejected. All repositories predicate on actor ownership, including receipt locks/replays. Other-owner and nonexistent valid IDs return identical 404 code/message without a current record. Logs preserve Phase 0's sanitized code/request-ID behavior.

Two-owner service/Postgres and browser/API tests prove list/get/edit/archive isolation and independent receipt namespaces. Unsupported DELETE returns 405. Database outages produce explicit 503/recovery, never success or empty state. No public impersonation or test-only UI/HTTP route was introduced.

## Verification results

| Check | Exact result |
| --- | --- |
| Documentation | PASS — six architecture docs, ADR/report links, fences |
| Domain/service | PASS — 22 tests, 4 files (15 Goal tests + 7 foundation tests) |
| Real PostgreSQL | PASS — 21 tests, 2 files (12 Goal tests + 9 auth tests) |
| Chromium browser | PASS — 13 tests, 2 files (9 Goal journeys + 4 foundation checks) |
| Actual production-process restart | PASS — User/session/Goal identity, create/edit/archive receipts, Active/Archived browser verification after two restarts |
| Real unavailable database | PASS — read/create/edit/archive 503 and explicit shell recovery in production proof |
| Lint | PASS — zero warnings permitted |
| Typecheck | PASS — tsc --noEmit and production-build checking |
| Production build | PASS — optimized Next.js/Turbopack build |
| Dependency audit | PASS — 0 vulnerabilities; no dependencies added/upgraded |
| Migration generation/application | PASS — generated reviewed new migration, clean reconstruction/reapplication, local migration applied |
| Manual UX | PASS — normal account create/reload/edit/archive/Archived reload; width 390 and keyboard verification |

56 automated unit/service/database/browser tests total, plus the separate process-restart proof. Commands: `npm run check` sequences docs/lint/typecheck/unit/Postgres/browser/build/restart; `npm audit` is separate. Browser tests now own a newly created isolated PostgreSQL database and remove only that database after completion. Test fixture row cleanup is restricted to that disposable database, never the local user database. The restart proof retains its unique archived test Goal in the dedicated execution_test database. CI is updated/configured, not remotely executed here.

### Required acceptance cases

| Brief case | Evidence |
| --- | --- |
| 1 Authentication | Anonymous page/API/browser; protected GET/POST/PATCH/archive all denied |
| 2 Empty state | Authenticated new user, useful outcome prompt, no empty table |
| 3 Create | Browser form + real actor-owned Postgres row/version 1 |
| 4 Idempotent create | Five concurrent same-ID DB requests, one row/receipt; HTTP and lost-response replay |
| 5 Validation | Whitespace/required/Unicode max/max+1/null/extra fields/IDs/versions, live server field error, no invalid DB writes |
| 6 Reload | Hard reload, same ID/fields, independent authenticated browser context |
| 7 Process restart | Actual web stop/start, same Goal and browser card from Postgres |
| 8 Edit | Same identity, version 2, retained creation instant, updated fields |
| 9 Idempotent edit | Concurrent duplicate and lost-ack replay; original result after archive/restart |
| 10 Edit conflict | Real concurrent DB updates + two browser tabs; one winner, retained draft, explicit review/reapply |
| 11 Archive | Active absence/Archived presence, retained row/identity/outcome; reload and process restart |
| 12 Idempotent archive | Concurrent duplicate/lost response/restart replay; one version increment |
| 13 Archive conflict | Stale archive after edit rejected; competing edit/archive one winner; no reactivation |
| 14 Ownership | Two owners across service/Postgres/API/browser; same 404 as missing; independent same-UUID receipts |

Revised build-plan G1–G14 also cover Cancel, failure drafts, key-reuse rejection, stale edit after archive, duplicate titles/Unicode/plain text, keyboard focus and narrow layout. Date examples were removed under the latest brief.

## Deviations, limits, and deliberate deferral

The latest explicit brief removes the earlier optional target date; all current Phase 1 contracts/model were amended accordingly. ADR 008 tightens receipt uniqueness from owner/command/ID to owner/ID and stores complete original result snapshots to satisfy all retry semantics. This is a small transactional table, not an event/workflow framework. No package changes or additional product scope.

A restricted compiler attempt cached a port-permission failure; stopping the identified old local server, clearing generated .next artifacts, and rebuilding with compiler process permissions resolved it. The final optimized build uses the existing bundler. Upstream NO_COLOR/FORCE_COLOR notices are non-failing tooling output.

This is a local app with operator-provisioned accounts. Remote deployment/HTTPS, least-privilege DB roles, backup/restore operations, email delivery/reset, and multi-instance rate-limit storage remain Phase 0 limitations. Lists are intentionally small and unpaginated. Drafts and pending command IDs live in the open dialog, not across tab closure/reload; after abandoning an uncertain save, review saved goals before issuing a new command. Goals/receipts persist independently in Postgres. No offline queue or automatic retry daemon.

Milestones, actions/tasks, estimates, dates, ordering controls, progress scoring, weekly planning, calendars/scheduling, focus/reviews, AI, external integrations, notifications/recurrence, hard delete, and restore are deliberately absent. No speculative future features were added.

## Exact proposed Phase 2 scope — not implemented

Deliver two separately usable slices from the approved roadmap:

1. Optional owned Milestone under an active Goal: create/display/edit and explicitly mark achieved with a success condition and user-entered evidence; persist/reload/restart and version/idempotency protections.
2. Owned Action/Task: create/display/edit, explicitly complete, and soft-archive; required title/done condition, optional active Goal and optional open Milestone (which implies that same Goal), positive whole-minute remaining estimate when provided. Standalone work remains valid. Completion is distinct from Goal/Milestone achievement.

Specify transitions and exact acceptance tests before coding. Enforce same-owner links in service/database; block new work under archived Goals; preserve relations/completion evidence; apply the existing ownership, command-receipt, and optimistic-version guarantees. Provide domain/Postgres/browser journeys for goal→optional milestone→action and standalone action, including reload/restart, cross-owner link rejection, invalid estimates, stale edits, completion, and archive retention.

Exclude dependencies, hierarchy/projects, deadlines/recurrence, bulk/backlog tooling, provider imports, progress percentages, weekly planning, calendar/focus/reviews/AI. Phase 2 requires a separate implementation request.
