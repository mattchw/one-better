# Phase 0 completion report

Completed locally on 2 October 2026. **Phase 0 only; Phase 1 has not begun.** All Phase 0 acceptance conditions passed. The application is available on the local port described in the README; no remote deployment was performed.

## Documentation amendments

Updated all six design documents and ADRs 001–006 before implementation. Authentication identity and IntegrationConnection are independent; future connections record provider account identity, scopes, credential metadata, sync success/error, and revocation/reconnect state. Browser input cannot supply an authoritative owner. Commitment history snapshots estimates, action/goal/milestone relationships, and presentation fields; live links are only navigation/current-state references. Rollover creates a new linked commitment. Original committed, scheduled, and actual effort stay distinct.

Added explicit IANA/timestamptz/day/week/DST/all-day/boundary semantics; constrained lifecycle transitions; free-time/focus-capable/commitment-capacity distinctions; reserve and the principle **“The application should make under-committing easy.”** Calendar architecture now states source mirrors/internal intent/dedicated focus projections, stable references/private metadata, initial conflict detection without unrestricted bidirectional resolution, and full/incremental sync pagination/cursor/deletion/410 recovery plus version-aware retries/reconciliation. No Calendar runtime was implemented.

Document checks verify all six required files, local links, and Markdown fences. README now documents actual setup, credentials, migration, verification, code boundaries, and limitations. [ADR 007](decisions/007-phase-zero-sessions.md) records the authentication refinement; [implementation plan](phase-zero-implementation-plan.md) records the Phase 0 sequence.

## Structure actually created

- Next.js App Router/TypeScript shell with signed-out/sign-in/authenticated/sign-out flows; desktop and mobile layouts visually inspected.
- `src/domain`: narrow Actor, application error codes, standard timezone validation.
- `src/modules/account`: current-account service and ownership-scoped Postgres repository. This present consumer proves the domain/service/repository boundaries without a Goal fixture.
- `src/server`: validated server-only configuration/runtime, auth factory, verified Actor resolver, sanitized HTTP errors/request IDs. Next instrumentation validates configuration on startup.
- `/api/account`: protected current-user context; `/api/health`: database/schema readiness; `/api/auth/*`: library authentication with exact-origin enforcement.
- Auth-only Drizzle schema, SQL migration, persistent-volume local Compose service, operator provisioning scripts, domain/service/Postgres/browser/restart test harnesses, and a CI workflow.

No Goals schema/UI/API, planning module, Calendar consent or adapter, worker/outbox runtime, focus timer, review, AI, Notion, Slack/Jira/GitHub, plugin system, event bus, or microservice was created. Next.js generated its standard AGENTS.md/CLAUDE.md guidance when the dev server ran; those files are retained.

## Authentication actually implemented

Better Auth 1.7.7 with Drizzle/Postgres database sessions and email/password accounts provisioned by an explicit local CLI. Public sign-up is disabled. No Google provider or Calendar scope is configured. Password hashing is the library's standard implementation; no custom password or session crypto. Local credentials/secrets were randomly generated in ignored environment files and never printed.

Anonymous protected API requests return 401; pages redirect to sign-in. Validated sessions yield an immutable Actor containing only the UUID owner identity. `/api/account` always reads that owner's row and ignores user IDs in query strings. The service checks returned ownership defensively. Cookie caching is disabled; expired/revoked sessions must be checked against Postgres. Auth POSTs require the exact configured Origin, including first login; sign-in is limited to ten attempts/minute. Sign-out uses a full navigation to clear prior account router state.

The development provisioning CLI refuses production and non-loopback databases/origins. There is no automatic development actor or impersonation web route. The production-process smoke authenticates normally on loopback; it does not enable a bypass.

## Database and migrations

Local official PostgreSQL image reports **16.15**. Port 55432 binds to loopback, and the named `personal-execution_postgres-data` volume retains data independently of web processes. `0000_auth_foundation.sql` creates only `app_user`, `auth_session`, `auth_account`, and `auth_verification`, with ownership foreign keys/indexes, unique email/session token/provider identity, and timestamptz instants. The auth adapter uses text UUID IDs. User timezone is an IANA name; validation uses Intl rather than a custom time system.

The initial schema was generated, inspected, applied, applied again safely, and created entirely from SQL migrations in isolated clean Postgres databases. Drizzle's migration ledger tracks application. Nullable OAuth columns are unused standard auth-schema columns; future Calendar credentials belong in a separate encrypted IntegrationConnection.

## Verification evidence

