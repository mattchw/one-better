# One Better

One Better — R5A Focus Cycles / Seasons, 3 October 2026.

Goals → weekly commitments → calendar plan → focused execution → actual-vs-planned review → replanning.

The architecture is approved with review amendments. Owned Goals have observable Milestones and concrete Goal-aligned Actions. Weekly Planning supports deliberate commitments, manual capacity/protected reserve, immutable original baselines and reasoned full-plan Amendments. Read-only Calendar context and Focusable Hours are advisory. Local TimeBlocks, Focus Sessions, Daily Reflections and finished-week Weekly Reviews now close the first deterministic loop. Carry/Defer/Drop decisions are explicit; a Carry proposal enters the following week's Draft only through a deliberate Add with a fresh chosen budget. AI, automatic rollover/replanning, Calendar writes and further integrations remain deferred. See the [Phase 7A report](docs/phase-seven-a-report.md) for verification and the real full-week dogfood gate.

## Design and implementation records

1. [Product specification](docs/product-spec.md) — purpose, journeys, scope, success measures, and risks.
2. [Architecture](docs/architecture.md) — stack, boundaries, operation, security, and testing.
3. [Domain model](docs/domain-model.md) — entities, ownership, invariants, and lifecycles.
4. [Planning engine](docs/planning-engine.md) — capacity, scheduling, and review arithmetic.
5. [Integrations](docs/integrations.md) — provider contracts, Google ownership, and safe retries.
6. [Build plan](docs/build-plan.md) — usable slices and the detailed Phase 1 acceptance contract.
7. [Architectural decisions](docs/decisions/README.md) — accepted decisions and alternatives.

## Review summary

Use a modular monolith: Next.js App Router + React + TypeScript, PostgreSQL + Drizzle, Better Auth database sessions now, Google sign-in later, thin server endpoints, testable domain services, and provider adapters. No background jobs are needed for on-demand FreeBusy; introduce durable work only for a concrete later requirement. Keep provider tokens server-side. AI proposes; users accept; deterministic services validate and apply.

Phase 0 establishes the local engineering foundation. Phase 1 is the first real vertical slice: create a goal, persist it in Postgres, edit it, archive it, display it, test it, and prove persistence after a reload and server restart. Phase 2A adds Milestones; 2B adds goal-aligned Actions; 3 weekly commitments; 4 advisory read-only Calendar context; 5 scheduling; 6 focus; 7 daily review; 8 weekly review/replanning. Stop the core MVP at Phase 8. AI, Notion, and further integrations follow evidence from using that loop.

