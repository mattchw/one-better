# ADR 006 — preserve plans and record actuals explicitly

Status: accepted with review amendments. Date: 2 October 2026.

Phase 3A refinement: [ADR 011](011-weekly-planning-immutable-baseline.md) implements the baseline using two tables. The revision representation discussed below is conceptual; [ADR 012](012-immutable-weekly-amendments.md) now defines Phase 3B as small immutable full-plan snapshots, with no generic revision/event framework.

## Context

If replanning replaces the original plan, reviews cannot reveal overplanning or missed commitments. Calendar events and running timers do not prove focused work or outcome completion.

## Decision

Keep immutable plan revisions. Preserve the first committed commitments/settings as the weekly baseline, first accepted schedule as the calendar baseline, and daily as-of-start schedule for daily comparison. Later amendments state a reason and retain cancelled/moved work in baseline views. Snapshot planning-time estimates, action/goal/milestone identities and relationships, and titles/outcomes/done conditions needed for historical meaning. Live references are for navigation/current-state warnings only.

Measure confirmed focus segments separately from planned intervals; exclude pauses and unconfirmed gaps. Permit explicit actual correction with retained original evidence. Record deliverable/task completion explicitly and independently from minutes. Goal progress is outcome/milestone evidence, not a fabricated effort percentage.

Offer incomplete commitments during weekly review; carry only selected work into new linked commitments with fresh budgets. Never move the old commitment or silently accumulate debt.

## Alternatives and consequences

Live-only plans are simpler but lose honest comparisons when blocks move or tasks are re-estimated. Full event sourcing would preserve everything but adds unnecessary reconstruction/operational complexity. Relational live entities plus versioned JSONB plan snapshots and compact activity records provide sufficient evidence initially.

Explicit actuals add a small recording burden; validate that burden in the Phase 6 pilot. Distinguish unknown/unrecorded from zero. Preserve timestamps in seconds and split by period before rounding display totals. Corrected actuals can update historical totals while the original plan remains immutable.

## Revisit trigger

Adjust review presentation and timer-gap thresholds based on pilot evidence. Do not remove baseline retention to make completion ratios look better. Consider richer event history only if compact amendments cannot explain a real user-facing discrepancy.
