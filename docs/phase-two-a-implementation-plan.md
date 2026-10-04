# Phase 2A implementation plan

Authorized: Goal Milestones only. Stop before Actions/Phase 2B.

1. Read approved docs/ADRs/reports and Goal services/receipts/tests; amend the Phase 2 contract and add ADR 009.
2. Add Milestone schema/new migration with same-owner Goal FK and lifecycle/time/field constraints. Extract the existing receipt transaction for minimal reuse; retain all Goal hash/results.
3. Add pure Milestone rules, actor-scoped service/repository, parent-before-child locking, and protected list/create/get/edit/complete/archive routes.
4. Add owned Goal detail navigation. Show Goal outcome plus Active/Completed/Archived checkpoints, explanatory empty states, create/edit and intentional complete/evidence/archive dialogs. Historical Goal is readable; no mutation controls. Preserve failed/conflicting drafts and same-command retries.
5. Test field boundaries, terminal states, parent archival, immutability, same-owner FK, all conflicting command pairs, all receipt types, original snapshot replay, rollback, two-owner HTTP/browser isolation, reload and actual process restart. Retain all Phase 0/1 tests.
6. Run full checks/audit, manually inspect completion/history and mobile/keyboard UX, record exact results in phase-two-a-report.md, update build plan/README, stop. Phase 2B model remains tentative pending use/review.

Expected additions: src/modules/milestones, src/db/command-receipt.ts, 0002 migration, milestone/Goal-detail HTTP/pages/components, domain/service/DB/browser tests. Existing changes: Goal repository receipt extraction, receipt result typing, Goal card detail link, health readiness, isolated test cleanup and restart harness, docs. No dependency changes planned.
