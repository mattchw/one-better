# UI Redesign R2 — Goal-to-Week workflow

Implemented 3 October 2026. R2 only; Phase 0–7A semantics remain authoritative. No schema, migration, domain service, provider, dependency or API changes.

## Result

Goals communicate direction, observable checkpoints, current weekly choices and a small preview of eligible Open Actions. Goal detail pairs progress checkpoints with This week’s work and concrete Next actions. Achieved checkpoints are shown by name; Completed/Archived definitions, evidence and Actions remain available through explicit history views. Progress is observed checkpoint completion, with no inferred Goal completion or score. Preview ordering follows the existing catalogue; it does not invent prioritisation.

Goal capture/edit uses a compact native dialog. Detail also supports the same guarded Goal edit/archive commands. Source definitions remain independently editable only when their existing mutability rules permit it.

An eligible Action has **Add to this week**. The dialog asks for an explicit whole-minute commitment budget, shows capacity after protected reserve and existing choices, and supports the current or a future week. Already-chosen eligible Actions can **Choose another week**. A selected future week is retained in the Goal URL and survives reload.

A week without a plan requires explicit capacity and reserve followed by **Create weekly draft**, then a separate **Add to week**. Adding preserves every existing selection, budget and source guard, submits through the existing full-state Weekly Plan PATCH, and uses its saved version. The shortcut prevents exceeding available capacity; the existing planning editor retains its original ability to save an over-capacity Draft and resolve it before commit. A committed week routes to its existing deliberate amendment workflow or a future Draft.

Draft choices appear immediately in the Calendar rail, clearly labelled **chosen · Draft**. Review and commit still establishes the immutable baseline before scheduling. Draft context is live source context; committed context and budgets come from the effective immutable plan, including amendments. Missing/changed/ineligible Draft context remains explicit and blocks commitment. Nothing is automatically committed or scheduled.

Calendar commitments retain one scheduled/budget ratio and progress bar. Only partial scheduling adds remaining time; zero scheduling omits the duplicate remaining-budget sentence. The R1 viewport fit and existing guarded scheduling editor remain in place.

## Recovery and invariants

- Ownership, exact-Origin mutation protection, eligibility, maximum 50 selections, duplicate prevention, capacity/reserve, concurrency, immutable snapshots and receipts remain enforced by existing services.
- A stale version, source race or concurrently committed week retains the entered budget. **Review latest context** displays current source context and weekly choices; **Use reviewed context** is explicit before another save.
- Existing selected-source changes require the original weekly planning source-review workflow. The shortcut never silently refreshes another Action’s guard.
- Uncertain writes, including an acknowledged write followed by a failed read, keep the exact command and mutation ID, lock editing/closing and expose **Retry same command**. After acknowledgement/replay the UI re-reads current state rather than displaying a historical receipt as truth.
- Native dialogs support keyboard entry, Escape cancellation and focus restoration. Pending commands and entered budgets have a browser unload guard. Errors remain distinct from an empty week.

## Verification

- 353 domain/service tests and 263 PostgreSQL tests passed.
- Full browser/HTTP run: 118 passed. Final affected-screen run: 44 passed, including all ten R2 tests. Together these cover **120 unique browser/HTTP tests**, for **736 unique tests** overall.
- R2 tests cover the overview → detail → Action capture → explicit budget → Calendar Draft → review/commit → Schedule journey; capacity, duplicates, persistence, focus restoration, concurrency, changed and terminal sources, exact lost-response replay, future Draft creation/recovery, effective amendments, mobile overflow, already-selected source review, concurrent commitment, and detail Goal edits/archival.
- All six production restart proofs passed. The initial combined run encountered a PostgreSQL teardown error after the Daily Reflection assertions passed; Daily Reflection and Weekly Review were rerun independently and completed successfully.
- Lint, TypeScript and production build passed. Documentation links/fences checked. Production app restarted at `http://127.0.0.1:3100`.
- Manual browser QA used a disposable database at port 3104. Goal overview → detail → create Action → choose 90m → Calendar was exercised on desktop and mobile; a reload/navigation retained the choice. The original review/commit and Schedule entry were also inspected. Automated scheduling regressions cover actual placements, warnings, rescheduling, cancellation and immutable history. Real user data and Google Calendar were not changed.
- Checked 1440×900, 1024×900 and 390×844. No horizontal overflow in the tested Goal layouts; Calendar document height still equals viewport height. Dialogs and panels own overflow when needed. Goal content pages scroll normally.

## Screenshots

| Surface | 1440px | 1024px | Mobile |
| --- | --- | --- | --- |
| Goals overview | [Desktop](screenshots/goals-r2-1440.jpg) | [Laptop](screenshots/goals-r2-1024.jpg) | [Mobile](screenshots/goals-r2-mobile.jpg) |
| Goal detail | [Desktop](screenshots/goal-detail-r2-1440.jpg) | [Laptop](screenshots/goal-detail-r2-1024.jpg) | [Mobile, full page](screenshots/goal-detail-r2-mobile.jpg) |
| Weekly budget | [Desktop](screenshots/add-to-week-r2-1440.jpg) | — | [Mobile](screenshots/add-to-week-r2-mobile.jpg) |
| Calendar Draft rail | [Desktop](screenshots/calendar-draft-r2-1440.jpg) | — | [Mobile](screenshots/calendar-draft-r2-mobile.jpg) |

[Compact Action capture](screenshots/action-create-r2-1440.jpg). Fixture reproduction: `tsx --env-file=.env.test scripts/ui-r2-walkthrough.ts`; enter `stop` to remove its disposable database and server.

## Boundary

Stop after R2. R3 Focus, R4 Review, Seasons, AI proposals, scheduling automation and additional integrations remain future work. The existing weekly review/commit editor is intentionally reused; redesigning that editor is outside this slice. No permanent metrics were added to the Calendar context rail.
