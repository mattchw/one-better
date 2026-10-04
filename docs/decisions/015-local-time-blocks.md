# ADR 015 — Local TimeBlocks and logical commitment alignment

Status: implemented for the authorized Phase 5A slice, 2 October 2026. Supersedes earlier scheduling assumptions in ADRs 004–006 and the conceptual roadmap where they conflict with this local contract. Future Calendar writing, suggestions and Focus execution require separate approval.

## Decision

Add `src/modules/scheduling` as a small domain/service/PostgreSQL boundary and owned HTTP routes. Users explicitly place time for a commitment in the current Effective Plan of a committed current/future week. Drafts cannot schedule. Finished weeks and past-started blocks are read-only. No provider call, Calendar event, actual-time state or automatic placement is involved.

A TimeBlock contains UUID, owner, Plan ID, logical commitment ID, start/end UTC instants, planned/cancelled state, version, frozen commitment context, created/updated/cancelled timestamps. A future planned block can change only its boundaries. Cancellation is terminal and retains its identity/interval/context. There is no product hard-delete endpoint.

## Existing lineage, minimal relational bridge

Baseline `WeeklyCommitment.id` and amendment member `id` already distinguish logical commitment lineage. The amendment service clones the existing ID and context for carry/budget changes, drops membership on removal, and assigns a new ID/context on a later re-add. Action ID is not a substitute for that membership identity. No previous DTO, receipt hash, immutable row or lineage algorithm is rewritten.

Because an ID can first occur in either baseline or amendment children, add only `commitment_identity(id, owner_id, plan_id)` as a composite owned foreign-key target. Register IDs in the existing commit/amendment transaction. Migration 0008 backfills every existing committed baseline and historical amendment ID, including dropped IDs. The registry is referential identity, not another versioned plan or source of Effective Plan membership. TimeBlocks reference `(owner, plan, commitment)` with restrictive foreign keys; the service still requires current membership for create/edit.

Blocks retain their own frozen commitment snapshot so labels survive source changes and drop/re-add. A budget amendment changes only derived budget-versus-scheduled information. A drop preserves blocks; future planned ones become review-required and remain intentionally cancellable. Re-added membership has zero scheduled minutes until the user places new blocks. Its predecessor's blocks continue reserving local time until explicitly cancelled.

## Time policy

The owning Plan's pinned IANA timezone governs wall-clock editing and display. Current User timezone governs current-week eligibility and live recurring hours/Calendar coverage, consistent with existing modules. A changed account timezone does not reinterpret stored instants or Plan labels. Coverage outside the cached User-local week is unknown.

Inputs use a valid local date and minute `HH:mm` between 00:00 and 23:59, with start before end. Both resolved boundaries must stay on the chosen local date, wholly inside the Plan's Monday–Sunday week. No 24:00 endpoint or overnight placement: both endpoints must share a date. Temporal's explicit `compatible` policy matches Phase 4B: repeated time resolves earlier; a gap resolves later. The preview displays every ambiguous/nonexistent boundary's resolved wall time and UTC offset before confirmation. A resolution that produces no positive elapsed duration, crosses the date or leaves the week is rejected. Arithmetic uses actual elapsed instants, not assumed 24-hour days. Shared day expansion also handles a Plan-local block spanning two User-local dates.

## Hard invariant and independent advisories

Active planned local blocks for one owner cannot overlap, across commitments and Plans. Intervals are half-open `[start,end)`; adjacency is valid. Cancelled records release their time. A create/edit/cancel command claims the established owner-scoped receipt, takes the stable User row `FOR NO KEY UPDATE`, then reads the owned Plan and all owner's blocks inside the final transaction. Edit/cancel also locks its owned block. User locking serializes scheduling writers across Plans and remains compatible with receipt foreign-key `KEY SHARE` locks. Plan locking serializes against amendments. Amendments never acquire TimeBlock/User locks; Calendar network operations do not acquire these scheduling locks. The final check runs after locks, not only at preview. Direct administrative SQL is outside the service overlap protocol; SQL independently enforces interval/lifecycle/version/timestamp/owned membership constraints.

Outside configured Focusable Hours is advisory, including an empty/unconfigured schedule. Known Google busy overlap is a separate advisory. Each requires its own explicit server-validated boolean acknowledgement. Preferences are never altered to make a block fit. Complete stale Calendar timing stays explicitly stale, including failed refresh. Missing/incomplete/no covered snapshot produces `busyConflict: null`, never Calendar-free. Unknown timing does not block a local placement. Google timing may change after confirmation; this is local intent, not a guarantee that Google will remain clear.

Read-only preview returns boundaries/clock adjustments, budget/already/resulting scheduled totals, separate hours/busy/freshness states and a context digest. Create/edit repeat the same deterministic calculation inside the transaction and require the reviewed Plan version and matching digest of relevant plan/hours/Calendar/block inputs. Changed context requires deliberate review again; acknowledgement from an older preview is not silently reused. The digest is a concurrency check, not a secret or an authorization token. Session-derived Actor and owned queries are the authorization boundary.

## Independent quantities and command replay

Action estimate ≠ commitment budget ≠ scheduled minutes ≠ future actual minutes. Scheduled minutes sum all active planned blocks for the logical membership, including preserved past planned blocks. Under-scheduling is acceptable; over-scheduling displays a neutral difference and is acceptable. Neither makes an amendment, changes capacity/reserve/budget, updates an Action or records actual effort. No stored scheduled-total column or duplicate derivation table.

Create/edit/cancel use the existing receipt transaction and version checks. Exact retries return the original DTO before current-state validation, even after later mutations, expiry of eligibility or restart. Changed payload with the same owner/mutation ID conflicts. Receipts remain scoped to the owner and established operation hash. Failed checks/SQL roll back both block and receipt. The UI retains stale drafts and uncertain exact commands, requires explicit review of newer block versions, then rereads current scheduling truth after success/replay.

## Consequences and deferred work

A compact weekly list answers when work has room without a full Calendar surface. Availability numbers stay prominent while daily intervals and Calendar Load share a collapsed details area. Keyboard focus, cancellation, narrow layouts and history remain supported. There is no polling/reconciliation for post-save advisory changes, schedule revision log, offline draft storage or external projection. Focus/actuals/review will need their own acceptance contract; cancellation does not invent execution outcomes. Suggestions, buffers, minimum duration, recurrence, drag/drop, AI, integration writes and automatic amendments are deferred.
