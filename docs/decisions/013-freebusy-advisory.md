# ADR 013 — FreeBusy advisory, without event synchronization

Status: implemented for Phase 4A. Date: 2 October 2026. Supersedes the assumed event-sync prerequisite in ADR 004; preserves its future write-ownership safeguards.

## Decision

Use Google CalendarList and FreeBusy only. They answer which calendars the user can select and what timing Google reports as busy. They are sufficient for Calendar load alongside independently chosen weekly focus capacity. Event content and an event mirror have no justified current use. Event synchronization remains a future option requiring its own approved feature, scopes and acceptance contract.

Use the maintained `google-auth-library` 11.1.0 for confidential-server authorization-code exchange, S256 PKCE, offline access, actual-grant inspection and refresh. Request exactly `https://www.googleapis.com/auth/calendar.calendarlist.readonly` and `https://www.googleapis.com/auth/calendar.events.freebusy`. The latter allows busy timing on accessible shared calendars; it is not event-content read permission. The own-calendar-only `calendar.freebusy` scope would not support the requested selection model. Verify against [Google scopes](https://developers.google.com/workspace/calendar/api/auth), [CalendarList](https://developers.google.com/workspace/calendar/api/v3/reference/calendarList/list), [FreeBusy](https://developers.google.com/workspace/calendar/api/v3/reference/freebusy/query) and [web-server OAuth](https://developers.google.com/identity/protocols/oauth2/web-server).

Application identity remains Better Auth User. Calendar is a separate, explicitly initiated, owned grant, even when its Google subject differs from login. One connection row per application owner transitions connected → reauthorization_required or disconnected; reconnect updates its identity rather than creating duplicates. Never use Google identity as application ownership. OAuth state is random, hashed in PostgreSQL, bound to the verified actor and ten-minute expiry; the PKCE verifier is encrypted and consumed before exchange. Exact configured callback URI, fixed clean redirects, no-referrer and sanitized request/error logging protect credentials.

## Storage and concurrency

Add only owned connection, pending OAuth flow and last-successful availability cache tables. Node/OpenSSL AES-256-GCM with random IV, authenticated owner/resource/purpose context and external versioned keys encrypts access/refresh credentials and PKCE verifier. No plaintext token is a column or DTO. Disconnect atomically erases local secrets, selection, list and cache before attempting bounded remote revocation; a failed revoke cannot retain usable local credentials. Backups require separate retention/key management.

CalendarList is paginated and reduced to ID, display name, primary flag, timezone and readable role. Choose zero to fifty calendars explicitly, including primary; no batching. Inaccessible old selections remain visible for deliberate removal. Version-bound selection commands serialize under a PostgreSQL per-owner session advisory lock, shared across server processes. Identical desired-selection retries are safe no-ops; stale different choices require review. The lock also prevents refresh/callback/disconnect races. Network requests do not hold a SQL transaction. No mutation receipts or job framework are added for Calendar reads.

## Timing and resilience

The normalized provider boundary returns offset-bearing instants with start < end. Pure interval union clips to the requested half-open local Monday-to-Monday range, sorts, and merges overlap, nesting, duplication and adjacency. Local day boundaries use the current User IANA timezone and calendar-date arithmetic, including 23/25-hour days; `@js-temporal/polyfill` is a date/time library, not the Temporal workflow service. Exact busy minutes precede display rounding.

Only complete successful selected-calendar results replace the cache. Missing/invalid calendar results or any per-calendar error are incomplete, never free. The cache is bound to connection, selection fingerprint, week and timezone, with original fetchedAt. Failed refresh preserves intervals and successful timestamp, marks stale, and gives a safe explanation. Freshness lasts fifteen minutes; reload reads cache without contacting Google. A browser-local freshness clock makes an open view become stale without polling. Without a complete prior result, availability is null/unavailable. A successful empty result can legitimately report zero busy minutes.

Google-reported busy time is factual context. Do not calculate focus capacity, 168-hours-minus-busy, recommendations, utilization, reserve or commitment budgets. Calendar operations have no write dependency on Goals, Milestones, Actions, Plans, baselines, amendments or their receipts. Existing manual decisions and history remain authoritative.

## Consequences and deferred work

Least privilege and much less private data; no event titles, descriptions, attendees, event IDs/resources, recurrence expansion, sync-token recovery, event tables, event webhooks, polling, durable jobs, writes or scheduling. On-demand refresh may leave stale context until the user refreshes. Fifty-calendar limit and serialized per-owner operations are deliberate local-slice constraints. Real consent/verification, production secret management, trusted proxy log redaction, backups and hosted operation require deployment work. See the [Phase 4A report](../phase-four-a-report.md).

Propose Phase 4B only: explicit focusable-hours preferences and pure subtraction of known busy intervals from those windows, still advisory and independent of Weekly Plan capacity. Define DST, unavailable/partial data and persistence rules before implementation. Do not implement it or request Calendar writes now.
