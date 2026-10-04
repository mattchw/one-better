# ADR 002 — PostgreSQL, Drizzle, and explicit ownership

Status: accepted with review amendments. Date: 2 October 2026.

## Context

Goals need genuine durable persistence. Later scheduling introduces same-owner relationships, version checks, non-overlap, immutable revisions, and atomic outbox intent. In-memory or browser storage cannot enforce these across sessions.

## Decision

Use PostgreSQL locally and when hosted. Use Drizzle for typed queries/schema and generated, reviewed SQL migrations. All owned rows have user scope; enforce relational ownership with composite keys where appropriate. Use optimistic versions, explicit aggregate locks, and atomic mutation receipts. Add tables only by slice.

Keep actual instants in timestamptz, local week/date meaning in date columns with IANA timezone metadata, and estimates as integer minutes. JSONB is appropriate for validated immutable plan snapshots, not all app state in one blob. Runtime and migration database privileges are separate.

## Alternatives and consequences

Prisma supports [customised migrations](https://www.prisma.io/docs/orm/migrations/how-migrations-work) and is a viable option. Drizzle is preferred here because explicit SQL and Postgres-specific constraints are central to the design; this is a project-fit judgement, not a claim that Prisma lacks transactions. SQLite simplifies setup but would weaken test/deployment parity for concurrency and range constraints. Supabase remains a possible managed PostgreSQL host without adopting its browser data APIs.

Postgres costs local setup effort: provide a persistent-volume service and documented migrations. Backup/restore verification is required before hosted reliance. Tests must exercise real Postgres semantics, not only repository mocks.

## Evidence and revisit trigger

Drizzle documents [transactions](https://orm.drizzle.team/docs/transactions) and [migration options](https://orm.drizzle.team/docs/migrations). Select a compatible stable Drizzle/driver/auth-adapter combination in Phase 0. Revisit only if demonstrated schema/tooling friction outweighs the migration cost; no dual-ORM support.
