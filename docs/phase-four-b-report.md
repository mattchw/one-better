# Phase 4B — Focusable Hours and deterministic Calendar-open focus time

2 October 2026. Phase 4B implemented and verified. All 50 acceptance cases are mapped below. The manual product gate passed with an isolated simulated provider; real Google verification and a fresh online dependency-advisory lookup remain explicitly unverified. No next-phase code was implemented.

## Delivered model and behavior

Availability settings intentionally captures when focused work could reasonably fit. No default workweek is created on read. One owned `focusable_hours` row contains UUID, unique owner, version, creation/update instants and a small JSONB array of authored windows. Windows use ISO weekdays 1–7, integer startMinute 0–1439/endMinute 1–1440, start < end, maximum 70. Empty weekdays and entire empty schedules are valid. Start/end are wall-clock preferences, not stored UTC recurrence. Overlap rejects with the day named; adjacency remains distinct in storage and unions for concrete arithmetic. 24:00 means next local midnight; overnight input must be split explicitly.

Full-state Settings save uses the existing owner-scoped command receipts and optimistic version. Unsaved new configuration expects version zero/null schedule ID; each acknowledged save advances version once. A stable User `FOR NO KEY UPDATE` lock serializes first creation and later replacements, compatible with receipt foreign-key KEY SHARE locks. Receipt → User → owned hours row is the lock order. Competing saves from one version have one winner/typed HOURS_VERSION conflict. Stale UI preserves fields and requires explicit latest-version review. Unknown outcomes retain/lock the exact original command, then retry safely and read current saved truth. Identical successful mutation retries return their original result even after later saves/restarts; changed payload reuse rejects. Read/derive creates no receipt.

Verified app Actor supplies ownership; browser owner/timezone fields reject. Public DTOs omit owner. Owned resource GET, full-state save and derived GET return indistinguishable 404 for foreign/missing schedule IDs. Real sessions, Origin enforcement, private/no-store responses, existing 32 KiB body bound and strict independent server validation protect HTTP boundaries. Additive reviewed migration `0007_focusable_hours.sql` adds only one table; runtime health checks sixteen tables. Prior migrations 0000–0006 remain byte-identical.

## Time semantics and interval derivation

**Focusable Hours ≠ Calendar-open Focusable Time ≠ Manual Weekly Capacity ≠ Commitment Capacity ≠ Scheduled Time ≠ Actual Focus Time.** Manual capacity minus chosen protected reserve determines commitment capacity. Budgets, future scheduled minutes and future actual effort remain separate.

