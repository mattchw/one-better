# Phase 5A — Local Time Blocking

Status: Phase 5A complete; combined verification and manual quality gate passed. Authorized boundary: Phase 5A only. Phases 0–4B are approved. No next-phase implementation.

## Result

Committed current/future weeks now turn current logical commitments into explicit local intended work. Each commitment shows budget, active scheduled elapsed minutes and remaining/excess difference. Add, preview, acknowledge warnings, confirm, reschedule and intentionally cancel through a small dialog. A compact weekly list answers when the user made room; historical labels, cancelled records and past-started blocks remain preserved. Clock-aware controls expire as a block starts, and the server always checks current time again.

The preparatory Phase 4B polish keeps the three availability numbers prominent and places daily intervals plus Calendar Load in one details area, collapsed by default. No unrelated screen redesign.

## Model and decisions

`time_block` stores UUID, owner, Plan ID, logical commitment ID, UTC start/end instants, planned/cancelled state, version, frozen PlanningSnapshot and created/updated/cancelled timestamps. There is no completion/actual/publication state and no product deletion endpoint. Future rescheduling changes only boundaries; cancellation retains the record and releases its local reservation.

The existing amendment implementation already carries stable commitment IDs and creates a new ID when dropped work is later re-added. Reused it unchanged. Added only `commitment_identity` as the owned relational foreign-key target for IDs that first appear in baseline or amendment children. The service continues deriving membership from the actual Effective Plan, never from the registry or source Action ID. [ADR 015](decisions/015-local-time-blocks.md) records this architectural bridge and the full contract.

Action estimate ≠ weekly commitment budget ≠ scheduled time ≠ future actual effort. Scheduled minutes derive from active planned blocks for a logical membership, including preserved past planned blocks. Under/over scheduling is valid. Creating/editing/cancelling never changes the Action, manual capacity/reserve, budget, original baseline or amendments. No schedule total is persisted separately.

## Time, eligibility, warnings and history

Only current Effective Plan commitments in committed current/future weeks can create/edit blocks. Drafts, uncommitted global Actions and finished weeks cannot be scheduled. A past-started block cannot normally be edited/cancelled; exact successful receipts still replay their original historical result.

Editing/display use the Plan's pinned IANA timezone; live recurring hours and existing Calendar coverage use the current User timezone. Persist instants, not floating wall times. Choose valid local date/minute HH:mm with start before end, both boundaries on one local date and wholly inside the owning Monday–Sunday week. No 24:00 endpoint or overnight/cross-week block. Temporal compatible resolution matches Phase 4B: repeated time earlier, nonexistent time later. Preview visibly shows changed wall times/offsets. Nonpositive elapsed or a resolved cross-date/week interval is rejected. Durations count actual elapsed minutes: London autumn 01:30–02:30 spans 120m, and spring gap 01:15–03:00 resolves 02:15–03:00 / 45m.

| Condition | Behavior |
| --- | --- |
| Another active local block overlaps, same owner across any Plan/commitment | Hard rejection in final transaction; half-open adjacency allowed |
| Any portion outside configured Focusable Hours, including unconfigured/empty hours | Explicit warning and separate server acknowledgement; hours unchanged |
| Complete fresh/stale Google timing reports busy overlap | Explicit warning and separate server acknowledgement; Google unchanged |
| Complete timing aged 15m or retained after failure | Visibly stale, with original successful fetch timestamp |
| No complete covered timing, incomplete/unavailable/disconnected, or interval outside cache coverage | Conflict status unknown; never Calendar-free; local placement permitted |
| Scheduled minutes below or above weekly budget | Neutral difference; no budget change or automatic amendment |

Budget/carry amendments retain block identity, duration and frozen context, recalculating only derived totals. A drop preserves blocks and marks future planned ones review-required; they may deliberately be cancelled but cannot be reassigned/rescheduled under removed membership. A later re-add has a distinct logical ID and zero scheduled time. Old active blocks still reserve their instants. Source rename/estimate/completion/archive and parent transitions do not relabel existing or newly placed carried snapshot context.

