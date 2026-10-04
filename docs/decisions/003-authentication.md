# ADR 003 — authentication choice and local scope

Status: accepted with review amendments. Date: 2 October 2026.

## Context

The initial goal slice should work without external credentials. Ownership cannot be retrofitted casually. Real Google sign-in and calendar consent must precede remote deployment; they are separate authorization purposes.

## Decision

Use real Better Auth database sessions from Phase 0, with email/password and operator-provisioned local accounts (ADR 007). No automatic actor, public sign-up, impersonation route, or browser-selected owner. Owner-scoped service/database tests use two actors from the beginning.

Add Google identity to the Phase 0 Better Auth/Drizzle session foundation in Phase 4 with basic identity scopes only, and a separate incremental calendar consent flow. Verify real sessions at every protected entry point. Store calendar credentials separately, encrypted server-side with keys external to Postgres; auth account storage must not accidentally duplicate integration secrets in plaintext.

## Alternatives considered

| Choice | Trade-off |
| --- | --- |
| Auth.js | Supports a [Drizzle adapter](https://authjs.dev/getting-started/adapters/drizzle), but current maintainer direction recommends Better Auth for new projects |
| Supabase Auth | Managed sign-in and a coherent managed platform; viable if operational simplicity dominates, but introduces a hosted auth dependency for a local-first project |
| Better Auth | Keeps sessions beside app data and fits Next.js/Drizzle; requires maintaining auth configuration, dependencies, and OAuth verification |

The [Auth.js/Better Auth maintainer announcement](https://better-auth.com/blog/authjs-joins-better-auth) recommends Better Auth for new projects. Its [Drizzle adapter](https://better-auth.com/docs/adapters/drizzle) and [Next.js integration](https://better-auth.com/docs/integrations/next) support this fit. This is a reasoned recommendation pending the callback/session spike, not an unconditional compatibility promise.

Supabase's [social login guidance](https://supabase.com/docs/guides/auth/social-login) explains that application-managed provider refresh remains necessary; selecting managed login does not remove calendar-token lifecycle work.

## Consequences and revisit trigger

No external credentials are needed for Phase 1, but the resulting local app is not deployable publicly. Phase 4 tests real callbacks, revocation, reconnect, encryption, logout/account switch, and two-owner isolation before remote use. Revisit this decision if the supported adapter/callback spike fails or managed auth materially reduces operations; do not build a generic auth-provider abstraction to hedge.

## Phase 4A superseding decision

[ADR 013](013-freebusy-advisory.md) supersedes this ADR's assumed Phase 4 Google-login/event-sync scope. Application login stays unchanged. CalendarList + FreeBusy only provide busy-time advisory with a separately owned encrypted OAuth connection and on-demand reads. No event mirror, event scopes, polling, jobs or Calendar writes. Existing event/write architecture remains a future option requiring a concrete feature and separate authorization.
