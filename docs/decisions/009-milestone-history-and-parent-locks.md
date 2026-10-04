# ADR 009 — Milestone history and parent locking

Status: accepted Phase 2A implementation decision. Date: 2 October 2026.

A Milestone belongs to one immutable owned Goal and declares title/successCondition. Active transitions only to completed or archived; both are terminal. Completion can store an optional trimmed plain-text evidence note (1–2,000 code points when present). No dates, ordering controls, progress score, Actions, or automatic Goal changes.

Composite (owner_id, goal_id) foreign key references Goal's existing unique ownership key. Every Milestone mutation claims the existing owner/mutation receipt, locks the parent Goal, then locks/checks the Milestone where applicable. Goal archive already locks that same Goal row. If archive wins, a new child mutation is blocked; if the child write wins, it commits before archive. Archive never cascades changes into children. All reads remain possible for archived Goals. Parent ownership and immutable goalId are service and SQL boundaries.

Extract the proven receipt transaction into a small shared helper used only by Goal/Milestone repositories. Its typed result becomes Goal | Milestone; persisted Goal snapshots and their existing hashes remain unchanged. Milestone hashes use milestone-prefixed command kinds. No new receipt table/protocol, dispatcher, workflow, or event framework. Replay happens before parent/lifecycle/version checks, including after Goal archive, because it performs no new mutation. Retention remains indefinite locally (ADR 008).

Milestone mutations lock parent→child consistently and compare the originally read child version; SQL also checks owner/ID/expected version/active state. Conflicts include only the actor's current record. Parent archival returns GOAL_ARCHIVED; normal UI makes the entire Goal history read-only. No terminal edit/reopen/restore. Completion evidence is entered only in the intentional completion command and becomes immutable with the success condition. Completed/archived timestamp consistency is checked in SQL.