## Ownership, concurrency and retry evidence

Every route resolves Actor from the established database-backed session; browser owner/context/state injection is rejected. Read-only previews use owned repeatable-read data with no provider network call. Foreign/missing blocks and Plans return indistinguishable 404 errors without foreign current DTOs; anonymous requests 401, cross-origin mutations 403, unsupported deletion 405, unavailable DB 503. HTTP reads/results are private/no-store.

Final commands reuse `executeReceipt`: owner-scoped mutation ID + operation/payload hash, then receipt-compatible stable User NO KEY UPDATE lock, owned Plan/block locks and final overlap/context/version recheck. All local writers for an owner serialize across Plans. Hours saves share the owner lock; amendments serialize on Plan. Preview is advisory, not a reservation. Create/edit require matching reviewed Plan version and context digest; changed settings/Calendar/local schedule or budget requires another explicit review. Edit/cancel expected block versions prevent stale overwrite. Draft values remain on error. An uncertain response freezes the exact command and supports retry; success/replay rereads current truth.

PostgreSQL proves simultaneous identical/partially overlapping creates have exactly one winner; competing edits and edit-versus-cancel have one winner; edits of two blocks cannot converge on overlap. Cancelled time is reusable. Identical concurrent create retries insert one row, and original create/edit/cancel results replay after later state changes. SQL failures roll back receipt and aggregate. Different owners may reuse a mutation ID independently and schedule the same times in their own Plans.

The hard overlap invariant is enforced through the application transaction protocol, as authorized, not a PostgreSQL exclusion constraint. Direct administrative SQL bypasses this protocol; relational SQL independently enforces owned Plan/commitment references, positive interval/version, lifecycle and timestamp checks. All product writers use the service.

## Additive migration

`0008_local_time_blocks.sql` creates the identity registry and owned block table with restrictive composite foreign keys and indexes. It backfills all existing committed baseline/historical amendment logical IDs with no immutable row rewrite. Clean migrations-only PostgreSQL construction and repeated migration pass; a real fixture with drop/re-add proves the backfill retains both lineages and leaves source/plan/history unchanged. Migrations 0000–0007 remain byte-for-byte unchanged. Normal local development migration was applied.

## Acceptance evidence

D = [domain](../tests/domain/scheduling.test.ts), S = [service](../tests/services/scheduling.test.ts), P = [real PostgreSQL](../tests/db/scheduling.test.ts), B = [browser](../tests/e2e/scheduling.spec.ts), R = [actual restart proof](../scripts/prove-scheduling-restart.ts). All provider/browser fixtures use deterministic simulated Google, without a real account.

