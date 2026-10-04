# ADR 010 — Goal-aligned Actions and effective mutability

Status: accepted Phase 2B implementation decision. Date: 2 October 2026.

Every Action belongs to exactly one immutable owned Goal; standalone Actions are excluded by the latest brief, superseding tentative earlier optional-Goal proposals. Optional Milestone association may change only on effectively mutable Open Actions and only to an active owned Milestone in that exact Goal (or null).

A central domain function calculates effective mutability from Action state and parent states. Only Open + active Goal + absent/active Milestone is writable. Completed/Archived Actions, archived Goals and terminal Milestones retain their child Action states unchanged and read-only. No escaping a terminal Milestone by reassignment. No cascade writes, evidence requirement, Goal progress or estimate conversions.

Reuse the existing owner/mutation receipt transaction with Action added to the DTO union and distinct action-prefixed hashes. Existing Goal/Milestone hashes/results remain unchanged. Original replay precedes current parent/version checks.

All existing Goal and Milestone writes already lock the Goal. Action writes lock that same Goal before discovering the current optional association under the lock; current/destination Milestones are then locked in stable ID order, and the Action is locked/checked/replaced. This serializes parent-terminal races and reassignment without modifying parent versions. No new locking framework or triggers. Composite owned Goal FK and optional (owner, Goal, Milestone) FK ensure exact-Goal ownership in PostgreSQL; a new unique Milestone ownership/Goal/ID index supports that FK.

Required title 1–160 code points; optional doneWhen up to 2000; optional integer effort estimate 1–10,080 minutes (a simple upper sanity bound, not a planning allowance). Optional omissions/null/blank doneWhen normalize to null. Edit replaces the four editable fields; Goal identity is not accepted. Terminal history retains context and transition timestamps. Reads supply server-computed mutability to React, while writes independently revalidate inside the transaction.
