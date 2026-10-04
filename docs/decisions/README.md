# Architectural decisions

ADRs 001–006 are accepted with review amendments, dated 2 October 2026. ADR 007 refines Phase 0 authentication; ADR 008 records Phase 1 command receipts; ADR 009 records Phase 2A milestone history and parent locks; ADR 010 records Phase 2B goal-aligned Actions.

| ADR | Decision |
| --- | --- |
| [001](001-modular-monolith.md) | Next.js modular monolith, small usable slices |
| [002](002-postgres-drizzle.md) | PostgreSQL + Drizzle, explicit ownership/versioning |
| [003](003-authentication.md) | Better Auth for real sign-in; database sessions before OAuth |
| [004](004-calendar-ownership-and-sync.md) | Read-only inputs, dedicated output calendar, snapshot-first reads, durable writes |
| [005](005-deterministic-planning-ai-proposals.md) | Deterministic scheduling and accepted AI proposals |
| [006](006-plan-baselines-and-actuals.md) | Immutable original plans, explicit actuals, deliberate rollover |
| [007](007-phase-zero-sessions.md) | Real Better Auth sessions in Phase 0; no automatic actor |
| [008](008-goal-command-receipts.md) | Atomic Goal retries, original result snapshots, owner/operation namespace; dates excluded |

- [009 — Milestone history and parent locks](009-milestone-history-and-parent-locks.md)

- [010 — Goal-aligned Actions and effective mutability](010-goal-aligned-actions.md)

- [011 — Weekly Planning and Immutable Baseline](011-weekly-planning-immutable-baseline.md)

- [012 — Immutable full-plan weekly amendments](012-immutable-weekly-amendments.md)

- [013 — FreeBusy advisory without event synchronization](013-freebusy-advisory.md)

- [014 — Focusable Hours and advisory Calendar-open time](014-focusable-hours-and-advisory-open-time.md)

- [015 — Local TimeBlocks and logical commitment alignment](015-local-time-blocks.md)

- [016 — Focus Sessions and the TimeBlock execution lock](016-focus-sessions-and-execution-lock.md)

- [017 — Daily execution and reflections](017-daily-execution-and-reflections.md)

- [018 — Weekly review and deliberate rollover](018-weekly-review-and-deliberate-rollover.md)

- [019 — Focus Cycles as a separate owned horizon](019-focus-cycles.md)

- [020 — AI coaching as explicit proposals over deterministic evidence](020-ai-coaching-proposals.md)

- [022 — Optional owned ChatGPT plan connection](022-chatgpt-plan-connection.md)

- [023 — Weekly Review insight candidates](023-weekly-review-insight-candidates.md)
