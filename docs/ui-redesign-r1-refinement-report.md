# R1 refinement: Reference-aligned calendar workspace

One Better’s Calendar workspace now follows the supplied “One Better - Calendar Workspace.html” reference more closely: warm cream chrome, Geist typography, pill navigation, compact commitments, a larger white calendar and a calmer context rail. This is a presentation refinement of R1 around the completed Phase 0–7A domain.

## Reference and implementation

The reference’s bundled markup/styles were inspected as design data. Its runtime was not executed or copied. The cream palette (`#F4F2EB`), ink (`#17231D`), paper panels (`#FBFAF6`), rounded controls, two-bar brand mark, Goal colors, scheduling ratios and three-region hierarchy inform the implementation. Reference example data, completion claims and scores were replaced with existing application facts. The supplied Latin Geist/Geist Mono font assets are self-hosted under their [SIL Open Font License](../public/fonts/OFL.txt).

The week heading sits inside the calendar. Work cards group effective commitments by frozen Goal context and show scheduled minutes against commitment budgets. Their bars indicate budget allocation to time blocks, not Action completion or actual effort. The week summary separates committed budget, scheduled time, still-unscheduled budget, breathing room, reserve and capacity. Its allocation bar covers current commitment budgets only; retained removed-work blocks and scheduling beyond budgets remain in the separate scheduled total.

## Calendar library decision

The workspace uses **FullCalendar React 7.1.0** with its standard TimeGrid, Interaction and Classic theme plugins, plus its required `temporal-polyfill` 1.0.1 peer. Both are pinned. The established domain continues to use its existing Temporal implementation. FullCalendar is MIT licensed and has an official [React integration](https://fullcalendar.io/docs/react), [named timezone support](https://fullcalendar.io/docs/timeZone), [background intervals](https://fullcalendar.io/docs/background-events) and [keyboard interaction](https://fullcalendar.io/docs/accessibility). These provide established calendar layout and scrolling while retaining React rendering hooks for One Better’s presentation.

FullCalendar owns layout only. `CalendarTimeGrid` maps read models into background Focusable Hours/busy intervals and foreground local TimeBlocks. Domain schemas, services, endpoints, migrations, source snapshots, immutable baselines, amendments and execution semantics are unchanged. Dragging, resizing, automatic placement and library-driven writes are disabled. Custom styles use the v7 public rendering hooks instead of its generated internal class names. The calendar loads on the client as a separate chunk with an explicit loading state.

## Interaction rules

- The desktop week defaults to Monday–Friday for readable cards. **Show weekends** exposes all seven days. Existing weekend blocks show weekends on initial load; saving/rescheduling a weekend block reveals weekends immediately.
- **Week/Day** switches the presentation without changing any saved state. Day view offers all seven dates; mobile uses this view automatically and collapses the work rail.
- The 24-hour grid opens at 08:00, uses half-hour rows and preserves the plan’s pinned timezone independently of the browser/account zone. Clock-change days are marked. Exact instants, UTC offsets and elapsed duration remain authoritative in details and existing services; the grid is a wall-clock presentation, not a 23/25-hour duration ruler.
- Blocks retain complete accessible titles/times/warnings, keyboard activation and selected state. Selection on narrow screens brings full frozen details into view. Closing details clears the card’s selected state.
- **+ Time block** opens the original editor for one commitment or a work chooser for multiple commitments. Clicking an empty time prefills a date/start/end through the same path. These actions create nothing until the original placement review, required acknowledgements and explicit confirmation succeed.
- Chooser/editor controls restore focus after closing. Existing version, ownership, overlap, outside-hours, busy-time, idempotency, uncertain-response and started/execution-locked guards remain authoritative.
- Google busy timing is hatched, advisory context. Stale timing has explicit text; unavailable timing reports Unknown and clears background intervals while keeping saved local blocks. Capacity remains manual.
- Focus entry retains its existing explicit start boundary. There are no new AI actions, completion claims, Google writes or automatic amendments.

## Verification

Final verification on 3 October 2026: **353 unit/service + 263 PostgreSQL + 110 browser/HTTP = 726 tests passed**. `npm run lint`, `npm run typecheck`, `npm run docs:check` and `npm run build` pass. All six production restart proofs pass, preserving sources/plans/amendments, Calendar/availability, scheduling, Focus, Daily Reflection and Weekly Review through twelve persistence stop/start cycles. The normal app was restarted on port 3100; `/api/health` reports ready. The disposable visual fixture was stopped and cleaned up.

The calendar suite retains the original seven R1 journeys and adds four: Week/Day/weekend visibility and keyboard selected-state reset; multi-work chooser/time-slot prefill with review-before-write and unchanged baseline; browser/account timezone independence; and spring/autumn clock-change offsets and elapsed durations. Placement assertions compare visible local slot boundaries, avoiding assumptions about the library’s generated positioning markup.

## Visual QA

Manual inspection uses the real production app on loopback port 3104, a disposable database and simulated Google provider, seeded by the existing `scripts/ui-r1-walkthrough.ts`. It uses no real Google account and does not change normal user data.

| View | Evidence |
| --- | --- |
| 1440×960 desktop | [Calendar and three-region hierarchy](screenshots/calendar-refinement-1440.png) |
| 1024×900 laptop | [Wider weekday cards; context below](screenshots/calendar-refinement-1024.png) |
| 390×844 mobile | [Single-day calendar](screenshots/calendar-refinement-mobile.png), [full block details](screenshots/calendar-refinement-mobile-details.png) |
| Simulated Google busy | [Distinct busy shading](screenshots/calendar-refinement-busy.png) |
| Stale timing | [Explicit stale context](screenshots/calendar-refinement-stale.png) |
| Unavailable timing | [Unknown availability with all ten saved blocks retained](screenshots/calendar-refinement-unavailable.png) |

Desktop/laptop/mobile checks show no horizontal page overflow. Long titles remain readable in the work rail and full selected details. Short cards use abbreviated visual text with complete accessible names. The existing guarded review editor remains the final save step. Real Google consent/provider verification retains its existing deployment prerequisite.

## Remaining limits

Very short blocks and seven-day weeks need selection to read full context. Day/week/weekend choices are temporary presentation state. DST axes remain wall-clock views with exact offsets and elapsed time in details. Goal/Action and weekly-commitment forms retain their existing workflows; their deeper redesign remains proposed R2.

Installing the calendar dependencies exposed five high-severity audit entries in the existing ESLint development chain (`braces` → `micromatch` → `fast-glob` → Next’s ESLint plugin/config). FullCalendar and its new peer have no reported entry in that audit. The suggested automatic fix would downgrade the Next ESLint config to v14, so it was not applied to this Next v16 project. This is a separate dependency-maintenance issue.

## Minor viewport-fit amendment

The calendar workspace now takes the available window height instead of adding a viewport-sized grid to its surrounding controls and footer. Calendar, work and context panels own their scrolling; notices and cancelled history stay bounded. Laptop context remains below the calendar, and narrow screens retain the existing Day view. Manual checks at 1066×1194, 525×1194, 1440×900 and 390×844 show document height/width equal to the viewport with no page overflow. [Current preview](screenshots/calendar-viewport-fit.png). The production build and all eleven existing calendar browser journeys pass; the local app was restarted and the previews reloaded. This amendment changes CSS only.
