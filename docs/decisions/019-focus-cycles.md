# ADR 019 — Focus Cycles as a separate owned horizon

Accepted for R5A, 3 October 2026.

## Decision

Use a small `focus_cycle` aggregate plus `focus_cycle_goal` membership. The user explicitly chooses a title, optional intent, inclusive local start/end dates and up to 50 owned active Goals. Membership gives present context; it is independent of Goal lifecycle and all weekly planning and execution records. There are no nested horizons, weights, scores, automatic selections or provider calls.

Draft → Active → Finished; Draft, Active and Finished may be explicitly Archived. Archived is terminal. Draft/Active metadata and full membership can be edited with an expected version. Activation requires at least one active Goal and dates covering the User's authoritative local today. Future cycles remain Draft until explicitly activated. An Active cycle may be deliberately emptied without archiving its Goals.

Choose **one Active cycle per owner**, enforced by a partial unique index and an owner advisory lock. This is a deliberately stronger, simpler rule than permitting multiple non-overlapping Active records. An elapsed cycle retains Active status until explicitly Finished/Archived, freeing the slot. Current Focus is a read-only projection: Active and `startDate <= localToday <= endDate`. Date edits on an Active cycle must continue to include today; use Finish and a new Draft for a different horizon. User timezone changes affect that projection without rewriting authored dates or existing pinned Plan timezones.

Mutable cycles display live owned Goal context. Goal archive keeps membership and visibly marks unavailable work until the user removes it. Finish/archive captures live Goal identity, version, title, outcome and archivedAt in membership snapshots. Finished → Archived retains those snapshots. Past-cycle Goal links deliberately open the current Goal workspace; their visible historical wording is frozen.

## Persistence and concurrency

All commands use the existing atomic owner-scoped mutation receipt mechanism. Hashes bind normalized metadata, sorted Goal IDs/versions, command kind, cycle ID and expected aggregate version. Same-key retries return the original result after later edits/transitions or a process restart; changed payloads conflict. Failed commands commit no successful receipt or partial membership. Goal selection locks rows in ID order and checks ownership, exact versions and active eligibility. Activation rechecks live eligibility, without requiring obsolete title/outcome versions from an earlier Draft. Finishing snapshots rows under the same locks.

Composite owned foreign keys preserve cycle/Goal membership scope. PostgreSQL guards identity/version and legal lifecycle updates, terminal metadata updates and terminal membership inserts/updates. Application routes offer no destructive delete or restore. This does not introduce account-erasure policy or claim privileged SQL DELETE is impossible.

## UI and consequences

Goals leads with Current Focus, selected outcomes and the existing Goal → Milestone/Action workspace. Other active Goals, Draft cycles and Past cycles are collapsed discovery. Calendar defaults its work rail to current-cycle Goals, retains all scheduled blocks and aggregate facts, and exposes Other committed work. Every eligible commitment remains in the time-block chooser. Weekly planning labels candidates but does not change eligibility or history. Cycle context links respect existing unsaved-editor navigation locks.

Empty Drafts and accounts without a cycle remain usable. Ending dates causes no background mutation, Goal archive, Action creation, commitment change or scheduling. Cycle commands cannot write these aggregates. Transient attempted fields and uncertain command IDs stay in the open dialog; durable state and receipts live in PostgreSQL. After closing/reloading an uncertain command, inspect saved state before issuing another create.

Rejected alternatives: embedding a season ID on Goal would mix independent lifecycles and obscure historical membership; automatically closing or activating cycles would introduce hidden mutations; restricting weekly eligibility would block deliberate outside work. A general priority/scoring engine is unnecessary.

R5B remains a proposal: AI can use cycle and deterministic planning/execution evidence to produce a previewable recommendation, accepted explicitly through existing services with fresh guards. R5A implements no coaching or provider adapter.
