# UI Redesign R1: Calendar-First Workspace

This records the initial R1 delivery. The later [reference-aligned refinement report](ui-redesign-r1-refinement-report.md) supersedes its typography, custom grid, day/week controls and empty-cell shortcut descriptions. Domain semantics remain the same.

One Better now opens into a weekly calendar. R1 changes presentation and navigation around the completed Phase 0–7A domain. It introduces no schema, migration, external Calendar write, automated scheduling, AI proposal or score. R2 is proposed below and has not begun.

## Information architecture and routes

`/calendar` is the authenticated working surface. `/` redirects there; sign-in still goes through `/`, so existing authentication and redirect behavior remain intact. The Goals list is at `/goals`. Legacy `/?view=active` and `/?view=archived` bookmarks redirect to the corresponding Goals view, including reload after switching tabs. Existing Goal detail bookmarks remain valid.

Primary navigation is Calendar, Goals, Focus and Review. A Settings disclosure contains Weekly planning, Today, Availability and Integrations. These routes and their forms remain available. Calendar links directly to the chosen week's planning page. Full Focus, Daily Execution and Weekly Review retain their existing interaction models.

Native shell/week links preserve the application's existing unsaved-form and unsaved-note navigation protection. The scheduling modal retains its own close, Escape, pending-command and navigation guards.

## Visual system and primitives

The existing Arial/Helvetica stack remains. CSS tokens define warm off-white paper (`#f7f8f4`), white surfaces, charcoal green ink (`#233f35`), muted green-grey text, soft borders, sage focus cards and restrained lilac milestone cards. Spacing mostly follows 8px increments, cards use a 16px radius, and chrome uses almost no shadows. Status meaning is written in text and accessible names, alongside the visual styling.

Immediately consumed components are `AppHeader`, `WeekNavigator`, `Panel`, `Metric` and `EmptyState`. Calendar layers and commitment rows stay local to the workspace. The existing `BlockEditor` is exported for reuse; its scheduling logic is unchanged. There is no speculative component library or added dependency.

## Calendar composition and existing data

| Surface | Existing source and meaning |
| --- | --- |
| Work rail | Effective Plan commitments, grouped by Goal with frozen Action/Milestone context. Shows weekly budget, scheduled time and remaining unscheduled budget. Global backlog is accessible through Goals, not loaded into this rail. |
| Week facts | Effective capacity/reserve from amendment history; usable capacity, effective committed budget and breathing room use existing capacity semantics. |
| Scheduled focus | Sum of planned local TimeBlock elapsed minutes, including retained blocks whose commitments were removed. |
| Still unscheduled | Sum of positive budget-minus-scheduled differences for current effective commitments. It is separate from breathing room and can coexist with scheduling beyond budget. |
| Focusable Hours | Existing recurring settings expanded by the existing DST-aware availability helpers, rendered as a faint background. Current settings are context, not historical planning evidence. |
| Google busy | Cached complete free/busy intervals, muted neutral shading with no invented titles. Stale intervals have written labels and hatching. Missing timing is unknown, not free. |
| Local TimeBlocks | Foreground keyboard-selectable cards with frozen Action titles, local times and Goal context. Removed-lineage blocks carry explicit “Review required” labels. |
| Selection | Frozen Goal/Milestone/done condition; block duration, current budget, scheduled total, recorded session time and current context warnings. |
| Focus entry | An eligible block links to the existing Focus page with its block ID. Visiting the link does not start a session. Existing start/acknowledgement rules still apply. |
| Cancelled blocks | Secondary expandable history. Cancellation preserves the existing record and snapshot. |

The page composes existing authenticated services. Refresh uses existing endpoints; create, reschedule and cancel use the original preview/review/acknowledgement/version/idempotency path. Execution-locked, started, historical, removed and cancelled restrictions remain authoritative in the domain. All existing domain modules, migrations and database schemas are unchanged.

The week spans Monday–Sunday with a 24-hour local axis at 64px per hour, initially scrolled to 08:00. Intervals clip at local midnight, and block selection exposes UTC offsets. The current-time line uses the displayed local date and updates every 30 seconds. Calendar context cannot change manual weekly capacity.

A clock-change day is marked. A repeated-hour interval whose wall-clock end precedes its start receives a visible elapsed-duration fallback. The 24-hour wall grid is a bounded visual approximation on DST transition days; exact instants, offsets and elapsed duration remain authoritative in details and services. R1 does not attempt a 23/25-hour axis.

Detailed availability remains secondary: the collapsed context disclosure contains compact facts and links to the existing daily availability report on the planning page. It does not embed the full report into the narrow context rail. Future suggestions are explanatory text only.

## Responsive and keyboard behavior

At 1440px, work, calendar and context appear together. Long work/context rails have independent accessible scroll areas. At 1024px, work and the seven-day calendar remain side by side; context moves underneath in wider panels. At 760px and below, work collapses and the calendar shows one chosen day with a seven-day picker. Context stacks below. Selecting a block on narrower screens focuses its detail heading and brings the panel into view. The existing modal remains usable with keyboard controls, and restores the initiating control after closing.

