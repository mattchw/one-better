# Phase 0 implementation plan

Approved scope: Phase 0 only, following the reviewed amendments. Stop before Phase 1.

1. Update the six design documents and ADRs, add ADR 007 for real session authentication, and run document checks before application code.
2. Lock Node/Next.js/React/TypeScript, Better Auth, Drizzle/Postgres, Zod, Tailwind, Vitest, and Playwright. Establish a persistent local Postgres service and migrations.
3. Implement the auth-only schema, local operator provisioning, verified server Actor, safe errors/configuration, and current-user service/repository. No Goal table or fixture is required.
4. Build the signed-out/sign-in/authenticated/sign-out shell and a protected account-context endpoint; no planning or integration runtime.
5. Verify clean migrations, anonymous rejection, distinct identities, revocation/expiry, domain/service behaviour, browser smoke, production build, and state across actual application-process restart.

Exact versions and measured acceptance results are recorded in [phase-zero-report.md](phase-zero-report.md). The Phase 1 contract remains in [build-plan.md](build-plan.md).
