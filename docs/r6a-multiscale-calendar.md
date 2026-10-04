# R6A — Multi-scale Calendar

Implemented 4 October 2026. Scope: Month / Week / Day projections over existing weekly planning and local TimeBlocks. No migration, MonthlyPlan, DailyPlan, recommendation/prompt changes, Google writes or new execution command.

## Information architecture and selected date

`/calendar?view=month|week|day&date=YYYY-MM-DD` is the shareable view state. A single selected local date survives zoom changes. The containing week is always Monday-start; the containing month uses local calendar arithmetic. Invalid dates/views produce the existing recoverable validation screen. Without parameters, Week selects the account's local Today. No view preference is written to domain history or local storage.

Legacy `?week=YYYY-MM-DD` bookmarks remain supported. Their previous/next week links retain the old URL shape for compatibility. Today upgrades to the shared-date URL and selects actual local Today. Week's narrow-screen weekday picker updates the date URL without a domain mutation.

Month and Day hide the weekly work rail; Week retains the existing three regions. Month's right panel explains the selected day and offers **View day / View week**. Selecting a block opens its original guarded details instead. Day has the existing single-day FullCalendar timeline with compact daily and weekly orientation facts. AI Coach remains on Week, with its existing explicit-generation behavior and unchanged safety contract.

## Navigation and interaction

Semantic pressed buttons select Month / Week / Day. Previous/next advance one calendar month, seven local dates, or one local date. Month advancement clamps month-end dates (31 January → 28 February). Today keeps the zoom level. Headings identify month/year, week endpoints or full weekday/day/month.

A Month date button or empty cell selects that local day. `+N more` opens Day directly. Every date, visible block and overflow control is keyboard reachable; title text remains in the accessible name even when mobile shows a quiet chip. View controls are disabled during the existing chooser/editor, preserving its explicit review and unsaved-navigation protections. No global letter shortcuts, drag/drop, resize or all-day creation.

## Month: projection across Weekly Plans

Monday-first complete rows include muted adjacent-month days. Desktop shows at most two Action-title chips per cell. A ResizeObserver reduces this to one, or overflow-only in unusually short rows, so overflow does not disappear behind clipping. Mobile shows one quiet chip with the full accessible Action title and `+N more`. Quiet exact scheduled totals appear where they fit; the selected-day panel always shows the full daily scheduled total.

Only planned local blocks are in the grid. Cancelled history stays in its existing disclosure. Day totals clip each stored instant interval to the local day, preventing cross-midnight double counting. Blocks retain `planId`, logical `commitmentId`, frozen source snapshot and actual interval; month browsing never merges budgets or identities.

Opening a Month block loads its owner's ordinary SchedulingView by its actual `planId`. Details, commitment budget, recorded session time, execution locks, removed-commitment flags, Reschedule and Cancel therefore use its originating plan. Month creation loads the selected date's committed containing week on demand, then uses the existing chooser and BlockEditor. Exact local date/start/end, deterministic preview, plan/context versions, warning acknowledgements, receipts and transactional overlap checks are unchanged. A missing/Draft/historical plan leads to weekly planning rather than inventing a monthly budget.

Month renders no individual Google busy rectangles, available-time claims, reflection text, session outcomes or AI coaching. It deliberately omits open-time aggregates rather than presenting unknown/stale timing as free capacity.

## Day: schedule and execution orientation

Day reuses the existing FullCalendar timeGrid positioning, all 24 wall-clock labels, keyboard block selection and exact-time placement. Foreground cards show Action and Goal; Milestone is optional. Eligible cards put **Start focus** in the first time row, keeping it visible on ordinary one-hour cards. The link opens `/focus?block=…`; only the existing R3 Focus command can start a session. Selecting any block exposes the same full details and larger Focus entry control.

Layers remain Focusable Hours background, neutral Google busy timing, foreground local blocks and the current-time marker on local Today. No Google event titles. Stale busy timing stays explicitly stale; absent timing stays unknown; either state retains local blocks. Google absence does not remove configured Focusable Hours.

Day's side context shows exact scheduled time, ended recorded Focus time clipped to that day, next future scheduled block, weekly unscheduled budget and weekly breathing room. Recorded time includes sessions associated with other dates' blocks if their actual execution intersects this day. Active elapsed time stays in the existing Focus surface; it is not counted as finalized recorded time. No reflection editor or duplicate Daily Review.

## Responsive behavior

Desktop: Month grid plus selected-day/details panel; existing three-region Week; wide Day timeline plus compact context. Tablet collapses context below the calendar. At 390 × 844, Month keeps complete tappable rows and visible View day / View week buttons. Day reserves more height for its scrollable timeline and keeps context in a short independent region. Selecting a block expands the context region for existing details. Full 24-hour timelines still scroll internally; there is no page-width overflow in the checked sizes.

## Timezones and DST

Selected dates, Today, Month ranges and Day ranges use the account's IANA timezone, independent of browser timezone. Month bounds start at local Monday midnight before/on the first and end at local Monday midnight after/on the next month's first. Interval queries are half-open (`block.start < end`, `block.end > start`). Day duration uses exact instants: London 29 March 2026 is 23 elapsed hours and 25 October is 25.

Compatibility exception: Week retains the existing plan-pinned timeline timezone and availability-zone warning after account timezone changes; weekly plan identity and exact-time editor always retain the plan's original timezone. Month/Day display account-local instants and show the originating week and entry timezone in block details. Zoom still finds the containing user-local Monday week. This preserves old Week tests rather than rewriting committed schedule meaning.

The timeline retains its documented wall-clock approximation on clock-change days and explicit clock-change label. Offset-labelled details and exact elapsed durations are authoritative; repeating/skipped wall-clock hours are not a second mutation path. Boundary/unit tests and existing spring/autumn scheduling tests preserve instants.

