# Calendar-first living week

## Interaction

Open a current or future week on Calendar. Last week's unfinished, eligible tasks are already checked. Untick anything to leave behind, then press **Plan my week** once. A saved nonempty draft retains all of its eligible choices, including more than three tasks. The former detailed `/planning` screen redirects to the matching Calendar week.

If there is no saved selection or unfinished work, the card asks **What's one thing to move forward this week?** A short task and 30m / 1h / 2h / 3h are enough. This also works when Goals already exist. **Set up goals instead** opens Goals without saving. The optional **Linked goal** selector includes active Goals even when they have no Actions yet. A task created here becomes an ordinary Action under the selected Goal. With **General** selected, the Action has a null Goal link. General is a weekly display group, not a Goal, and does not appear in the Goals catalog. The user can add more tasks later.

There is no capacity form, separate draft-save step, amendment form, reason field or second confirmation screen. Adding a Goal Action to a fresh week saves the chosen task directly; adding to a draft expands its allowance when needed while preserving other choices. The saved Spare time preference (None / Some 25% / Lots 40%) establishes the internal weekly allowance automatically. It is not a claim about Calendar availability. Existing sufficient empty-draft allowances remain valid; undersized ones can expand atomically for the first task.

The button explicitly accepts existing deterministic placements where fresh Calendar busy timing and Focusable Hours permit them. Nothing is placed over busy time, outside hours, in the past, across ambiguous DST boundaries, or over another block without the existing manual review. Unknown timing saves the task list and leaves time ready to place manually. First-task manual fallback opens the existing guarded time picker.

## Goal groups and outside-hours tags

The Calendar rail groups tasks under their linked Goal. General has a plain heading; real Goal headings link to their Goal. Cards show a progress bar, ±30-minute controls and an options menu with Edit/Delete. Scheduled totals, status and the Schedule button share the bottom row. Only tasks with time left to place show a Schedule button.

Manual placement outside Focusable Hours is advisory: show an **Outside Focusable Hours** tag without an acknowledgement checkbox. The existing request field remains accepted for retry compatibility, but it is no longer a prerequisite for saving. Known Google busy conflicts still require confirmation. Automatic placement remains restricted to Calendar-open Focusable Hours; ownership, stale previews, overlaps, past times and clock-change checks remain intact.

## Direct edits and Undo

Calendar's **This week's work** is the editable list: ±30-minute task time, inline rename, Delete, and **+ Add a task** with a name, duration and optional Goal. Selected Goals are owner scoped and version checked at save; foreign, archived or changed Goals reject the entire task addition without silently changing the selected Goal. Each operation saves immediately. Budget changes, task additions and drops offer six-second Undo. Reducing task time preserves existing scheduled blocks; an over-budget placement stays visible rather than being silently moved or deleted.

Drop cancels blocks with no recorded execution. Active Focus Sessions prevent removal; finished execution remains available. Undo restores the original task identity and exact cancelled blocks, with advancing versions. It rejects expired, changed or overlapping restorations and changed Calendar/Hours timing. Budget/add Undo rejects a newer weekly edit; it never overwrites subsequent work. Undoing an added weekly task removes it from this week, preserving its underlying Action and any recorded execution.

The server deadline is authoritative. Responses supply remaining Undo milliseconds so browser clock skew cannot hide a valid toast or renew an expired one. Slow refresh time is deducted. A response interrupted after a save retains the exact command for retry; replay cannot duplicate tasks, blocks or Undo. Further writes remain disabled while the result is uncertain.

## Quiet history and summary

The week summary shows one amount: **still to place**. It does not repeat usable, committed, uncommitted and reserve totals. Individual tasks still show their own time and placement progress.

**Week activity** is optional and collapsed by default on Calendar and Review, including after reload. Entries say Added, Removed or Changed task time with dates. No numbered “Amendment”, mandatory reason, accounting diff or snapshot blocks appear in the user flow.

Internal immutable revisions and receipts are deliberately retained: scheduling validation, actual execution, historical Review and stale AI proposals depend on them. This is a presentation/workflow change, not destruction of the original baseline or history. Legacy HTTP contracts remain guarded even though their old form screens are retired. `0015_spare_time.sql` stores the preference. `0016_general_tasks.sql` allows a null Action Goal link, retains direct owner and milestone integrity constraints, and converts the exact old automatic Weekly priorities container to General. Its Actions are detached and versioned; its Goal is archived and hidden from the catalog. Frozen plan/block snapshots, Focus Sessions, reflections, decisions and receipts are retained. User-created Goals with different outcomes are unchanged. Historical snapshots of the automatic container display as General.

## Unfinished work

The read-only suggestion route uses only the owner's immediately preceding committed week, its effective tasks and current eligible sources. Completed/archived Actions or parents are excluded. Finalized **Defer** and **Drop** decisions are honored; finalized **Carry** uses its proposed minutes. Otherwise the prior effective budget is retained. No reflection or session-note text is read. Opening the card never writes next week's plan. Pressing the button creates new weekly commitment identities while preserving previous weeks.

## “1% better” streak

The user approved **finished Focus Session OR finalized Daily Reflection** as the daily rule. Positive-duration finished sessions count on their finish date in the account timezone, including partial/abandoned attempts. Finalized daily reflections count on the local date of finalization. Finalizing old reflections today credits today once, without retroactively repairing missed streak days. Drafts, active sessions, future dates and records finalized after the observation time do not count. Both activities on one date count once.

