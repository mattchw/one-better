# R6 — Instant Calendar interaction

Implemented 7 October 2026. This slice covers Calendar TimeBlock creation, rescheduling, resizing, cancellation and their derived totals, plus immediate weekly-task addition, removal and reassignment between Goals and General. Other task edits and Focus start retain their existing mutation flows.

## State and authority

Postgres remains authoritative. `CalendarStateController` uses TanStack Query **5.104.1** for confirmed scheduling views and background reads. A separate, small in-memory intention ledger projects pending changes over those views. Selection, hover, dialogs and viewport remain React state. There is no Zustand domain store, persisted client replica or backend redesign.

One controller is created per mounted Calendar, scoped to that authenticated page. Query retention is infinite within that instance because projection subscribers are not `useQuery` observers; idle pages keep confirmed views. The controller is not stored globally. A confirmed TimeBlock response patches the cache immediately. Creation replaces `optimistic:<mutationId>` with the server identity, including selection. The calendar, task progress, still-to-place total, selected details and existing Quick focus candidates derive from the same projection. Month/Day range projections incorporate cached planned blocks. Temporary or pending blocks cannot start Focus.

The modal keeps its existing placement review before Schedule/Save. After confirmation it closes immediately and the change appears while persistence continues. Cancellation keeps its confirmation, then disappears immediately. Routine success does not show a toast or wait for a page reload. A muted card/dot and a small saving status indicate pending work.

## Drag, resize and queue

FullCalendar **7.1.0** owns pointer movement and resize previews. No request is made while dragging. A completed drop/resize submits an intention with 30-minute snapping. The existing dialog remains the keyboard alternative.

Each block retains the latest intended interval while an earlier write is running. Intermediate unsent moves are coalesced. After the active command returns, the next command uses its canonical block version and a fresh placement preview. Older responses cannot visually overwrite a later intention.

Persistence is additionally serialized across the mounted controller, because a placement review key covers neighboring blocks in the same plan. A paused busy-time review or uncertain save pauses other writes for that plan; the user can still express further moves on a saving block.

Google busy or daylight-saving adjustments pause after preview and before the acknowledged write. The intended placement stays visible with **Move back** and **Schedule anyway** / **Save reviewed times**. Outside Focusable Hours remains a tag and does not require the removed checkbox.

## Failure and reconciliation

- Definitive validation rejection removes that block's intention, restores its confirmed projection and shows the server explanation. Other pending intentions remain intact. A background read reconciles changes made elsewhere.
- An uncertain write preserves the exact command identity/body and the optimistic placement. **Retry same command** resolves that receipt before sending any later coalesced move. It does not generate another creation identity.
- Reads already in flight cannot replace a newer intention or canonical response. Reconciliation also retains newer block versions if a stale response arrives after a save.
- Failure of background reconciliation does not turn a confirmed write into a failed save.
- Navigation/reload retains the existing native before-unload guard while work is pending. This is not an offline queue: closing the page discards unsent intentions. Accepted server writes remain persisted.

Existing ownership, eligibility, week boundaries, expected versions, receipts, overlap, execution locks, timezone/DST and plan-context validation remain in the existing deterministic services. No schema, routes, AI prompts or AI capabilities changed.

## Validation

All QA mutations use disposable loopback Postgres databases and mocked external providers, not the shared Neon database.

Controller tests cover temporary identities, derived totals, coalescing/version handoff, rollback with an unrelated pending creation, advisory review, exact uncertain retries, stale reads, read failures and read-only boundaries. Browser tests hold network requests to prove the UI changes before persistence; they exercise actual pointer drag/resize, overlap rollback, busy-time confirmation, another-tab version changes, exact creation receipt retry and reload persistence.

Results:

- Lint, TypeScript and documentation checks: PASS.
- Full unit suite: **522 passed**, including 9 intention/cache controller tests.
- Targeted scheduling and calendar-task database suites: **37 passed**.
- Calendar browser suite: 45 passed in the full run; its remaining stale-version case initially used an invalid test-only PATCH payload (`blockId`), then passed after correcting the fixture. All **46 Calendar scenarios** have passed.
- Production build: PASS. Local preview restarted on port 3100; health endpoint returned `ready` and the authenticated Calendar rendered correctly. The existing ChatGPT-host dynamic filesystem tracing warning remains outside this slice.

The initial pointer-test assertions were corrected to wait for FullCalendar's temporary drag mirror to clear, and to perform repeated moves within a visible desktop viewport. The application updates the block's accessible time label after projection changes. No backend validation was loosened to make a test pass.

Screenshots generated by browser QA (ignored local artifacts, recreated by tests):

- `.cache/instant-calendar-creating.png` — temporary creation before the server replies.
- `.cache/instant-calendar-moving.png` — latest coalesced move while the first write is held.
- `.cache/instant-calendar-rollback.png` — rejected overlap restored with an explanation.
- `.cache/instant-calendar-busy-review.png` — advisory review before an acknowledged save.

## Limits

The cache is mounted-page scoped. Another tab is reconciled through rejection/background reads or manual refresh; there is no push subscription. Quick focus refreshes its candidate set on the existing 30-second poll/window focus; existing candidates update through the projection immediately. Other domain mutations and the standalone full scheduler retain their existing behavior for a later slice. Client checks are convenience guards, never authorization.

