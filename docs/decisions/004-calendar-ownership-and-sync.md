# ADR 004 — read-only inputs and a dedicated focus calendar

Status: accepted with review amendments. Date: 2 October 2026.

## Context

Capacity needs trustworthy calendar coverage. Calendar writes cross a transactional boundary and can fail after remote success. Normal meetings must remain protected. Scope grants alone do not prove an event belongs to the app.

## Decision

Phase 4 reads selected calendars through complete bounded occurrence snapshots. Poll first; no rolling sync-token filter. Phase 5 requests app-created-calendar write capability and creates one dedicated focus calendar. Only blocks with verified local references and remote ownership markers can be mutated.

Use stable provider-valid event IDs, desired-vs-observed state, durable outbox operations, at-least-once jobs, reconciliation after ambiguous results, and remote-version conflict checks. Tombstones prevent resurrection. Initial external moves/deletions are recorded as conflicts without overwriting either side; unrestricted bidirectional resolution is deferred. Reconnect/disconnect does not automatically delete events.

## Alternatives and consequences

Writing onto the primary calendar feels familiar but grants unnecessary authority and makes unrelated-event protection harder. A dedicated calendar adds a setup/toggle step but provides a visible boundary and easier removal. Calendar-only state fails to preserve task/plan/actual relationships; app-only time blocks do not protect focus in the user's calendar.

Incremental collection sync can reduce network volume later, but maintaining recurrence projections and valid cursors is more complex than bounded snapshots. Push channels add renewal and duplicate-delivery handling before volume justifies it. Snapshot-first can use more API calls; monitor sync time and quotas before changing it.

There is no exactly-once or atomic Google+database guarantee. Publication state must be honest and recoverable. A new remote meeting can conflict even after a successful write.

## Evidence and revisit trigger

[Google scopes](https://developers.google.com/workspace/calendar/api/auth) include app-created-calendar authority. [Event creation](https://developers.google.com/workspace/calendar/api/guides/create-events) supports custom IDs for duplicate prevention. [events.list](https://developers.google.com/workspace/calendar/api/v3/reference/events/list) limits sync-token filters. Verify these capabilities in the Phase 4–5 sandbox; introduce incremental sync/webhooks only after measured snapshot cost or latency warrants them.

## Phase 4A superseding decision

[ADR 013](013-freebusy-advisory.md) supersedes this ADR's assumed Phase 4 Google-login/event-sync scope. Application login stays unchanged. CalendarList + FreeBusy only provide busy-time advisory with a separately owned encrypted OAuth connection and on-demand reads. No event mirror, event scopes, polling, jobs or Calendar writes. Existing event/write architecture remains a future option requiring a concrete feature and separate authorization.