The current run includes today when complete, otherwise it ends yesterday so an unfinished today does not prematurely break a streak. A missed prior day breaks it. Daily and Weekly Review show the current streak, seven recent day markers and a route to reflect/focus. The count means showing up, not an assessment or numerical productivity score. It is derived from owner-scoped saved timestamps/dates; note text is not loaded for the streak. Timezone changes affect completion-day attribution; reviewed reflection dates remain pinned for historical Review evidence.

Review defaults to the current account-local week, with explicit past-week navigation. Historical analytics, finalized reflection privacy, deliberate rollover decisions, AI constraints and stale-state protections remain intact.

## Verification

Unit tests cover streak deduplication, grace for today, missed days, drafts/future records, timezone/DST and deterministic placement boundaries. Service tests retain source guards, transaction rollback, receipt replay, identity preservation, capacity bounds and the fifty-task limit.

Disposable PostgreSQL tests verify unfinished task suggestions, explicit Defer/Drop exclusions, ownership, derived Spare allowances, first-task concurrency/reuse, immutable history, Undo expiry/conflicts, active/finished execution and streak privacy. Browser coverage exercises the new one-button flow, exact retries after lost responses, fresh timing revalidation, stale source rejection, direct edits/restoration, collapsed activity, reload persistence, mobile/dark layout and the agreed streak. Retired planner/amendment/schedule-form UI tests are replaced by Calendar flow coverage; HTTP ownership/origin tests and database/domain guards remain.

QA uses isolated loopback databases and mock provider endpoints. It does not seed or modify the shared Neon production data, change AI prompts/capabilities, or write Google events. Screenshots from browser QA: `.cache/living-week-calendar.png`, `.cache/living-week-review.png` (local ignored artifacts).

Verified locally on 5 October 2026: documentation checks, lint, type checking, 511 unit tests and 96 disposable PostgreSQL tests passed. The 160 browser scenarios were exercised: 151 passed in the broad run; the nine failing retired-label/navigation or dated-cache assertions were corrected and passed in targeted reruns. Three living-week scenarios were repeated after the final streak-date rule was settled. Production build and local health checks passed.

The mock ChatGPT browser fixture uses a fresh observation time so synthetic Calendar coverage is valid for both the server and browser. Provider prompts, evidence constraints and capabilities are unchanged. Final Goals/Review edits replace ledger terms with picked task time; calculations are unchanged.


Verified on 6 October 2026 for General tasks and advisory outside-hours placement: docs, lint, TypeScript and production build passed; all 513 unit/service tests passed. The full disposable PostgreSQL run passed 339 of 340 checks; the old Goal-not-null assertion was updated for the new rule and all 39 Action checks passed on rerun. All 12 Calendar-task checks passed, including General Action lifecycle/Review Drop, analytics and legacy conversion with preserved history. Calendar, Focus, Daily Review and Weekly Review browser coverage passed after correcting outdated navigation labels and fixture timing/selection; the final mixed Goal/General light, dark and mobile check passed. Local screenshot: `.cache/general-goal-groups.png`.

Neon preflight confirmed `0015` was already applied, no orphan Action owners, and two exact automatic containers containing three Actions. Migration `0016` changes only these containers/links and the reviewed schema; historical JSON snapshots and receipts are retained.

## Task organization — Standalone (5)

Drag a task card into a different Goal group or General. Empty active Goals become drop targets during dragging. General remains a null link, not a Goal. **Options → Move to…** provides the same interaction for touch and keyboard. This drag changes the Goal association; it does not reorder cards or schedule blocks. The options menu replaces the separate Drop button with **Delete**, which still removes only this week’s task and eligible blocks. **Edit** renames inline: Enter or blur saves, Escape cancels.

Rename and move update the canonical Action and the effective current/future weekly task atomically. A move clears the old milestone association. Task identity, selected minutes and scheduled times stay unchanged. Only future blocks with no Focus Session follow the changed Goal; inherited task names follow renames while explicitly named blocks keep their names. Started/past blocks, all recorded execution, prior weekly baselines and previous revisions keep their original snapshots. The UI activity log stays collapsed and describes names and Goal moves without revision numbers.

These edits use owner/source/Goal version checks and the existing receipt/weekly-version transaction. A six-second Undo restores the former name/Goal/milestone when its source, week, Goal and affected blocks are still unchanged. Block or Action versions always advance; history is never overwritten. If a block has started or recorded execution since the edit, Undo refuses the entire restore. Read-only Actions and archived Goals cannot be changed through drag. No schema migration or AI capability changes are needed.

Verified on 6 October 2026 for Standalone (5): lint, type checking, documentation checks, 513 unit/service checks and all 17 disposable Calendar-task database checks passed. Four targeted browser checks passed (direct task controls, lost-response/Undo expiry, native pointer drag with inline editing/mobile move/reload, and dark Calendar hover). The dark hover check passed on rerun after an initial transient missing-tooltip assertion. Production build passed with the existing ChatGPT filesystem-tracing warning. Local app was restarted on port 3100 and its real Calendar options menu was visually verified without editing user data. Screenshots: `.cache/calendar-task-organization-light.png`, `.cache/calendar-task-organization-dark.png`, `.cache/calendar-task-options-local.png`.