| Case | Evidence |
| --- | --- |
| 1. Current/future committed eligibility; Draft/historical restrictions | D eligibility, P current-week/future/draft/history, B narrow/draft/history |
| 2. Current Effective Plan commitment receives a block | D/S placement; P create; B authenticated two-placement journey |
| 3. Persist/display unambiguous instants in Plan timezone | D London conversion/User move; P new connection read; B day/time/reload |
| 4. No midnight/week crossing | D boundary and schema fixtures; shared final create/edit evaluation |
| 5. Active owner-wide overlap, including races | D cross-Plan/commitment; P full/partial create races, converging edits and cross-zone Plans; B hard error retains fields |
| 6. Adjacent half-open intervals | D adjacency; P adjacency and cancelled reuse; B adjacency after overlap |
| 7. Inside Focusable Hours no warning | D evaluated flag; B first placement and manual normal blocks |
| 8. Outside acknowledgement permitted, server-enforced | S bypass rejects; P warning/budget non-mutation; B acknowledgement checkbox |
| 9. Busy acknowledgement permitted, server-enforced | S busy bypass; P real cached provider fixture; B simulated consent/busy |
| 10. Stale visibly labelled | D aging/status; P failed/retained cache; B stale placement text |
| 11. Unknown/incomplete never free | D unavailable/incomplete/out-of-coverage; P disconnect; B unknown text and no free claim |
| 12. Independent derived scheduled minutes | D totals; P snapshot non-mutation; B estimate 4h/budget 3h/scheduled 3h |
| 13. Under-scheduling allowed | D 90m/180m; P create; B remaining 90m |
| 14. Over-scheduling neutral, budget intact | D 240m/180m; P beyond budget; B neutral difference and immutable budget |
| 15. Sources/baseline/amendments/capacity/reserve unchanged | P exact table snapshots; B exact history; R exact rows; manual original/source/settings assertion |
| 16. Safe future reschedule | S final checks; P edit; B reschedule and manual same-duration move |
| 17. Stale edit cannot overwrite | D expected version; P competing edits; B retained times and explicit newer-block review |
| 18. Cancel without deletion | S terminal DTO; P retained row and reuse; B cancelled details; manual orphan cancellation |
| 19. Original successful command replay | P all three after later states; B lost create/edit/cancel payload equality and current reread; R |
| 20. Past-started preserved | D exact start; P server exact start/history; B read-only and open-page clock expiry |
| 21. Carried lineage stays aligned | D logical ID; P carry amendment; B alignment |
| 22. Budget changes only derived totals | P byte-identical blocks; B changed remaining; manual 3h→2h with 5h30 unchanged |
| 23. Drop preserves review-required blocks | P drop; B orphan review/cancel; manual four retained |
| 24. Re-add cannot steal old blocks | D changed membership; P distinct ID/zero total; B re-add lineage |
| 25. Source changes preserve labels | S cloned snapshot; P rename/complete/archive; earlier snapshot browser coverage retained |
| 26. Browser reload and process restart | P new connection; B reload; R two actual production restarts |
| 27. B cannot inspect/create/edit/cancel/derive A | P and B every owned surface, matching foreign/missing errors |
| 28. Mutation ID owner scope | P same mutation ID for different owned commitments; established receipt suite |
| 29. Documented DST resolution | D London gap/fold/elapsed and no-duration rejection; visible preview adjustments |
| 30. Compact Phase 4B advisory | B collapsed default/hidden Calendar refresh; prior advisory tests updated to expand; manual measured layout |

## Verification

Final combined `npm run check` exited 0 against the final implementation.

| Check | Exact result |
| --- | --- |
| Domain/service/provider | 264 passed, 19 files |
| Real PostgreSQL | 198 passed, 9 files |
| Browser | 75 passed, including open-page start-time expiry; 2.6m |
| Total | 537 passed; 64 additional tests beyond the approved 473-test Phase 4B suite |
| Restart/idempotency | All three proof scripts passed; six successful production process restart cycles, plus unavailable-DB boots |
| Lint | Passed, zero warnings |
| TypeScript | Passed |
| Documentation | Required documents, Markdown fences and local links passed |
| Production | Compiled successfully (1615ms), route generation/build passed |
| Migration | Clean/repeatable test migrations, normal local development migration, and all eight prior SQL SHA-256 hashes unchanged |
| Audit | Offline cached audit: 0 info/low/moderate/high/critical; dependency lockfile unchanged |

The initial browser gate exposed older Calendar tests waiting on controls now deliberately collapsed, and a modal focus restoration issue. Both were corrected. A final timezone regression test also preserves Phase 4B's empty-day behavior when Pacific/Apia skips an entire local date. The complete final gate passes. A sandboxed unit run could not bind its localhost fixture; the authorized local run passes. No failed checks remain in the final gate.

Production restart scripts exercise six successful process stop/start cycles across existing foundation/Goal/Milestone/Action/Plan/amendment, Calendar/hours and new TimeBlock proofs. New proof runs in its own disposable PostgreSQL database, authenticates for real and verifies create/edit/cancel original DTOs, one retained cancelled block, three receipts, unchanged source/baseline/history/settings, and 503 on every scheduling surface with DB unavailable. No process reload substitute.

Dependency versions/lockfile unchanged. `npm audit --offline --json` reports zero vulnerabilities at every severity using cached advisories. This is not a fresh registry audit. Automatic approval review rejected the earlier live audit because it would transmit dependency metadata to the npm service without explicit authorization; no bypass or live retry was made. No hosted CI or deployment was requested/run.

