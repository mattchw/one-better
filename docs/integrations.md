# Integration architecture and safe sync

Status: Phase 4A implements Google CalendarList + FreeBusy advisory only, 2 October 2026. Event-level integration and writes below are deferred options.

## Adapter boundary

Domain types express calendars, instant ranges, normalized event occurrences, external references, capabilities, and failures. Google/Notion/AI request and response types stay inside their provider modules. Services resolve the authenticated connection and inject its adapter; the browser never supplies credentials or an arbitrary remote mutation target.

The following event/write/AI interfaces are deferred illustrative designs only; the current busy-only contract is described below:

```typescript
interface CalendarProvider {
  listCalendars(): Promise<Calendar[]>;
  syncEvents(range: DateRange): Promise<CalendarSnapshot>;
  createTimeBlock(block: TimeBlock, operation: WriteIntent): Promise<ExternalReference>;
  updateTimeBlock(block: TimeBlock, reference: ExternalReference, operation: WriteIntent): Promise<WriteResult>;
  deleteTimeBlock(reference: ExternalReference, operation: WriteIntent): Promise<WriteResult>;
}

interface PlanningAssistant {
  propose(context: ApprovedPlanningContext): Promise<RecommendationDraft>;
}
```

`CalendarSnapshot` includes normalized occurrences, covered range, fetch time, and completeness. `WriteIntent` supplies stable operation ID and desired version. References carry expected remote version and verified ownership. Providers return normalized conflicts/reconnect-required/rate-limit/transient failures; no raw SDK exception escapes the boundary. Concrete adapters expose capabilities such as read-only, app-calendar creation, conditional update, and stable-ID creation. Do not pretend every provider has identical capabilities.

This slightly expands the minimal CalendarProvider sketch to address coverage, idempotency, and conditional writes. It is not a universal integration framework. Phase 4A implements only the Google availability adapter; no placeholder clients or event capabilities.

## Implemented Phase 4A: CalendarList + FreeBusy

The provider boundary is `CalendarAvailabilityProvider`: library-supported authorization/PKCE/code exchange/refresh; `listCalendars(accessToken)`; `queryBusyIntervals(accessToken, calendarIds, range)`; and explicit revocation. Its server-internal credential types never enter planning DTOs. Google response mapping is separate from the pure interval union and application lifecycle. No Events API, source-event mirror, cursor, watch channel, polling or durable job exists.

