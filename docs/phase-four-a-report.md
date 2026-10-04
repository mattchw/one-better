# Phase 4A — Google Calendar connection and Free/Busy advisory

2 October 2026. Phase 4A only. All 47 acceptance cases are demonstrated below; Phase 4B is a proposal only.

## Delivered behavior

Authenticated Integrations supports explicit Google consent, account reconnect/switch, paginated readable calendar choices, version-safe selection and intentional disconnect. Weekly Planning displays Calendar load directly after the manual capacity summary, with per-local-day and weekly Google-reported busy minutes, last successful fetch, timezone, freshness and an explicit advisory explanation. Opening Planning never triggers consent or a provider query; refresh is intentional. Visiting connected Integrations refreshes CalendarList metadata only. No calendars, including primary, are automatically selected.

Calendar load does not calculate focus capacity or change capacity, reserve, commitments, budgets, amendments, Actions, Goals or Milestones. Existing Draft editing, explicit commitment and immutable amendment/history workflows continue independently. No event content, event synchronization, scheduling, Calendar writes, jobs, focus mode, actuals, AI or other adapters were implemented.

## OAuth, identity and tokens

`google-auth-library` 11.1.0 handles the confidential-server authorization-code flow, S256 PKCE, offline access, server token exchange, grant inspection and refresh. Authorization requests exactly:

- `https://www.googleapis.com/auth/calendar.calendarlist.readonly`
- `https://www.googleapis.com/auth/calendar.events.freebusy`

