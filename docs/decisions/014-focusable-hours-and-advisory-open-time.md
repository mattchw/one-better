# ADR 014 — Focusable Hours and advisory Calendar-open time

Status: implemented for the authorized Phase 4B brief. Date: 2 October 2026.

## Decision and vocabulary

**Focusable Hours ≠ Calendar-open Focusable Time ≠ Manual Weekly Capacity ≠ Commitment Capacity ≠ Scheduled Time ≠ Actual Focus Time.** A user's recurring hours express willingness/possibility. Selected-calendar occupied instants reduce that concrete interval set. Human capacity remains an explicit weekly decision; commitment capacity is that manual capacity minus protected reserve. Budgets, later accepted blocks and later recorded actuals are separate evidence. Empty time is not an instruction to fill it.

Add one optional owned `focusable_hours` aggregate: app UUID, unique owner, positive integer version, creation/update UTC instants, and a bounded JSONB array of authored windows. This is one small configuration, not an availability rule engine or snapshot history. Each window is ISO weekday 1 (Monday) through 7 (Sunday), integer startMinute 0–1439 and endMinute 1–1440. Start < end; 1440 means the next local midnight. Zero windows and empty weekdays are valid. Maximum 70 windows keeps a full command well below the existing 32 KiB bound. Same-day overlap rejects; adjacency remains distinct in storage. Preserve authored order; no hidden template, sorting/merging during persistence or UTC recurrence storage.

## Time and deterministic derivation

Use current User IANA timezone, not a Plan's frozen historical timezone. Expand each requested valid Monday-start local week with @js-temporal/polyfill 0.5.1. Use local calendar-date addition and explicit `compatible` disambiguation: earlier occurrence of a repeated time; forward by the transition gap for skipped time. See [Temporal's primary documentation](https://tc39.es/proposal-temporal/docs/timezone.html). Full Sundays have 23 or 25 elapsed hours in London transition weeks; 00:00–03:00 has two or four. End 24:00 converts the following local midnight.

Show every ambiguous/nonexistent boundary resolution in the advisory. Clip each resolved window to its actual local date boundaries. If resolution leaves end <= start (e.g. London spring Sunday 01:30–02:00), it contributes zero elapsed time and a visible omission explanation. A wholly skipped local date likewise contributes zero. This explicit policy supersedes the earlier proposed rejection/day-override rule **only for recurring Phase 4B hours**; manually placed future TimeBlocks need a separately approved time-entry policy. No day overrides exist here.

Reuse Phase 4A normalized `BusyInterval`, `weekRange`, `mergeBusyIntervals`, and `busyTotals`; no Google SDK/payload reaches the domain. Concrete intervals use half-open `[start,end)`. Union expanded focus windows, intersect with the clipped selected-calendar busy union, union the intersections, then subtract the blocked union to obtain actual open intervals. Adjacent concrete intervals merge for calculation only. Bucket each set on exact local-day boundaries and preserve nanosecond precision until minute totals/display. Do not subtract weekly aggregate numbers to invent intervals. Busy time outside focusable windows has no effect; total Calendar load remains a different metric.

## Reads and status

Derived intervals are recalculated, not persisted or cached again. Owned settings and Calendar workspace reads are ordinary private/no-store reads; opening Planning does not call Google or create preferences/receipts. The same pure derivation runs on the server GET and after explicit Calendar refresh in the browser. Existing Calendar refresh controls/provider service are reused. The Calendar workspace carries an internally consistent connection/selection/cache snapshot; refresh response rendering checks the connection version and selection again, avoiding an old response being attached to a changed selection.

No/empty hours → not_configured. Complete fresh busy cache + hours → available. An aged/error/reauthorization last complete snapshot → stale, with original fetchedAt. No complete cache/disconnect/no selected calendars → unavailable, open/blocked null even though hours remain known. Incomplete refresh without a complete snapshot → incomplete and unknown. A prior complete snapshot after incomplete refresh remains stale, never fresh. Phase 4A's failure reason without prior cache remains transient: reload stays unavailable/unknown but does not retain the incomplete label. No new failure cache is introduced.

## Atomic saves, retries and ownership

Full-state PUT includes mutationId, nullable scheduleId and expectedVersion (zero with no schedule). Reuse the established owner/mutation receipt and distinct `focusable-hours.save` hash kind including schedule identity/version/windows. Matching retries replay the original successful result before later version checks. Different payload reuse rejects; receipts commit/rollback with the aggregate. Receipts are never used for derivation.

Lock order: receipt → owned User row `FOR NO KEY UPDATE` → owned hours row. The stable User lock serializes competing first creates despite an absent schedule. NO KEY UPDATE permits existing receipt foreign-key KEY SHARE locks; FOR UPDATE would create a lock-upgrade deadlock between competing saves. Unique owner reinforces one aggregate. Every acknowledged save increments version once, including explicit equivalent full-state saves. A stale tab receives typed HOURS_VERSION, retains its windows, and must explicitly review the latest saved version before deliberately replacing it. Unknown outcomes lock controls and retry the exact original command, then read current saved truth.

Actor supplies owner for every query/write. Public DTO omits owner. Foreign/missing schedule IDs produce the same 404 for owned reads, saves and derived reads. HTTP mutations require verified sessions, exact Origin, bounded JSON and strict server validation. No settings or availability operation calls a planning/source mutation service.

## UI, consequences and boundaries

Availability settings begins empty and supports seven days/multiple windows/save/discard. Planning places a modest advisory after the manual capacity summary. Show focusable, blocked-inside and Calendar-open totals; disclose daily concrete interval lists. On offset-change days show offsets to distinguish repeated times. Retain subordinate Phase 4A Calendar load and its original successful fetch time/refresh/reconnect. Fresh known open time below the manually chosen capacity produces neutral context, never a plan validation error. Open time above capacity produces no prompt to increase work.

Show live hours only for current/future weeks, including Current Plan/amendment proposals. Omit it from finished weeks and immutable history inspectors: Phase 4B does not snapshot preferences. Editing hours/disconnecting Calendar never changes sources, manual decisions or frozen history. Additive migration 0007 adds only this configuration table; earlier SQL remains byte-identical.

No Calendar writes, TimeBlocks, scheduling suggestions, energy/daily targets, reserve automation, minimum block length, buffers, breaks engine, exceptions/holidays/vacations, jobs, AI or additional integrations. Real Google OAuth + FreeBusy remains a hard gate before hosted Calendar use or future external writes. See [Phase 4B report](../phase-four-b-report.md).
