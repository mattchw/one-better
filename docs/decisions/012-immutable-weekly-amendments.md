# ADR 012 — immutable full-plan weekly amendments

Status: implemented for the authorized Phase 3B brief. Date: 2 October 2026.

## Decision

Keep the Phase 3A WeeklyPlan and WeeklyCommitment baseline where it is. Append one WeeklyPlanAmendment and its complete AmendmentCommitment set per confirmed planning change. This is a small full-snapshot representation, not event sourcing. Effective Plan is the latest sequence snapshot, or the original baseline before any amendment. Earlier revision/event examples remain future concepts, not additional implementation.

Amendment stores owned Plan, positive sequence, required reason (1–500 trimmed Unicode code points), capacity/reserve, UTC creation instant and the technical Plan version at confirmation. `(plan_id,sequence_number)` is unique. Child primary key is `(amendment_id,id)`; logical commitment identity carries forward from baseline/previous amendment. Membership is unique by amendment/Action, with restrictive composite owned Amendment and Action foreign keys. Each child stores budget, source guard and mandatory frozen Action/Goal/optional Milestone context.

Start with current effective snapshots. Retained commitments preserve logical identity, source guards and all snapshot fields exactly; only explicitly supplied budgets change. Do not consult their live source eligibility. A drop omits the commitment from the new full set. An Action absent from the predecessor is a new addition: lock current sources, require effective eligibility and reviewed version/relationship guards, then capture fresh context with a new logical commitment identity. Re-addition after an earlier drop therefore does not resurrect stale text. Normal source estimates and lifecycle rows are never written by planning commands.

Pure differences match source Action IDs, sort deterministically and report capacity, reserve, additions, drops and budget changes, with previous/new totals and remaining capacity. Reason or text differences alone cannot create an amendment. Do not persist differences. Capacity/reserve/commitments must fit; no automatic shrinking. Capacity zero requires reserve zero and no commitments. Empty amendments are allowed at valid positive capacity. Original positive-capacity/nonempty commitment rules stay unchanged.

## Atomicity, concurrency and historical truth

Reuse the existing owner/mutation receipt: receipt → owned Plan lock → sorted source Goals/Milestones/Actions for additions only. Check expected Plan version, committed lifecycle and current/future eligibility in the current User IANA timezone. Read predecessor history under the Plan lock; choose sequence +1, insert all child rows, increment only WeeklyPlan.version and persist the original result receipt in that transaction. Competing different commands from one effective version have one winner and a typed conflict; no branches or merging. Identical retries replay one original result before current date/version/source checks, even after later amendments and process restart.

WeeklyPlan.version is concurrency metadata. Original capacity/reserve/state/creation/update/commit timestamps, baseline commitment identities/budgets/guards/context and every previous amendment stay unchanged. Never copy current content into baseline tables. No application service or route updates/deletes/reorders an amendment. Direct privileged database maintenance is outside product operations; no generic trigger/audit framework is added. Cross-row total capacity and append-only policy are enforced by the serialized service; SQL enforces relational integrity and row bounds.

## UX and consequences

The transient editor copies Current Plan, shows the pure difference and requires reason plus explicit review/confirmation. Cancel writes nothing. Main view leads with Current Plan and a derived amendment count. Chronological history always exposes Original Plan and immutable full snapshots. Internal versions, receipt IDs and database details are absent from product text.

Stale proposals remain visible until explicit restart from the latest Current Plan; error recovery cannot silently advance their version. Unknown outcomes lock choices/cancellation/navigation and retry the exact command, then read current truth. Read failure never masquerades as no history. Snapshot duplication is small at the existing 50-commitment limit; history has no pagination in this slice. See the [completion report](../phase-three-b-report.md).