The second scope permits busy timing from accessible/shared calendars; `calendar.freebusy` is narrower to owned calendars and would not satisfy shared-calendar selection. Neither selected scope grants event-content reads or writes. No OpenID/email permission is added just to identify Calendar. Token-info subject is stored only if supplied; otherwise account-switch handling is conservative. Scope decisions were checked against current [official scopes](https://developers.google.com/workspace/calendar/api/auth), [FreeBusy](https://developers.google.com/workspace/calendar/api/v3/reference/freebusy/query), [CalendarList](https://developers.google.com/workspace/calendar/api/v3/reference/calendarList/list), [OAuth web-server flow](https://developers.google.com/identity/protocols/oauth2/web-server), and the [maintained Node client](https://github.com/googleapis/google-auth-library-nodejs).

Better Auth login is unchanged. Server session → Actor determines every connection/flow/cache owner; a different Google subject never changes application identity. One connection is unique per owner, with connected, reauthorization_required and disconnected states. Reconnect updates that owned ID. A verified identical subject can retain selection; a different or absent subject clears selection/cache. An omitted refresh token is reused only for a verified identical subject whose existing connection remains connected; a known revoked grant cannot be reused.

Random 256-bit state is hashed in PostgreSQL, bound to actor and ten-minute expiry. The encrypted PKCE verifier is removed when callback claims processing, before exchange. Used callbacks replay their safe outcome; a crash/uncertain exchange requires a fresh connect rather than exchanging twice. Starting a second consent invalidates the first pending flow. The exact redirect URI is configured server-side, including origin/path. The callback validates its Host against that configuration (Next normalizes loopback Request.url to localhost), strips query credentials with a fixed 303 Integrations redirect, and sends no-referrer/no-store. Unsafe raw library exceptions and callback request URLs are excluded from application logs. A deployment reverse proxy must also redact the callback query; this app cannot configure external access logs.

Node/OpenSSL authenticated AES-256-GCM encrypts both tokens together and the PKCE verifier. The versioned envelope carries active key ID, random 96-bit IV, 128-bit tag and ciphertext; authenticated context binds owner/resource/purpose. Keys are 32 random bytes, base64 in server-only ignored environment configuration, outside the database/source. Rotation retains old read keys and uses a new active write key; losing old keys requires reconnection. DTOs omit tokens, encrypted envelopes, granted scopes and provider subject. Encryption tests actually inspect ciphertext/plaintext markers and tampering, rather than relying on a flag.

Access expiry triggers one refresh; an authorization rejection permits at most one refresh and one API retry. Grant scopes and subject are checked again. Refresh rejection marks reconnection required and stops subsequent automatic attempts. Revocation uses the client library's transport with POST form body so a token never becomes a revoke URL query. Every provider HTTP attempt has a ten-second abort/timeout and automatic transport retries are disabled. Disconnect first atomically clears local credentials, subject, scopes, selection, list, cache and pending flow; then attempts remote revocation. A failed revoke is shown truthfully and local cleanup still succeeds. Repeated disconnect is safe; an acknowledgment retry cannot prove a prior remote revoke succeeded.

## Selection and provider boundary

`CalendarAvailabilityProvider` exposes authorization/exchange/refresh/revoke plus normalized `listCalendars` and `queryBusyIntervals`. OAuth credentials are server-internal. Google API payloads stay in the adapter; Weekly Planning imports neither Google types nor provider services.

CalendarList follows all pages (250 entries/page), with repeated-cursor and 100-page guards. It stores only ID, summary, primary, timezone and readable accessRole, including freeBusyReader, reader, writer, writerWithoutPrivateAccess and owner. Deleted/unreadable entries are filtered. List failure preserves the previous list and returns a safe error. A missing selected ID remains visibly unavailable; it is not replaced. The user must remove it before saving. Selection is distinct, sorted and capped at fifty, matching the single FreeBusy request limit. Metadata refresh changes the version only for structurally changed entries, independent of JSONB object-key ordering.

Selection commands carry expectedVersion. A different stale selection returns the established 409 conflict and retains unsaved UI choices until explicit review. An exact already-current desired selection is a safe no-op, including a lost-ack retry. Successful selection changes delete old cache snapshots. Calendar writes serialize using a per-owner PostgreSQL session advisory lock across processes, preventing callbacks/selection/refresh/disconnect from restoring obsolete credentials or cache. SQL transactions are short, not held during provider network calls. Reads use repeatable-read, read-only snapshots. No Calendar command receipts, job system or background polling were introduced.

## Instants, union, DST and cache

Busy intervals require unambiguous RFC3339/offset-bearing instants and start < end. Pure union clips to the half-open requested range, sorts by instant, merges overlapping/nested/duplicate/adjacent intervals, and discards portions outside the week. Adjacent ranges deliberately merge. Overlapping Work/Personal time counts once. Nanosecond arithmetic preserves sub-minute values before display rounding; day/weekly summaries are Google-reported busy minutes only.

The requested date must be a valid Monday. Boundaries are local Monday start through the next local Monday start in the **current User IANA timezone**, independent of a historical Plan's frozen timezone. Local calendar-date addition yields each day boundary, including DST and midnight transitions; there is no 24-hour-day assumption. Tests cover Europe/London spring 167-hour and autumn 169-hour weeks, 23/25-hour Sundays, cross-midnight and boundary clipping. `@js-temporal/polyfill` 0.5.1 is used solely for dates/instants, not Temporal workflow infrastructure.

Only a validated complete result for every selected calendar replaces last-successful cache. Missing calendars, malformed ranges, invalid intervals, response errors or mismatched request boundaries make availability incomplete. A complete empty result legitimately reports zero; failures never become zero/free. Cache identity includes owner/connection, Monday date, timezone and SHA-256 fingerprint of selected IDs; it stores merged timing, successful fetchedAt and a safe failure classification only. Selection/account changes invalidate it; timezone/week changes cannot reuse another range.

Freshness is fifteen minutes. Reload reads cached data without a Google call. Age or failed/incomplete refresh marks prior timing stale and retains the original fetchedAt and intervals; the open browser also updates its freshness label without network polling. No prior complete success means unavailable with null timing/totals. Failure details without a prior cache are transient; after reload the unavailable state remains but the preceding provider failure reason is not persisted. CalendarList failure is recorded separately from availability freshness. Cache is advisory external context, never frozen into Plan baselines or amendments.

## Database and privacy evidence

Additive reviewed migration `0006_calendar_freebusy.sql` adds `google_calendar_connection`, `calendar_oauth_flow` and `calendar_availability_cache`, with ownership foreign keys, one-connection/flow uniqueness, cache week/timezone identity, lifecycle/JSON/selection constraints, and indexes created before their composite foreign keys. Migrations 0000–0005 remain byte-for-byte unchanged. Runtime health now checks all fifteen required tables. No event table, sync token, attendee/title/description/event-ID column or raw-provider payload store exists.

Provider fixtures deliberately include unused metadata to prove the whitelist discards it. Automated tests use only synthetic OAuth markers, never real Google credentials. The simulated server is an external loopback fixture, not an app route or authentication bypass: both browser and restart tests use real Better Auth sessions. Custom Google endpoints require loopback app/database, explicitly named execution_test database and exact dummy test client values. Real deployment configuration cannot enable that seam. Logs are checked for synthetic code/access/refresh markers in production restart proof. Real PostgreSQL verification compares all Goal/Milestone/Action/Draft/baseline/Amendment/receipt rows before and after Calendar operations and requires exact equality, including technical versions and timestamps.

## Acceptance evidence

| Brief cases | Demonstration |
| --- | --- |
| 1–7 connection, state, grants, secret isolation/encryption | Service/provider tests; real-session browser consent against isolated fake; PostgreSQL raw ciphertext assertions; production restart/log proof |
| 8–9 distinct identity and app ownership | Different synthetic Google subject; unchanged app account; actor-scoped services/SQL and restart proof |
| 10–15 paginated readable list, explicit persisted selection, inaccessible review | Adapter fixtures with second page/unreadable role; service/SQL selection; browser none-auto, reload and missing-calendar removal |
| 16–23 normalized ranges/union/day/timezone/DST | Pure domain fixtures, service range assertion, adapter mapping; clipping, nesting, adjacency, midnight and both DST transitions |
| 24–27 capacity/reserve/commitments/amendments unchanged | Exact full-table PostgreSQL equality; browser compares planning facts before/after; production restart row equality |
| 28–32 unavailable/partial/stale/revoked | Domain/service/SQL and browser failure fixtures; complete prior snapshot and fetchedAt retained; reconnect state and bounded attempts |
| 33–37 deliberate disconnect, revocation/cleanup, unchanged sources/history | Cancel-first browser dialog/Escape focus; SQL cleanup including pending flow; failed revoke; refresh/disconnect race; equality assertions |
| 38–42 no event content/raw resources/real credentials | Minimal schema/DTOs, whitelisted fixture mapping, narrow-scope assertions, synthetic external test provider and log-marker assertions |
| 43–44 foreign/missing isolation | Every connection surface uses actor; service/SQL/browser matching 404s; anonymous 401 and invalid Origin 403 |
| 45–47 reload and actual restart persistence/freshness | Browser reload plus production process stop/start twice with identical selection, fresh cache then failed-refresh stale cache and original fetchedAt |

## Exact verification results

Final complete suite, including previous Phase 0–3B checks:

| Check | Result |
| --- | --- |
| `npm test` | PASS: 181 domain/service/provider tests, 15 files (119 previous + 62 new) |
| `npm run test:db` | PASS: 166 real PostgreSQL tests, 7 files (150 previous + 16 new), freshly migrated disposable database |
| `npm run test:e2e` | PASS: all 57 browser tests (47 previous + 10 new), isolated database/real auth/simulated Google; 2.1 minutes |
| Test total | **404 PASS**, including all 316 prior tests and 88 Phase 4A tests |
| `npm run lint` / `npm run typecheck` | PASS, zero ESLint warnings and no TypeScript errors |
| `npm run docs:check` | PASS: required documents, local links and fences |
| `npm run build` | PASS: Next 16.3.8 optimized production build, all existing/new routes; compile 3.5s, build TypeScript 3.4s |
| `npm run test:restart` | PASS: previous production proof plus new Calendar proof, **four actual stop/start cycles** in total; fresh and stale timing retain exact fetchedAt; browser reload and every Calendar read/mutation returns 503 for unavailable database |
| `npm audit` | PASS: **0 vulnerabilities** at every severity |
| Local migration / previous migrations | `npm run db:migrate` PASS; migration 0006 applied to the local app; SHA-256 for every 0000–0005 SQL matches pre-change values |
| Manual simulated product gate | PASS; separate production app/temporary database cleaned up; all planning/source/history/receipt rows compared exactly unchanged |

The first full browser run passed 54/57: reconnect UI correctly removed its refresh button, which an old test helper still expected; two Milestone tests raced login/save completion. The helper now accepts the reconnect action, the existing real-login helper honors the production rate limiter, and the concurrency test waits for the first save to complete before submitting its stale proposal. Production auth and the stale-conflict assertions were not weakened. The subsequent full 57-test run passed with zero retries. Earlier development checks found and fixed Next's loopback callback-host normalization, JSONB key-order comparison and Disconnect focus restoration. Hosted CI has not been run; its workflow invokes the same suite.

## Product quality gate and real-provider status

Performed manually through the Codex browser against a separate production app on port 3104, a newly created disposable PostgreSQL database and an external **simulated Google provider**. Real Better Auth login used a dedicated synthetic account; the real OAuth client performed exchange/PKCE/grant checks against that fixture. Seeded the requested 12h capacity / 3h reserve / 9h usable / 6h30 committed / 2h30 breathing room, then explicitly selected Work and Personal (Team Holidays remained unselected). No live Google account was used.

Observed Mon 3h, Tue 5h30, Wed 2h, Thu 4h, Fri 1h, Sat/Sun 0m: merged weekly 15h30. Overlapping Monday Personal timing counted once. Capacity and commitments stayed exactly as seeded. Failed refresh showed the same complete timing and original 17:59 successful fetch as stale; reload retained both. Integration choices survived navigation. Disconnect initially focused Keep connected; Escape restored the trigger; deliberate disconnect removed Calendar context while the same capacity/commitments/history remained visible. The walkthrough script compared every planning/source/history/receipt row before/after and passed, then removed only its own test database/server. The normal local preview was rebuilt/restarted on port 3100.

Product findings:

- Busy-day pattern helps question whether the chosen 12h is realistic: Tuesday/Thursday deserve attention. It cannot establish actual focus capacity without explicit focusable-hours windows; no recommendation is inferred.
- The separate modest Calendar section directly under the manual summary, explicit advisory sentence and independent refresh make the distinction clear. The green manual capacity summary remains primary; busy load is not an over-capacity validation error.
- Seven daily values make busy days quick to compare. Daily totals alone do not locate intraday openings; this is a useful limitation for a narrowly defined next phase.
- Zero-busy weekends have no empty slots, fill prompts, recommended extra Actions or inferred obligation. The protected reserve and “Breathing room is healthy” message stay prominent.
- Calendar information adds useful context without an event-card UI, agenda clone or scheduling controls. No event titles are needed for the demonstrated capacity decision; any later title-based use needs a concrete new requirement and separately justified permissions.
- This is an engineering walkthrough with realistic fixture data, not evidence from a multi-week productivity pilot or live Google usage. Real use should validate the observations before Phase 4B authorization.

Visual proof is saved locally at `.cache/visual/phase-four-a-calendar-load.png` (ignored test artifact, intentionally outside product/source data). Repeatable fixture command: `npx tsx --env-file=.env.test scripts/calendar-walkthrough.ts`; use a **separate browser profile** from normal localhost usage. Cookies are host-scoped across ports: this run replaced the in-app browser's normal sign-in cookie, leaving the final preview at sign-in. Stored application sessions and user data were not erased. Future walkthroughs should isolate browser storage as well as database/server. Automated browser tests already use isolated contexts.

Local Google OAuth client/secret/keyring are **not configured**. No real Google consent, CalendarList, FreeBusy, token refresh, disconnect or reconnect was performed. No claims of live-provider verification are made. Configuring the documented credentials and Google consent project is required for that follow-up; automated tests do not depend on a developer account.

## Deviations, limitations and deliberate deferrals

The user-approved brief replaces assumed event synchronization with CalendarList/FreeBusy and no jobs. One minimal connection per owner, fifty-calendar cap, fifteen-minute freshness, adjacency union, transient no-cache failure reasons and conservative missing-subject reconnect are explicit implementation choices. Two small dependencies implement maintained OAuth and correct date arithmetic; no generic integration platform was added. Optional timeline was omitted: the daily pattern is sufficient for this first advisory decision, and windows/open-time semantics remain undefined.

No live Google verification yet. Local single-user deployment assumptions continue: ignored environment keyring rather than managed KMS, development database role, no hosted OAuth consent verification, no production proxy/security operations or validated backup retention. Old database backups may retain encrypted revoked credentials until separately expired; active application persistence is erased on disconnect. Calendar names themselves are private metadata and should remain access-controlled. App logging is sanitized; external request/proxy capture needs explicit redaction. CalendarList pagination caps at 100 pages; ten seconds is per request rather than an aggregate list deadline. Owner operations serialize and occupy one database connection; there is no distributed work queue or cancellation UI. Same-account selection is retained only when token-info establishes the same subject. An OAuth crash after claim requires restarting consent. Unsaved/uncertain choices remain browser-memory only, following existing conventions.

No event content reads, event sync/tokens/mirror, recurrence processing, webhooks/watch, polling, durable jobs, Calendar writes/timeblocks/dedicated output calendar, drag/drop, automatic capacity/reserve/budgets/amendments, focusable-hours settings, AI/recommendations, focus/actuals or Notion/Slack/Jira/GitHub/LLM adapters. Existing future architecture options are marked deferred, not dependencies of this slice.

## Proposed Phase 4B only

Evaluate **Focusable Hours + Deterministic Calendar-Open Time** after real 4A use. Persist explicitly chosen local weekday windows; validate overlap, cross-midnight and timezone edits; define DST gap/fold behavior. Purely subtract complete known busy timing from those windows to expose calendar-open focusable intervals/minutes. Clearly distinguish fresh, stale and unavailable inputs and avoid treating missing timing as open. Keep manually chosen Weekly Plan capacity, reserve, commitment budgets and amendments independent, with no automatic writes. Test window persistence, union/subtraction, boundary/DST cases, freshness and full planning non-mutation. Stop before Calendar writing or recommendations. Nothing in 4B is implemented here.


## Local configuration follow-up — real Google redirect attempt

After completion, the user supplied matching real Google client ID/secret in the ignored local environment files. Added the missing exact `http://127.0.0.1:3100/api/calendar/callback` redirect and a newly generated 32-byte server-only AES key ring in ignored `.env.local` (permissions 0600), with no secret values printed. Configuration validation confirms the real provider is selected; restarted the existing production preview without rebuilding or changing application code.

Through the authenticated Integrations UI, Connect now enables and redirects to the real Google authorization service. Google rejects this client request with **Error 400: redirect_uri_mismatch**. The supplied OAuth client's Google Cloud configuration must register the exact local callback above as an Authorized redirect URI. Google documents the exact-match requirement in its [web-server OAuth guide](https://developers.google.com/identity/protocols/oauth2/web-server#authorization-errors-redirect-uri-mismatch). Returned the browser to Integrations for a fresh retry once that external setting is saved.

This is a real authorization-redirect attempt, not a successful consent/API walkthrough. No Calendar authorization completed, no access/refresh tokens were received and no CalendarList/FreeBusy data was fetched. The previous automated verification results remain unchanged. Local evidence is `.cache/visual/google-calendar-redirect-mismatch.png`.