## Follow-up — instant task moves

Moving a weekly task by dragging or **Move to…** now projects its destination before even the fresh Action read finishes. The task and eligible future calendar blocks change Goal together, while durations, block-specific names and recorded history remain intact. General remains a nullable Goal assignment. Executed and past block snapshots retain their original context.

The fresh Action read still checks mutability and supplies the expected Action version. The existing task service checks plan and destination versions and persists the move. Its canonical receipt patches commitments and affected block versions immediately; scheduling, workspace and quiet activity reads reconcile in the background. Neither the save nor the existing six-second Undo notice waits for those reads. Older reads cannot overwrite a pending or newer confirmed move.

Pending tasks show a muted saving indicator. Conflicting task/schedule edits are guarded until confirmation. A preflight failure or definitive rejection restores the original group and blocks with an explanation. An uncertain write keeps the projected destination and exact mutation body for **Retry same task change**; it cannot silently create a second move. Undo, rename and budget changes retain their existing flows. No backend, schema or AI changes were needed.

Follow-up validation:

- Full unit suite: **525 passed**, including three additional task-move controller tests.
- Calendar-task database suite: **17 passed**, including existing Undo and snapshot rules.
- Targeted browser run: **12 passed** — four new delayed-network/preflight/rejection/uncertain-retry cases, existing task-menu and General regressions, and six instant TimeBlock scenarios.
- Lint, TypeScript, documentation checks and production build: PASS. The existing ChatGPT tracing warning remains.

The browser tests hold the Action read, task POST and background scheduling read separately. They prove relocation happens before the first read returns, confirmation unlocks without awaiting reconciliation, a subsequent move uses the new plan version, uncertain retries reuse the exact command, and reload preserves the result. These fixtures use disposable local databases. `.cache/instant-task-moving.png` captures a task under Workout while its Action read is still held.

## Follow-up — instant task addition

**Add task** immediately closes the inline form and projects a temporary commitment under the selected Goal or General. Its budget contributes to “still to place” immediately. A saving indicator distinguishes it from confirmed tasks; scheduling and conflicting edits wait for canonical Action/commitment identities. The receipt replaces the temporary task without awaiting background reads. The next edit uses the returned plan version.

Definitive rejection removes the temporary task, restores totals and reopens the form with the task name, duration and linked Goal preserved. An uncertain response keeps one unconfirmed task visible and retries the exact receipt, avoiding duplicate Actions or commitments. The existing six-second Undo remains available after confirmation. Title, duration, week and task-count guards remain in the deterministic server service; no route, schema or AI behavior changed.

Unit tests cover temporary identities, totals, canonical replacement, nullable Goals, uncertainty, rollback, stale handles and late reads. Browser QA holds the POST and subsequent scheduling read separately, checks preserved form choices after rejection, simulates a committed write with a lost response, verifies exact retry and reload, and exercises Undo and scheduling with confirmed identities. `.cache/instant-task-adding.png` captures the new task while its save request is held. QA mutations use disposable local databases.

Addition follow-up results: **528 unit tests**, **17 Calendar-task database tests**, lint and TypeScript passed. The targeted browser run passed 11 cases; its new scheduling case initially addressed the existing Day field as Date in the test. Correcting that locator made the case pass on rerun, so all **12 selected scenarios** passed, including four new addition cases and task-move/Goal/General regressions. Production build and documentation checks also passed. Existing first-week creation retains its guarded flow; this addition work covers the Calendar's **+ Add a task** inline form.

## Follow-up — instant task removal

**Delete** immediately removes the weekly commitment and projects cancellation of its planned blocks that have no recorded execution. The week summary updates at once; pending cancellations do not appear in the quiet cancellation history. Selected details disappear with a cancelled block and return if the save is rejected. Blocks with recorded execution retain their original schedule, context and actuals, with removed-commitment review status.

The existing task service remains authoritative. Only block IDs and versions listed in its Drop receipt become confirmed cancellations, so a Focus Session started elsewhere is preserved. Confirmed task and block versions patch immediately, while reads reconcile in the background. The existing six-second Undo becomes available as soon as the receipt arrives, without waiting for those reads; restoring through Undo still uses the guarded server command and refreshed facts.

A definitive rejection restores the task, block selection and totals. An uncertain response keeps the removal projected with an explicit unconfirmed message and exact-command retry. Conflicting writes remain guarded until confirmation. No database, service, schema or AI changes were needed.

Unit QA covers executed/past/unrelated blocks, receipt versions, rollback, stale handles, uncertain removal, late reads and execution appearing elsewhere. Browser QA holds deletion and background reads separately, verifies Undo restoration, rejection recovery and selection, exact retry/reload, and preservation of a completed Focus Session. `.cache/instant-task-removing.png` captures removal before its POST completes. QA mutations use disposable local databases.

Removal follow-up validation: **532 unit tests**, **17 Calendar-task database tests** and **14 targeted browser scenarios** passed, including four new removal cases plus addition/movement, direct controls and Undo-expiry regressions. Lint, TypeScript, documentation checks and production build passed. The existing ChatGPT filesystem tracing warning remains outside this change.

References: [TanStack Query optimistic updates](https://tanstack.com/query/latest/docs/framework/react/guides/optimistic-updates), [FullCalendar completed drops](https://fullcalendar.io/docs/eventDrop).
