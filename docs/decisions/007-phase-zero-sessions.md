# ADR 007 — real sessions for Phase 0 ownership proof

Status: accepted implementation refinement. Date: 2 October 2026.

## Context

The approved review requires anonymous protected requests to fail and two test users to have distinct identities. The original automatic local development actor cannot prove authentication: every request would already have an actor. A custom development-cookie system would duplicate the approved authentication library and later migration work.

## Decision

Introduce the approved Better Auth + Drizzle database-session foundation in Phase 0 with email/password sign-in, disabled public sign-up, and explicit non-production local-account provisioning through a CLI. No Google provider or Calendar scopes. Use real hashed passwords and database sessions with HttpOnly cookies, server-side session verification, and a narrow authenticated Actor. No automatic identity or web impersonation path. Development provisioning refuses production and non-loopback databases/origins. The loopback production-process smoke uses real sessions; it does not bypass authentication.

The only Phase 0 tables are auth-required user/session/account/verification. User has an IANA timezone. A protected read-only account-context endpoint and shell consume actor→service→repository boundaries; no Goal fixture/table is necessary. Future owned aggregates derive ownership from the verified Actor.

## Consequences

This brings the chosen auth library forward from Phase 4, not Google OAuth. It adds a small credential form and operator script but satisfies anonymous-access, two-user, durable-session, and production-build proof without a custom auth system. Public registration, email delivery/reset, and remote deployment are out of scope. Login identity remains separate from later IntegrationConnection. Use the standard library crypto/session logic; never implement password hashing or timezone rules ourselves. Phase 0 explicitly enforces exact Origin for auth POST requests, including first login, and enables sign-in throttling at ten attempts/minute. Cookie caching is disabled to retain database-authoritative revocation/expiry.

## Verification

Real Postgres migrations and tests establish distinct users, valid/invalid/expired/revoked sessions, disabled sign-up, server Actor resolution, and state after process restart. Browser smoke covers signed-out → sign-in → authenticated shell → reload → sign-out; production-process restart preserves the same User/session identity. See the Phase 0 completion report for measured results.
