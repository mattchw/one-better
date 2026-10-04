# ADR 016 — Focus Sessions and the TimeBlock execution lock

Status: implemented for the authorized Phase 6A slice. Phases 0–5A approved. Supersedes earlier focus proposals for pause/segments/heartbeats/unplanned execution/corrections and refines ADR 015's future-block mutability only after execution begins.

## Small local execution model

Add one `focus_session` table: UUID, owner, required TimeBlock ID, authoritative startedAt, nullable endedAt/outcome/endNote, version, createdAt and updatedAt. Exactly one TimeBlock supplies the immutable Plan/logical-commitment/frozen Action/Goal/optional Milestone context. Do not duplicate those relationships or introduce a FocusSegment, activity framework, timer queue, heartbeat/job or separately mutable duration.

An active session has no end/outcome/note and version 1. Ending records one completed/partial/abandoned outcome, optional trimmed Unicode plain-text note up to 1,000 code points, endedAt and version 2. EndedAt must be strictly later than startedAt. Ended sessions cannot edit, reopen or delete through the product. A focused SQL update trigger additionally preserves identity/start/context and rejects changes to ended rows. Administrative deletion for disposable-test cleanup remains outside normal product behavior. Restrictive composite `(owner,timeBlock)` foreign key preserves ownership; TimeBlock receives the unique owned identity index needed by it.

## One active session and transactional execution lock

A PostgreSQL partial unique index on owner WHERE endedAt IS NULL independently enforces at most one globally active session per user. Different owners may each be active. Start/end reuse the existing owner/mutation receipt helper; matching committed results replay before current lifecycle/eligibility/version checks. Distinct `focus.start`/`focus.end` hashes include resource/version/normalized payload. Receipts and session changes commit or roll back together. No second retry system.

Lock order: receipt → stable owned User row FOR NO KEY UPDATE → owned TimeBlock then Plan for start; receipt → User → owned session for end. This shares scheduling's receipt-compatible owner lock. Scheduling final edit/cancel checks for *any* associated session, active or ended, under that same owner lock. Consequently start versus reschedule/cancel cannot both win from the inspected block version. Start itself never increments or rewrites the TimeBlock. Its original planned interval/context becomes historical after the first session, even when execution starts before the block's planned start. Create a different block if more/different planned intent is needed.

Start resolves owned context before exposing an existing owned active session. A second start reports ACTIVE_SESSION/current and the UI returns to the saved active context; it never silently ends/replaces it. Competing end commands have one version winner. Starting another session waits for the serialized end to commit, or fails with the existing session. The unique index reinforces the service protocol independently.

## Eligibility and preserved planning context

Start only from a non-cancelled block in a committed current *User-local* planning week. Validate interval/Plan/week consistency. Clock placement within that week is flexible: early/late/another day are permitted. No global Action/backlog entry point, future-week start or finished-week start. A removed logical commitment requires explicit server acknowledgement; this authorizes the session only and never restores membership or amends the Plan. If an existing active session crosses midnight/week boundaries, keep recovering it globally and allow it to end.

Amendments never write sessions. The Plan lock serializes start's membership check against amendments. Dropping a commitment does not stop an already-running session. Carry/budget changes retain logical membership and sessions; re-addition creates a distinct identity and does not acquire old blocks/actuals. Frozen TimeBlock snapshots supply all labels, including beneath renamed/terminal sources. Session outcomes never complete an Action/parent, cancel a block, adjust budgets/capacity/scheduled time, or score productivity.

## Clock, recovery and duration

Inject a server clock; normal runtime uses current UTC Date instants. Browser timestamps are not accepted. Start/end capture time after final locks. If clock has not advanced past start, ending fails without a receipt rather than fabricating elapsed time. Instants persist at PostgreSQL timestamp precision; no sub-minute truncation. A guarded process-owned test clock file is accepted only with an explicitly isolated `execution_test_<suffix>` loopback database and loopback application origin, with no HTTP clock/impersonation endpoint. Deterministic browser/restart tests advance it; normal accounts cannot use it.

Ended recorded duration = endedAt − startedAt for every outcome, including abandoned. Aggregate exact milliseconds once per TimeBlock and through that block's logical commitment. Live Focus alone adds the one active session's elapsed time and labels it “so far.” Saved/scheduling historical totals exclude active sessions until ended. Active elapsed = saved startedAt to server-sampled now plus browser wall-time since that sample. Local one-second display ticks and visibility/focus recovery derive timestamps, never count ticks or persist observations. A private read every 15 seconds while visible and same-origin BroadcastChannel invalidation discover other-tab changes; those are reads, not background writes/jobs. Revision checks discard older read responses; an open end-note draft is retained until explicitly dismissed/submitted.

Count up without countdown, timeout, alarm or automatic scheduled-end termination. Running sessions may naturally overrun, cross midnight or finish in a later week; the entire duration remains associated with the original block/lineage. No clipping/day allocation or productivity inference. Floor only final aggregate display minutes; positive sub-minute duration displays `<1m`. Reload, closing/reopening, navigation and application restart recover the same saved session; no original tab/localStorage is required.

## User-facing boundary

Dedicated authenticated Focus destination: today intersects concrete User-IANA local-day bounds, sorted by planned start, with cancelled/future/historical weeks omitted. A selected block from Weekly Planning also supports returning later in the current week. Active mode reduces navigation and shows only frozen work context, schedule, elapsed time, budget/scheduled/recorded totals and End session. End is a compact explicit outcome/note dialog, with Action independence stated. Failed/uncertain commands retain exact payload and support safe retry before rereading current truth. Ownership/private no-store HTTP and indistinguishable foreign/missing errors follow prior phases.

No pause/resume segments, active-note autosave, terminal corrections, review/reflection, reminders/notifications, blocking/DND, actual productivity measurement, AI, suggestions or Calendar writes. Real Google account OAuth/list/FreeBusy/refresh/reconnect/disconnect verification remains a separate hard prerequisite before future writes. Recommend evaluating Daily Execution / End-of-Day Reflection next; proposal only.
