# Phase 2B implementation plan — Goal-Aligned Actions

Authorized scope: Actions beneath exactly one immutable Goal, optionally linked to one active Milestone in that Goal. No standalone Actions and no weekly planning.

1. Add the small Action domain: required title, optional doneWhen/estimateMinutes/milestoneId, terminal open→completed or open→archived. Centralize effective mutability and assignment validation.
2. Add an additive migration with owned Goal and owned exact-Goal Milestone foreign keys. Leave earlier SQL unchanged. Reuse receipts with Action DTO/hash kinds only.
3. Implement actor-scoped service/repository and thin HTTP routes. Lock receipt→Goal→current/destination Milestones→Action, with parent checks and expected version. Replay successful original snapshots before current state checks.
4. Extend Goal detail with Actions/Open/Completed/Archived, optional contextual fields, intentional completion/archive, server-derived read-only states, and useful conflict drafts. Refresh Action context after Milestone changes.
5. Add domain/service, real PG races/relationships/receipts/history/isolation, HTTP/browser journeys and real production-restart proof. Keep all previous tests and update disposable fixture cleanup for FKs.
6. Run the full gate/audit, migrate local PG, manually inspect the production experience and document exact evidence/limits in phase-two-b-report.md. Stop and propose Phase 3 only.

Bounds: title 1–160 and optional doneWhen up to 2000 Unicode code points; estimate absent or positive whole minutes 1–10,080. Blank optional text normalizes to null. Estimate is current effort only, never commitment/schedule/actual/progress.