Expand a requested valid Monday-start week through the current User IANA timezone with existing @js-temporal/polyfill 0.5.1. Local calendar-date addition determines weekdays; 24:00 converts the following midnight. Explicit `compatible` disambiguation chooses the earlier repeated time and advances a skipped boundary by its transition gap. [Temporal primary documentation](https://tc39.es/proposal-temporal/docs/timezone.html) specifies that policy. London full Sundays contribute 23/25 elapsed hours on spring/fall transitions; 00:00–03:00 contributes two/four. Boundary adjustments are visible. Clip to exact local-date bounds; gap-collapsed/inverted or wholly skipped-date windows contribute zero with a visible omission explanation. No one-off override is introduced. Offsets display on offset-change days to distinguish repeated times.

Pure domain operations reuse provider-independent Phase 4A BusyInterval, weekRange, mergeBusyIntervals and busyTotals. Union concrete focusable intervals; intersect with clipped merged busy timing; union blocked intersections; subtract blocked union to return actual open intervals. Every interval is half-open `[start,end)`. Boundary adjacency removes nothing, partial overlaps clip, nested/duplicate/cross-calendar busy intervals count once, and outside busy time has no effect. Weekly/per-local-day totals preserve precise elapsed nanoseconds before minute display. No nominal-wall-hours or aggregate-only subtraction substitutes for interval correctness. The same pure function serves the owned server GET and UI after explicit Calendar refresh.

Only authored recurring preferences persist. Derived intervals/metrics are recalculated from settings + complete owned Calendar snapshot + week/timezone. No new cache, network-on-read, event payload, queue, job, Google scope or provider logic. The existing Calendar load refresh handles on-demand FreeBusy. Rendering checks connection/selection/version after refresh so an old response cannot become timing for a changed selection.

## Advisory status and planning independence

| State | Meaning and displayed data |
| --- | --- |
| not_configured | No schedule or deliberately empty windows; offer setup, never derive all free Calendar time |
| available | Hours plus complete fresh selected-calendar snapshot; known focusable/blocked/open intervals and totals |
| stale | Last complete snapshot is aged or refresh/coverage/reauthorization failed; preserve intervals/original fetchedAt and clearly label previously fetched timing |
| unavailable | No complete matching snapshot, disconnected Calendar or no selection; hours known, open/blocked null/Unknown |
| incomplete | Incomplete refresh and no complete snapshot; open/blocked unknown, never partial truth. With previous complete timing use stale instead |

Freshness remains Phase 4A's fifteen minutes; a browser-local clock updates staleness without provider polling. No-cache failure reasons remain Phase 4A-transient: reloading after incomplete failure stays unavailable/unknown but does not retain the reason. Calendar disconnect leaves hours intact; reconnect and successful selected-calendar refresh restore derivation. Selection fingerprints and timezone/week cache identity prevent reuse of previous coverage.

Current/future Planning displays concise totals after the manual capacity summary, daily focusable/blocked/open interval lists, and subordinate total Calendar load/fetch time. A fresh known open total below the manual capacity produces neutral advisory text only. Capacity above/below open time neither blocks commitment nor changes any plan value; no prompt to fill spare hours exists. Finished weeks and immutable history inspectors omit live hours. No hours snapshot is retroactively attached to a baseline/amendment.

Database evidence seeds Goals, Milestones, Actions, a Draft, committed baseline and amendment, then compares exact source/planning/history rows and **all existing planning/source receipts**, including versions and timestamps, after hours changes and availability/Calendar operations. New successful hours-save receipts are intentionally additive; they are the only receipt changes. Pure derives write nothing. Browser evidence compares persisted Plan before/after hours edits, refresh/stale/disconnect/reconnect and a transient over-open-capacity edit. Production restart proof replays the original save after a later replacement and two real restarts while retaining current settings and Calendar fetchedAt.

## Acceptance evidence

| Cases | Concrete evidence |
| --- | --- |
| 1–5 empty setup, single/multiple windows, multiple/empty weekdays | Domain validation; SQL no-read-create; real-login browser explicit eight-window schedule and empty weekend |
| 6–9 overlap, ordering, overnight, server validation | Domain negative matrix; service rejects before write; PostgreSQL no row/receipt on invalid command; browser retains invalid input then saves 24:00 |
| 10–11 reload/restart persistence | Browser saved settings reload; new PostgreSQL connection; production process restart proof |
| 12–15 version, stale save, replay, owner-scoped IDs | Service protocol, real PostgreSQL competing first/replacement saves and identical concurrent retries; stable two-tab browser conflict/lost acknowledgment; original result after later save/restart |
| 16–18 concrete dates/current User zone/Monday | Pure expansion with London/New York and 24:00; invalid/non-Monday dates; PostgreSQL timezone change invalidates busy cache |
| 19–21 spring/fall/disambiguation | London 23/25-hour Sundays and 2/4-hour windows; gap moves forward/fold chooses earlier; collapsed window omitted with explicit explanation |
| 22–26 outside/inside/partial/full-cover busy | Parameterized half-open intersection/subtraction matrix and exact returned intervals |
| 27–30 overlaps/multiple windows/cross-calendar union/adjacency | Pure nested/duplicate/overlap fixtures; adapter-backed browser Work/Personal overlap; adjacent authored vs expanded coverage |
| 31–32 weekly sums/local days | Exact concrete union and per-day sum assertions; midnight/week clipping and sub-minute precision; DST day bounds |
| 33–36 complete/stale/unavailable/incomplete | Pure status matrix, SQL complete/stale/error, browser no-cache incomplete and prior-cache stale, production restart original fetchedAt |
| 37–39 disconnect/reconnect/selection | SQL and browser retain hours while open unknown; explicit reconnect/fetch restores; selection invalidation before new fetch |
| 40–45 capacity/reserve/commitments/budgets/no amendment/history | Exact SQL full-row nonmutation with seeded baseline/amendment/Draft/source/receipts; browser persisted Plan equality; production restart equality |
| 46–47 neutral over-open-capacity/no fill encouragement | Browser transient 780m capacity versus 750m open remains saveable; persisted plan unchanged; informational copy/manual quality gate |
| 48–50 ownership | Real two-owner SQL and authenticated browser foreign/missing GET/save/derived 404; B's own configuration/receipt cannot influence A; B derived read never uses A's hours/Calendar |

## Exact verification results

| Check | Result |
| --- | --- |
| Unit/service/provider | PASS: 230 tests / 17 files (181 previous + 49 new) |
| Real PostgreSQL | PASS: 179 tests / 8 files (166 previous + 13 new), disposable migrations-only database |
| Browser | PASS: all 64 tests, zero retries, 2.4 minutes (57 previous + 7 new). The final screenshot-only test addition was separately verified: all 7 availability tests passed in 19.6 seconds |
| Total automated tests | **473 passed**: 230 unit/service/provider + 179 PostgreSQL + 64 browser (404 previous + 69 new) |
| Production restart persistence | PASS: four actual stop/start cycles across the two proof scripts. Original settings receipt replays after a later replacement and two restarts; current settings and original Calendar fetchedAt survive; disconnected open time is unknown; unavailable DB yields 503 on new reads/save |
| Lint | PASS: `npm run lint`, zero warnings |
| Typecheck | PASS: `npm run typecheck` |
| Documents | PASS: `npm run docs:check`, required documents/local links/fences |
| Production build | PASS: `npm run build`, Next 16.3.8, optimized compilation 4.3 seconds, build TypeScript 4.5 seconds |
| Dependency/security audit | Cached offline audit PASS: `npm audit --offline --json`, 0 vulnerabilities at every severity across 646 dependencies. No dependency changes. Automatic approval review rejected the online audit because it would transmit dependency metadata to an external registry without explicit destination/payload authorization; no fresh advisory lookup is claimed |
| Local migration/previous migration hashes | PASS: `npm run db:migrate`, additive migration 0007 applied; SHA-256 of SQL 0000–0006 unchanged. Disposable test databases reconstruct solely from migrations |
| Manual product gate | PASS: real sign-in and explicit hours setup in separate Chrome storage; simulated-provider fresh/stale/disconnected UX and higher-capacity amendment review; cleanup verified exact source/planning/history/original-receipt equality |
| Normal preview | Latest production build restarted at `http://127.0.0.1:3100`; `/api/health` checked after fixture cleanup |

Development verification caught and fixed a real PostgreSQL lock-upgrade deadlock by changing the owner lock to NO KEY UPDATE. Browser harness checks wait for actual sign-in navigation and scope alerts to Settings because Next also has a route-announcement alert. Assertions retain stale conflict/transport retry semantics; no production authentication/validation was weakened. The restricted-shell initial provider-suite run could not bind its loopback fixture; the permitted loopback run passed all tests.

## Manual product quality gate

Completed against the production build on a separate localhost port, disposable PostgreSQL database, synthetic account and external simulated Google provider. The normal in-app browser session and real account were untouched. Used actual UI sign-in, added eight windows across Monday/Tuesday/Thursday 09:00–12:00 + 14:00–17:00 and Wednesday/Friday 09:00–12:00, left weekends empty, saved and reloaded, then explicitly selected Work/Personal and refreshed.

The realistic current-week Plan retained **11h capacity / 2h reserve / 9h usable / 6h30 commitments / 2h30 breathing room**. Derived totals were **24h focusable / 11h30 busy inside / 12h30 open**; total Calendar load was separately **15h30**. Daily lists made Tuesday 14:30–17:00 and Wednesday 09:00–10:00 immediately identifiable. A temporary amendment to 15h capacity showed a neutral higher-than-open advisory and an enabled Review amendment button. Cancelling restored the 11h current Plan; no amendment was persisted.

Changing Monday's afternoon end to 16:00 yielded **23h focusable / 11h30 busy inside / 11h30 open**, while Plan values and original history remained unchanged. A selected-calendar incomplete refresh retained the last complete intervals and original **2 October 22:35 Europe/London** fetch time, visibly stale. Explicit disconnect retained 23h of recurring hours and made blocked/open values **Unknown**, with copy explaining that missing data does not mean free time. Automated real-login browser coverage separately verifies reload-stale and reconnect/refresh without reconfiguring hours. The manual fixture was stopped and removed; its cleanup assertion confirmed byte-identical planning/source/history/original-receipt rows. Only newly authored hours and their receipts were allowed to differ.

The saved visual artifact `.cache/visual/phase-four-b-availability.png` comes from the real-login browser acceptance journey with the same eight-window and busy fixtures, in a future Draft week; it is not represented as the manual current-week committed Plan. Its expanded daily list was visually inspected for readability and surrounding manual-capacity context. Separate 390-pixel browser assertions verify no horizontal overflow in Settings and daily Planning.

| Product question | Observed finding |
| --- | --- |
| Does availability make capacity decisions easier? | Yes. Busy-inside versus all Calendar load avoids over-subtraction; Wednesday's one open hour makes a weekly total more concrete. This is an engineering walkthrough, not yet a multiweek user pilot |
| Does it feel informational rather than judgmental? | Yes. The chosen capacity/reserve summary remains primary; the availability panel explains current context without a score or performance target |
| Can I quickly see realistically open days/times? | Yes. Expandable daily lists expose Tuesday's 14:30 start and Wednesday's shorter opportunity; empty weekends remain explicit. A list is sufficient for this slice |
| Are Focusable Hours easy to configure? | Day groups and Add/Remove/Save are clear; deliberate empty days work. Eight windows require sixteen field entries, so initial repeated entry is modest friction. Templates can wait |
| Is there pressure to fill unused open time? | None observed. The Plan preserves 2h30 breathing room and explicitly says it need not be filled; lower manual capacity triggers no add-work prompt |
| Is manual capacity clearly human judgment? | Yes. It stays in its own controls and reserve calculation. Editing hours recalculates advisory values without touching either |
| Does it reveal unrealistic assumptions without deciding for me? | Yes. 15h versus 12h30 open displayed a neutral warning while amendment review remained possible. Cancellation left the saved Plan untouched |
| Would one-off overrides materially improve the experience, or can they wait? | Travel/holiday exceptions could help during later use, but can wait. Current recurring settings and stale/unknown context are honest; no speculative override was added |

## Deviations, limitations and deferred features

One bounded JSONB window array models the single small aggregate rather than a separate per-window table. SQL guards aggregate shape/ownership/version/time, while strict service validation enforces minute/day/overlap rules. No generic scheduling-rule language or per-window event sourcing. Inputs accept any valid minute via HH:mm rather than imposing quarter-hour increments. Save increments version even for an explicit equivalent full state. Current User timezone, not historical Plan timezone, intentionally controls live advisory. Compatible DST resolution plus visible collapsed-window omission replaces earlier proposed availability-day rejection; no exceptions/day override is added.

This is recurring preference/current external context, not historical availability evidence or human capacity estimation. One-off exceptions, holidays/vacations, working-hours import, per-Goal windows, daily targets, minimum block length, buffers, auto capacity/reserve/amendments, productivity scores, scheduling suggestions, TimeBlocks, Calendar writes, focus/actuals, AI and extra integrations remain deferred. There is no private event content or Google Events API. The audit used cached offline advisories because automatic approval review rejected the online metadata transmission; newly published advisories were not checked. Settings do not poll other tabs automatically; explicit reload/latest-version review is intentional. Real Google credentials are locally configured by the user, but the latest real attempt was blocked by Google's testing-user access restriction; a completed real consent/CalendarList/FreeBusy lifecycle walkthrough has not been verified. This is explicitly non-blocking for Phase 4B and required before hosted Calendar use or any future external writing.

## Recommended next slice — proposal only

Phase 4C / 5A: **Local Time Blocking**, one Weekly Commitment → one or more explicit manually placed local TimeBlocks using these advisory intervals. Keep commitment budget distinct from scheduled minutes, prevent internal overlap, respect configured hours, warn about busy conflicts, preserve frozen planning history, and keep every placement/change user-controlled. Specify owned command/version/retry/DST/interval/history acceptance rules first. Evaluate a deterministic suggestion only after basic manual placement proves useful. Create no Google events in that slice. Real Google OAuth + FreeBusy walkthrough is a hard gate before a subsequent dedicated focus-calendar publication slice. No part of this next phase is implemented here.
