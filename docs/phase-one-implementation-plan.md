# Phase 1 implementation plan

Authorized scope: Goals only. The 2 October Phase 1 brief supersedes earlier optional target-date examples: no dates, milestones, actions, planning, or integrations.

1. Amend the Phase 1 contract and document receipt semantics in ADR 008.
2. Add Goal and MutationReceipt schema in a new migration; leave 0000 unchanged. Add pure validation/transitions, actor-scoped services, and an ownership-scoped transactional repository.
3. Add protected list/create/get/edit/archive HTTP routes, exact-origin mutation checks, typed field/conflict errors, private no-store responses.
4. Replace foundation decoration with Active/Archived outcome cards and accessible create/edit/intentional-archive dialogs. Preserve drafts and command IDs across uncertain retries; require review after conflicts.
5. Verify boundaries/lifecycle, real Postgres concurrent writes/replays/isolation, browser journeys/failures/two tabs, and actual production-process restart. Run docs/lint/typecheck/build/audit and a manual desktop/mobile walkthrough.
6. Record exact results in phase-one-report.md, update build-plan.md/README, and stop before Phase 2.

Expected changes: src/db/schema.ts plus new SQL/meta migration; src/modules/goals; src/server goal transport/error handling; src/app/api/goals routes; src/app/page.tsx; goal components/styles; domain/service/database/browser tests; restart proof and isolated browser database harness; documentation. No dependency additions are planned.