## Performance and ownership

The new read-only CalendarProjection queries owned planned TimeBlocks once for the requested interval (at most 42 Month dates), joining originating plan metadata with owner equality. Day adds one bounded ended-session interval query returning only started/ended instants and a recorded aggregate. The new API authenticates normally and gets timezone from the owned account; clients cannot choose another owner or query arbitrary/unbounded instants.

Month initial loading does not invoke scheduling history, execution workspace, availability or coaching. Full scheduling context loads only for explicit block details/creation and retains existing service guards. Month cells derive intersections from already fetched rows, parsing block instants once and local boundaries once per displayed date. No per-day/plan query loop and no event store. Existing weekly workspace metadata selector and Week/Day planning/availability readers are reused; their pre-existing whole-owner history reads have not been redesigned in R6A.

## Verification

- Unit/domain/service suite: **482 / 482**, 37 files, PASS (1.95 seconds). Includes nine new local-date/range/navigation/DST cases. First sandbox run could not bind existing loopback provider fixtures; rerun with local fixture access passed, with no live provider calls.
- Database suite: **303 / 303**, 16 files, PASS (39.20 seconds). New projection case covers multiple plans, original identities, cancellation, bounded ranges, owner isolation and recorded cross-midnight clipping with private note exclusion. The new fixture's initial invalid outcome/timestamps were corrected to existing lifecycle constraints; no constraint was weakened.
- Browser full suite: **157 / 157**, PASS (8.0 minutes). All 152 existing cases plus the initial five R6A cases passed.
- Final Calendar browser suite: **18 / 18**, PASS (51.3 seconds), including all 12 existing Week cases and six R6A cases after final layout changes. Combined runs cover 158 distinct browser cases; counts are not added as if repeated tests were new tests.
- Typecheck, lint and documentation-link/fence check: PASS.
- Final production build: PASS (compiled in 2.0 seconds; TypeScript finished in 2.9 seconds). One existing Turbopack warning traces the ChatGPT host configuration's dynamic filesystem path; no R6A warning or adapter change.
- Nine normal coaching contract files: SHA-256 hashes match the R5G frozen baseline, PASS. See [verification](r6a-evidence/verification.json).

All browser/database tests use disposable local databases and synthetic accounts. Existing Week/planning/TimeBlock tests remain intact. Automated Google/AI fixtures do not use real APIs or credentials. Normal local app is restarted at port 3100; saved account, plans and connections are preserved. R5G's separate comparison/evaluation task remains pending and unchanged.

## Manual QA and screenshots

A production walkthrough uses `node --env-file=.env.test --import tsx scripts/r6a-calendar-walkthrough.ts` on loopback port 3104. It creates a disposable database, explicit Focusable Hours, three distinct weekly plans, four blocks on Today and 35 minutes of ended recorded execution. Real Google/OpenAI/Anthropic credentials are explicitly disabled in its child app. `stop` removes only that isolated QA database. The walkthrough was stopped and its database removed after final screenshot capture; the normal app remains running on port 3100.

Direct UI walkthrough confirmed: Week → Month retains 4 October 2026; selecting the 6 October block displays originating week 5 October and its own 3h budget; Month → Day retains 4 October; Day displays 4h scheduled / 35m recorded; Day → existing Focus shows the selected block and explicit Start focus without starting execution; browser Back and Day → Week retain the selected date. Mobile Month → Day is visible and usable. A private session note never appears in the new projection or its visible Calendar context.

The browser QA matrix also covers empty/six-row Month, multiple plans, dense days, long titles, past/future/current days, no Google connection, stale/unknown timing, exact local slot geometry, clock-change labels, ownership, keyboard selection and guarded create/edit commands. Layout checks at 1440 × 1000, 1280 × 720, 1024 × 900 and 390 × 844 combine automated geometry and visual review. Initial clipping was corrected by reducing Month chip count and placing Day Focus entry in the first row.

| Surface | Frozen synthetic browser fixture | Production manual walkthrough |
| --- | --- | --- |
| Desktop Month | [Screenshot](r6a-evidence/desktop-month.png) | [Screenshot](r6a-evidence/manual-month.jpg) |
| Desktop Week | [Screenshot](r6a-evidence/desktop-week.png) | [Screenshot](r6a-evidence/manual-week.jpg) |
| Desktop Day | [Screenshot](r6a-evidence/desktop-day.png) | [Screenshot](r6a-evidence/manual-day.jpg) |
| Mobile Month | [Screenshot](r6a-evidence/mobile-month.png) | [Screenshot](r6a-evidence/manual-mobile-month.jpg) |
| Mobile Day | [Screenshot](r6a-evidence/mobile-day.png) | [Screenshot](r6a-evidence/manual-mobile-day.jpg) |

Additional evidence: [Month originating-plan details](r6a-evidence/manual-origin-details.jpg), [empty Month](r6a-evidence/empty-month.png).

## Remaining friction and next-step proposal

View/date navigation reloads the server page; it is shareable and reliable but not a continuous animated zoom. Short Month rows/mobile show fewer titles and rely on View day for detail. Day context scrolls independently on small screens. Exact-time entry still uses the original plan timezone after account changes, explicitly labelled in details/editor. Very short calendar cards can omit lower context, with full information in selected details. The 24-wall-hour DST timeline remains an approximation; exact details are preserved. Google refresh remains explicit and weekly; there is no new Month availability cache.

Proposed next step only: a small real-use Calendar usability pass to decide whether date-navigation continuity and short-block Focus target sizing warrant a follow-up. No agenda, drag/drop, recurring work, automation or AI phase has been started. Stop after R6A.