The five highest-risk assumptions are that weekly planning reduces overload, calendar context helps deliberate capacity decisions, people record actuals consistently, Google sync/write ownership remains trustworthy, and the single-user design provides adequate account and credential isolation. Each has a validation gate in the [product specification](docs/product-spec.md#five-highest-risk-assumptions).

Recommended adjustments: distinguish weekly commitments from scheduled minutes; reserve capacity deliberately; preserve original plans for honest reviews; avoid automatic rollover; use a dedicated focus calendar; and postpone AI and broad imports until manual planning is useful.


## Run locally

Use Node 24.14.0 (see `.nvmrc`), npm, and Docker Compose. The local web app binds to `127.0.0.1:3100`; Postgres binds to `127.0.0.1:55432` and stores data in a named volume. All direct package versions and transitive resolution are locked in `package-lock.json`. The project uses the public Yarn npm registry mirror because the host's default registry was unavailable during setup; no global npm configuration is changed.

```bash
nvm use
npm ci
cp .env.example .env.local
cp .env.example .env
# Replace the placeholders in BOTH files with matching local values.
# Generate secrets/passwords with: openssl rand -hex 32
npm run db:up
npm run db:migrate
npm run db:provision
npm run dev
```

Open [the local app](http://127.0.0.1:3100) and sign in with `LOCAL_USER_EMAIL` / `LOCAL_USER_PASSWORD` from `.env.local`. In this prepared workspace, ignored `.env`, `.env.local`, and `.env.test` already contain randomly generated values; do not replace them unless you intend to change configuration. Credentials are never printed by provisioning. Creating the same local account again preserves its ID and password; changing a password in the environment does not reset an existing account.

Accounts can be created through verified Google sign-in when the dedicated Google identity credentials are configured, or through local CLI provisioning. Email/password signup remains disabled. Local provisioning refuses production mode and remote database/origin configuration. There is no automatic development identity: signed-out requests cannot access `/api/account` or the workspace. Better Auth uses database sessions, library password hashing, HttpOnly cookies, and exact-origin checks; the server resolves a narrow Actor from the verified session. Google Calendar consent is a separate connection. See [Google Sign-In](docs/google-sign-in.md) for setup and account-linking rules.

`npm run build` and `npm start` exercise the production application shape locally with real session authentication. The HTTP loopback default is for local use; remote deployment, HTTPS/domain configuration, production credentials/least-privilege database roles, trusted proxy/rate-limit configuration, and backup operations need a separate deployment slice.

## Database and configuration

`.env.local` configures the application/CLI; `.env` supplies Compose's `POSTGRES_PASSWORD`. `DATABASE_URL` and `BETTER_AUTH_SECRET` are server-only and must not use a `NEXT_PUBLIC_` prefix. `BETTER_AUTH_URL` must match the exact browser origin; use `127.0.0.1`, not `localhost`, with the defaults. The server validates configuration at startup.

The unchanged Phase 0 migration creates `app_user`, `auth_session`, `auth_account`, and `auth_verification`, plus owner foreign keys, indexes, and uniqueness constraints. Migrations 0002–0005 add Milestones, Actions, Weekly Plans/baselines and immutable amendments. Migration 0006 adds only owned Calendar connection, OAuth flow and minimal availability cache. The new `0001_goals.sql` migration adds Goal and MutationReceipt only, with owner foreign keys, field/version constraints, ownership/list indexes, and owner-scoped receipt uniqueness. The auth library represents application IDs as text UUIDs. User timezone is an IANA name validated with Intl; instants are PostgreSQL `timestamptz`. Nullable provider columns are required by the auth adapter but unused in this phase; they do not constitute Calendar integration storage. The separate Calendar connection in migration 0006 is owned by application User and does not reuse auth-account credentials.

Generate reviewed changes with `npm run db:generate`, inspect the SQL, then apply `npm run db:migrate`. Do not use schema push as deployment infrastructure. The migrator tracks applied SQL in Drizzle's migration schema; applying it again is safe. Local Compose's owner role is for development/tests, not a recommended production runtime role.

`npm run db:down` stops the container without deleting its volume. Never run `docker compose down --volumes` unless you deliberately want to erase this project's local data. Restarting the web app does not affect Postgres. For backups, use `pg_dump` against the local database with credentials supplied through environment/ignored configuration, and store private backups outside source control. A verified restore procedure is required before hosted reliance; browser reload is not a backup.

If `/api/health` reports unavailable, confirm Compose is healthy, run migrations, and check the matching connection settings. A failed authenticated account read shows an explicit recovery/error state rather than an empty workspace. Database failures/logs are sanitized; private URLs and passwords are not returned to the browser.

## Verify

```bash
cp .env.test.example .env.test
# Fill with the same Compose database credentials, a random test auth secret,
# and distinct random test-account passwords. Never point tests at user data.
npx playwright install chromium
npm run check
```

The prepared workspace already has the test environment. Commands can be run separately:

```bash
npm run docs:check
npm run lint
npm run typecheck
npm test
npm run test:db
npm run test:e2e
npm run build
npm run test:restart
npm audit
```

Database tests create and remove only a new dedicated `execution_test_<random>` database. Browser tests create/migrate/provision a new isolated `execution_test_<random>` database and boot an owned test server on port 3101, then remove only that newly created database. Goal fixtures are cleaned only inside this isolated test database. Run `npm run test:e2e` rather than bypassing the runner. The restart proof uses port 3102 and stops/restarts only processes it created, preserving real Postgres User/session, Goal/Milestone/Action history, saved weekly Drafts, immutable committed snapshots and original command receipts across two process restarts. A second production proof uses simulated Google through the real OAuth client and two more restarts to preserve encrypted credentials, selections and fresh/stale cached timing. Test scripts reject remote or non-test database URLs. No SQLite substitute is used. Browser traces are off to avoid capturing credentials; generated test reports are ignored.

The GitHub workflow runs the same checks against a disposable Postgres service. Local verification does not claim that the hosted CI job has already run. The narrow override of esbuild under the migration CLI fixes its dev-tool advisory; migration generation is verified with the override.

## Current code map

```text
src/app/                         Goals shell, sign-in, Goals/account/health/auth routes
src/components/                  Goal cards/dialogs and sign-in/sign-out interaction
src/domain/                      Actor, timezone validation, application errors
src/modules/account/service.ts   authenticated current-account use case
src/modules/account/repository.ts owner-scoped Postgres query
src/modules/goals/                pure rules, service, owned transactional repository
src/modules/focus-cycles/         independent owned horizons and retained membership context
src/modules/milestones/           outcome checkpoints and terminal evidence history
src/modules/actions/              concrete work, same-Goal links, central effective mutability
src/modules/calendar/            owned consent/selection/cache, encrypted tokens, pure busy union
src/providers/google/            CalendarList/FreeBusy adapter and OAuth library
src/server/                      config, auth, verified Actor, safe transport/errors
src/db/                          auth + Goal/Milestone/Action/WeeklyPlan/WeeklyCommitment/receipt Drizzle schema and reviewed migrations
scripts/                         migration, local provisioning, isolated tests/restart proof
tests/domain, tests/services, tests/db, tests/e2e
```

See [ADR 007](docs/decisions/007-phase-zero-sessions.md) for the auth refinement, [implementation plan](docs/phase-zero-implementation-plan.md), and [completion report](docs/phase-zero-report.md) for acceptance evidence. The [Phase 1 implementation plan](docs/phase-one-implementation-plan.md) and [completion report](docs/phase-one-report.md) record the Goals slice. Phase 2A Milestones is implemented; see its [implementation plan](docs/phase-two-a-implementation-plan.md), [ADR 009](docs/decisions/009-milestone-history-and-parent-locks.md), and [report](docs/phase-two-a-report.md). Phase 2B Goal-Aligned Actions is implemented; see [ADR 010](docs/decisions/010-goal-aligned-actions.md) and the [report](docs/phase-two-b-report.md). Phase 3A Weekly Planning and Immutable Baseline is implemented; see [ADR 011](docs/decisions/011-weekly-planning-immutable-baseline.md) and the [report](docs/phase-three-a-report.md). Phase 3B immutable weekly amendments is implemented; see [ADR 012](docs/decisions/012-immutable-weekly-amendments.md) and its [report](docs/phase-three-b-report.md). Phase 4A is implemented; see [ADR 013](docs/decisions/013-freebusy-advisory.md) and the [report](docs/phase-four-a-report.md). Phase 4B is implemented; see [ADR 014](docs/decisions/014-focusable-hours-and-advisory-open-time.md) and the [report](docs/phase-four-b-report.md).

## Goals usage and guarantees

Open `/goals` for Active goals or `/goals?view=archived` for retained archived goals. The legacy `/?view=archived` bookmark redirects to the new list. Create asks for a concise title and what success means. Edit preserves identity. Archive confirms intentionally, initially focuses Cancel, and keeps the row; there is no restore or hard delete. Title is 1–160 trimmed Unicode code points; outcome is 1–2,000, with newlines/plain-text rendering. Server validation independently enforces these limits and rejects unsupported fields.

Every list/get/write uses the verified Actor. Browser owner IDs are never authoritative. Edits/archive carry the version originally read; stale commands return 409 and keep the draft until explicit review of the latest saved version. Transport failures keep the original command/payload and offer Retry same change. Do not close/reload during an uncertain save: transient drafts and command IDs live only in the open dialog. If you do, review the server list before issuing a new create.

Goal and successful receipt commit together. `(owner_id, mutation_id)` identifies the logical command; hashes bind normalized fields, command kind, resource ID and expected version. Same-key retries replay the original successful result; changed payloads are rejected. Receipts are retained indefinitely in the local slice, including after archive; no cleanup worker is introduced. See [ADR 008](docs/decisions/008-goal-command-receipts.md).

## Goal-aligned Actions

Open a Goal to see Milestones and Actions. Capture a concrete title quickly; doneWhen, effort estimate in minutes, and active same-Goal Milestone are optional. Open is primary; Completed/Archived retain definition, estimate, milestone context and transition time. Milestone and Action history tabs preserve one another’s URL view. Completion is intentional without evidence; archive confirms and has no restore.

Every Action belongs to one immutable Goal. Only Open work beneath active parents can change; terminal parent changes retain all Action states unchanged as read-only history. Estimates remain current effort estimates, independent of weekly commitment budgets. Expected-version conflict drafts and same-command uncertain retries use the existing receipt guarantees. Transient drafts/command IDs are in-memory; after closing/reloading an uncertain command, inspect saved work before a fresh create. The additive `0003_goal_aligned_actions.sql` migration adds composite owned relationships; previous migrations are unchanged. All 28 acceptance cases and exact verification results are in the report.

## Weekly Planning

Open **Weekly planning** from **Settings**, **Plan this week** on the calendar, or Goal detail. Choose the current/future Monday-start week, enter manual focus capacity and protected reserve, create a Draft, then deliberately add eligible Actions and fill blank weekly budgets. The summary shows usable capacity, total budgets and healthy breathing room. Save before review; empty or over-capacity Drafts cannot commit. Source edits/reassignment require explicit review and saved guards; terminal work must be deliberately removed.

Review and **Commit this week** establish an immutable original baseline. Source edits/completion/archive and parent transitions do not relabel it. Current/future navigation and saved historical weeks remain available. Capacity/reserve/budgets use whole minutes; capacity/budgets are 1–10,080, reserve is nonnegative and less than capacity, and selection is bounded at 50. Phase 5A adds independent local scheduling below; actuals remain deferred. Post-commit changes use the separate immutable amendment workflow below. The additive `0004_weekly_planning_baseline.sql` migration is reconstructable with the existing migrations.

All 31 acceptance cases and the 235-test verification gate are documented in the [Phase 3A report](docs/phase-three-a-report.md). Unsaved choices/uncertain commands are in-memory; saved Drafts and receipts live in Postgres. No offline draft storage or committed-plan editing is provided.

## Immutable weekly amendments

On a current/future committed week, **Amend plan** starts with an exact copy of Current Plan. Adjust capacity/reserve, change budgets, deliberately drop work or add eligible Actions. Supply a concise reason, inspect the difference and **Confirm amendment**. Cancellation saves nothing. A successful confirmation appends one full snapshot; the latest is Current Plan. Original Plan and every amendment remain inspectable in chronological history. Historical wording never refreshes with a budget change; additions alone capture current eligible context. Dropping then re-adding in a later amendment captures fresh context.

Revised plans may deliberately contain no commitments. Zero capacity requires zero reserve and no commitments. No-op and over-capacity confirmations are blocked. Finished past weeks stay read-only, with no reopening or history edits/deletes. Concurrent stale proposals require explicit restart/review, and uncertain responses retry the same owned command. Only technical Plan.version advances; original content and timestamps remain unchanged. Additive migration `0005_immutable_weekly_amendments.sql` leaves all earlier SQL intact. The [Phase 3B report](docs/phase-three-b-report.md) maps all 42 acceptance cases and records the full 316-test gate, actual process restart, manual walkthrough and limitations.


## Google Calendar setup and use (optional)

Manual planning works without Google configuration. In ignored `.env.local`, set `GOOGLE_CALENDAR_CLIENT_ID`, `GOOGLE_CALENDAR_CLIENT_SECRET`, `GOOGLE_CALENDAR_REDIRECT_URI`, `CALENDAR_ENCRYPTION_KEYS` and `CALENDAR_ENCRYPTION_KEY_ID`. Enable the Google Calendar API in your Google Cloud project, configure its OAuth consent audience/test users as appropriate, and create a **Web application** OAuth client. Register the exact redirect `http://127.0.0.1:3100/api/calendar/callback` for the local default. It must equal the `BETTER_AUTH_URL` origin plus `/api/calendar/callback`, including host/port/path. Restart the app after configuration. Application email/password login and Calendar identity remain independent.

The key ring is a JSON object mapping key IDs to base64-encoded **32 random bytes**; the active ID chooses new encryption. Generate randomness using `openssl rand -base64 32`, place it in the ignored server configuration, and never commit or expose it. Example **shape**, not a usable key: `CALENDAR_ENCRYPTION_KEYS={"local-v1":"YOUR_32_BYTE_BASE64_KEY"}`, `CALENDAR_ENCRYPTION_KEY_ID=local-v1`. Keep keys outside PostgreSQL and backups, with separate secure recovery storage. For rotation, retain old key entries, add a new random key, switch the active ID, and restart. Updated grants encrypt under the new key; old entries must remain until older credentials are replaced/disconnected. Losing a key requires reconnection. Hosted use needs managed secrets/key lifecycle, HTTPS/exact public callback, consent verification as applicable, backup retention and trusted proxy/access-log query redaction. Never log `/api/calendar/callback` query strings at an upstream proxy.

The app requests only CalendarList read-only and accessible-calendar FreeBusy scopes: `calendar.calendarlist.readonly` and `calendar.events.freebusy` under `https://www.googleapis.com/auth/`. See [official scope definitions](https://developers.google.com/workspace/calendar/api/auth). It imports no event titles, descriptions, attendees or raw events. Connect explicitly in **Integrations**, choose up to fifty readable calendars (none preselected), and save. Return to Planning, expand **See daily focusable, busy and open intervals**, then **Refresh Calendar load**. Daily/weekly busy minutes are advisory, independent of capacity, protected reserve, budgets and amendments. No recommendation or calendar-open capacity is calculated.

Last complete timing survives reload/restart; freshness lasts fifteen minutes. Failed/partial refresh keeps old timing and successful fetchedAt visibly stale. Without prior complete success, timing is unavailable rather than zero/free. Refresh CalendarList in Integrations to review inaccessible choices. Reconnect repairs the same owned connection; changing Google account clears choices. Disconnect confirms intentionally, removes local secrets/selection/cache even if remote revocation fails, and preserves all planning/source history. Database backups have separate retention and may retain old encrypted rows until expired.

The recorded walkthrough/report distinguishes simulated testing from live Google verification. Automated tests start an external deterministic loopback provider and real authenticated app against isolated test databases. The fake endpoint seam is rejected outside explicit loopback test configuration; it is not an application route or session bypass.

For the manual simulated quality gate, run `npx tsx --env-file=.env.test scripts/calendar-walkthrough.ts` and use a separate browser profile from the normal preview. It creates a disposable database and synthetic login, seeds the realistic 12h/3h/6h30 plan and starts production on port 3104. Type fixture-control JSON in that terminal, or `stop` to verify non-mutation and clean up only its created server/database. Localhost cookies span ports; sharing a browser profile can replace the normal preview’s sign-in cookie. Automated browser tests use isolated contexts.


## Phase 4B: Focusable Hours

Open **Availability** to explicitly add recurring local windows. Empty days are valid; no workweek is assumed. Enter HH:mm, including 24:00 as an end; split overnight windows across two days. Save the whole weekly preference, then open current/future Weekly Planning and explicitly refresh Calendar load. The advisory shows focusable hours, busy time inside them and concrete Calendar-open intervals. Open time is information, not expected productivity; manual weekly capacity/reserve/commitments remain your choices.

Without complete selected-calendar timing, open time stays unknown. Disconnect keeps hours. Old completed weeks omit live settings. [Phase 4B report](docs/phase-four-b-report.md) and [ADR 014](docs/decisions/014-focusable-hours-and-advisory-open-time.md) document DST, ownership, concurrent edits, exact retries and verification. Real Google consent/provider walkthrough is still required before hosted Calendar use or future writes; Phase 4B creates no calendar events; independent local TimeBlocks arrive in Phase 5A below.


## Phase 5A: Local Time Blocking

Open a committed current/future week. **Add time block** on a current commitment, choose a local day/start/end, **Review placement**, then confirm. Times display in the Plan's pinned timezone. Preview shows budget, scheduled/resulting totals, Focusable Hours and fresh/stale/unknown Calendar context. Local overlap is blocked. Outside-hours or known Google busy requires explicit acknowledgement; unknown data never promises Calendar-free time. Scheduling beyond budget is permitted and leaves the Plan unchanged.

**Reschedule** future planned blocks, or deliberately **Cancel block** to retain its history. Past-started blocks and finished weeks are read-only. Budget amendments retain blocks; dropped commitments leave clearly review-required blocks with intentional cancellation. Re-adding an Action creates distinct commitment lineage. Estimates, budgets, scheduled time and future actual effort remain separate.

Additive migration `0008_local_time_blocks.sql` backfills existing logical IDs without changing immutable snapshots. Exact create/edit/cancel retries reuse existing owner receipts. [ADR 015](docs/decisions/015-local-time-blocks.md) and [Phase 5A report](docs/phase-five-a-report.md) document all 30 cases, races, restart proofs and UX findings. No Calendar writing, suggestions, Focus/actuals or AI is implemented.

Reproduce the disposable manual gate with `npx tsx --env-file=.env.test scripts/scheduling-walkthrough.ts` after building production. It seeds next week with a 3h budget / 4h Action estimate and explicit weekday hours, uses a simulated Calendar provider and real auth on port 3104, and removes its own database/process on `stop`. Use a separate browser profile from the normal preview. The quality gate expects two 90m placements, busy/outside-hour exceptions, a budget amendment/drop and preserved cancellation; source/original baseline/settings must stay unchanged.

## Focus Sessions (Phase 6A)

Open Focus from authenticated navigation to see today's scheduled blocks. Start a current-week block in one click; removed commitments require explicit acknowledgement. The same active session recovers after navigation, reload or process restart. End with a session outcome and optional note; the Action stays unchanged. Start another session to return after an interruption. Recorded totals include every ended outcome and stay separate from budgets/scheduled time. Any Focus Session preserves its TimeBlock's original schedule against further reschedule/cancel.

Production restart proof now includes `scripts/prove-focus-restart.ts`. All tests use disposable PostgreSQL and simulated Calendar; browser timing uses a guarded process-owned test clock, without an HTTP override. For a separate real-time manual account/server/database, run `tsx --env-file=.env.test scripts/focus-walkthrough.ts` after a production build; the script exposes only synthetic fixture credentials in its source and cleans its own resources on `stop`. Use its `restart`, `budget`, `drop` and `readd` commands while focusing. Do not stop until at least two sessions have been deliberately ended. Manual scope/limitations and exact results: [Phase 6A report](docs/phase-six-a-report.md).

## Daily Execution (Phase 6B)

Open `/today` after signing in, inspect scheduled and recorded focus, save one reflection Draft, and deliberately finish it. `/today?date=YYYY-MM-DD` reviews a previous or future local date in your account timezone. Future dates have no reflection controls. Finished text is read-only; current-day active Focus must end first. Migration `0010_daily_reflections.sql` is additive. See [Phase 6B report](docs/phase-six-b-report.md) for verification and limitations. Weekly Review follows in Phase 7A below.

## Weekly Review and deliberate rollover (Phase 7A)

Open **Weekly review** or `/review` to reach the most recently finished committed week. `/review?week=YYYY-MM-DD` selects a local Monday-start week. Inspect original/final plan facts, Amendment reasons, every logical commitment (including midweek removals), independent schedule/focus totals and daily notes. Explicitly save one weekly note and Carry/Defer/Drop choices. Carry requires a fresh proposed budget; Drop clearly confirms Action archival. Finish freezes the review note/decisions. Later Daily Reflection finalizations remain outside its timestamp cutoff.

Follow **Plan the following week**, create a Draft explicitly if needed, then use **Add to this week's plan** for eligible carried work. The chosen budget may differ from the saved proposal; the new week receives its own commitment identity. Already-present Actions do not duplicate, terminal sources cannot be added, and committed Plans receive no automatic Amendment. No review finalization creates a next Plan or changes historical execution/planning.

Migration `0011_weekly_reviews.sql` is additive. The full check now passes 711 tests and six production restart proofs. The disposable finished-week manual script is `scripts/weekly-review-walkthrough.ts`; after a production build run it with `tsx --env-file=.env.test`, complete review and explicit 75-minute next-week Carry in its synthetic account, then enter `stop` to assert independence and clean only its own database/server. See [ADR 018](docs/decisions/018-weekly-review-and-deliberate-rollover.md) and [Phase 7A report](docs/phase-seven-a-report.md). Stop at this slice and complete a real full-week dogfood before authorizing another feature. Real Google OAuth/list/FreeBusy/refresh/reconnect/disconnect remains a hard prerequisite for Calendar writes.

## Calendar-first workspace (UI Redesign R1)

The Calendar context rail now includes Quick focus for a running session or eligible block today. Work-card padding matches the reference. See [the Calendar amendment report](docs/ui-calendar-focus-report.md) for behavior and verification.

Settings now has a shared Availability / Integrations / Account workspace at `/settings`, following the supplied Settings reference. Existing settings bookmarks and Google callbacks remain valid. See [the Settings report](docs/ui-settings-report.md) for scope, responsive screenshots and verification.

After sign-in, One Better opens `/calendar`. Current effective commitments feed the Work rail; the calendar layers current Focusable Hours, advisory Google busy timing and frozen local TimeBlocks. FullCalendar powers the time grid; **Week/Day** and **Show weekends** provide readable views. Existing or newly saved weekend blocks reveal weekends automatically. **+ Time block** or clicking an open time leads to the existing work selection and guarded placement review. Select a block for details, rescheduling/cancellation or the existing Focus entry. Use **Plan this week** for the existing weekly commitment/amendment workflow. Narrow screens provide a single-day calendar and collapsible Work list.

Goals are at `/goals`; old `/?view=archived` bookmarks remain valid. Availability, Integrations, Today and Weekly planning are in **Settings**. The full daily availability report remains on the planning page. See [the R1 report](docs/ui-redesign-r1-report.md) and [reference refinement](docs/ui-redesign-r1-refinement-report.md) for screenshots, verification and known presentation limits. R2 is implemented: Goals → Actions → explicit weekly budget → Calendar, preserving Draft review/commit and immutable amendments. See [the R2 report](docs/ui-redesign-r2-report.md) for interaction rules, responsive screenshots and verification. The supplied Goals / Focus / Review reference is also implemented; see [the workspace tabs report](docs/ui-workspace-tabs-report.md).

## Focus Mode (UI Redesign R3)

Focus now separates a chronological Next / Later today / collapsed Earlier today launchpad from a quiet, full-height active workspace. Start eligible work in one click; End focus records the existing explicit outcome and optional note. Scratch notes stay in tab memory and prefill the end note; leaving or reloading clears them after the browser warning. The saved session/timer still recover. See [R3 report](docs/ui-redesign-r3-report.md) for screenshots, manual QA and exact regressions.

## Feedback & Review (UI Redesign R4)

Daily feedback leads with scheduled time, recorded focus and sessions, followed by compact block results and a prominent reflection. Weekly Review separates summary, direct Carry / Defer / Drop decisions and collapsed historical evidence. Finish a week without opening evidence; Carry still requires a fresh budget and Drop still requires explicit confirmation. Finalized reflections remain readable and immutable. See [R4 report](docs/ui-redesign-r4-report.md) for screenshots and verification. R5A Focus Cycles is implemented below. R5B AI recommendations are implemented below.

## Focus Cycles (R5A)

Open **Goals → Create Focus Cycle** to choose a title, optional intent, local dates and up to 50 owned active Goals. Saving creates a Draft; expand Draft cycles and explicitly Activate when dates include today and at least one Goal is selected. The Current Focus card leads with selected outcomes; other active Goals remain available under a collapsed section. An empty Draft is valid. Edit a Draft or Active cycle to change the horizon/membership without changing any Goal lifecycle or planned work.

There is one Active cycle per account. Start/end dates are inclusive in your current account timezone. When the horizon ends, Finish or Archive explicitly to make room for another; Goals stay active. Future Drafts never activate automatically. Past cycles retain the outcome wording from Finish/Archive, with links to current Goal workspaces. Finished cycles can only be Archived; Archived cycles cannot reopen. Archived Goals remain cycle context until explicitly removed, and are unavailable for new selection.

Calendar labels Current Focus and defaults the work rail to that cycle; expand **Other committed work** for outside Goals. All blocks, facts and selectable commitments stay available. Weekly planning labels current-cycle and other-Goal candidates, preserving deliberate eligibility. Cycle context is live and does not change saved plan evidence.

Run `npm run db:migrate` for additive `0012_focus_cycles.sql` before restarting the app. Existing migrations are unchanged. Exact retries, ownership, expected versions and retained attempted fields follow the existing command conventions. Do not reload an uncertain save before retrying; after a reload, inspect saved cycles before another create. See [ADR 019](docs/decisions/019-focus-cycles.md) and [R5A report](docs/ui-redesign-r5a-report.md) for tests, screenshots and the production restart/non-mutation proof. R5B is implemented below.

## Optional AI coaching (R5B, hardened in R5D)

Run `npm run db:migrate` for additive `0013_ai_coaching_runs.sql`. In `.env.local`, set `AI_PROVIDER=openai` with `OPENAI_API_KEY` and `OPENAI_MODEL`, or `AI_PROVIDER=anthropic` with `ANTHROPIC_API_KEY` and `ANTHROPIC_MODEL`. Choose an exact model ID available to your account supporting structured JSON schema output. No default model is supplied. Restart after environment changes. Leave these unset to keep coaching disabled; Calendar, Goals, Focus and Review continue working.

Use **Coach → Get coaching** in Calendar or **Coach’s perspective** in Weekly Review. **What is shared?** explains the data and destination. Calendar excludes reflection bodies/session notes; explicit Review requests may include finalized weekly/daily text through the existing cutoff, never drafts. Suggestions survive reload without another model call. **Why?** separates server-derived Evidence from Coach prose. Scheduling proposals select legal server candidates; the model cannot provide timestamps. A well-planned week may correctly return no suggestions. **Preview** opens the ordinary editor; **Schedule block** explicitly accepts through existing warning/version/receipt guards. Changed facts require refreshed advice. **Review choices** opens the human workflow.

Keys and SDK construction stay server-only. No chat, autonomous scheduling, amendments, Carry/Defer/Drop choices or Google event writes are added. Tests use dummy credentials and local HTTP fixtures. `AI_FIXTURE_PROVIDER=anthropic npm run test:e2e -- tests/e2e/coaching.spec.ts` exercises Claude's adapter. Fixture names `fixture-openai` and `fixture-claude` are not public model names. Verification and live-QA limitations: [R5D hardening report](docs/r5d-ai-quality-hardening-report.md), [R5B report](docs/ui-redesign-r5b-report.md), [ADR 020](docs/decisions/020-ai-coaching-proposals.md).

## ChatGPT plan connection (R5E)

Run `npm run db:migrate` for additive `0014_chatgpt_connection.sql`, then restart One Better. Keep `BETTER_AUTH_URL=http://127.0.0.1:3100` and configure the server Calendar encryption key ring, or a separate `CHATGPT_ENCRYPTION_KEYS` / `CHATGPT_ENCRYPTION_KEY_ID` ring. No OpenAI client secret or API key is needed for this connection. Keep `.one-better/chatgpt-host.json` across restarts; it is an ignored, opaque installation identity, not a user identity.

Sign in to One Better normally. Open Settings → Integrations → ChatGPT → Continue with ChatGPT, complete the OpenAI consent, select an available account model, then choose Use ChatGPT for coaching. Account/model discovery does not generate advice. Get coaching remains explicit. Connected identity without granted plan permission has a clear disabled state. API-key configuration remains available; reconnect failures never silently substitute another model/provider.

Disconnect removes local credentials before attempting remote revocation and reports whether it was confirmed. Better Auth and planning data remain independent. Normal tests use fake transports; `npm run test:restart` includes rotating-refresh persistence. Live QA uses only frozen disposable data and is recorded separately in [R5E report](docs/r5e-chatgpt-openai-live-qa.md) and [ADR 022](docs/decisions/022-chatgpt-plan-connection.md).