Long labels wrap in the work rail and selected details. Calendar cards intentionally truncate their visual excerpts; their accessible names retain complete titles and times. Short removed-lineage cards show their warning before the excerpt. Critical context is never available only through color.

## Verification

Final verification on 3 October 2026: **353 domain/service + 263 real PostgreSQL + 106 browser/HTTP = 722 tests passed**. `npm test`, `npm run test:db`, `npm run test:e2e`, `npm run lint`, `npm run typecheck`, `npm run docs:check` and `npm run build` pass. `npm run test:restart` passes all six production proofs, covering twelve persistence stop/start cycles across sources/plans/amendments, Calendar/availability, scheduling, Focus, Daily Reflection and Weekly Review. The normal production app was restarted on port 3100 and `/api/health` returns ready.

The new suite adds seven browser journeys and four pure presentation tests. Existing journeys are retained and updated to navigate through the relocated Goals list or Settings disclosure. The Goals restart proof now reads the relocated `/goals` list while retaining its original persistence and recovery assertions. Fixture login waits for the production authentication limiter's advertised window; no authentication exemption was added. Daily Reflection browser input explicitly focuses the field before replacing existing text and asserts the attempted value before saving; its application behavior is unchanged.

The new browser journeys cover home/bookmark/settings/week navigation; effective commitments and amended capacity; Focusable Hours and correct local card coordinates; keyboard selection and frozen detail; guarded create/reschedule/cancel and unchanged baseline; Google busy/stale/unavailable states; removed lineage and outside-hours warnings; responsive long frozen titles; and the explicit Focus entry/start boundary. A failed refresh followed by a concurrent disconnect re-reads current advisory context and clears obsolete busy intervals while retaining saved local blocks.

## Manual browser QA and screenshots

QA used a production build on loopback port 3104 with a newly allocated disposable database and simulated Google OAuth/free-busy provider. The fixture was seeded through the real domain APIs with four effective commitments, ten blocks, one removed commitment and an early outside-hours block. It did not access a real Google account or modify normal application data. `scripts/ui-r1-walkthrough.ts` can repeat this inspection with the normal test environment. Its database/provider/server are cleaned up on exit.

| View | Screenshot and finding |
| --- | --- |
| Desktop 1440×960, no Calendar | [Three-region workspace](screenshots/ui-r1-1440.jpg): the calendar dominates and works without Google. Long work is contained in its rail. |
| Busy desktop | [Busy context](screenshots/ui-r1-busy-1440.jpg): neutral intervals remain visually separate beneath stronger local cards. |
| Laptop 1024×900 | [Calendar](screenshots/ui-r1-1024.jpg), [full page](screenshots/ui-r1-1024-full.jpg): seven days remain usable; context moves beneath the primary surface. |
| Mobile 390×844 | [Day view](screenshots/ui-r1-mobile.jpg), [selected details](screenshots/ui-r1-mobile-details.jpg): readable single-day cards, collapsed work and explicit details. |
| Empty week | [Empty state](screenshots/ui-r1-empty-1440.jpg): clear planning action and honest unknown capacity; current date/time remain visible. |
| Stale timing | [Stale context](screenshots/ui-r1-stale.jpg): labels and hatching preserve last complete timing without implying freshness. |
| Unavailable timing | [Unavailable context](screenshots/ui-r1-unavailable.jpg): open time is Unknown; all ten local blocks remain. |
| Removed commitment | [Review required](screenshots/ui-r1-review-required.jpg): frozen context, removed budget, explanatory warning and permitted cancellation remain accessible. |
| Outside current hours | [Outside-hours detail](screenshots/ui-r1-outside-hours.jpg): long title is readable in full and the advisory warning is explicit. |

Manual inspection led to refinements for clipped hour labels, short-block warning visibility, bounded rails and narrow-screen detail positioning. Browser tests additionally verify no horizontal page overflow at 1440, 1024 and 390px. Real Google authorization remains dependent on the user's existing OAuth configuration; R1's provider QA is explicitly simulated.

## Remaining friction and proposed R2

Small/short blocks cannot display an entire long title at seven-day desktop density. Selection is still necessary for full context, and a very short block has a minimum visual height. DST repeated hours use the documented approximation. At 1024px, week facts sit below the calendar; mobile sacrifices simultaneous week comparison for readable days.

Weekly planning and Goal/Action management still use the prior form-heavy layouts. Repeated scheduling requires the existing editor's date/time fields and review step; there is no empty-cell shortcut or drag behavior in R1. An active-session summary remains in the Focus destination; the calendar's selected block exposes recorded time and the Focus entry point rather than duplicating the execution screen.

Propose R2 for Goal/Action and weekly-commitment presentation: clearer hierarchy, concise capture/edit flows, explicit budget entry, source review and tighter return-to-calendar navigation. Preserve all lineage, baseline, amendment and retry semantics. Focus Mode redesign belongs to R3. Seasons, AI, automated scheduling and Google writes require separately approved feature slices.