| Phase 0 condition | Result / evidence |
| --- | --- |
| App boots locally | PASS — dev-server browser suite and loopback production-process boot; local provisioned account also inspected |
| Clean database entirely from migrations | PASS — each database suite creates an isolated new database; exactly four auth tables; migration reapplication safe |
| Authentication works | PASS — correct/incorrect password, disabled sign-up, origin rejection, throttling, sign-out, expiry, revocation |
| Server obtains authenticated User | PASS — session→Actor→service→repository→current-user DTO and shell |
| Anonymous request denied | PASS — `/api/account` 401 and protected page redirects; verified in browser and production process |
| Two distinct ownership identities | PASS — two seeded users in independent browser contexts and Postgres tests; arbitrary browser owner input ignored |
| Persistence across app restart | PASS — stop/restart actual production process; same Postgres User and same authenticated session still resolve |
| Domain/service tests | PASS — 7 tests across 2 files |
| Real Postgres tests | PASS — 9 tests; no SQLite substitution |
| Browser smoke/authenticated flow | PASS — 4 Chromium tests, including reload/sign-out/independent accounts and narrow-layout failure state |
| Database failure distinct from empty state | PASS — unavailable database gives health/account 503 and explicit shell recovery during production proof |
| Lint | PASS — zero warnings permitted |
| TypeScript | PASS — `tsc --noEmit` and Next production-build checking |
| Production build | PASS — Next.js optimized production build |
| Document checks | PASS — six required files, ADR/document links, fences |
| Clean locked install | PASS — `npm ci` installs from package-lock.json |
| Dependency audit | PASS — zero reported vulnerabilities |
| Desktop/mobile inspection | PASS — actual authenticated shell at 1440px and 390px; screenshots in ignored `.cache/visual` |

Commands: `npm run docs:check`, `npm run lint`, `npm run typecheck`, `npm test`, `npm run test:db`, `npm run test:e2e`, `npm run build`, `npm run test:restart`, `npm ci`, and `npm audit`. `npm run check` sequences the required checks. Database-test commands reject remote/non-test database names and delete only newly created isolated test databases; restart proof stops only its owned processes. Browser traces are disabled to avoid retaining credentials. The hosted GitHub workflow is configured but has not been executed by this local task.

## Architectural refinements and limitations

The sole substantive refinement is bringing the approved Better Auth session library forward from Phase 4 to Phase 0. The original automatically resolved development actor could not demonstrate anonymous rejection. ADR 007 replaces it with real sessions while keeping Google OAuth and integrations deferred. No other product scope expansion occurred.

The public npm endpoint was unreachable during initial installation; project-local registry configuration uses the reachable public Yarn mirror, without modifying global npm settings. A narrow esbuild override under the migration CLI removes its dev-tool audit finding; migration generation and clean migration tests pass with it. Some compatible lint/migration tooling still prints upstream deprecation notices; that is distinct from the clean vulnerability audit. All versions are locked and listed in architecture.md/package.json.

This remains a local foundation. No remote deployment, Google callback/consent verification, production backup/restore, email verification/reset delivery, production least-privilege database-role setup, multi-instance rate-limit storage, or trusted-proxy hardening is claimed complete. Local HTTP cookies use library defaults; remote hosting must use HTTPS and its own secrets. Phase 1 will prove goal read/write isolation; only current-account isolation can be proved in Phase 0 because no Goals exist.

## Exact proposed Phase 1 scope — not implemented

Implement only User-owned Goal and atomic MutationReceipt persistence plus end-to-end goal interaction:

1. Required trimmed title (1–160 Unicode code points), intended outcome (1–2,000), optional validated local target date; plain-text rendering.
2. Create, display Active/Archived, edit with expected version, explicit soft archive, distinct loading/empty/error states. Archived rows remain readable; no restore/permanent-delete/bulk feature.
3. Server Actor-derived owner on every list/get/mutation; User A cannot read/edit/archive User B's goal. Same unavailable response for another owner's/nonexistent ID.
4. Atomic idempotent create/retry receipts; version conflicts prevent stale edits, lost updates, and reactivation after archive. Failure retains the draft; saved state follows database acknowledgement.
5. Postgres migrations/constraints plus meaningful domain/service/database/browser tests covering G1–G14 in build-plan.md, including hard reload, independent browser, actual web-process restart, duplicate/lost-response retry, stale two-tab edits, archive retention, Unicode/date validation, database failures, keyboard access, and narrow layout.

Exclude milestones/actions, planning/calendar, timers/reviews, AI/integrations, nested project/season hierarchy, invented progress scores, restore/permanent deletion, and drag-and-drop. Await a separate Phase 1 implementation request.