Request exactly `https://www.googleapis.com/auth/calendar.calendarlist.readonly` and `https://www.googleapis.com/auth/calendar.events.freebusy`. The latter covers accessible calendars, including shared calendars; the own-calendar-only `calendar.freebusy` scope would be insufficient for that selection model. [Google scopes](https://developers.google.com/workspace/calendar/api/auth), [CalendarList reference](https://developers.google.com/workspace/calendar/api/v3/reference/calendarList/list), [FreeBusy reference](https://developers.google.com/workspace/calendar/api/v3/reference/freebusy/query).

Complete paginated CalendarList reads project only ID, summary, primary, timezone and access role; unknown/non-readable roles are excluded. No calendar is selected automatically. Explicit selection caps at the documented 50-calendar single-request limit. Settings entry/manual refresh retrieves the list; inaccessible selected IDs remain visible for deliberate removal. Selection replaces atomically under an owner lock and optimistic version. A repeat of an already-current desired selection is a safe no-op.

FreeBusy retrieves only explicitly selected calendars for local Monday-to-Monday boundaries using current User IANA timezone. Normalize offset-bearing instants, clip and union overlaps/nested/duplicate/adjacent half-open intervals. Split by actual local-day instant boundaries; preserve nanoseconds until minute aggregation. Report busy intervals, seven day totals, weekly busy total and last successful fetch. Never subtract from 168 hours or compute focus capacity, recommendations, reserve, commitment budgets or amendments.

Only complete results replace the minimal owned week/timezone/selection-bound cache. Every requested calendar must return a valid busy array with no errors and the exact requested range. Partial/missing/malformed results are incomplete, never free time. Keep previous complete intervals/fetchedAt and persist a stale failure marker; no previous success means unavailable/null totals. Freshness is 15 minutes, independently of refresh errors. UI age updates locally without polling Google. Selection changes/account switches/reconnect/disconnect invalidate cached timing. Availability uses current User timezone, independently of historical Plan timezone; neither rekeys a Plan.

Credentials use Node/OpenSSL AES-256-GCM with random IVs and owner/resource/purpose AAD, external versioned key ring, server-only code exchange and actual grant inspection. One connection per application User; Google subject is separate and optional. Offline consent uses library-generated PKCE and random state hashed/persisted for ten minutes, bound to actor. Code exchange is claimed once; duplicate callbacks return the stored safe outcome. Reconnect updates the same row; only a verified same subject can retain selection or reuse an omitted refresh credential, and an invalid grant requires a new refresh credential. Expired access refreshes once under the same cross-process owner lock; rejected refresh marks reauthorization_required and stops repeated calls. No network transaction is held open. [Google OAuth guide](https://developers.google.com/identity/protocols/oauth2/web-server), [Google auth library](https://github.com/googleapis/google-auth-library-nodejs).

Disconnect first erases ciphertext/config/cache/pending consent atomically, then attempts bounded provider revocation. Tokens stay in POST bodies/Authorization headers, including revocation; OAuth callback redirects immediately to a fixed clean local URL. Next development callback-request logging is disabled. Failures expose only application-owned safe codes/messages. Real Google verification is separate from deterministic simulated-provider tests. See [ADR 013](decisions/013-freebusy-advisory.md) and [Phase 4A report](phase-four-a-report.md).

### Deferred event-level strategy — only after a concrete product requirement

Earlier event interfaces above and event normalization/cursor designs below describe possible future capabilities. They are not implemented or required for availability. If a later agenda/review/export feature requires event content, justify additional scopes through incremental consent and a new brief. Only then evaluate bounded occurrence snapshots versus a stable collection cursor, pagination, recurrence/moved instances, deletion/tombstone reconciliation and 410 recovery. Never combine rolling time filters with a sync token. Provider-cache resets must leave local planning/history/actuals intact. [Google Events list restrictions](https://developers.google.com/workspace/calendar/api/v3/reference/events/list), [sync guide](https://developers.google.com/workspace/calendar/api/guides/sync). No background infrastructure is presumed necessary by Phase 4A.

## Google writes and event ownership — Phase 5

Request incremental `calendar.app.created` consent to create a dedicated secondary **One Better Focus** calendar and manage its events. Combined with read-only input scopes, this narrows write access compared with all-event access; verify the exact scope/calendar-creation behaviour in the sandbox before shipping. No calendar-wide sharing changes, attendees, invitations, normal-event editing, or recurring focus blocks.

Only linked app-owned events on the registered output calendar are mutation targets. Verify connection, output calendar, remote ID, and private ownership marker before updates/deletes. Title resemblance is never proof of ownership. User-created events on the same calendar remain external busy events and are protected.

Generate a valid Google event ID deterministically from a persisted block export identity; keep it stable across retries. Set opaque private app metadata, not secret credentials or private goal text. Default summary is “Focus”; detailed task titles require opt-in. Google's [event creation guide](https://developers.google.com/workspace/calendar/api/guides/create-events) supports client-generated event IDs for duplicate prevention. Adapter implementation must verify ID-format rules at Phase 5.

### Write protocol

1. Scheduling service validates fresh capacity and expected aggregate versions, writes desired block state plus outbox intent atomically, and returns pending publication.
2. Worker serializes operations per block, skips superseded versions, fetches current selected-calendar coverage, and rechecks validity. New conflicts stop the write for user resolution.
3. For create, use the stable ID. If a timeout or ID conflict occurs, fetch that event and validate ownership/payload before deciding whether create succeeded or an update is required.
4. For update/delete, read the linked event and use its expected version/conditional request where supported. Remote changes yield conflict; never unconditional overwrite. See [Google error handling](https://developers.google.com/workspace/calendar/api/guides/errors) for conflict/precondition and retry behaviour.
5. Persist confirmed reference/version and operation result. If the remote write succeeded but the local acknowledgement failed, the next lease holder reconciles the stable remote identity first.
6. Cancellation is a local tombstone plus linked delete intent. Remote absence confirms the desired deletion, not failure. Verify tombstone/current desired version before any older create retry.

Moving a block updates one linked event. If a user changes/deletes it in Google, record the observed change and a conflicted publication state. Initial writing does not adopt or overwrite either side automatically; a later explicitly designed resolution command may adopt/restore after normal validation. External deletion must not trigger automatic resurrection. Disconnect halts writes and deletes tokens; it leaves exported events in place and explains that state. Deleting them is a separate explicit action.

There is no atomic commit across Google and Postgres. “Synced” means confirmed observed desired state at a particular time; later remote changes still require reconciliation.

## OAuth and token lifecycle

Bind consent state to the current app actor and intended connection. Keep identity and calendar-account IDs separate. Use exact callback allowlists, state/PKCE protections appropriate to Google's supported flow, and least privilege. Phase 4A requests offline access for later on-demand refresh, without background sync; preserve an omitted refresh credential only for the verified same subject on a still-connected grant; never reuse known revoked credentials. Serialize refresh per connection and retain credential version for race protection. Invalid/revoked credentials become reconnect-required. [Google's web-server OAuth guide](https://developers.google.com/identity/protocols/oauth2/web-server) describes offline access and refresh flows.

Encrypt tokens server-side with a rotatable key external to the database. Provider tokens never belong in browser session payloads, local storage, query strings, AI context, or logs. Test refresh, denial, reconnection, scope upgrade, and disconnect. Verify consent-screen/testing-mode restrictions and app-verification requirements before a hosted pilot; do not promise permanent background access based on a single successful test login.

## Future job/write retry and idempotency rules

| Situation | Rule |
| --- | --- |
| Rate limit/transient 5xx/network read failure | Bounded exponential backoff + jitter; respect retry hints, surface persistent failure |
| Expired access token | Serialize refresh once, then retry; revoked refresh pauses connection |
| Permission denied/malformed request | No blind retry; show actionable permission/configuration failure |
| Unknown write outcome | Read/reconcile stable identity before any repeat mutation |
| Remote version mismatch | Conflict; user resolution, not overwrite |
| Worker crash/expired lease | Another worker may repeat safely; no exactly-once claim |
| Duplicate local request | Stored mutation receipt returns original committed result |
| Remote event manually deleted | Conflict/unpublished; no automatic recreate |

Use at-least-once jobs, durable operation keys, per-block ordering, and bounded retries (initial proposal: five attempts then visible failed state/manual retry). Logs include sanitized codes/request IDs. Manual retry revalidates current intent and permissions rather than replaying obsolete payloads.

## Notion — Phase 10

Select a specific project/page/data source and preview a mapping into goal context or candidate actions. Import only chosen items, with provenance and stable external IDs. Keep local fields app-owned after import; later source changes appear as a diff for explicit refresh. Deletion or revoked access at source marks it unavailable, not a command to delete local work. Deduplicate reconnect/import by stable source account+page identity; no automatic whole-workspace ingest or two-way editing.

Before implementation, verify the current official Notion API version and data-source/database distinction, scopes, pagination, and rate limits. The documentation retrieval during this design did not establish the query endpoint sufficiently to lock a version/schema. That uncertainty does not affect the core MVP and is a Phase 10 spike gate.

## OpenAI / Anthropic — Phase 9

Map a shared recommendation schema to OpenAI's Responses structured output and Anthropic's structured output capability. Keep SDK types, supported schema differences, refusal/length-limit handling, and usage accounting in each adapter. Validate both shape and domain meaning. [OpenAI documentation](https://developers.openai.com/api/docs/guides/structured-outputs) and [Anthropic documentation](https://platform.claude.com/docs/en/build-with-claude/structured-outputs) support schema-constrained output; this does not establish that a suggested plan is valid.

Store proposal kind, payload, rationale, input plan/settings versions, provider/model/prompt/schema version, and proposed/accepted/rejected/stale status. Acceptance is a user action; atomic idempotent command submission then validates current state and schedules through the deterministic service. Models have no tools for calendar writes. Start with one implemented provider and a fake contract; add the second when there is a user need and a small shared evaluation set. Do not silently send private data to another provider on failure.

AI is disabled by default. Show the included context before consent; prefer aggregate busy minutes over meeting details. Imported instructions are untrusted data. No calendar descriptions, credentials, or full Notion workspace contents by default. Set per-request/time/cost budgets; validate provider-specific retention/data controls when the feature is enabled. The future integration is API-backed; access or billing through a ChatGPT subscription is not assumed.

## Later integrations and priority

Dependency-aware sequence: **Google Calendar first; core loop through weekly reviews; optional AI assistance; selective Notion import; Slack; then Jira/GitHub**. If selective Notion context proves more useful than AI, swap Phases 9 and 10; both depend on a useful manual loop, not on each other. Google Tasks is postponed.

Slack may protect a user-started focus session with bounded DND and reliable restoration on finish/failure; it must never send messages without explicit user authorization. Jira/GitHub may provide read-only candidates linked to chosen goals before any workflow updates. Each requires a concrete user journey, ownership/permission rules, an idempotency/retry design, and contract tests before becoming an adapter.

## Deferred event connection and incremental reconciliation contract

IntegrationConnection is owned by the application User, independently of authentication accounts. It records provider/account identity, state, granted scopes, encrypted token/credential metadata and key/version, last successful sync, sanitized last sync error, revocation time, and reconnect-required state. Login never requests Calendar scopes, and the connected Google account need not equal the login account.

Three ownership categories remain explicit: ExternalCalendarEvent is a read-only source mirror; TimeBlock is internal intent; a focus-calendar event is an external projection linked by stable ExternalReference and application-specific private metadata. Application writes target only the registered dedicated output calendar and verified linked events. Initial writing represents external edits as conflicts; unrestricted bidirectional conflict resolution is postponed.

If incremental collection sync is introduced, persist a cursor per owned connection/calendar/query profile. Initial full sync pages into a new generation and only promotes it and persists nextSyncToken after all pages commit. Incremental requests reuse the compatible fixed query profile and old token, page through all results, apply deleted/cancelled occurrence tombstones, then atomically advance the token. A page/commit failure retains the previous cursor and retries idempotently. Invalid token/410 invalidates only that provider cache/cursor and builds a new full generation; local plans, TimeBlocks, actuals, and outbox intents survive. Never combine rolling range filters with a token. Resource versions remain required for later writes, and partial remote success is reconciled before retry. No Calendar code, cursor table, or job runner is built in Phase 0.

## Implemented Phase 4B — independent Focusable Hours

**Focusable Hours ≠ Calendar-open Focusable Time ≠ Manual Weekly Capacity ≠ Commitment Capacity ≠ Scheduled Time ≠ Actual Focus Time.** Owned recurring local windows describe willingness, not human capacity. Pure expansion/union/intersection/subtraction with the existing selected-calendar complete busy snapshot returns concrete advisory intervals and daily/weekly elapsed-minute totals. Manual capacity minus explicit reserve still determines commitment capacity. Nothing automatically changes a Draft, committed baseline, amendment, source or budget; extra open time creates no obligation.

`src/modules/availability` owns one optional versioned weekly configuration and pure derivation. ISO weekdays 1–7, integer minutes, 24:00 end, empty days/schedule, same-day overlap rejection, adjacent authored windows retained. Full-state saves reuse optimistic versions and atomic owner-scoped receipts. Current User IANA timezone controls live expansion, explicit Temporal compatible gap/fold resolution is explained in the UI, and half-open instant intervals preserve actual DST elapsed time. Derived intervals have no table or additional cache. Fresh/stale/unknown/incomplete status inherits Phase 4A coverage; disconnect retains hours and makes open time unknown. Finished weeks omit the live advisory; history is not reconstructed from today's preferences.

Read-only Calendar scopes/provider logic are unchanged. No TimeBlocks, scheduling, Calendar writes, one-off exceptions, buffers, minimum block size, automated capacity/reserve/amendment, focus/actuals, jobs or AI. Earlier future scheduling/daily-cap/override examples are proposals only; [ADR 014](decisions/014-focusable-hours-and-advisory-open-time.md) is authoritative for this slice. Exact results and next-slice proposal: [Phase 4B report](phase-four-b-report.md).

## Phase 5A boundary: local TimeBlocks, unchanged read-only Google

Scheduling consumes the already normalized owned Calendar cache and creates local application records only. It makes no Calendar provider request, event write, output calendar or new scope. Known busy overlap requires explicit acknowledgement; stale timing is labelled, and incomplete/unavailable/out-of-covered-range timing is unknown. Existing CalendarList/FreeBusy adapter, identity separation, encryption, selection and coverage semantics remain unchanged.

Local acceptance is not external publication or a promise that Google will stay clear. Before any future Calendar-writing phase: prove the local model useful, complete a real Google OAuth + FreeBusy walkthrough with an actual test account, and separately design write ownership/conflict/reconciliation semantics. This phase's provider/browser/manual checks remain simulated. See [ADR 015](decisions/015-local-time-blocks.md) and the [Phase 5A report](phase-five-a-report.md).

## Phase 6A authoritative local execution contract

FocusSession belongs to one owned TimeBlock and inherits its frozen Plan/logical commitment/Action/Goal/optional Milestone context. Start/end use server time, the established receipts and shared owner lock. PostgreSQL enforces one active session per owner; ended history cannot be edited or reopened. Current User-local planning week only, regardless of exact planned clock time; dropped work requires explicit acknowledgement. Existing active sessions remain recoverable across midnight/week/restart and can end independently of amendments/source state.

Any session locks its TimeBlock's original planned interval/state against normal reschedule/cancel. Sequential sessions are allowed. Ended duration derives precisely from timestamps for every outcome; live Focus adds active elapsed only in labelled “so far” totals. Action estimate, commitment budget, scheduled time and recorded session time remain independent. No pause/segments/heartbeat, auto-timeout/completion, correction, review, suggestions, AI, external side effect or Calendar writing. Earlier focus roadmap examples are deferred and superseded for this slice. See [ADR 016](decisions/016-focus-sessions-and-execution-lock.md) and [Phase 6A report](phase-six-a-report.md).

## Phase 6B implemented semantics — 3 October 2026

Daily Execution and Reflection are entirely local. No Google request, OAuth scope, Calendar write, sync job, AI call or integration adapter is added. Google busy advisory remains independent from local execution facts. Manual real-Google OAuth/calendar list/FreeBusy/refresh/reconnect/disconnect verification is still required before any future Calendar-write slice; automated fixture results do not prove that external operational gate.

## Phase 7A — Weekly Review and Deliberate Rollover

Finished committed User-local weeks support one owned explicit-save Draft → terminal WeeklyReview. Derive every logical commitment ever present in the baseline/ordered Amendments, original/final summaries, independent scheduled and exact week-intersected Focus actuals, and daily reflection context. Seven-date finalized context uses DailyReflection.finalizedAt <= WeeklyReview.finalizedAt; later finalized daily text is excluded without copying bodies. Action lifecycle remains authoritative, with no scores or inferred completion.

Explicit Carry needs a fresh 1–10,080-minute proposal, Defer keeps work ordinarily available, Drop intentionally archives via the existing Action transition during atomic review finalization. Revalidate all inspected Action/parent guards; any conflict/failure rolls back Review, Drops and receipt. Finalized Carry is intent only: following-week Planning explicitly adds eligible work through the existing Draft-save transaction with owned review/decision proof, a fresh new-week identity and editable chosen budget. No automatic Plan, Amendment or rollover. [ADR 018](decisions/018-weekly-review-and-deliberate-rollover.md) is authoritative; [Phase 7A report](phase-seven-a-report.md) records verification. Stop after this slice and run a real full-week dogfood gate before choosing features.

## R5B optional AI providers

Server-only OpenAI Responses and Anthropic Messages adapters implement a narrow provider-neutral coaching interface. Set the selected provider's key and exact model in server environment configuration; no key database or browser credential input exists. Both request JSON schema output, have no tools/repository access, and generate only on explicit request. Calendar coaching excludes reflection bodies; Review includes permitted finalized text only. Google stays read-only and independent. See [ADR 020](decisions/020-ai-coaching-proposals.md) and [R5B report](ui-redesign-r5b-report.md).

## R5E ChatGPT plan usage

Settings → Integrations → ChatGPT uses the official local-app PKCE flow with stable installation host ID and an exact `127.0.0.1` callback. Better Auth stays separate. Validated identity alone does not permit inference: granted direct-plan/resource scopes, available account model selection and explicit Use ChatGPT for coaching are required. Local encrypted credentials never reach the browser. Model catalogs use display names and persist exact slugs; no automatic replacement occurs. Responses use `store:false`, `stream:true` and only succeed after terminal completion. Completed stream items are retained because the plan route can omit output from the terminal envelope. Token usage is ChatGPT plan usage, not an inferred dollar API bill. [ADR 022](decisions/022-chatgpt-plan-connection.md), [R5E evidence](r5e-chatgpt-openai-live-qa.md).

### R5F Review contract

Explicit Weekly Review generation uses the shared Review-only candidate-selection schema and prompt through OpenAI API-key Responses, ChatGPT OAuth Responses or Anthropic Messages. Calendar keeps its existing contract. Anthropic transport removes the unsupported Review `maxItems` keyword from a clone; the application still rejects more than two insights. No retries, provider-specific semantic tuning or AI mutation capability were added. Finalized reflection text remains limited to explicit approved Review context. [R5F evidence](r5f-weekly-review-evidence-quality.md) records live compatibility, safety and usefulness independently.