## Manual quality gate and interaction count

Real production app on dedicated port 3104, disposable PostgreSQL, synthetic authenticated account in a separate Chrome profile, simulated Calendar. Week 5–11 October 2026: 11h manual capacity, 2h reserve, 6h30 committed; first Action estimate 4h and commitment budget 3h; explicit weekday 09–17 hours. None of the normal user's source/plan/Calendar rows were used or changed.

1. Simulated consent, explicit Work/Personal selection and refresh through secondary detail area; no event titles.
2. Two 90m blocks for the 3h commitment: Tuesday 15:00–16:30, Wednesday 14:00–15:30. First shows 90m still unscheduled; second 0m. Reload retains both with GMT+1 display.
3. Tuesday 15:30–16:30 overlap rejected, retaining inputs. Changed to Tuesday 10:00–11:30: busy warning, disabled confirm until acknowledgement, neutral 90m beyond budget; accepted deliberately.
4. Thursday 07:00–08:00 outside-hours warning, explicit acknowledgement; accepted. Total 5h30, original budget still 3h and estimate 4h.
5. Rescheduled Wednesday to 15:00–16:30, same duration and logical commitment; total stays 5h30.
6. Intentional budget amendment 3h→2h: same four blocks and total 5h30; neutral 3h30 excess. Drop amendment: all four preserved/review-required, no Reschedule controls. Intentional Thursday cancellation leaves three active review-required blocks and one cancelled record after reload.
7. Manual fixture assertion proves source/estimates, original baseline content/timestamps/capacity/reserve/commitments and recurring hours unchanged. Technical Plan.version advances only for the two deliberate amendments. Disposable tab/server/database cleaned up afterward.

Six control-level steps for ordinary placement: Add, choose Day, Start, End, Review, Schedule. One acknowledgement adds a seventh; both warnings would add an eighth. Count excludes page navigation, scrolling, typing/native-picker keystrokes and pauses to inspect context. Chrome's automation fill required native key changes to trigger React date/time events; this is recorded separately from the product control count. There was no forced return to the Action pool, settings or integrations between normal placements.

The day list makes protected time and orphaned intent understandable without an event calendar. Six controls are a reasonable first weekly flow; explicit review is useful before exceptional work. The details area measured 308 CSS pixels collapsed versus 1,492 expanded at the walkthrough viewport, keeping 1,184 pixels of optional timing detail out of the default flow. The existing hero/capacity section still makes the page long, especially narrow; this focused polish does not redesign them. Native fields and one modal avoid drag/drop complexity. Browser checking fixed focus restoration after dialog removal, including Escape and a sensible fallback after cancellation.

Visual evidence: [normal two-block schedule](screenshots/phase-five-a-schedule.png), [manual drop/cancellation state](screenshots/phase-five-a-manual.png). Reproduction: [manual fixture](../scripts/scheduling-walkthrough.ts).

## Limitations and next proposal

Google was simulated throughout this phase. A successful real Google OAuth + FreeBusy walkthrough with an actual test account remains required before any future writing; this phase provides no evidence of that prerequisite. Timing can change after save; cached warnings are advisory. Unsaved editors/uncertain payloads live in memory; persistence/replay concerns confirmed records and receipts. No post-save conflict reconciliation, execution outcomes, schedule revision ledger or offline drafts. No Google writing/output calendar/events sync/titles, suggestions/optimizer/automatic gap fill, AI, recurrence/cross-midnight, drag/drop, minimum duration/buffers/travel, automatic amendment, reminders, Focus Sessions/timers/actuals/reviews or other integrations.

Recommend **Phase 6A — Focus Sessions / Actual Execution**, proposal only. Manual placement already makes protected time clear with six ordinary controls; the missing value is evidence of doing the work. Next contract should let the user intentionally start work from one block and preserve measured/confirmed actual effort independently. Placement suggestions should wait for observed repeated placement friction, without assuming an optimizer is necessary. Stop at Phase 5A.
